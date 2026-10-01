"use client";
import { api } from "../../../../../packages/backend/convex/_generated/api";
import MaximizedText from "@/components/MaximizedText";
import CaptureGrid from "@/components/CaptureGrid";
import { FilterPanel, TypeChips } from "@/components/FilterBar";
import { MasonrySkeleton } from "@/components/Skeletons";
import { useQuery } from "convex/react";
import { useCachedQuery } from "@/hooks/useStableQuery";
import { useSessionOptions } from "@/hooks/useSessionOptions";
import { useQueryEmbedding } from "@/hooks/useQueryEmbedding";
import { useFilterParams } from "@/hooks/useFilterParams";
import { useCaptureFeed } from "@/hooks/useCaptureFeed";
import { argsKey, filtersToArgs, type FeedFilterArgs } from "@/lib/capture-feed";
import { clearFilters, countActiveFilters, normalizeHexColor } from "@/lib/capture-filters";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Search, SlidersHorizontal } from "lucide-react";

/** `value`, but the same object for as long as `key` is unchanged. */
function useStableByKey<T>(value: T, key: string): T {
  const ref = useRef({ key, value });
  if (ref.current.key !== key) ref.current = { key, value };
  return ref.current.value;
}

type EmptyKind = "library" | "noMatches" | "error";

/**
 * The library is empty until the extension is installed, so that state
 * doubles as the install prompt. "No matches" offers the way back out.
 */
const EmptyState = ({
  kind,
  canClearFilters,
  canClearSearch,
  onClearFilters,
  onClearSearch,
}: {
  kind: EmptyKind;
  canClearFilters: boolean;
  canClearSearch: boolean;
  onClearFilters: () => void;
  onClearSearch: () => void;
}) => (
  <div className="surface-card flex min-h-[320px] flex-col items-center justify-center px-6 py-16 text-center">
    <span className="mb-5 flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--blue-500)]">
      <span className="h-2.5 w-2.5 rounded-[2px] bg-white" />
    </span>

    {kind === "library" ? (
      <>
        <h2 className="mb-2 text-[16px] font-semibold text-[var(--text)]">No captures yet</h2>
        <p className="mb-6 max-w-md text-[13px] leading-relaxed text-[var(--text-muted)]">
          Install the Chrome extension and press a shortcut on any page to save an
          image, screenshot, link or selection. Everything you capture lands here.
        </p>
        <div className="flex items-center gap-3">
          <a className="btn-primary" href="#">
            Add to Chrome
          </a>
          <span className="mono text-[12px] text-[var(--text-subtle)]">then press ⌘⇧S</span>
        </div>
      </>
    ) : (
      <>
        <h2 className="mb-2 text-[16px] font-semibold text-[var(--text)]">
          {kind === "error" ? "Couldn't load captures" : "No matches"}
        </h2>
        <p className="mb-6 max-w-sm text-[13px] leading-relaxed text-[var(--text-muted)]">
          {kind === "error"
            ? "Something went wrong fetching your library. Try again, or loosen the filters."
            : "Nothing in your library matches this search and these filters. Try a different word, or widen the filters."}
        </p>
        <div className="flex flex-wrap items-center justify-center gap-2">
          {canClearFilters && (
            <button type="button" className="btn-secondary" onClick={onClearFilters}>
              Clear filters
            </button>
          )}
          {canClearSearch && (
            <button type="button" className="btn-secondary" onClick={onClearSearch}>
              Clear search
            </button>
          )}
        </div>
      </>
    )}
  </div>
);

