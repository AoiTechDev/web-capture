"use client";
import { api } from "../../../../../packages/backend/convex/_generated/api";
import MasonryLayout from "@/components/MansoryLayout";
import MaximizedText from "@/components/MaximizedText";
import TextWrapLayout from "@/components/TextWrapLayout";
import LinkList from "@/components/LinkList";
import { useSelectedCategoryStore } from "@/store/selected-category-store";
import { useCachedQuery } from "@/hooks/useStableQuery";
import { MasonrySkeleton, ListSkeleton } from "@/components/Skeletons";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Search, Images, Camera, Link, FileText } from "lucide-react";
import { useAction } from "convex/react";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import type { CaptureDetails } from "@/components/DesignDnaPanel";


type Kind = "image" | "text" | "link" | "code" | "screenshot";

type SearchArgs = FunctionArgs<typeof api.search.searchCaptures>;

/** Row shape returned by `search.searchCaptures` and consumed by the layouts. */
type SearchRow = FunctionReturnType<typeof api.search.searchCaptures>["results"][number];

/** Stored kinds each tab lists; the Screenshots tab also holds element and viewport shots. */
const KINDS_FOR_TAB: Record<Kind, NonNullable<SearchArgs["kinds"]>> = {
  image: ["image"],
  screenshot: ["screenshot", "element", "viewport"],
  link: ["link"],
  text: ["text"],
  code: ["code"],
};

/**
 * Arguments for `search.searchCaptures`. Keyword-only for now. Once the
 * dashboard runs the local text encoder, pass the two query embeddings:
 * `vector` = the query embedded via lib/ai_config `imageQueryText` (matched
 * against image captures) and `textVector` = the raw query embedded
 * (matched against text captures). The action fuses them with the keyword
 * hits; nothing else here changes.
 */
function buildSearchArgs(
  query: string,
  kind: Kind,
  vectors: Pick<SearchArgs, "vector" | "textVector"> = {}
): SearchArgs {
  return { query, kinds: KINDS_FOR_TAB[kind], limit: 60, ...vectors };
}

/** What the layout components accept once a row has been normalised. */
type DisplayItem = CaptureDetails & {
  _id: string;
  kind?: string;
  status?: string | null;
  error?: string | null;
  aiCategory?: string | null;
  aiTags?: string[] | null;
  url?: string;
  thumbUrl?: string | null;
  pageUrl?: string;
  width: number;
  height: number;
  alt: string;
  tags: string[];
  storageId?: string;
};

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
  // Rows remember the tab they were fetched for, so switching tabs never
  // shows the previous tab's kinds in the wrong layout.
  const [search, setSearch] = useState<{ kind: Kind; rows: SearchRow[] } | null>(null);
  const runSearch = useAction(api.search.searchCaptures);

  const { data: captures, isLoading: capturesLoading } = useCachedQuery(
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

  const { data: counts } = useCachedQuery(api.captures.countsByKind, {});

  // Undefined while the count query is in flight; an em dash reads better than
  // a flash of "0" that then corrects itself.
  // The Screenshots tab also lists picked-element and viewport shots (the
  // backend merges them into the "screenshot" listing), so count them too.
  const countFor = useCallback(
    (kind: Kind): string => {
      if (!counts) return "—";
      const kinds: string[] = kind === "screenshot" ? ["screenshot", "element", "viewport"] : [kind];
      return String(kinds.reduce((sum, k) => sum + (counts[k] ?? 0), 0));
    },
    [counts]
  );

  const searching = !!q.trim();

  // Hybrid search action (keyword-only until the dashboard embeds queries).
  // Debounced, and a newer keystroke discards an older response.
  useEffect(() => {
    const query = q.trim();
    if (!query) {
      setSearch(null);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const { results } = await runSearch(buildSearchArgs(query, selectedKind));
        if (!cancelled) setSearch({ kind: selectedKind, rows: results });
      } catch (err) {
        console.error("Search failed:", err);
        if (!cancelled) setSearch({ kind: selectedKind, rows: [] });
      }
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [q, selectedKind, runSearch]);

  // Search rows reshaped into what each tab's layout reads.
  const searchRows = search && search.kind === selectedKind ? search.rows : null;
  const searchItems = useMemo(
    () =>
      searchRows?.map((r) => ({
        _id: r.id,
        kind: r.kind,
        url: r.imageUrl ?? undefined,
        thumbUrl: r.thumbUrl ?? null,
        designDna: (r.designDna as CaptureDetails["designDna"]) ?? null,
        palette: (r.palette as CaptureDetails["palette"]) ?? null,
        clipped: r.clipped ?? null,
        pageUrl: r.pageUrl ?? undefined,
        width: r.width || 600,
        height: r.height || 400,
        alt: r.alt || r.title || "",
        tags: r.tags || [],
        storageId: r.storageId ?? undefined,
        status: r.status,
        error: r.error,
        aiCategory: r.aiCategory,
        aiTags: r.aiTags,
        // text / link layouts
        content: r.content ?? "",
        href: r.href ?? "",
        text: r.text ?? undefined,
        title: r.title ?? undefined,
        category: r.category ?? undefined,
        timestamp: r.timestamp,
      })) ?? null,
    [searchRows]
  );

  const visible = searching && searchItems ? searchItems : captures;
  const total = Array.isArray(visible) ? visible.length : 0;

  // Loading and empty look identical if you only test length, which is what
  // made the empty state flash before content arrived. Only the absence of a
  // resolved result counts as loading.
  const isLoading = searching ? searchItems === null : capturesLoading;

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
        <p className="text-[12px] text-[var(--text-muted)]">{searching ? "Best match" : "Newest first"}</p>
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
              <MasonryLayout items={visible as DisplayItem[]} />
            )}
            {selectedKind === "text" && (
              <TextWrapLayout
                items={
                  visible as unknown as Array<{
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
                  (visible as unknown as Array<{
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

      <MaximizedText />
    </main>
  );
}