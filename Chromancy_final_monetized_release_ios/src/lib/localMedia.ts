import { processPhotoLocallyCore, type LocalPhotoToolId } from "./localMediaCore";

const bitmapCache = new Map<string, ImageBitmap>();
const videoBlobCache = new Map<string, Blob>();
const decodedBlobCache = new Map<string, Blob>();
const previewCache = new Map<string, string>();
const finalCache = new Map<string, Promise<string>>();
const previewToFinal = new Map<string, Promise<string>>();

const PREVIEW_MAX_DIMENSION = 960;

async function blobToDataUrl(blob: Blob): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Unable to read processed image."));
    reader.readAsDataURL(blob);
  });
}

let photoWorker: Worker | null = null;
let taskCounter = 0;
const pending = new Map<string, { resolve: (value: string) => void; reject: (error: Error) => void }>();

async function decodeBlobFromUrl(url: string): Promise<Blob> {
  const cached = decodedBlobCache.get(url);
  if (cached) return cached;
  const response = await fetch(url);
  if (!response.ok) throw new Error("Unable to read media.");
  const blob = await response.blob();
  decodedBlobCache.set(url, blob);
  return blob;
}

export async function getCachedBitmap(source: string): Promise<ImageBitmap> {
  const cached = bitmapCache.get(source);
  if (cached) return cached;
  const blob = await decodeBlobFromUrl(source);
  const bitmap = await createImageBitmap(blob, { colorSpaceConversion: "default", premultiplyAlpha: "default" });
  bitmapCache.set(source, bitmap);
  return bitmap;
}

export async function cacheVideoBlob(url: string): Promise<Blob> {
  const cached = videoBlobCache.get(url);
  if (cached) return cached;
  const blob = await decodeBlobFromUrl(url);
  videoBlobCache.set(url, blob);
  return blob;
}

function getWorker() {
  if (photoWorker || typeof Worker === "undefined") return photoWorker;
  photoWorker = new Worker(new URL("../workers/photoProcessingWorker.ts", import.meta.url), { type: "module" });
  photoWorker.onmessage = (event: MessageEvent<{ id: string; ok: boolean; blob?: Blob; error?: string }>) => {
    const message = event.data;
    const task = pending.get(message.id);
    if (!task) return;
    pending.delete(message.id);
    if (!message.ok || !message.blob) {
      task.reject(new Error(message.error || "Processing failed."));
      return;
    }
    blobToDataUrl(message.blob).then(task.resolve).catch((error) => task.reject(error instanceof Error ? error : new Error("Processing failed.")));
  };
  return photoWorker;
}

export async function warmLocalPhotoProcessor() {
  getWorker();
  return null;
}

async function processOnWorker(source: string, toolId: LocalPhotoToolId, maxDimension?: number): Promise<string> {
  const worker = getWorker();
  if (!worker) throw new Error("Worker unavailable");
  const blob = await decodeBlobFromUrl(source);
  const id = `photo-${Date.now()}-${(taskCounter += 1)}`;
  return await new Promise<string>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, blob, toolId, maxDimension });
  });
}

async function processOnMainThread(source: string, toolId: LocalPhotoToolId, maxDimension?: number): Promise<string> {
  const blob = await decodeBlobFromUrl(source);
  const result = await processPhotoLocallyCore(blob, toolId, { maxDimension });
  return await blobToDataUrl(result.blob);
}

async function processVariant(source: string, toolId: LocalPhotoToolId, maxDimension?: number) {
  return await (typeof Worker !== "undefined"
    ? processOnWorker(source, toolId, maxDimension).catch(() => processOnMainThread(source, toolId, maxDimension))
    : processOnMainThread(source, toolId, maxDimension));
}

export async function processPhotoLocally(source: string, toolId: LocalPhotoToolId) {
  const previewKey = `${toolId}::preview::${source}`;
  const cachedPreview = previewCache.get(previewKey);
  if (cachedPreview) return cachedPreview;

  const previewUrl = await processVariant(source, toolId, PREVIEW_MAX_DIMENSION);
  previewCache.set(previewKey, previewUrl);

  const finalKey = `${toolId}::final::${source}`;
  let finalPromise = finalCache.get(finalKey);
  if (!finalPromise) {
    finalPromise = processVariant(source, toolId).catch(() => previewUrl);
    finalCache.set(finalKey, finalPromise);
  }
  previewToFinal.set(previewUrl, finalPromise);

  return previewUrl;
}

export async function resolveProcessedPhotoForExport(currentUrl: string) {
  const finalPromise = previewToFinal.get(currentUrl);
  if (!finalPromise) return currentUrl;
  return await finalPromise;
}
