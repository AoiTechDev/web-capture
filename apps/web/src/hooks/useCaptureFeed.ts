import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAction, useQueries } from "convex/react";
import type { RequestForQueries } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../../../packages/backend/convex/_generated/api";
import {
  argsKey,
  buildBrowseArgs,
  buildSearchArgs,
  mergePages,
  type CaptureRow,
  type FeedFilterArgs,
  type SearchArgs,
} from "@/lib/capture-feed";
import {
  appendPage,
  canAppendPage,
  FIRST_PAGE,
  isFeedDone,
  rangeKey,
  reconcilePages,
  type BrowseReply,
  type PageRange,
} from "@/lib/browse-pages";
import { useRemovedCapturesStore } from "@/store/removed-captures-store";

/**
 * A browse page's reply. A pinned page that could not cover its range within
 * the read budget carries `splitCursor` and is split in two there.
 */
type Reply = FunctionReturnType<typeof api.browse.browseCaptures> & BrowseReply<CaptureRow>;

export type CaptureFeed = {
  mode: "browse" | "search";
  /** Null until the first page has arrived; then the rows to show. */
  rows: CaptureRow[] | null;
  /** True while `rows` are the previous view's, kept on screen while the new one loads. */
  stale: boolean;
  /** Every page loaded. */
  isDone: boolean;
  loadingMore: boolean;
  /** Another page can be asked for now: what infinite scroll waits on. */
  canLoadMore: boolean;
  /** The last page failed; auto-loading stops (for search, `loadMore` retries). */
  failed: boolean;
  loadMore: () => void;
};

type Options = {
  /** Trimmed, debounced search text; blank browses. */
  query: string;
  /** Memoised by value: a new object means new filters. */
  filters: FeedFilterArgs;
  /** False while the filters cannot be sent yet (the session is being checked). */
  enabled: boolean;
  embed: (query: string) => Promise<number[] | null>;
  /** The extension's model is still loading: search by keyword now, hybrid once it is ready. */
  modelLoading: boolean;
};

/**
 * Browse: `browse.browseCaptures` is reactive, so each page is its own live
 * subscription. A page is loaded open-ended first, then pinned to the range
 * that reply covered and split when it outgrows it (lib/browse-pages), so a
 * capture added or deleted elsewhere neither skips nor duplicates cards.
 * While a page re-subscribes, its last rows stay on screen. A change of
 * filters, or leaving browse for search, starts again from the first page.
 */
function useBrowsePages(filters: FeedFilterArgs, active: boolean) {
  const key = active ? argsKey(filters) : "";
  const [state, setState] = useState<{ key: string; ranges: readonly PageRange[] }>({ key, ranges: FIRST_PAGE });
  const ranges = active && state.key === key ? state.ranges : FIRST_PAGE;

  // Keyed by range, so pinning or splitting one page leaves the others' subscriptions alone.
  const requests = useMemo(() => {
    const r: RequestForQueries = {};
    if (active) {
      for (const range of ranges) {
        r[rangeKey(range)] = { query: api.browse.browseCaptures, args: buildBrowseArgs(filters, range) };
      }
    }
    return r;
  }, [active, filters, ranges]);
  const results = useQueries(requests);

  // Each page's last reply by start cursor: what it shows while it re-loads.
  const last = useRef<{ key: string; byStart: Map<string, Reply> }>({ key, byStart: new Map() });
  if (last.current.key !== key) last.current = { key, byStart: new Map() };
  const replies: Array<Reply | undefined> = [];
  const pages: Array<CaptureRow[] | undefined> = [];
  let pending = false;
  let error: Error | null = null;
  if (active) {
    for (const range of ranges) {
      const live = results[rangeKey(range)] as Reply | Error | undefined;
      const start = range.start ?? "";
      if (live instanceof Error) error ??= live;
      else if (live === undefined) pending = true;
      else last.current.byStart.set(start, live);
      replies.push(live instanceof Error ? undefined : live);
      pages.push(live instanceof Error || live === undefined ? last.current.byStart.get(start)?.results : live.results);
    }
  }
  useEffect(() => {
    if (error) console.error("Browse failed:", error);
  }, [error]);

  const next = reconcilePages(ranges, replies);
  useEffect(() => {
    if (next !== ranges) setState({ key, ranges: next });
  }, [next, ranges, key]);

  const failed = error !== null;
  const isDone = failed || isFeedDone(ranges, replies);

  const loadMore = useCallback(() => {
    setState((s) => {
      const current = s.key === key ? s.ranges : FIRST_PAGE;
      const more = appendPage(current);
      return more === current && s.key === key ? s : { key, ranges: more };
    });
  }, [key]);

  // A first page that failed reads as an empty, finished feed (with `failed` set).
  const rows = !active ? null : pages[0] ? pages : failed ? [] : null;
  return {
    pages: rows,
    isDone,
    loadingMore: active && !isDone && pending,
    // Only a pinned last page can be followed, so this cannot double-load; it
    // need not wait for the pinned page to re-subscribe, only for its range.
    canLoadMore: active && !isDone && canAppendPage(ranges),
    failed,
    loadMore,
  };
}

type SearchState = {
  key: string;
  /** Which run produced it; a load-more reply for an older run is dropped. */
  run: number;
  rows: CaptureRow[];
  cursor: string | null;
  isDone: boolean;
  /** What the first page was fetched with; later pages must match. */
  args: SearchArgs | null;
  loadingMore: boolean;
  failed: boolean;
};

