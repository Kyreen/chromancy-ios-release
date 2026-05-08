import { processPhotoLocallyCore, type LocalPhotoToolId } from "../lib/localMediaCore";

self.onmessage = async (event: MessageEvent<{ id: string; blob: Blob; toolId: LocalPhotoToolId; maxDimension?: number }>) => {
  const { id, blob, toolId, maxDimension } = event.data;
  try {
    const result = await processPhotoLocallyCore(blob, toolId, { maxDimension });
    (self as unknown as Worker).postMessage({ id, ok: true, blob: result.blob, width: result.width, height: result.height });
  } catch (error: any) {
    (self as unknown as Worker).postMessage({ id, ok: false, error: error?.message || "Processing failed." });
  }
};
