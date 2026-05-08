import React from "react";
import { AnimatePresence, motion } from "motion/react";
import { X } from "lucide-react";
import { cn } from "../lib/utils";
import { PreviewRenderer } from "./PreviewRenderer";
import type { MediaHistoryEntry } from "../lib/usePhotoStack";

type HistoryItem = string | MediaHistoryEntry;

interface HistoryDrawerProps {
  open: boolean;
  title?: string;
  items: HistoryItem[];
  currentItem: string | null;
  onClose: () => void;
  onSelect: (index: number) => void;
}

function normalizeItem(item: HistoryItem): MediaHistoryEntry {
  if (typeof item === "string") {
    return {
      uri: item,
      type: item.startsWith("blob:") ? "video" : "image",
      thumbnailUri: item.startsWith("blob:") ? null : item,
    };
  }
  return item;
}

export function HistoryDrawer({
  open,
  title = "History",
  items,
  currentItem,
  onClose,
  onSelect,
}: HistoryDrawerProps) {
  const normalized = items.map(normalizeItem);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ x: 300 }}
          animate={{ x: 0 }}
          exit={{ x: 300 }}
          className="absolute right-0 top-0 bottom-0 w-64 bg-black/90 backdrop-blur-xl border-l border-white/10 z-40 p-4 overflow-y-auto"
        >
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-xs font-bold uppercase tracking-widest text-white/40">{title}</h3>
            <button onClick={onClose} className="p-1 rounded-lg hover:bg-white/5 transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>

          {normalized.length === 0 ? (
            <p className="text-xs text-white/35">Your edits will appear here.</p>
          ) : (
            <div className="space-y-4">
              {normalized.map((item, index) => (
                <button
                  key={`${item.uri.slice(0, 32)}-${index}`}
                  onClick={() => onSelect(index)}
                  className={cn(
                    "w-full rounded-2xl border-2 overflow-hidden transition-all bg-white/5",
                    item.uri === currentItem ? "border-white" : "border-transparent opacity-60 hover:opacity-100",
                  )}
                >
                  <div className="relative aspect-square w-full bg-black/40">
                    <PreviewRenderer
                      result={{ type: item.type, uri: item.thumbnailUri || item.uri, thumbnailUri: item.thumbnailUri }}
                      alt={`History step ${index + 1}`}
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <div className="px-3 py-2 text-left">
                    <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/70">Step {index + 1}</p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