/** Search: `search.searchCaptures` is an action, fetched once per query and filter set. */
function useSearchPages({ query, filters, enabled, embed, modelLoading }: Options) {
  const runSearch = useAction(api.search.searchCaptures);
  const active = enabled && !!query;
  const key = active ? `${query}\u0000${argsKey(filters)}` : "";
  const [search, setSearch] = useState<SearchState | null>(null);
  const runs = useRef(0);

  // Hybrid search: the query vector comes from the extension when it is
  // installed and answers in time, else the same action runs keyword-only.
  // A newer query or filter set discards an older response.
  //
  // While the model is still loading (a cold start can take minutes), no
  // search waits for the vector: keyword results show at once and the query
  // still goes to the extension. Its first vector turns the status "ready",
  // which re-runs this effect for the current query, now hybrid.
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    void (async () => {
      let vector: number[] | null = null;
      if (modelLoading) {
        void embed(query).catch(() => null);
      } else {
        // Resolves to null within ~3s (DEFAULT_EMBED_TIMEOUT_MS) when the
        // extension is missing, errors or is slow; the catch is belt and braces.
        vector = await embed(query).catch(() => null);
      }
      if (cancelled) return;
      const run = ++runs.current;
      let args = buildSearchArgs(query, filters, vector ? { vector } : {});
      try {
        const res = await runSearch(args).catch((err) => {
          // A vector the backend refuses (say, an extension on another model)
          // must not cost the user their results: retry by keyword.
          if (!vector) throw err;
          console.warn("Hybrid search failed, retrying by keyword:", err);
          args = buildSearchArgs(query, filters);
          return runSearch(args);
        });
        if (cancelled) return;
        setSearch({
          key,
          run,
          rows: res.results,
          cursor: res.cursor,
          isDone: res.isDone,
          args,
          loadingMore: false,
          failed: false,
        });
      } catch (err) {
        console.error("Search failed:", err);
        if (!cancelled) {
          setSearch({ key, run, rows: [], cursor: null, isDone: true, args: null, loadingMore: false, failed: true });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [active, key, query, filters, embed, modelLoading, runSearch]);

  const current = useRef(search);
  useEffect(() => {
    current.current = search;
  }, [search]);

  const loadMore = useCallback(() => {
    const s = current.current;
    if (!s || s.isDone || !s.cursor || !s.args || s.loadingMore) return;
    const { run, cursor, args } = s;
    const same = (cur: SearchState | null): cur is SearchState => !!cur && cur.run === run && cur.cursor === cursor;
    const pending = { ...s, loadingMore: true, failed: false };
    current.current = pending;
    setSearch(pending);
    runSearch({ ...args, cursor })
      .then((res) => {
        setSearch((cur) =>
          same(cur)
            ? {
                ...cur,
                rows: mergePages([cur.rows, res.results]),
                cursor: res.cursor,
                isDone: res.isDone,
                loadingMore: false,
              }
            : cur
        );
      })
      .catch((err) => {
        console.error("Loading more results failed:", err);
        setSearch((cur) => (same(cur) ? { ...cur, loadingMore: false, failed: true } : cur));
      });
  }, [runSearch]);

  const ready = active && search?.key === key ? search : null;
  return { active, ready, loadMore };
}

/**
 * The dashboard grid's data: the filtered library newest first when the
 * query is blank (live), else hybrid search results; both a page at a time.
 */
export function useCaptureFeed(opts: Options): CaptureFeed {
  const browsing = opts.enabled && !opts.query;
  const browse = useBrowsePages(opts.filters, browsing);
  const search = useSearchPages(opts);
  const removed = useRemovedCapturesStore((s) => s.removed);

  const merged = browsing
    ? browse.pages && mergePages(browse.pages, removed)
    : search.ready && mergePages([search.ready.rows], removed);

  // Browse pages are rebuilt every render; keep the previous array while it
  // holds the same row objects (Convex hands back unchanged results as is),
  // so the grid only re-lays out when something did change.
  const stable = useRef<CaptureRow[] | null>(null);
  const prev = stable.current;
  const rows =
    merged && prev && merged.length === prev.length && merged.every((r, i) => r === prev[i]) ? prev : merged;

  // The previous view stays up (dimmed by the caller) while the next loads,
  // rather than collapsing to a skeleton on every filter change.
  useEffect(() => {
    if (rows) stable.current = rows;
  }, [rows]);
  const fallback = rows ?? prev;

  if (browsing) {
    return {
      mode: "browse",
      rows: fallback,
      stale: !rows && !!fallback,
      isDone: browse.isDone,
      loadingMore: browse.loadingMore,
      canLoadMore: browse.canLoadMore,
      failed: browse.failed,
      loadMore: browse.loadMore,
    };
  }
  const s = search.ready;
  return {
    mode: "search",
    rows: fallback,
    stale: !rows && !!fallback,
    isDone: s ? s.isDone : false,
    loadingMore: !!s?.loadingMore,
    canLoadMore: !!s && !s.isDone && !!s.cursor && !s.loadingMore && !s.failed,
    failed: !!s?.failed,
    loadMore: search.loadMore,
  };
}
