"use client";
import { api } from "../../../../../packages/backend/convex/_generated/api";
import MasonryLayout from "@/components/MansoryLayout";
import MaximizedImage from "@/components/MaximizedImage";
import TextWrapLayout from "@/components/TextWrapLayout";
import { useSelectedCategoryStore } from "@/store/selected-category-store";
import { useStableQuery } from "@/hooks/useStableQuery";
import { useState } from "react";

type Kind = "image" | "text" | "link" | "code" | "screenshot";
const kinds: Kind[] = ["image", "text", "link", "code", "screenshot"];
export default function DashboardPage() {
  const { selected } = useSelectedCategoryStore();
  const [selectedKind, setSelectedKind] = useState<Kind>("image");
  // Use stable cached query results; default to [] to make return typed and non-undefined
  const captures = useStableQuery(
    api.captures.byCategoryAndKind,
    { category: selected || "unsorted", kind: selectedKind },
    []
  );

  // Pass the selected category to the query

  return (
    <div className="min-h-screen bg-background py-8 w-full px-8 max-w-8xl mx-auto">
      <div className="sticky top-0 z-10 bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className=" px-4 py-2">
          <div
            role="tablist"
            aria-label="Capture kind"
            className="inline-flex items-center gap-1 rounded-xl border border-border bg-card p-1 shadow-sm"
          >
            {kinds.map((kind) => {
              const isActive = selectedKind === kind;
              return (
                <button
                  key={kind}
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => setSelectedKind(kind as Kind)}
                  className={`px-3 py-1.5 rounded-lg text-sm capitalize transition-colors ${
                    isActive
                      ? "bg-neutral-800 text-white"
                      : "text-neutral-400 hover:bg-neutral-800/30"
                  }`}
                >
                  {kind}
                </button>
              );
            })}
          </div>
        </div>
      </div>
      <div className=" px-4 relative ">
        {selectedKind === "image" && (
          <MasonryLayout items={captures as any} />
        )}
        {selectedKind === "text" && (
          <TextWrapLayout items={captures as any} />
        )}
      </div>
      <MaximizedImage />
    </div>
  );
}