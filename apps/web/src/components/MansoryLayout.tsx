"use client";

import { useRef, useState, useMemo, useLayoutEffect } from "react";
import Image from "next/image";
import { Trash, Maximize2, Download, FolderEdit } from "lucide-react";

import { api } from "../../../../packages/backend/convex/_generated/api";
import { useMutation } from "convex/react";
import { Id } from "../../../../packages/backend/convex/_generated/dataModel";
import { useMaximizeImageStore } from "@/store/maximize-image-store";
import { preloadImage } from "@/utils/image-preloader";
import ChangeCategoryDialog from "./ChangeCategoryDialog";
interface MasonryItem {
  _id: string;
  url?: string;
  width: number;
  height: number;
  kind?: string;
  src?: string;
  alt?: string;
  storageId?: string;
  pageUrl?: string;
  tags?: string[];
}

interface MasonryLayoutProps {
  items: MasonryItem[];
}

const COLUMN_WIDTH = 280;
const GAP = 16;
const MIN_HEIGHT = 100;
const MAX_HEIGHT = 600;
const FOOTER_HEIGHT = 80; // Approximate height for URL + tags footer


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

export default function MasonryLayout({ items }: MasonryLayoutProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [columns, setColumns] = useState<number>(3);
  const [columnWidth, setColumnWidth] = useState<number>(COLUMN_WIDTH);
  const [containerWidth, setContainerWidth] = useState<number>(0);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { setIsOpen, setImageUrl } = useMaximizeImageStore();
  const deleteById = useMutation(api.upload.deleteById);

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
              <div className="pointer-events-none absolute right-2 top-2 z-10 flex gap-1 opacity-0 transition-opacity duration-150 group-hover:pointer-events-auto group-hover:opacity-100">
                <button
                  className="flex h-7 w-7 items-center justify-center rounded-md border border-[var(--border-strong)] bg-[var(--bg)]/90 text-[var(--text-muted)] backdrop-blur-sm transition-colors hover:text-[var(--text)]"
                  title="Maximize"
                  onMouseEnter={() => {
                    if (item.url) preloadImage(item.url);
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (item.url) preloadImage(item.url);
                    setIsOpen(true);
                    setImageUrl(item.url || "");
                  }}
                >
                  <Maximize2 className="h-3.5 w-3.5" />
                </button>

                <button
                  className="flex h-7 w-7 items-center justify-center rounded-md border border-[var(--border-strong)] bg-[var(--bg)]/90 text-[var(--text-muted)] backdrop-blur-sm transition-colors hover:text-[var(--text)]"
                  title="Download"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDownload(item.url, item.alt || `capture-${item._id}`);
                  }}
                >
                  <Download className="h-3.5 w-3.5" />
                </button>

                <button
                  className="flex h-7 w-7 items-center justify-center rounded-md border border-[var(--border-strong)] bg-[var(--bg)]/90 text-[var(--text-muted)] backdrop-blur-sm transition-colors hover:text-[var(--text)]"
                  title="Change category"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedId(item._id);
                    setDialogOpen(true);
                  }}
                >
                  <FolderEdit className="h-3.5 w-3.5" />
                </button>

                <button
                  className="flex h-7 w-7 items-center justify-center rounded-md border border-[var(--border-strong)] bg-[var(--bg)]/90 text-[var(--text-muted)] backdrop-blur-sm transition-colors hover:border-[var(--danger)] hover:text-[var(--danger)]"
                  title="Delete"
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteById({
                      storageId: item.storageId as Id<"_storage">,
                      docId: item._id as Id<"captures">,
                    });
                  }}
                >
                  <Trash className="h-3.5 w-3.5" />
                </button>
              </div>

              <div
                className="relative flex-1 overflow-hidden bg-[var(--bg)]"
                onMouseEnter={() => {
                  if (item.url) preloadImage(item.url);
                }}
              >
                {item.url && (
                  <Image
                    src={item.url}
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
                {item.pageUrl && (
                  <div className="mono truncate text-[11px] text-[var(--text-muted)]">
                    {(() => {
                      try {
                        return new URL(item.pageUrl).hostname.replace(/^www\./, "");
                      } catch {
                        return item.pageUrl;
                      }
                    })()}
                  </div>
                )}

                {item.tags && item.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {/* Capped at three: auto-tagging produces 4-8 per capture and
                        an uncapped row pushes the footer taller than the image. */}
                    {item.tags.slice(0, 3).map((tag, idx) => (
                      <span key={idx} className="chip">
                        {tag}
                      </span>
                    ))}
                    {item.tags.length > 3 && (
                      <span className="chip text-[var(--text-subtle)]">
                        +{item.tags.length - 3}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })}
      <ChangeCategoryDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        captureId={selectedId}
      />
    </div>
  );
}