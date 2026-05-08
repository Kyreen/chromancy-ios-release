import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { addLocalHistoryEntryFromUri, updateLocalHistoryEntry } from "./localHistory";

export type MediaHistoryType = "image" | "video";

export interface MediaHistoryEntry {
  uri: string;
  type: MediaHistoryType;
  thumbnailUri?: string | null;
  filename?: string | null;
  persistLocalHistory?: boolean;
  localHistoryId?: string | null;
}

function createEntry(uri: string, entry?: Partial<MediaHistoryEntry>): MediaHistoryEntry {
  return {
    uri,
    type: entry?.type || (uri.startsWith("blob:") ? "video" : "image"),
    thumbnailUri: entry?.thumbnailUri ?? null,
    filename: entry?.filename ?? null,
    persistLocalHistory: entry?.persistLocalHistory ?? true,
    localHistoryId: entry?.localHistoryId ?? null,
  };
}

const MAX_HISTORY_ENTRIES = 30;

export function usePhotoStack(initialImage: string | null, initialEntry?: Partial<MediaHistoryEntry>) {
  const [historyEntries, setHistoryEntries] = useState<MediaHistoryEntry[]>(initialImage ? [createEntry(initialImage, initialEntry)] : []);
  const [currentIndex, setCurrentIndex] = useState(initialImage ? 0 : -1);
  const currentIndexRef = useRef(currentIndex);

  useEffect(() => {
    currentIndexRef.current = currentIndex;
  }, [currentIndex]);

  const pushImage = useCallback((newImage: string, entry?: Partial<MediaHistoryEntry>) => {
    const nextEntry = createEntry(newImage, entry);

    setHistoryEntries((prev) => {
      const head = prev.slice(0, Math.max(currentIndexRef.current + 1, 0));
      const last = head[head.length - 1];
      if (last?.uri === nextEntry.uri && last?.thumbnailUri === nextEntry.thumbnailUri && last?.type === nextEntry.type) {
        return prev;
      }

      const combined = [...head, nextEntry];
      const overflow = Math.max(0, combined.length - MAX_HISTORY_ENTRIES);
      const trimmed = overflow > 0 ? combined.slice(overflow) : combined;
      const nextIndex = trimmed.length - 1;
      currentIndexRef.current = nextIndex;
      setCurrentIndex(nextIndex);
      return trimmed;
    });

    if (nextEntry.persistLocalHistory !== false) {
      void addLocalHistoryEntryFromUri(nextEntry.uri, {
        type: nextEntry.type,
        filename: nextEntry.filename,
      }).then((storedEntry) => {
        if (!storedEntry?.id) return;
        setHistoryEntries((prev) => {
          const nextEntries = [...prev];
          const matchIndex = nextEntries.findIndex((entry) => entry.uri === nextEntry.uri && entry.localHistoryId == null);
          if (matchIndex < 0) return prev;
          nextEntries[matchIndex] = {
            ...nextEntries[matchIndex],
            localHistoryId: storedEntry.id,
          };
          return nextEntries;
        });
      });
    }
  }, []);

  const undo = useCallback(() => {
    setCurrentIndex((prev) => {
      const next = prev > 0 ? prev - 1 : prev;
      currentIndexRef.current = next;
      return next;
    });
  }, []);

  const redo = useCallback(() => {
    setCurrentIndex((prev) => {
      const next = prev < historyEntries.length - 1 ? prev + 1 : prev;
      currentIndexRef.current = next;
      return next;
    });
  }, [historyEntries.length]);

  const reset = useCallback((newInitialImage: string | null, entry?: Partial<MediaHistoryEntry>) => {
    const nextEntries = newInitialImage ? [createEntry(newInitialImage, entry)] : [];
    setHistoryEntries(nextEntries);
    const nextIndex = newInitialImage ? 0 : -1;
    currentIndexRef.current = nextIndex;
    setCurrentIndex(nextIndex);
  }, []);

  const selectHistory = useCallback((index: number) => {
    setCurrentIndex((prev) => {
      if (index < 0 || index >= historyEntries.length) return prev;
      currentIndexRef.current = index;
      return index;
    });
  }, [historyEntries.length]);

  const updateCurrentEntry = useCallback((updates: Partial<MediaHistoryEntry>) => {
    setHistoryEntries((prev) => {
      if (currentIndexRef.current < 0 || currentIndexRef.current >= prev.length) return prev;
      const nextEntries = [...prev];
      nextEntries[currentIndexRef.current] = {
        ...nextEntries[currentIndexRef.current],
        ...updates,
      };
      const updatedEntry = nextEntries[currentIndexRef.current];
      if (updatedEntry.localHistoryId && updates.filename !== undefined) {
        void updateLocalHistoryEntry(updatedEntry.localHistoryId, {
          filename: updatedEntry.filename || undefined,
        });
      }
      return nextEntries;
    });
  }, []);

  const currentEntry = currentIndex >= 0 ? historyEntries[currentIndex] : null;
  const history = useMemo(() => historyEntries.map((entry) => entry.uri), [historyEntries]);

  return {
    currentImage: currentEntry?.uri ?? null,
    currentEntry,
    history,
    historyEntries,
    currentIndex,
    pushImage,
    undo,
    redo,
    reset,
    selectHistory,
    updateCurrentEntry,
    canUndo: currentIndex > 0,
    canRedo: currentIndex < historyEntries.length - 1,
  };
}
