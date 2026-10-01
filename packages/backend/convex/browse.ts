/**
 * Browsing: the caller's captures newest first, with the same filters as
 * search, a page at a time ("load more").
 */
import { query, type QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { v } from "convex/values";
import {
  clampLimit,
  decodeBrowseCursor,
  encodeBrowseCursor,
  normalizeFilters,
  type BrowseCursor,
} from "./lib/search_filters";
import { createReadBudget, type ReadBudget } from "./lib/read_budget";
import {
  captureRange,
  filterArgs,
  filterPredicate,
  resolveScope,
  toRows,
  type CaptureRow,
  type Filters,
} from "./search_scope";

/**
 * Captures one page may examine. With filters that match little, a page can
 * stop here (or at the read budget, lib/read_budget) with fewer than `limit`
 * results, even none, and `isDone: false`; the next page continues from
 * where it stopped.
 */
export const MAX_BROWSE_SCAN = 500;

export type BrowseResponse = {
  results: CaptureRow[];
  /**
   * Without `endCursor`: the last capture examined, to pass as `cursor` for
   * the next page and as `endCursor` when re-subscribing this one; null
   * once `isDone`. With `endCursor`: `endCursor` itself.
   */
  cursor: string | null;
  /** Nothing follows this page. Never true for a page pinned with `endCursor`. */
  isDone: boolean;
  /**
   * Only with `endCursor`, when the page could not examine its whole range
   * within MAX_BROWSE_SCAN or the read budget: `results` then cover only
   * (cursor, splitCursor], and the client must replace this page with two,
   * (cursor, splitCursor] and (splitCursor, endCursor], as for Convex's own
   * paginated queries.
   */
  splitCursor?: string;
};

type CaptureDoc = Doc<"captures">;
type Positioned = { _creationTime: number; _id: string };

/*
 * Browse order: newest first, creation-time ties broken by id, larger id
 * first, compared as strings. Both sources use it: the in-memory candidate
 * set sorts by it, and the index scan (whose tie order is the index's own)
 * re-sorts each run of equal creation times. Convex gives the documents of
 * a table distinct creation times, so runs are one capture long in practice.
 */

/** Negative when `d` comes before position `p`, zero at it, positive after. */
export function comparePosition(d: Positioned, p: BrowseCursor): number {
  if (d._creationTime !== p.t) return d._creationTime > p.t ? -1 : 1;
  return d._id === p.id ? 0 : d._id > p.id ? -1 : 1;
}

export function browseOrder(a: Positioned, b: Positioned): number {
  return comparePosition(a, { t: b._creationTime, id: b._id });
}

/** The index scan in browse order, charging the budget for every capture read. */
export async function* inBrowseOrder(source: AsyncIterable<CaptureDoc>, budget: ReadBudget): AsyncGenerator<CaptureDoc> {
  let run: CaptureDoc[] = [];
  for await (const d of source) {
    budget.charge(d);
    if (run.length && run[0]!._creationTime !== d._creationTime) {
      yield* run.sort(browseOrder);
      run = [];
    }
    run.push(d);
  }
  yield* run.sort(browseOrder);
}

/**
 * One page: the captures after `after` (exclusive) in browse order, either
 * up to `limit` results or, when `end` is given, exactly up to `end`
 * (inclusive) whatever the limit. Two sources, both in browse order:
 * - a colour filter whose matching set is small (CANDIDATE_CAP): that set,
 *   loaded and sorted in memory, so a rare colour does not mean scanning
 *   the library page by page for it;
 * - otherwise the creation-time index (by_user_session for a session, else
 *   by_user), ranged by the date filters and the page's bounds, examining
 *   at most MAX_BROWSE_SCAN captures and the read budget. Kind, category
 *   and colour are checked per capture.
 * Positions are compared, not looked up, so a cursor whose capture has
 * since been deleted still marks the same place.
 */
export async function browsePage(
  ctx: QueryCtx,
  userId: string,
  f: Filters,
  limit: number,
  after: BrowseCursor | null,
  end: BrowseCursor | null = null
): Promise<BrowseResponse> {
  const budget = createReadBudget();
  const scope = await resolveScope(ctx, userId, f, { materialize: "color", budget });
  if (scope.empty) return { results: [], cursor: null, isDone: true };
  const passes = filterPredicate(userId, f);
  const fromIndex = !scope.candidates;
  const source: AsyncIterable<CaptureDoc> | Iterable<CaptureDoc> = scope.candidates
    ? [...scope.candidates].sort(browseOrder)
    : inBrowseOrder(captureRange(ctx, userId, f, { atOrBefore: after?.t, atOrAfter: end?.t }), budget);

  const page: CaptureDoc[] = [];
  let last: CaptureDoc | null = null;
  let scanned = 0;
  let stopped = false;
  for await (const d of source) {
    if (after && comparePosition(d, after) <= 0) continue;
    if (end && comparePosition(d, end) > 0) break;
    // Checked before examining `d`, so stopping means a capture really follows.
    const full = !end && page.length === limit;
    const spent = scanned === MAX_BROWSE_SCAN || (fromIndex && scanned > 0 && budget.exhausted);
    if (full || spent) {
      stopped = true;
      break;
    }
    scanned++;
    last = d;
    if (passes(d) && (await scope.colorOk(d._id))) page.push(d);
  }

  const results = await toRows(ctx, userId, page);
  const lastCursor = last ? encodeBrowseCursor({ t: last._creationTime, id: last._id }) : null;
  if (end) {
    return {
      results,
      cursor: encodeBrowseCursor(end),
      isDone: false,
      ...(stopped && lastCursor ? { splitCursor: lastCursor } : {}),
    };
  }
  return { results, cursor: stopped ? lastCursor : null, isDone: !stopped };
}

/**
 * The caller's captures, newest first, filtered (every filter ANDed) and
 * paginated. Reactive: a page re-renders as its captures change (status,
 * labels). `searchCaptures` with an empty query and no vectors returns the
 * same pages.
 *
 * Paging contract. Load a page with `{ cursor }` (none for the first) and
 * keep the `cursor` it returns, X. From then on subscribe to that page as
 * `{ cursor, endCursor: X }`: a pinned page covers exactly (cursor, X], so
 * when captures are added or deleted it grows or shrinks in place and the
 * pages after it neither skip nor repeat a capture. The next page starts at
 * `{ cursor: X }`. The last page (`isDone`, no cursor) stays unpinned and
 * picks up whatever comes after it. A pinned page that answers with a
 * `splitCursor` S could not examine its whole range: split it into
 * `{ cursor, endCursor: S }` and `{ cursor: S, endCursor: X }`.
 */
export const browseCaptures = query({
  args: {
    ...filterArgs,
    /**
     * Pin the page's end (inclusive) to the `cursor` an earlier load of it
     * returned. The page then returns exactly (cursor, endCursor], ignoring
     * `limit`. Must come after `cursor`.
     */
    endCursor: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<BrowseResponse> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return { results: [], cursor: null, isDone: true };
    const { limit, cursor, endCursor, ...raw } = args;
    const filters = normalizeFilters(raw);
    const after = cursor ? decodeBrowseCursor(cursor) : null;
    const end = endCursor ? decodeBrowseCursor(endCursor) : null;
    if (after && end && comparePosition({ _creationTime: end.t, _id: end.id }, after) <= 0) {
      throw new Error("Invalid cursor: endCursor must come after cursor");
    }
    return await browsePage(ctx, identity.subject, filters, clampLimit(limit), after, end);
  },
});
