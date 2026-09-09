"use client";
import { api } from "../../../../../packages/backend/convex/_generated/api";
import MasonryLayout from "@/components/MansoryLayout";
import MaximizedImage from "@/components/MaximizedImage";
import MaximizedText from "@/components/MaximizedText";
import TextWrapLayout from "@/components/TextWrapLayout";
import LinkList from "@/components/LinkList";
import { useSelectedCategoryStore } from "@/store/selected-category-store";
import { useCachedQuery } from "@/hooks/useStableQuery";
import { MasonrySkeleton, ListSkeleton } from "@/components/Skeletons";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Search, Plus, Images, Camera, Link, FileText } from "lucide-react";
import { useQuery } from "convex/react";


type Kind = "image" | "text" | "link" | "code" | "screenshot";

/**
 * The app is empty until the extension is installed, so this doubles as the
 * install prompt rather than just reporting an absence.
 */
const EmptyState = ({ searching }: { searching: boolean }) => (
  <div className="surface-card flex min-h-[320px] flex-col items-center justify-center px-6 py-16 text-center">
    <span className="mb-5 flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--blue-500)]">
      <span className="h-2.5 w-2.5 rounded-[2px] bg-white" />
    </span>

    {searching ? (
      <>
        <h2 className="mb-2 text-[16px] font-semibold text-[var(--text)]">No matches</h2>
        <p className="max-w-sm text-[13px] leading-relaxed text-[var(--text-muted)]">
          Nothing here matches that search. Try a different word, or clear the
          field to see everything again.
        </p>
      </>
    ) : (
      <>
        <h2 className="mb-2 text-[16px] font-semibold text-[var(--text)]">
          Nothing captured yet
        </h2>
        <p className="mb-6 max-w-md text-[13px] leading-relaxed text-[var(--text-muted)]">
          Install the Chrome extension and press a shortcut on any page to save an
          image, screenshot, link or selection. Everything you capture lands here.
        </p>
        <div className="flex items-center gap-3">
          <a className="btn-primary" href="#">
            Add to Chrome
          </a>
          <span className="mono text-[12px] text-[var(--text-subtle)]">
            then press ⌘⇧S
          </span>
        </div>
      </>
    )}
  </div>
);
export default function DashboardPage() {
  const { selected } = useSelectedCategoryStore();
  const [selectedKind, setSelectedKind] = useState<Kind>("image");
  const [q, setQ] = useState("");
  const [searchItems, setSearchItems] = useState<any[] | null>(null);
  const fallback = useQuery(api.search.searchCapturesFallback, { q: q.trim() || "__NOOP__", limit: 60 });

  const { data: captures, isLoading: capturesLoading } = useCachedQuery<any[]>(
    api.captures.byCategoryAndKind,
    { category: selected || "unsorted", kind: selectedKind }
  );


  const searchRef = useRef<HTMLInputElement>(null);

  // Cmd/Ctrl-K focuses search from anywhere, matching the badge in the field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const tabs = useMemo(
    () => [
      { key: "image" as const, label: "Images", Icon: Images },
      { key: "screenshot" as const, label: "Screenshots", Icon: Camera },
      { key: "link" as const, label: "Links", Icon: Link },
      { key: "text" as const, label: "Text", Icon: FileText },
      // "code" is intentionally hidden from the UI. The kind still exists in the
      // schema and in stored documents; we just don't offer it as a browse tab.
      // { key: "code" as const, label: "Code", Icon: Code },
    ],
    []
  );

  const { data: counts } = useCachedQuery<Record<string, number>>(
    api.captures.countsByKind,
    {}
  );

  // Undefined while the count query is in flight; an em dash reads better than
  // a flash of "0" that then corrects itself.
  const countFor = useCallback(
    (kind: Kind): string => (counts ? String(counts[kind] ?? 0) : "—"),
    [counts]
  );

  const searching = !!q.trim();
  const visible = searching && searchItems ? searchItems : captures;
  const total = Array.isArray(visible) ? visible.length : 0;

  // Loading and empty look identical if you only test length, which is what
  // made the empty state flash before content arrived. Only the absence of a
  // resolved result counts as loading.
  const isLoading = searching ? searchItems === null && !fallback : capturesLoading;

  // Local-only search: `searchCapturesFallback` is a plain Convex query with no
  // external API call. The previous OpenAI-backed `searchCapturesSemantic`
  // action billed a request per debounced keystroke, so it is no longer used.
  useEffect(() => {
    if (!q.trim()) {
      setSearchItems(null);
      return;
    }
    if (!fallback || !Array.isArray((fallback as any).results)) return;

    setSearchItems(
      (fallback as any).results.map((r: any) => ({
        _id: r.id,
        url: r.imageUrl,
        pageUrl: r.pageUrl,
        width: r.width || 600,
        height: r.height || 400,
        alt: r.alt || r.title || "",
        tags: r.tags || [],
        storageId: r.storageId,
      }))
    );
  }, [q, fallback]);

 

  return (
    <main id="main-content" className="flex-1 flex flex-col w-full">
      <header
        id="dashboard-header"
        className="flex h-14 shrink-0 items-center justify-between gap-6 border-b border-[var(--border)] px-6"
      >
        {/* Underlined tabs rather than pills: the rule sits on the same baseline
            as the border below, so the header reads as one continuous edge. */}
        <nav id="tabs" className="flex h-full items-stretch gap-6">
          {tabs.map(({ key, label }) => {
            const active = selectedKind === key;
            return (
              <button
                key={key}
                onClick={() => setSelectedKind(key)}
                className={`relative flex items-center gap-1.5 text-[13px] transition-colors ${active
                    ? "text-[var(--text)]"
                    : "text-[var(--text-muted)] hover:text-[var(--text)]"
                  }`}
              >
                <span>{label}</span>
                <span className="text-[11px] tabular-nums text-[var(--text-subtle)]">
                  {countFor(key)}
                </span>
                {active && (
                  <span className="absolute inset-x-0 -bottom-px h-px bg-[var(--text)]" />
                )}
              </button>
            );
          })}
        </nav>

        <div className="flex items-center gap-2">
          <div className="relative w-[300px]">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--text-subtle)]" />
            <input
              ref={searchRef}
              type="text"
              placeholder="Search captures"
              className="input-field pl-8 pr-12"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <span className="kbd pointer-events-none absolute right-2 top-1/2 -translate-y-1/2">
              ⌘K
            </span>
          </div>
          <button className="btn-secondary">Filter</button>
        </div>
      </header>

      <div className="flex shrink-0 items-center justify-between px-6 pb-1 pt-4">
        <p className="text-[12px] text-[var(--text-muted)]">
          {isLoading ? " " : `${total} ${total === 1 ? "capture" : "captures"}`}
        </p>
        <p className="text-[12px] text-[var(--text-muted)]">Newest first</p>
      </div>

      <div id="content-area" className="flex-1 overflow-y-auto px-6 pb-6 pt-2">
        {isLoading ? (
          selectedKind === "image" || selectedKind === "screenshot" ? (
            <MasonrySkeleton />
          ) : (
            <ListSkeleton />
          )
        ) : total === 0 ? (
          <EmptyState searching={searching} />
        ) : (
          <>
            {(selectedKind === "image" || selectedKind === "screenshot") && (
              <MasonryLayout items={(q && searchItems ? searchItems : captures) as any} />
            )}
            {selectedKind === "text" && (
              <TextWrapLayout
                items={
                  captures as unknown as Array<{
                    _id: string;
                    kind: "text";
                    content: string;
                    url: string;
                    timestamp: number;
                    category?: string;
                  }>
                }
              />
            )}
            {selectedKind === "link" && (
              <LinkList
                items={
                  (captures as unknown as Array<{
                    _id: string;
                    kind: "link";
                    href: string;
                    text?: string;
                    url: string;
                    title?: string;
                    timestamp: number;
                    category?: string;
                    tags?: string[];
                  }>)
                }
              />
            )}
          </>
        )}
      </div>

  
    </main>
  );
}