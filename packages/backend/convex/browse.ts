/**
 * Browsing: the caller's captures newest first, with the same filters as
 * search, a page at a time ("load more").
 */
import { query, type QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import {
  clampLimit,
  decodeBrowseCursor,
  encodeBrowseCursor,
  normalizeFilters,
  type BrowseCursor,
} from "./lib/search_filters";
import {
  captureRange,
  filterArgs,
  filterPredicate,
  resolveScope,
  sessionNameLoader,
  toRow,
  type CaptureRow,
  type Filters,
} from "./search_scope";

/**
 * Captures one page may examine. With filters that match little, a page can
 * stop here with fewer than `limit` results (even none) and `isDone: false`;
 * the next page continues from where it stopped.
 */
export const MAX_BROWSE_SCAN = 500;

export type BrowseResponse = {
  results: CaptureRow[];
  /** Pass back as `cursor` for the next page; null once `isDone`. */
  cursor: string | null;
  isDone: boolean;
};

type CaptureDoc = Doc<"captures">;

/** Newest first, ties by id; only docs at or before the cursor's time. */
function sortedNewestFirst(docs: CaptureDoc[], after: BrowseCursor | null): CaptureDoc[] {
  return docs
    .filter((d) => after === null || d._creationTime <= after.t)
    .sort((a, b) => b._creationTime - a._creationTime || (a._id < b._id ? 1 : a._id > b._id ? -1 : 0));
}

/**
 * One page. Two sources, both newest first:
 * - a colour filter whose matching set is small (CANDIDATE_CAP): that set,
 *   loaded and sorted in memory, so a rare colour does not mean scanning the
 *   library page by page for it;
 * - otherwise the creation-time index (by_user_session for a session, else
 *   by_user), ranged by the date filters, examining at most MAX_BROWSE_SCAN
 *   captures. Kind, category and colour are checked per capture.
 * The cursor is the last capture examined; the scan resumes at or before its
 * time, skipping captures up to and including it (creation times can tie).
 */
export async function browsePage(
  ctx: QueryCtx,
  userId: string,
  f: Filters,
  limit: number,
  after: BrowseCursor | null
): Promise<BrowseResponse> {
  const scope = await resolveScope(ctx, userId, f, "color");
  if (scope.empty) return { results: [], cursor: null, isDone: true };
  const passes = filterPredicate(userId, f);
  const source: AsyncIterable<CaptureDoc> | Iterable<CaptureDoc> = scope.candidates
    ? sortedNewestFirst(scope.candidates, after)
    : captureRange(ctx, userId, f, after?.t);

  const page: CaptureDoc[] = [];
  let last: CaptureDoc | null = null;
  let scanned = 0;
  let more = false;
  let pastCursor = after === null;
  for await (const d of source) {
    if (!pastCursor) {
      if (d._creationTime < after!.t) {
        pastCursor = true;
      } else {
        if (d._id === after!.id) pastCursor = true;
        continue;
      }
    }
    // Checked before examining `d`, so `more` means a capture really follows.
    if (page.length === limit || scanned === MAX_BROWSE_SCAN) {
      more = true;
      break;
    }
    scanned++;
    last = d;
    if (passes(d) && (await scope.colorOk(d._id))) page.push(d);
  }

  const names = sessionNameLoader(ctx, userId);
  return {
    results: await Promise.all(page.map((d) => toRow(ctx, d, names))),
    cursor: more && last ? encodeBrowseCursor({ t: last._creationTime, id: last._id }) : null,
    isDone: !more,
  };
}

/**
 * The caller's captures, newest first, filtered (every filter ANDed) and
 * paginated. Reactive: a page re-renders as its captures change (status,
 * labels). `searchCaptures` with an empty query and no vectors returns the
 * same pages.
 */
export const browseCaptures = query({
  args: filterArgs,
  handler: async (ctx, args): Promise<BrowseResponse> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return { results: [], cursor: null, isDone: true };
    const { limit, cursor, ...raw } = args;
    const filters = normalizeFilters(raw);
    const after = cursor ? decodeBrowseCursor(cursor) : null;
    return await browsePage(ctx, identity.subject, filters, clampLimit(limit), after);
  },
});
