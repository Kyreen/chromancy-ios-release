import { Capacitor } from "@capacitor/core";
import { NativeMediaStore } from "./nativeMediaStore";

export interface ExportSourceInfo {
  mimeType?: string | null;
  extension?: string | null;
  originalName?: string | null;
}

const MIME_TO_EXTENSION: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
  "video/mp4": "mp4",
  "video/webm": "webm",
};

const NATIVE_BRIDGE_INLINE_LIMIT = 450_000;
const NATIVE_BRIDGE_CHUNK_BYTE_SIZE = 128 * 1024;

async function triggerBrowserDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.rel = "noopener";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(url), 1500);
  }
}

export function extensionFromMimeType(mimeType?: string | null): string | null {
  if (!mimeType) return null;
  return MIME_TO_EXTENSION[mimeType.toLowerCase()] || null;
}

export function sanitizeExtension(extension?: string | null): string | null {
  if (!extension) return null;
  return extension.replace(/^\./, "").trim().toLowerCase() || null;
}

export function normaliseExportTarget(source: ExportSourceInfo = {}, fallbackMimeType = "image/jpeg") {
  const requestedMime = source.mimeType?.toLowerCase() || fallbackMimeType;
  const requestedExt = sanitizeExtension(source.extension) || extensionFromMimeType(requestedMime) || extensionFromMimeType(fallbackMimeType) || "jpg";

  if (requestedExt === "jpeg") {
    return { mimeType: "image/jpeg", extension: "jpg" };
  }

  if (requestedExt === "jpg") {
    return { mimeType: "image/jpeg", extension: "jpg" };
  }

  if (["png", "webp", "pdf", "mp4", "webm"].includes(requestedExt)) {
    const mimeType = requestedExt === "pdf"
      ? "application/pdf"
      : requestedExt in { mp4: 1, webm: 1 }
        ? `video/${requestedExt}`
        : `image/${requestedExt}`;
    return { mimeType, extension: requestedExt };
  }

  return { mimeType: fallbackMimeType, extension: extensionFromMimeType(fallbackMimeType) || "jpg" };
}

export async function blobFromDataUrl(dataUrl: string): Promise<Blob> {
  const response = await fetch(dataUrl);
  if (!response.ok) throw new Error("Failed to prepare export file.");
  return await response.blob();
}


export async function convertDataUrlToBlob(dataUrl: string, mimeType: string, quality = 0.96): Promise<Blob> {
  const sourceBlob = await blobFromDataUrl(dataUrl);
  if ((sourceBlob.type || "").toLowerCase() === mimeType.toLowerCase()) {
    return sourceBlob;
  }

  const objectUrl = URL.createObjectURL(sourceBlob);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("Failed to convert export image."));
      element.src = objectUrl;
    });

    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Failed to prepare export canvas.");
    ctx.drawImage(image, 0, 0);

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, mimeType, quality));
    if (!blob) throw new Error("Failed to encode export image.");
    return blob;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function blobToBase64(blob: Blob): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Failed to prepare file data."));
    reader.readAsDataURL(blob);
  });

  const commaIndex = dataUrl.indexOf(",");
  if (commaIndex < 0) throw new Error("Failed to encode file.");
  return dataUrl.slice(commaIndex + 1);
}

async function blobSliceToBase64(blob: Blob) {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Failed to prepare file data."));
    reader.readAsDataURL(blob);
  });

  const commaIndex = dataUrl.indexOf(",");
  if (commaIndex < 0) throw new Error("Failed to encode file.");
  return dataUrl.slice(commaIndex + 1);
}

async function saveLargeBlobToNativeDevice(blob: Blob, filename: string, mimeType: string) {
  const session = await NativeMediaStore.beginFile({
    fileName: filename,
    mimeType,
  });

  try {
    for (let start = 0; start < blob.size; start += NATIVE_BRIDGE_CHUNK_BYTE_SIZE) {
      const chunkBlob = blob.slice(start, start + NATIVE_BRIDGE_CHUNK_BYTE_SIZE);
      const base64Chunk = await blobSliceToBase64(chunkBlob);
      await NativeMediaStore.appendChunk({
        sessionId: session.sessionId,
        base64Chunk,
      });
    }

    const result = await NativeMediaStore.finishFile({ sessionId: session.sessionId });
    if (!result?.uri) throw new Error("File save failed.");
  } catch (error) {
    await NativeMediaStore.abortFile({ sessionId: session.sessionId }).catch(() => undefined);
    throw error;
  }
}

async function saveBlobToNativeDevice(blob: Blob, filename: string): Promise<void> {
  const mimeType = blob.type || "application/octet-stream";
  const mustUseChunkedVideoSave = mimeType.toLowerCase().startsWith("video/");
  if (!mustUseChunkedVideoSave && blob.size <= NATIVE_BRIDGE_INLINE_LIMIT) {
    const base64Data = await blobToBase64(blob);
    const result = await NativeMediaStore.saveFile({
      base64Data,
      fileName: filename,
      mimeType,
    });
    if (!result?.uri) throw new Error("File save failed.");
    return;
  }

  await saveLargeBlobToNativeDevice(blob, filename, mimeType);
}

export async function saveBlobToDevice(blob: Blob, filename: string): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    try {
      await saveBlobToNativeDevice(blob, filename);
      return;
    } catch (error) {
      if (Capacitor.getPlatform() !== "ios") {
        throw error;
      }
    }
  }

  const mimeType = (blob.type || "").toLowerCase();
  const shouldForceDownload = mimeType.startsWith("video/");

  if (!shouldForceDownload && typeof navigator !== "undefined" && "canShare" in navigator && "share" in navigator) {
    const file = new File([blob], filename, { type: blob.type || "application/octet-stream" });
    try {
      if ((navigator as any).canShare?.({ files: [file] })) {
        await (navigator as any).share({ files: [file], title: filename });
        return;
      }
    } catch {
      // fall through to download fallback
    }
  }

  await triggerBrowserDownload(blob, filename);
}

export async function saveDataUrlToDevice(dataUrl: string, filename: string): Promise<void> {
  const blob = await blobFromDataUrl(dataUrl);
  await saveBlobToDevice(blob, filename);
}