function Dashboard() {
  const { filters, setFilters } = useFilterParams();
  const [q, setQ] = useState(filters.q);
  const [debouncedQ, setDebouncedQ] = useState(filters.q.trim());
  const { embed, status: modelStatus } = useQueryEmbedding();
  const searchRef = useRef<HTMLInputElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const activeCount = countActiveFilters(filters);
  const panelFilters = activeCount - (filters.types.length ? 1 : 0);
  const [panelOpen, setPanelOpen] = useState(panelFilters > 0);
  // Remounts the panel on "Clear filters", resetting its local state (a custom date range left open).
  const [panelKey, setPanelKey] = useState(0);

  // 300 ms debounce; clearing the field browses at once.
  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedQ(q.trim()), 300);
    return () => window.clearTimeout(t);
  }, [q]);
  const query = q.trim() ? debouncedQ : "";

  // The URL follows the debounced query, so a refresh or a shared link searches again.
  useEffect(() => {
    if (query !== filters.q.trim()) setFilters({ q: query });
  }, [query, filters.q, setFilters]);

  // A colour set from a swatch shows up in the panel.
  useEffect(() => {
    if (filters.color) setPanelOpen(true);
  }, [filters.color]);

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

  // Null (shown as "—") until the backend's counters cover the whole library.
  const counts = useCachedQuery(api.captures.countsByKind, {}).data ?? undefined;
  // The picker's list, a page at a time; fetched only while the panel is open.
  const sessionOptions = useSessionOptions(panelOpen);
  const { sessions } = sessionOptions;

  // The URL's session must be one of the user's before it is sent: the
  // backend's id validator throws on an id from another table. One
  // owner-checked read settles it, however old the session; unknown ones
  // (garbage, another table's id, deleted, someone else's) come back null
  // and are dropped from the URL. One picked from the list is known good.
  const sessionCheck = useQuery(
    api.sessions.getSessionOption,
    filters.session ? { id: filters.session } : "skip"
  );
  const sessionOk =
    !filters.session || !!sessionCheck || !!sessions?.some((s) => s.id === filters.session);
  useEffect(() => {
    if (filters.session && sessionCheck === null) setFilters({ session: null });
  }, [filters.session, sessionCheck, setFilters]);

  // Date presets start at local midnight, so the arguments (and the queries
  // they key) change once a day, not on every render.
  const rawArgs = filtersToArgs(filters, Date.now(), sessionOk ? filters.session : null);
  const filterArgs = useStableByKey<FeedFilterArgs>(rawArgs, argsKey(rawArgs));

  const feed = useCaptureFeed({
    query,
    filters: filterArgs,
    enabled: sessionOk,
    embed,
    modelLoading: modelStatus === "loading",
  });

  const pickColor = useCallback(
    (hex: string) => setFilters({ color: normalizeHexColor(hex) }),
    [setFilters]
  );
  const onClearFilters = () => {
    setFilters(clearFilters);
    setPanelKey((k) => k + 1);
  };
  const onClearSearch = () => {
    setQ("");
    setDebouncedQ("");
  };

  const searching = !!query;
  const libraryTotal = counts ? (counts.all ?? 0) - (counts.code ?? 0) : null;
  const emptyKind: EmptyKind = feed.failed
    ? "error"
    : libraryTotal === 0 || (libraryTotal === null && !searching && activeCount === 0)
      ? "library"
      : "noMatches";
  const total = feed.rows?.length ?? 0;
  const onlyLists = filters.types.length > 0 && filters.types.every((t) => t === "link" || t === "text");

  return (
    <main id="main-content" className="flex min-w-0 flex-1 flex-col w-full">
      <header
        id="dashboard-header"
        className="flex min-h-14 shrink-0 flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b border-[var(--border)] px-4 py-2.5 sm:px-6"
      >
        <TypeChips selected={filters.types} counts={counts} onChange={(types) => setFilters({ types })} />

        <div className="flex w-full items-center gap-2 sm:w-auto">
          <div className="relative min-w-0 flex-1 sm:w-[300px] sm:flex-none">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--text-subtle)]" />
            <input
              ref={searchRef}
              type="text"
              aria-label="Search captures"
              placeholder="Search captures"
              className="input-field pl-8 pr-12"
              value={q}
              maxLength={500}
              onChange={(e) => setQ(e.target.value)}
            />
            <span className="kbd pointer-events-none absolute right-2 top-1/2 -translate-y-1/2">⌘K</span>
          </div>
          <button
            type="button"
            className="btn-secondary shrink-0"
            aria-expanded={panelOpen}
            aria-controls="filter-panel"
            onClick={() => setPanelOpen((o) => !o)}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            Filters
            {activeCount > 0 && (
              <span className="chip-count" aria-label={`${activeCount} active`}>
                {activeCount}
              </span>
            )}
          </button>
          {activeCount > 0 && (
            <button
              type="button"
              className="shrink-0 text-[12px] text-[var(--text-muted)] transition-colors hover:text-[var(--text)]"
              onClick={onClearFilters}
            >
              Clear
            </button>
          )}
        </div>
      </header>

      {panelOpen && (
        <FilterPanel
          key={panelKey}
          id="filter-panel"
          filters={filters}
          setFilters={setFilters}
          sessions={sessionOptions}
          selectedSession={sessionCheck ?? null}
        />
      )}

      <div className="flex shrink-0 items-center justify-between px-4 pb-1 pt-4 sm:px-6">
        <p className="text-[12px] text-[var(--text-muted)]" aria-live="polite">
          {feed.rows === null || feed.stale
            ? " "
            : `${total}${feed.isDone ? "" : "+"} ${total === 1 ? "capture" : "captures"}`}
        </p>
        <p className="text-[12px] text-[var(--text-muted)]">
          {/* Shown only while the extension's model is still loading for the first time. */}
          {searching ? (modelStatus === "loading" ? "Loading search model…" : "Best match") : "Newest first"}
        </p>
      </div>

      <div ref={contentRef} id="content-area" className="flex-1 overflow-y-auto px-4 pb-6 pt-2 sm:px-6">
        <CaptureGrid
          feed={feed}
          listSkeleton={onlyLists}
          scrollRoot={contentRef}
          onPickColor={pickColor}
          emptyState={
            <EmptyState
              kind={emptyKind}
              canClearFilters={activeCount > 0}
              canClearSearch={searching}
              onClearFilters={onClearFilters}
              onClearSearch={onClearSearch}
            />
          }
        />
      </div>

      <MaximizedText />
    </main>
  );
}

export default function DashboardPage() {
  // useSearchParams needs a Suspense boundary wherever a page could be prerendered.
  return (
    <Suspense
      fallback={
        <main className="flex-1 p-6">
          <MasonrySkeleton />
        </main>
      }
    >
      <Dashboard />
    </Suspense>
  );
}
