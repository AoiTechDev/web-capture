"use client";

import { useRef, useState, useMemo, useLayoutEffect } from "react";
import Image from "next/image";
import { Maximize2, Download, RotateCw } from "lucide-react";

import { api } from "../../../../packages/backend/convex/_generated/api";
import { useMutation } from "convex/react";
import { Id } from "../../../../packages/backend/convex/_generated/dataModel";
import { useMaximizeImageStore } from "@/store/maximize-image-store";
import { useRemovedCapturesStore } from "@/store/removed-captures-store";
import { preloadImage } from "@/utils/image-preloader";
import type { CaptureDetails } from "./DesignDnaPanel";
import ConfirmDeleteButton from "./ConfirmDeleteButton";

export interface MasonryItem extends CaptureDetails {
  _id: string;
  url?: string;
  /** Grid-sized WebP; the full image is used when there is none. */
  thumbUrl?: string | null;
  width: number;
  height: number;
  kind?: string;
  src?: string;
  alt?: string;
  storageId?: string;
  pageUrl?: string;
  tags?: string[];
  /**
   * Enrichment state: pending | processing | ready | failed. `skipped` (old
   * captures never queued) shows no chip: the analysis is local and free, so
   * there is no plan limit to explain.
   */
  status?: string | null;
  error?: string | null;
  aiCategory?: string | null;
  aiTags?: string[] | null;
  aiDescription?: string | null;
  title?: string | null;
  sessionId?: string | null;
  sessionName?: string | null;
}

interface MasonryLayoutProps {
  items: MasonryItem[];
  /** A palette swatch was clicked: filter by its colour. Swatches are inert without it. */
  onPickColor?: (hex: string) => void;
}

const COLUMN_WIDTH = 280;
const GAP = 16;
const MIN_HEIGHT = 100;
const MAX_HEIGHT = 600;
const FOOTER_HEIGHT = 80; // Approximate height for URL + tags footer
/** Chips per card, status chip included; the rest collapse into "+n". */
const MAX_CHIPS = 3;

/**
 * The card's chip row: the enrichment state while the model works (or a
 * Retry when it failed), then the model's category and top tags once ready,
 * then the user's own tags. Neutral chips throughout, per the design brief.
 */
function CaptureChips({
  item,
  retrying,
  onRetry,
}: {
  item: MasonryItem;
  retrying: boolean;
  onRetry: () => void;
}) {
  const status = retrying ? "pending" : item.status;
  const analyzing = status === "pending" || status === "processing";
  const failed = status === "failed";

  const labels: string[] = [];
  const push = (t?: string | null) => {
    const v = t?.trim();
    if (v && !labels.some((l) => l.toLowerCase() === v.toLowerCase())) labels.push(v);
  };
  if (status === "ready") {
    if (item.aiCategory && item.aiCategory !== "other") push(item.aiCategory);
    (item.aiTags ?? []).slice(0, 2).forEach(push);
  }
  (item.tags ?? []).forEach(push);

  const room = MAX_CHIPS - (analyzing || failed ? 1 : 0);
  const shown = labels.slice(0, room);
  if (!analyzing && !failed && shown.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1">
      {analyzing && (
        <span className="chip text-[var(--text-subtle)]" title="Embedding and tagging on your machine">
          Analyzing…
        </span>
      )}
      {failed && (
        <button
          type="button"
          className="chip transition-colors hover:text-[var(--text)]"
          title={item.error ? `Analysis failed: ${item.error}` : "Analysis failed"}
          onClick={(e) => {
            e.stopPropagation();
            onRetry();
          }}
        >
          <RotateCw className="h-3 w-3 text-[var(--warning)]" />
          Retry
        </button>
      )}
      {shown.map((tag, idx) => (
        <span
          key={`${tag}-${idx}`}
          className={idx === 0 && status === "ready" && tag === item.aiCategory ? "chip text-[var(--text)]" : "chip"}
        >
          {tag}
        </span>
      ))}
      {labels.length > shown.length && (
        <span className="chip text-[var(--text-subtle)]">+{labels.length - shown.length}</span>
      )}
    </div>
  );
}


const getColumnWidth = () => {
  if (typeof window === "undefined") return COLUMN_WIDTH;

  const width = window.innerWidth;
  if (width < 640) return 162; // Mobile
  if (width < 1024) return 192; // Tablet
  return COLUMN_WIDTH; // Desktop
};

const getColumnsCount = (containerWidth?: number) => {
  if (typeof window === "undefined") return 3;

  const width = containerWidth || window.innerWidth;
  const columnWidth = getColumnWidth();
  return Math.max(1, Math.floor((width - GAP) / (columnWidth + GAP)));
};

