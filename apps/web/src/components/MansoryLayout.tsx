"use client";

import { useEffect, useRef, useState, useMemo, useLayoutEffect } from "react";
import Image from "next/image";
import { Trash, Maximize2 } from "lucide-react";

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
}

interface MasonryLayoutProps {
  items: MasonryItem[];
}

const COLUMN_WIDTH = 280;
const GAP = 16;
const MIN_HEIGHT = 100;
const MAX_HEIGHT = 600;

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

  useLayoutEffect(() => {
    const updateLayout = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();

        console.log(rect.width);
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

    // Use ResizeObserver to detect container size changes
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
      // Find the shortest column
      const shortestColumnHeight = Math.min(...columnHeights);
      const columnIndex = columnHeights.indexOf(shortestColumnHeight);

      // Calculate image height for this item
      const itemHeight = calculateImageHeight(
        item.width,
        item.height,
        columnWidth
      );

      // Calculate left position, ensuring it doesn't overflow
      const leftPosition = columnIndex * (columnWidth + GAP);

      // Ensure the item fits within the container. If containerWidth isn't known yet (0 on first paint),
      // still compute positions so content isn't blank until a resize triggers measurement.
      if (containerWidth === 0 || leftPosition + columnWidth <= containerWidth) {
        // Store position
        positions.push({
          left: leftPosition,
          top: shortestColumnHeight,
          width: columnWidth,
          height: itemHeight,
        });

        // Update column height
        columnHeights[columnIndex] = shortestColumnHeight + itemHeight + GAP;
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
            onClick={() => {
              setIsOpen(true);
              setImageUrl(item.url || "");
            }}
          >
            <div className="bg-white rounded-2xl shadow-lg overflow-hidden  group duration-100 relative cursor-pointer">
              <div className="absolute inset-0 bg-black/50 group-hover:flex transition-all duration-100 hidden">
                <button
                  className="absolute top-5 right-5 cursor-pointer"
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteById({
                      storageId: item.storageId as Id<"_storage">,
                      docId: item._id as Id<"captures">,
                    });
                  }}
                >
                  <Trash className="w-7 h-7 text-red-300" />
                </button>

                <button className="absolute top-1/2 right-1/2 -translate-y-1/2 translate-x-1/2 ">
                  <Maximize2 className="w-15 h-15 text-white" />
                </button>
              </div>
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
                  className="rounded-t-2xl"
                />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}