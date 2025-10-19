"use client";

import { useRef, useState, useMemo, useLayoutEffect } from "react";
import Image from "next/image";
import { Trash, Maximize2, Download } from "lucide-react";

import { api } from "../../../../packages/backend/convex/_generated/api";
import { useMutation } from "convex/react";
import { Id } from "../../../../packages/backend/convex/_generated/dataModel";
import { useMaximizeImageStore } from "@/store/maximize-image-store";
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

// Responsive breakpoints
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
      <div className="text-center text-gray-500 py-8">No captures yet</div>
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
            className="absolute"
            style={{
              left: `${position.left}px`,
              top: `${position.top}px`,
              width: `${position.width}px`,
              height: `${position.height}px`,
            }}
           
          >
            <div className="bg-white rounded-2xl shadow-lg overflow-hidden group duration-100 relative cursor-pointer flex flex-col h-full">
              <div className="absolute inset-0 bg-black/70 group-hover:flex gap-4 justify-center items-center transition-all duration-100 hidden z-10">
                <button
                  className="  cursor-pointer p-2 bg-red-500 rounded-xl"
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteById({
                      storageId: item.storageId as Id<"_storage">,
                      docId: item._id as Id<"captures">,
                    });
                  }}
                >
                  <Trash className="w-7 h-7 text-white" />
                </button>

                <button
                  className=" p-2 bg-white/30 rounded-xl cursor-pointer"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDownload(item.url, item.alt || `capture-${item._id}`);
                  }}
                >
                  <Download className="w-7 h-7 text-white" />
                </button>

                <button className=" p-2 bg-white/30 rounded-xl cursor-pointer" 
                 onClick={() => {
              setIsOpen(true);
              setImageUrl(item.url || "");
            }}>
                  <Maximize2 className="w-7 h-7 text-white " />
                </button>
              </div>
              
              {/* Image */}
              <div className="flex-1 relative overflow-hidden">
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
                  />
                )}
              </div>
              
              {/* Footer with URL and Tags */}
              <div className="bg-gradient-to-br from-slate-800 to-slate-900 p-4 space-y-2">
                {/* Page URL */}
                {item.pageUrl && (
                  <div className="text-gray-300 text-xs font-medium truncate">
                    {new URL(item.pageUrl).hostname}
                  </div>
                )}
                
                {/* Tags */}
                {item.tags && item.tags.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {item.tags.map((tag, idx) => (
                      <span
                        key={idx}
                        className="px-3 py-1 bg-indigo-600/80 hover:bg-indigo-600 text-white text-xs font-medium rounded-full transition-colors"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}