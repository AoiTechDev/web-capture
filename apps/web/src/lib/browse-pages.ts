/**
 * Page ranges for the live browse feed, the way Convex's own paginated
 * queries keep them: a page is first loaded open-ended from its start
 * cursor, then pinned to the cursor that reply returned (`endCursor`,
 * inclusive), so a capture added or deleted elsewhere neither skips nor
 * duplicates cards across pages. A page that grows too large comes back with
 * `splitCursor` and is split in two there. Pure, for the vitest suite.
 */

export type PageRange = {
  /** Where the page starts; null for the newest end of the library. */
  start: string | null;
  /** Where it is pinned to end (inclusive); null until its first reply, and for a last page that reached the end. */
  end: string | null;
};

export type BrowseReply<T> = {
  results: T[];
  /** Null once `isDone`. */
  cursor: string | null;
  isDone: boolean;
  /** Set when the page should be split in two at this cursor. */
  splitCursor?: string | null;
};

export const FIRST_PAGE: readonly PageRange[] = [{ start: null, end: null }];

/** Identifies a page's subscription. */
export function rangeKey(r: PageRange): string {
  return `${r.start ?? ""}>${r.end ?? ""}`;
}

/**
 * The ranges after replies came in (`replies[i]` for `ranges[i]`, undefined
 * while loading): an open page whose reply has a cursor is pinned to it, a
 * page whose reply has a `splitCursor` becomes two, and an open page that
 * reached the end of the library is the last. Returns `ranges` itself when
 * nothing changes, so it can feed a state update directly.
 */
export function reconcilePages<T>(
  ranges: readonly PageRange[],
  replies: ReadonlyArray<BrowseReply<T> | undefined>
): readonly PageRange[] {
  const out: PageRange[] = [];
  let changed = false;
  for (let i = 0; i < ranges.length; i++) {
    const range = ranges[i]!;
    const reply = replies[i];
    const split = reply?.splitCursor;
    if (split && split !== range.start && split !== range.end) {
      out.push({ start: range.start, end: split }, { start: split, end: range.end });
      changed = true;
    } else if (reply && range.end === null && !reply.isDone && reply.cursor) {
      out.push({ start: range.start, end: reply.cursor });
      changed = true;
    } else {
      out.push(range);
    }
    if (reply && range.end === null && reply.isDone) {
      // Nothing can follow the end of the library.
      if (i < ranges.length - 1) changed = true;
      break;
    }
  }
  return changed ? out : ranges;
}

/** Another page can be added: the last one is pinned, so its end is where the next starts. */
export function canAppendPage(ranges: readonly PageRange[]): boolean {
  const last = ranges[ranges.length - 1];
  return !!last && last.end !== null;
}

/** `ranges` plus an open page after the last, or `ranges` when the last is not pinned yet. */
export function appendPage(ranges: readonly PageRange[]): readonly PageRange[] {
  if (!canAppendPage(ranges)) return ranges;
  return [...ranges, { start: ranges[ranges.length - 1]!.end, end: null }];
}

/** Every page is loaded: the last one is open-ended and its reply says the library ends there. */
export function isFeedDone<T>(
  ranges: readonly PageRange[],
  replies: ReadonlyArray<BrowseReply<T> | undefined>
): boolean {
  const i = ranges.length - 1;
  const reply = replies[i];
  return i >= 0 && ranges[i]!.end === null && !!reply && reply.isDone;
}
