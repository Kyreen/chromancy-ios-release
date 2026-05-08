const thumbnailCache = new Map<string, Promise<string>>();
const videoAssetRegistry = new Set<string>();

export function registerVideoAsset(src: string) {
  if (src.startsWith("blob:") || src.startsWith("data:video") || /\.(mp4|mov|avi|m4v|webm)(\?|#|$)/i.test(src)) {
    videoAssetRegistry.add(src);
  }
}

export function unregisterVideoAsset(src: string) {
  videoAssetRegistry.delete(src);
  thumbnailCache.delete(src);
}

function pickFrameTime(duration: number) {
  if (!Number.isFinite(duration) || duration <= 0) return 0.1;
  return Math.min(Math.max(duration * 0.18, 0.12), Math.max(duration - 0.12, 0.12));
}

function isVideoUrl(src: string) {
  return videoAssetRegistry.has(src) || src.startsWith("data:video") || /\.(mp4|mov|avi|m4v|webm)(\?|#|$)/i.test(src);
}

export function looksLikeVideoAsset(src: string) {
  return isVideoUrl(src);
}

export async function getVideoThumbnail(src: string): Promise<string> {
  if (!isVideoUrl(src)) return src;
  let cached = thumbnailCache.get(src);
  if (cached) return cached;

  cached = new Promise<string>((resolve, reject) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;
    video.crossOrigin = "anonymous";

    let settled = false;
    const cleanup = () => {
      video.onloadedmetadata = null;
      video.onseeked = null;
      video.onerror = null;
    };
    const fail = (error?: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      thumbnailCache.delete(src);
      reject(error instanceof Error ? error : new Error("Unable to create thumbnail."));
    };

    video.onerror = () => fail(new Error("Unable to load video thumbnail."));
    video.onloadedmetadata = () => {
      try {
        video.currentTime = pickFrameTime(video.duration);
      } catch (error) {
        fail(error);
      }
    };
    video.onseeked = () => {
      try {
        const width = Math.max(1, video.videoWidth || 1);
        const height = Math.max(1, video.videoHeight || 1);
        const maxWidth = 720;
        const ratio = Math.min(1, maxWidth / width);
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(width * ratio));
        canvas.height = Math.max(1, Math.round(height * ratio));
        const ctx = canvas.getContext("2d", { alpha: false, willReadFrequently: false });
        if (!ctx) throw new Error("Canvas unavailable.");
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL("image/jpeg", 0.86);
        settled = true;
        cleanup();
        resolve(dataUrl);
      } catch (error) {
        fail(error);
      }
    };

    video.src = src;
  });

  thumbnailCache.set(src, cached);
  return cached;
}
