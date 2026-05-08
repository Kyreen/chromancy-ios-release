import type { MediaHistoryType } from "./usePhotoStack";

const DB_NAME = "chromancy-local-history";
const DB_VERSION = 1;
const STORE_NAME = "entries";
const HISTORY_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_HISTORY_ENTRIES = 80;

export interface LocalHistoryEntry {
  id: string;
  createdAt: number;
  expiresAt: number;
  type: MediaHistoryType;
  mimeType: string;
  size: number;
  filename: string;
}

interface StoredLocalHistoryEntry extends LocalHistoryEntry {
  blob: Blob;
}

function isIndexedDbAvailable() {
  return typeof indexedDB !== "undefined";
}

function openLocalHistoryDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!isIndexedDbAvailable()) {
      reject(new Error("Local history storage is not available on this device."));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error || new Error("Local history storage could not open."));
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex("createdAt", "createdAt");
        store.createIndex("expiresAt", "expiresAt");
      }
    };
  });
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onerror = () => reject(request.error || new Error("Local history request failed."));
    request.onsuccess = () => resolve(request.result);
  });
}

async function getAllStoredEntries(): Promise<StoredLocalHistoryEntry[]> {
  if (!isIndexedDbAvailable()) return [];
  const db = await openLocalHistoryDb();
  try {
    const transaction = db.transaction(STORE_NAME, "readonly");
    return await requestToPromise<StoredLocalHistoryEntry[]>(transaction.objectStore(STORE_NAME).getAll());
  } finally {
    db.close();
  }
}

async function putStoredEntry(entry: StoredLocalHistoryEntry) {
  if (!isIndexedDbAvailable()) return;
  const db = await openLocalHistoryDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error("Local history save failed."));
      transaction.objectStore(STORE_NAME).put(entry);
    });
  } finally {
    db.close();
  }
}

export async function deleteLocalHistoryEntry(id: string) {
  if (!isIndexedDbAvailable()) return;
  const db = await openLocalHistoryDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error("Local history delete failed."));
      transaction.objectStore(STORE_NAME).delete(id);
    });
  } finally {
    db.close();
  }
}

export async function updateLocalHistoryEntry(
  id: string,
  updates: Partial<Pick<LocalHistoryEntry, "filename">>,
) {
  if (!isIndexedDbAvailable()) return;
  const db = await openLocalHistoryDb();
  try {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const existing = await requestToPromise<StoredLocalHistoryEntry | undefined>(store.get(id));
    if (!existing) return;
    store.put({
      ...existing,
      ...updates,
    });
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error("Local history update failed."));
    });
  } finally {
    db.close();
  }
}

export async function clearLocalHistory() {
  if (!isIndexedDbAvailable()) return;
  const db = await openLocalHistoryDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error("Local history clear failed."));
      transaction.objectStore(STORE_NAME).clear();
    });
  } finally {
    db.close();
  }
}

export async function purgeExpiredLocalHistory() {
  const now = Date.now();
  const entries = await getAllStoredEntries();
  await Promise.all(entries.filter((entry) => entry.expiresAt <= now).map((entry) => deleteLocalHistoryEntry(entry.id)));
}

async function trimLocalHistory() {
  const entries = await getAllStoredEntries();
  const sorted = entries.sort((a, b) => b.createdAt - a.createdAt);
  const overflow = sorted.slice(MAX_HISTORY_ENTRIES);
  await Promise.all(overflow.map((entry) => deleteLocalHistoryEntry(entry.id)));
}

function inferMimeType(uri: string, blob: Blob) {
  if (blob.type) return blob.type;
  if (uri.startsWith("data:")) {
    return uri.slice(5, uri.indexOf(";")) || "application/octet-stream";
  }
  return "application/octet-stream";
}

function inferHistoryType(mimeType: string, fallback?: MediaHistoryType): MediaHistoryType {
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("image/")) return "image";
  return fallback || "image";
}

function extensionFromMimeType(mimeType: string) {
  if (mimeType.includes("png")) return "png";
  if (mimeType.includes("webp")) return "webp";
  if (mimeType.includes("gif")) return "gif";
  if (mimeType.includes("webm")) return "webm";
  if (mimeType.includes("mp4")) return "mp4";
  if (mimeType.includes("quicktime")) return "mov";
  return mimeType.startsWith("video/") ? "mp4" : "jpg";
}

export async function addLocalHistoryEntryFromUri(
  uri: string,
  entry?: { type?: MediaHistoryType; filename?: string | null },
) {
  if (!uri || !isIndexedDbAvailable()) return null;

  try {
    await purgeExpiredLocalHistory();
    const response = await fetch(uri);
    if (!response.ok) return null;
    const blob = await response.blob();
    if (!blob.size) return null;

    const createdAt = Date.now();
    const mimeType = inferMimeType(uri, blob);
    const type = inferHistoryType(mimeType, entry?.type);
    const extension = extensionFromMimeType(mimeType);
    const storedEntry: StoredLocalHistoryEntry = {
      id: `hist_${createdAt}_${Math.random().toString(36).slice(2, 10)}`,
      createdAt,
      expiresAt: createdAt + HISTORY_TTL_MS,
      type,
      mimeType,
      size: blob.size,
      filename: entry?.filename || `chromancy-history-${createdAt}.${extension}`,
      blob,
    };

    await putStoredEntry(storedEntry);
    await trimLocalHistory();
    const { blob: _blob, ...publicEntry } = storedEntry;
    return publicEntry;
  } catch {
    return null;
  }
}

export async function listLocalHistoryEntries(): Promise<LocalHistoryEntry[]> {
  await purgeExpiredLocalHistory();
  return (await getAllStoredEntries())
    .sort((a, b) => b.createdAt - a.createdAt)
    .map(({ blob: _blob, ...entry }) => entry);
}

export async function getLocalHistoryBlob(id: string): Promise<Blob | null> {
  if (!isIndexedDbAvailable()) return null;
  await purgeExpiredLocalHistory();
  const db = await openLocalHistoryDb();
  try {
    const transaction = db.transaction(STORE_NAME, "readonly");
    const entry = await requestToPromise<StoredLocalHistoryEntry | undefined>(transaction.objectStore(STORE_NAME).get(id));
    return entry?.blob || null;
  } finally {
    db.close();
  }
}

export async function createLocalHistoryObjectUrl(id: string) {
  const blob = await getLocalHistoryBlob(id);
  return blob ? URL.createObjectURL(blob) : null;
}
