"use client";

import { api } from "@/convexApi";
import { useQuery } from "convex/react";
import MasonryLayout from "@/components/MasonryLayout";
import MaximizedImage from "@/components/MaximizedImage";
import { useSelectedCategoryStore } from "@/store/selected-category-store";
import { useEffect, useMemo, useState } from "react";

export default function DashboardPage() {
  const { selected } = useSelectedCategoryStore();
  // Single fetch of all captures (images have URLs resolved on the server)
  const all = useQuery(api.captures.byCategoryAndKind, {
    category: undefined,
    kind: undefined as any,
  });

  const [allCache, setAllCache] = useState<any[]>([]);
  useEffect(() => {
    if (all !== undefined && Array.isArray(all)) setAllCache(all);
  }, [all]);

  const allData = (all ?? allCache) as any[];
  const categoryFilter = selected ?? undefined;
  const filteredByCategory = useMemo(
    () =>
      allData.filter((d) =>
        categoryFilter ? (d.category ?? "unsorted") === categoryFilter : true
      ),
    [allData, categoryFilter]
  );

  const kindsInCategory = useMemo(() => {
    const set = new Set<string>();
    for (const d of filteredByCategory) set.add(d.kind);
    return Array.from(set) as ("image" | "text" | "link" | "code" | "element")[];
  }, [filteredByCategory]);

  const [activeKind, setActiveKind] = useState<"image" | "text" | "link" | "code" | "element">("image");
  useEffect(() => {
    // Ensure activeKind is valid when category changes
    if (!kindsInCategory.includes(activeKind)) {
      if (kindsInCategory.includes("image")) setActiveKind("image");
      else if (kindsInCategory[0]) setActiveKind(kindsInCategory[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoryFilter, kindsInCategory.join(",")]);

  const showKindTabs = kindsInCategory.length > 1 || (kindsInCategory[0] ?? "") !== "image";

  const isInitialLoading = all === undefined && allCache.length === 0;
  if (isInitialLoading)
    return (
      <div className="flex justify-center items-center min-h-screen">
        Loading…
      </div>
    );

  return (
    <div className="min-h-screen bg-background py-8 w-full">
      <div className="max-w-7xl mx-auto px-4 relative">
        {showKindTabs ? (
          <div className="mb-4 flex gap-2">
            {(["image", "text", "link", "code", "element"] as const)
              .filter((k) => kindsInCategory.includes(k))
              .map((k) => (
                <button
                  key={k}
                  onClick={() => setActiveKind(k)}
                  className={`px-3 py-1 rounded ${activeKind === k ? "bg-neutral-800 text-white" : "bg-neutral-300 text-black"}`}
                >
                  {k}
                </button>
              ))}
          </div>
        ) : <div className="mb-4 h-8"></div>}

        {activeKind === "image" ? (
          <MasonryLayout
            items={filteredByCategory
              .filter((d) => d.kind === "image")
              .map((d) => ({
                _id: d._id,
                url: d.url,
                width: d.width,
                height: d.height,
                storageId: d.storageId,
                alt: d.alt,
              })) as any}
          />
        ) : (
          <LocalKindList items={filteredByCategory.filter((d) => d.kind === activeKind)} kind={activeKind} />
        )}
      </div>

      <MaximizedImage />
    </div>
  );
}

function LocalKindList({ items, kind }: { items: any[]; kind: "text" | "link" | "code" | "element" }) {
  if (!items || items.length === 0) return <div className="text-sm text-gray-400">No items</div>;
  return (
    <div className="flex flex-wrap gap-3 items-start">
      {items.map((it: any) => (
        <div
          key={it._id}
          className="inline-block max-w-[360px] min-w-[220px] p-3 rounded border-border border bg-card "
        >
          {kind === "text" || kind === "code" ? (
            <pre className="whitespace-pre-wrap text-sm">{it.content}</pre>
          ) : kind === "link" ? (
            <a href={it.href} target="_blank" className="text-blue-600 underline break-all">{it.text ?? it.href}</a>
          ) : (
            <div className="text-xs text-gray-500">{it.tagName}</div>
          )}
          <div className="text-xs text-gray-400 mt-1 break-all">{it.url}</div>
        </div>
      ))}
    </div>
  );
}
