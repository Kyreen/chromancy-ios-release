import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, Download, History, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { PreviewRenderer } from "../components/PreviewRenderer";
import { cn } from "../lib/utils";
import {
  clearLocalHistory,
  createLocalHistoryObjectUrl,
  deleteLocalHistoryEntry,
  getLocalHistoryBlob,
  listLocalHistoryEntries,
  type LocalHistoryEntry,
} from "../lib/localHistory";
import { saveBlobToDevice } from "../lib/exportMedia";

interface LocalHistoryPageProps {
  onBack: () => void;
}

type ViewHistoryEntry = LocalHistoryEntry & { objectUrl: string | null };

function formatRemainingTime(expiresAt: number) {
  const remainingMs = Math.max(0, expiresAt - Date.now());
  const hours = Math.floor(remainingMs / (60 * 60 * 1000));
  const minutes = Math.ceil((remainingMs % (60 * 60 * 1000)) / (60 * 1000));
  if (hours <= 0) return `${Math.max(1, minutes)} min left`;
  return `${hours}h ${minutes}m left`;
}

function formatSize(bytes: number) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function LocalHistoryPage({ onBack }: LocalHistoryPageProps) {
  const [entries, setEntries] = useState<ViewHistoryEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const objectUrlsRef = useRef<string[]>([]);

  const releaseObjectUrls = useCallback(() => {
    objectUrlsRef.current.forEach((url) => {
      try { URL.revokeObjectURL(url); } catch {}
    });
    objectUrlsRef.current = [];
  }, []);

  const loadEntries = useCallback(async () => {
    setIsLoading(true);
    releaseObjectUrls();
    try {
      const storedEntries = await listLocalHistoryEntries();
      const viewEntries = await Promise.all(storedEntries.map(async (entry) => {
        const objectUrl = await createLocalHistoryObjectUrl(entry.id);
        if (objectUrl) objectUrlsRef.current.push(objectUrl);
        return { ...entry, objectUrl };
      }));
      setEntries(viewEntries);
    } catch {
      toast.error("Could not load local history.");
    } finally {
      setIsLoading(false);
    }
  }, [releaseObjectUrls]);

  useEffect(() => {
    void loadEntries();
    return releaseObjectUrls;
  }, [loadEntries, releaseObjectUrls]);

  const handleExport = async (entry: ViewHistoryEntry) => {
    const blob = await getLocalHistoryBlob(entry.id);
    if (!blob) {
      toast.error("This history item has expired.");
      await loadEntries();
      return;
    }
    await saveBlobToDevice(blob, entry.filename);
    toast.success("History export saved.");
  };

  const handleDelete = async (entry: ViewHistoryEntry) => {
    await deleteLocalHistoryEntry(entry.id);
    await loadEntries();
  };

  const handleClearAll = async () => {
    if (!window.confirm("Clear all 24-hour local history from this device?")) return;
    await clearLocalHistory();
    await loadEntries();
    toast.success("Local history cleared.");
  };

  return (
    <div className="flex h-full flex-col bg-black">
      <div className="flex items-center justify-between border-b border-white/5 p-4">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="rounded-full border border-white/10 bg-white/5 p-2">
            <ChevronLeft className="h-5 w-5" />
          </button>
          <div>
            <h2 className="text-xl font-bold tracking-tight">History</h2>
            <p className="text-xs text-white/45">Local edits stay on this device for 24 hours.</p>
          </div>
        </div>
        <button
          onClick={handleClearAll}
          disabled={!entries.length}
          className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-[10px] font-bold uppercase tracking-[0.16em] text-white/60 disabled:opacity-30"
        >
          Clear
        </button>
      </div>

      <div className="visible-scrollbar flex-1 overflow-y-auto p-4 pb-28">
        {isLoading ? (
          <div className="flex h-full flex-col items-center justify-center gap-4 text-white/45">
            <div className="h-10 w-10 animate-spin rounded-full border-4 border-white/10 border-t-white" />
            <p className="text-xs font-bold uppercase tracking-[0.2em]">Loading history</p>
          </div>
        ) : entries.length ? (
          <div className="grid gap-4 sm:grid-cols-2">
            {entries.map((entry) => (
              <div key={entry.id} className="overflow-hidden rounded-3xl border border-white/10 bg-white/5">
                <div className="aspect-square bg-black/40">
                  {entry.objectUrl ? (
                    <PreviewRenderer
                      result={{ type: entry.type, uri: entry.objectUrl }}
                      alt="Local history preview"
                      controls={entry.type === "video"}
                      muted
                      className={cn("h-full w-full", entry.type === "video" ? "object-contain" : "object-cover")}
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center text-white/35">
                      <History className="h-8 w-8" />
                    </div>
                  )}
                </div>
                <div className="space-y-3 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-bold uppercase tracking-[0.18em] text-white/70">{entry.type} edit</p>
                      <p className="mt-1 text-[11px] text-white/40">{formatRemainingTime(entry.expiresAt)} | {formatSize(entry.size)}</p>
                    </div>
                    <History className="h-4 w-4 text-white/35" />
                  </div>
                  <div className="grid grid-cols-[1fr_auto] gap-2">
                    <button onClick={() => void handleExport(entry)} className="flex items-center justify-center gap-2 rounded-2xl bg-white px-3 py-3 text-[10px] font-bold uppercase tracking-[0.16em] text-black">
                      <Download className="h-4 w-4" />
                      Export
                    </button>
                    <button onClick={() => void handleDelete(entry)} className="rounded-2xl border border-white/10 bg-black/30 px-3 py-3 text-white/60">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex min-h-full flex-col items-center justify-center gap-4 text-center">
            <div className="rounded-full border border-white/10 bg-white/5 p-5">
              <RotateCcw className="h-9 w-9 text-white/35" />
            </div>
            <div>
              <h3 className="text-lg font-bold">No local history yet</h3>
              <p className="mt-2 max-w-xs text-sm text-white/45">Generated edits will appear here for 24 hours on this device only.</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
