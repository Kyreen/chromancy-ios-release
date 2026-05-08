import { registerPlugin } from "@capacitor/core";

export interface NativeMediaSaveResult {
  uri: string;
  displayName: string;
  relativePath: string;
  mimeType: string;
}

export interface NativeMediaStorePlugin {
  saveFile(options: {
    base64Data: string;
    fileName: string;
    mimeType: string;
  }): Promise<NativeMediaSaveResult>;
  beginFile(options: {
    fileName: string;
    mimeType: string;
  }): Promise<{ sessionId: string }>;
  appendChunk(options: {
    sessionId: string;
    base64Chunk: string;
  }): Promise<void>;
  finishFile(options: {
    sessionId: string;
  }): Promise<NativeMediaSaveResult>;
  abortFile(options: {
    sessionId: string;
  }): Promise<void>;
}

export const NativeMediaStore = registerPlugin<NativeMediaStorePlugin>("NativeMediaStore");
