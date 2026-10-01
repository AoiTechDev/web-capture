/**
 * What `searchCaptures` and `browseCaptures` share: their filter arguments,
 * the per-capture filter check, the colour filter's matching set, the
 * candidate set narrow filters allow, and the row the dashboard renders.
 */
import type { QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { isVisualKind } from "./local_ai";
import { aiCategoryValidator } from "./schema";
import { hexToLab, MAX_CAPTURE_COLORS, type Lab } from "./lib/color";
import { colorRowMatches, lightnessBand, type SearchFilters } from "./lib/search_filters";

/**
 * Most captures a narrow filter may leave for them to be ranked exhaustively
 * (search: exact cosine over each one's stored vector; browse with a colour:
 * sorted in memory). At ~7 KB per embedded capture that is ~3.5 MB read.
 */
export const CANDIDATE_CAP = 500;

/**
 * captureColors rows one colour filter reads (~150 B each). Past this the
 * matching set is incomplete; captures outside it are then checked one by
 * one through by_capture, so results stay exact, just without the shortcut.
 */
export const MAX_COLOR_ROWS = 5000;

export const kindValidator = v.union(
  v.literal("image"),
  v.literal("text"),
  v.literal("link"),
  v.literal("code"),
  v.literal("screenshot"),
  v.literal("element"),
  v.literal("viewport")
);

/** Filter and paging arguments of both public entry points; lib/search_filters validates them. */
export const filterArgs = {
  /** One of the caller's sessions; any other id yields no results. */
  sessionId: v.optional(v.id("sessions")),
  kinds: v.optional(v.array(kindValidator)),
  /** The model's categories (`aiCategory`); a capture matches any of them. */
  aiCategories: v.optional(v.array(aiCategoryValidator)),
  /** Legacy single category, folded into `aiCategories`. */
  aiCategory: v.optional(aiCategoryValidator),
  /** "#rgb" or "#rrggbb". */
  color: v.optional(v.string()),
  /** ΔE2000, default 10, clamped to 1..50. */
  colorTolerance: v.optional(v.number()),
  /** Inclusive bounds on the capture's creation time, ms since epoch. */
  dateFrom: v.optional(v.number()),
  dateTo: v.optional(v.number()),
  /** Page size, default 30, clamped to 1..100. */
  limit: v.optional(v.number()),
  /** `cursor` from the previous page. */
  cursor: v.optional(v.string()),
};

/** Normalised filters as an internal function receives them. */
export const filtersValidator = v.object({
  sessionId: v.optional(v.id("sessions")),
  kinds: v.optional(v.array(v.string())),
  aiCategories: v.optional(v.array(v.string())),
  color: v.optional(v.string()),
  colorTolerance: v.number(),
  dateFrom: v.optional(v.number()),
  dateTo: v.optional(v.number()),
});

export type Filters = SearchFilters<Id<"sessions">>;
type CaptureDoc = Doc<"captures">;

/* ---------- rows ---------- */

/** Display name of one of the caller's sessions, memoised per request. */
export function sessionNameLoader(ctx: QueryCtx, userId: string) {
  const cache = new Map<string, Promise<string | null>>();
  return (id: Id<"sessions"> | undefined): Promise<string | null> => {
    if (!id) return Promise.resolve(null);
    let name = cache.get(id);
    if (!name) {
      name = ctx.db
        .get(id)
        .then((s) => (s && s.userId === userId ? (s.name ?? s.autoName ?? "Untitled session") : null));
      cache.set(id, name);
    }
    return name;
  };
}

export type SessionNames = ReturnType<typeof sessionNameLoader>;

/** One capture as the dashboard grid, the detail view and the in-page overlay render it. */
export async function toRow(ctx: QueryCtx, d: any, sessionName: SessionNames) {
  return {
    id: d._id as Id<"captures">,
    kind: d.kind as string,
    imageUrl: isVisualKind(d.kind) && d.storageId ? await ctx.storage.getUrl(d.storageId) : null,
    thumbUrl: d.thumbStorageId ? await ctx.storage.getUrl(d.thumbStorageId) : null,
    palette: d.palette ?? null,
    designDna: d.designDna ?? null,
    clipped: d.clipped ?? false,
    pageUrl: (d.url ?? null) as string | null,
    title: (d.title ?? d.alt ?? null) as string | null,
    alt: (d.alt ?? null) as string | null,
    tags: (d.tags ?? []) as string[],
    category: (d.category ?? null) as string | null,
    width: (d.width ?? null) as number | null,
    height: (d.height ?? null) as number | null,
    storageId: d.storageId ?? null,
    content: (d.content ?? null) as string | null,
    href: (d.href ?? null) as string | null,
    text: (d.text ?? null) as string | null,
    linkPreviewId: d.linkPreviewId ?? null,
    domain: (d.domain ?? null) as string | null,
    /** Client-reported capture time. */
    timestamp: (d.timestamp ?? d._creationTime) as number,
    /** Server creation time: what browse order and the date filters use. */
    createdAt: d._creationTime as number,
    sessionId: (d.sessionId ?? null) as Id<"sessions"> | null,
    sessionName: await sessionName(d.sessionId),
    status: (d.status ?? null) as string | null,
    error: (d.error ?? null) as string | null,
    aiCategory: (d.aiCategory ?? null) as string | null,
    aiStyle: (d.aiStyle ?? []) as string[],
    aiTags: (d.aiTags ?? []) as string[],
    aiDescription: (d.aiDescription ?? null) as string | null,
  };
}

export type CaptureRow = Awaited<ReturnType<typeof toRow>>;

/* ---------- filtering ---------- */

/** The filters a capture document can be checked against on its own (all but colour). */
export function filterPredicate(userId: string, f: Filters) {
  return (d: any): boolean =>
    !!d &&
    d.userId === userId &&
    (!f.kinds || f.kinds.includes(d.kind)) &&
    (!f.aiCategories || (d.aiCategory !== undefined && f.aiCategories.includes(d.aiCategory))) &&
    (f.sessionId === undefined || d.sessionId === f.sessionId) &&
    (f.dateFrom === undefined || d._creationTime >= f.dateFrom) &&
    (f.dateTo === undefined || d._creationTime <= f.dateTo);
}

/** Whether the narrow, index-backed filters (session, dates, colour) are set. */
export function hasNarrowFilter(f: Filters): boolean {
  return f.sessionId !== undefined || f.dateFrom !== undefined || f.dateTo !== undefined || f.color !== undefined;
}

/**
 * The caller's captures newest first, through by_user_session when a
 * session is set and by_user otherwise (both end in `_creationTime`), with
 * the date filters (and `atOrBefore`, a page cursor) as the index range.
 */
export function captureRange(ctx: QueryCtx, userId: string, f: Filters, atOrBefore?: number) {
  const upper =
    atOrBefore === undefined ? f.dateTo : f.dateTo === undefined ? atOrBefore : Math.min(f.dateTo, atOrBefore);
  const dates = (q: any) => {
    let r = q;
    if (f.dateFrom !== undefined) r = r.gte("_creationTime", f.dateFrom);
    if (upper !== undefined) r = r.lte("_creationTime", upper);
    return r;
  };
  const sessionId = f.sessionId;
  const indexed = sessionId
    ? ctx.db
        .query("captures")
        .withIndex("by_user_session", (q) => dates(q.eq("userId", userId).eq("sessionId", sessionId)))
    : ctx.db.query("captures").withIndex("by_user", (q) => dates(q.eq("userId", userId)));
  return indexed.order("desc");
}

async function captureHasColor(ctx: QueryCtx, id: Id<"captures">, target: Lab, tolerance: number) {
  const rows = await ctx.db
    .query("captureColors")
    .withIndex("by_capture", (q) => q.eq("captureId", id))
    .take(MAX_CAPTURE_COLORS * 2);
  return rows.some((r) => colorRowMatches(target, r, tolerance));
}

export type Scope = {
  /** Nothing can match: the session filter names a session the caller does not own, or none at all. */
  empty: boolean;
  /**
   * Every capture the session, date and colour filters can leave, when that
   * is known to be at most CANDIDATE_CAP; else null. A superset: callers
   * still apply `filterPredicate` and `colorOk` to each.
   */
  candidates: CaptureDoc[] | null;
  /** Whether a capture passes the colour filter; always true without one. */
  colorOk: (id: Id<"captures">) => Promise<boolean>;
  diagnostics: Record<string, number | boolean | null>;
};

/**
 * Resolve the filters that narrow the library before any ranking.
 *
 * The colour filter is turned into the set of matching capture ids FIRST,
 * from the caller's captureColors rows in the L band a match can lie in
 * (by_user_l). Ranking then happens within that set, so a colour filter
 * never has to post-filter a top-k vector list down to nothing. `materialize`
 * says which candidate sets to load: "color" only the colour set (browse),
 * "any" also a session/date range (search), "none" neither.
 */
export async function resolveScope(
  ctx: QueryCtx,
  userId: string,
  f: Filters,
  materialize: "none" | "color" | "any"
): Promise<Scope> {
  if (f.sessionId !== undefined) {
    const session = await ctx.db.get(f.sessionId);
    if (!session || session.userId !== userId) {
      return { empty: true, candidates: [], colorOk: async () => false, diagnostics: {} };
    }
  }

  const diagnostics: Scope["diagnostics"] = {};
  let colorIds: Set<string> | null = null;
  let colorOk: Scope["colorOk"] = async () => true;
  if (f.color !== undefined) {
    const target = hexToLab(f.color)!;
    const tol = f.colorTolerance;
    const band = lightnessBand(tol);
    const rows = await ctx.db
      .query("captureColors")
      .withIndex("by_user_l", (q) =>
        q
          .eq("userId", userId)
          .gte("l", target[0] - band)
          .lte("l", target[0] + band)
      )
      .take(MAX_COLOR_ROWS + 1);
    const complete = rows.length <= MAX_COLOR_ROWS;
    const ids = new Set<string>(
      rows
        .slice(0, MAX_COLOR_ROWS)
        .filter((r) => colorRowMatches(target, r, tol))
        .map((r) => r.captureId)
    );
    if (complete) colorIds = ids;
    colorOk = complete
      ? async (id) => ids.has(id)
      : async (id) => ids.has(id) || (await captureHasColor(ctx, id, target, tol));
    diagnostics.colorMatches = ids.size;
    diagnostics.colorRowsTruncated = !complete;
  }

  let candidates: CaptureDoc[] | null = null;
  if (materialize !== "none") {
    if (colorIds && colorIds.size <= CANDIDATE_CAP) {
      const docs = await Promise.all([...colorIds].map((id) => ctx.db.get(id as Id<"captures">)));
      candidates = docs.filter((d): d is CaptureDoc => !!d && d.userId === userId);
    } else if (materialize === "any" && (f.sessionId !== undefined || f.dateFrom !== undefined || f.dateTo !== undefined)) {
      const docs = await captureRange(ctx, userId, f).take(CANDIDATE_CAP + 1);
      if (docs.length <= CANDIDATE_CAP) candidates = docs;
    }
  }
  diagnostics.candidates = candidates ? candidates.length : null;
  return { empty: false, candidates, colorOk, diagnostics };
}
