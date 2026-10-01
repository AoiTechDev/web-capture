/**
 * Turning the dashboard's filters into `browse.browseCaptures` and
 * `search.searchCaptures` arguments, and pages into one list. Pure (type-only
 * imports from the backend), so the extension's vitest suite can test it.
 */
import type { FunctionArgs } from "convex/server";
import type { api } from "../../../../packages/backend/convex/_generated/api";
import type { Id } from "../../../../packages/backend/convex/_generated/dataModel";
import type { CaptureRow } from "../../../../packages/backend/convex/search_scope";
import { KINDS_FOR_TYPE, type CaptureFilters, type CaptureKind } from "./capture-filters";

export type SearchArgs = FunctionArgs<typeof api.search.searchCaptures>;
export type BrowseArgs = FunctionArgs<typeof api.browse.browseCaptures>;
/** The filter part both entry points share. */
export type FeedFilterArgs = Omit<BrowseArgs, "limit" | "cursor">;
export type QueryVectors = Pick<SearchArgs, "vector" | "textVector">;
export type { CaptureRow };

/** Results per page. */
export const PAGE_SIZE = 40;

const DAY_PRESETS = { "7d": 7, "30d": 30 } as const;

/** Local midnight `daysBack` days before the day of `now`. */
function localDayStart(now: number, daysBack = 0): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - daysBack);
  return d.getTime();
}

/** Local midnight of a "YYYY-MM-DD" day, shifted by `addDays`. */
function dayToMs(day: string, addDays = 0): number {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y!, m! - 1, d! + addDays).getTime();
}

/**
 * Creation-time bounds (ms) for the date filter. A preset covers today and
 * the days before it ("7d" = today and the 6 days before), starting at local
 * midnight, so the bounds stay the same all day and do not re-key queries on
 * every render. Custom days are inclusive local days.
 */
export function dateBounds(f: Pick<CaptureFilters, "date" | "from" | "to">, now: number): {
  dateFrom?: number;
  dateTo?: number;
} {
  if (f.date) return { dateFrom: localDayStart(now, DAY_PRESETS[f.date] - 1) };
  let from = f.from;
  let to = f.to;
  if (from && to && from > to) [from, to] = [to, from];
  return {
    ...(from ? { dateFrom: dayToMs(from) } : {}),
    ...(to ? { dateTo: dayToMs(to, 1) - 1 } : {}),
  };
}

/** Stored kinds for the selected type chips; undefined (every kind) when none is selected. */
export function kindsForTypes(types: CaptureFilters["types"]): CaptureKind[] | undefined {
  const kinds = types.flatMap((t) => KINDS_FOR_TYPE[t] ?? []);
  return kinds.length ? Array.from(new Set(kinds)) : undefined;
}

/**
 * The filter arguments for `f`. `sessionId` is passed separately because the
 * caller must first check the URL's session against the user's sessions: the
 * backend's `v.id("sessions")` validator throws on an id from another table.
 * Absent filters are left out rather than sent as undefined.
 */
export function filtersToArgs(
  f: CaptureFilters,
  now: number,
  sessionId: string | null = null
): FeedFilterArgs {
  const kinds = kindsForTypes(f.types);
  return {
    ...(sessionId ? { sessionId: sessionId as Id<"sessions"> } : {}),
    ...(kinds ? { kinds } : {}),
    ...(f.categories.length ? { aiCategories: [...f.categories] } : {}),
    ...(f.color ? { color: f.color, colorTolerance: f.tolerance } : {}),
    ...dateBounds(f, now),
  };
}

/**
 * One browse page: from `range.start`, and up to `range.end` (`endCursor`,
 * inclusive) once the page is pinned to the range its first reply covered
 * (lib/browse-pages).
 */
export function buildBrowseArgs(
  filters: FeedFilterArgs,
  range: { start: string | null; end: string | null } = { start: null, end: null }
): BrowseArgs {
  return {
    ...filters,
    limit: PAGE_SIZE,
    ...(range.start ? { cursor: range.start } : {}),
    ...(range.end ? { endCursor: range.end } : {}),
  };
}

/**
 * Arguments for `search.searchCaptures`. `vectors.vector` is the query
 * embedded by the Chrome extension's local model (useQueryEmbedding); with
 * SigLIP2 that one vector serves both the image and the text index, so
 * `textVector` stays unset. Without a vector the action searches by keyword
 * only, through the same path. `cursor` continues a previous page, and must
 * come with the same query, filters and vectors.
 */
export function buildSearchArgs(
  query: string,
  filters: FeedFilterArgs,
  vectors: QueryVectors = {},
  cursor: string | null = null
): SearchArgs {
  return {
    query,
    ...filters,
    limit: PAGE_SIZE,
    ...(vectors.vector ? { vector: vectors.vector } : {}),
    ...(vectors.textVector ? { textVector: vectors.textVector } : {}),
    ...(cursor ? { cursor } : {}),
  };
}

/**
 * Pages concatenated in order, each capture once (its first appearance), minus
 * `removed`. While a page re-loads (pinned, or split in two) its last rows
 * stand in for it, so a capture can briefly sit on two pages; and search
 * pages are fused lists fetched one at a time, which can overlap.
 */
export function mergePages<T extends { id: string }>(
  pages: ReadonlyArray<ReadonlyArray<T> | undefined>,
  removed: ReadonlySet<string> = new Set()
): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const page of pages) {
    for (const row of page ?? []) {
      if (seen.has(row.id) || removed.has(row.id)) continue;
      seen.add(row.id);
      out.push(row);
    }
  }
  return out;
}

const VISUAL_KINDS: ReadonlySet<string> = new Set(["image", "screenshot", "element", "viewport"]);

/**
 * Rows split by the layout that shows them, order kept. "code" captures have
 * no layout (the kind is hidden from the UI) and are left out.
 */
export function partitionByLayout<T extends { kind: string }>(rows: readonly T[]): {
  visual: T[];
  text: T[];
  link: T[];
} {
  const out = { visual: [] as T[], text: [] as T[], link: [] as T[] };
  for (const r of rows) {
    if (VISUAL_KINDS.has(r.kind)) out.visual.push(r);
    else if (r.kind === "text") out.text.push(r);
    else if (r.kind === "link") out.link.push(r);
  }
  return out;
}

/** A stable key for an arguments object, for keying state and effects. */
export function argsKey(args: object): string {
  return JSON.stringify(args, Object.keys(args).sort());
}