function calculateImageHeight(
  originalWidth: number,
  originalHeight: number,
  targetWidth: number
) {
  const aspectRatio = originalHeight / originalWidth;
  const calculatedHeight = Math.round(targetWidth * aspectRatio);

  // Apply Pinterest-style constraints
  return Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, calculatedHeight));
}

export default function MasonryLayout({ items, onPickColor }: MasonryLayoutProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [columns, setColumns] = useState<number>(3);
  const [columnWidth, setColumnWidth] = useState<number>(COLUMN_WIDTH);
  const [containerWidth, setContainerWidth] = useState<number>(0);
  const { setIsOpen, setImageUrl, setDetails, setCapture } = useMaximizeImageStore();
  const markRemoved = useRemovedCapturesStore((s) => s.markRemoved);
  const deleteById = useMutation(api.upload.deleteById);
  const retryProcessing = useMutation(api.local_ai.retryProcessing);
  // Search results do not update live, so a retried card is shown as
  // analysing locally until its row is next fetched.
  const [retried, setRetried] = useState<Set<string>>(() => new Set());

  const openDetail = (item: MasonryItem) => {
    if (item.url) preloadImage(item.url);
    setImageUrl(item.url || "");
    setDetails({
      designDna: item.designDna ?? null,
      palette: item.palette ?? null,
      clipped: item.clipped ?? null,
    });
    setCapture({
      id: item._id,
      kind: item.kind,
      title: item.title ?? item.alt ?? null,
      pageUrl: item.pageUrl ?? null,
      aiDescription: item.aiDescription ?? null,
      aiCategory: item.aiCategory ?? null,
      aiTags: item.aiTags ?? null,
      tags: item.tags ?? [],
      sessionId: item.sessionId ?? null,
      sessionName: item.sessionName ?? null,
    });
    setIsOpen(true);
  };

  const handleDownload = async (url?: string, preferredName?: string) => {
    if (!url) return;
    try {
      const response = await fetch(url, { mode: "cors" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      const mimeSubtype = blob.type?.split("/")[1] || "png";
      const filename = `${(preferredName || "capture").replace(/[^a-z0-9-_]+/gi, "-")}.${mimeSubtype}`;

      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (err) {
      // Fallback: open in a new tab if direct download fails (e.g., CORS)
      window.open(url, "_blank", "noopener,noreferrer");
      console.error("Failed to download image:", err);
    }
  };

  useLayoutEffect(() => {
    const updateLayout = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();

        const newContainerWidth = rect.width;
        const newColumnWidth = getColumnWidth();
        const newColumns = getColumnsCount(newContainerWidth);

        setContainerWidth(newContainerWidth);
        setColumns(newColumns);
        setColumnWidth(newColumnWidth);
      }
    };

    updateLayout();
    window.addEventListener("resize", updateLayout);

    const resizeObserver = new ResizeObserver(updateLayout);
    if (containerRef.current) {
      resizeObserver.observe(containerRef.current);
    }

    return () => {
      window.removeEventListener("resize", updateLayout);
      resizeObserver.disconnect();
    };
  }, [items]);

  const itemPositions = useMemo(() => {
    if (items.length === 0 || columns === 0)
      return { positions: [], containerHeight: 0 };

    const columnHeights = new Array(columns).fill(0);
    const positions: Array<{
      left: number;
      top: number;
      width: number;
      height: number;
    }> = [];

    items.forEach((item) => {
      const shortestColumnHeight = Math.min(...columnHeights);
      const columnIndex = columnHeights.indexOf(shortestColumnHeight);

      const imageHeight = calculateImageHeight(
        item.width,
        item.height,
        columnWidth
      );
      
      // Add footer height to total card height
      const totalCardHeight = imageHeight + FOOTER_HEIGHT;

      const leftPosition = columnIndex * (columnWidth + GAP);

      if (containerWidth === 0 || leftPosition + columnWidth <= containerWidth) {
        positions.push({
          left: leftPosition,
          top: shortestColumnHeight,
          width: columnWidth,
          height: totalCardHeight,
        });

        columnHeights[columnIndex] = shortestColumnHeight + totalCardHeight + GAP;
      }
    });

    return { positions, containerHeight: Math.max(...columnHeights, 0) };
  }, [items, columns, columnWidth, containerWidth]);

  if (items.length === 0) {
    return (
      <div className="py-8 text-center text-[13px] text-[var(--text-muted)]">No captures yet</div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="relative w-full overflow-hidden"
      style={{ height: `${itemPositions.containerHeight}px` }}
    >
      {items.map((item, index) => {
        const position = itemPositions.positions[index];
        if (!position) return null;

        return (
          <div
            key={item._id}
            className="absolute "
            style={{
              left: `${position.left}px`,
              top: `${position.top}px`,
              width: `${position.width}px`,
              height: `${position.height}px`,
            }}
            
          >
            <div className="surface-card-interactive group relative flex h-full cursor-pointer flex-col overflow-hidden">
              {/* Compact action bar, revealed on hover in the top-right rather
                  than a full-cover scrim: the image stays readable while you
                  reach for an action. */}
              <div className="pointer-events-none absolute right-2 top-2 z-10 flex gap-1 opacity-0 transition-opacity duration-150 group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100">
                <button
                  type="button"
                  className="flex h-7 w-7 items-center justify-center rounded-md border border-[var(--border-strong)] bg-[var(--bg)]/90 text-[var(--text-muted)] backdrop-blur-sm transition-colors hover:text-[var(--text)]"
                  title="Open"
                  aria-label="Open details"
                  onMouseEnter={() => {
                    if (item.url) preloadImage(item.url);
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    openDetail(item);
                  }}
                >
                  <Maximize2 className="h-3.5 w-3.5" />
                </button>

                <button
                  type="button"
                  className="flex h-7 w-7 items-center justify-center rounded-md border border-[var(--border-strong)] bg-[var(--bg)]/90 text-[var(--text-muted)] backdrop-blur-sm transition-colors hover:text-[var(--text)]"
                  title="Download"
                  aria-label="Download"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDownload(item.url, item.alt || `capture-${item._id}`);
                  }}
                >
                  <Download className="h-3.5 w-3.5" />
                </button>

                <ConfirmDeleteButton
                  onDelete={async () => {
                    try {
                      // The server deletes the capture's own file; it never
                      // takes a storage id from the client.
                      await deleteById({ docId: item._id as Id<"captures"> });
                      markRemoved(item._id);
                    } catch (err) {
                      console.error("Failed to delete capture:", err);
                    }
                  }}
                />
              </div>

              <div
                className="relative flex-1 overflow-hidden bg-[var(--bg)]"
                onMouseEnter={() => {
                  if (item.url) preloadImage(item.url);
                }}
                // A mouse shortcut; the Open button is the keyboard path.
                onClick={() => openDetail(item)}
              >
                {(item.thumbUrl || item.url) && (
                  <Image
                    src={(item.thumbUrl || item.url)!}
                    alt={item.alt || ""}
                    width={position.width}
                    height={position.height}
                    style={{
                      objectFit: "cover",
                      width: "100%",
                      height: "100%",
                    }}
                    loading="lazy"
                  />
                )}
              </div>

              <div className="space-y-2 border-t border-[var(--border)] px-3 py-2.5">
                {(item.pageUrl || (item.palette?.length ?? 0) > 0) && (
                  <div className="flex items-center justify-between gap-2">
                    {item.pageUrl && (
                      <div className="mono min-w-0 truncate text-[11px] text-[var(--text-muted)]">
                        {(() => {
                          try {
                            return new URL(item.pageUrl).hostname.replace(/^www\./, "");
                          } catch {
                            return item.pageUrl;
                          }
                        })()}
                      </div>
                    )}
                    {/* Pixel palette, heaviest first. Sits on the source line
                        so the footer height the layout assumes is unchanged. */}
                    {item.palette && item.palette.length > 0 && (
                      <div className="ml-auto flex shrink-0 overflow-hidden rounded-[3px] border border-[var(--border)]">
                        {item.palette.slice(0, 6).map((p, i) =>
                          onPickColor ? (
                            <button
                              key={`${p.hex}-${i}`}
                              type="button"
                              title={`Show captures with ${p.hex}`}
                              aria-label={`Filter by colour ${p.hex}`}
                              className="h-3 w-3"
                              style={{ backgroundColor: p.hex }}
                              onClick={(e) => {
                                e.stopPropagation();
                                onPickColor(p.hex);
                              }}
                            />
                          ) : (
                            <span
                              key={`${p.hex}-${i}`}
                              title={p.hex}
                              className="h-2.5 w-2.5"
                              style={{ backgroundColor: p.hex }}
                            />
                          )
                        )}
                      </div>
                    )}
                  </div>
                )}

                <CaptureChips
                  item={item}
                  retrying={retried.has(item._id) && item.status === "failed"}
                  onRetry={() => {
                    setRetried((prev) => new Set(prev).add(item._id));
                    retryProcessing({ captureId: item._id as Id<"captures"> }).catch((err) => {
                      console.error("Failed to retry analysis:", err);
                      setRetried((prev) => {
                        const next = new Set(prev);
                        next.delete(item._id);
                        return next;
                      });
                    });
                  }}
                />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}