/**
 * What `searchCaptures` and `browseCaptures` share: their filter arguments,
 * the per-capture filter check, the colour filter's matching set, the
 * candidate set narrow filters allow, and the row the dashboard renders.
 */
import type { QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { aiCategoryValidator } from "./schema";
import { isVisualKind } from "./lib/capture_stats";
import { truncateUtf8 } from "./lib/capture_text";
import { hexToLab, MAX_CAPTURE_COLORS, type Lab } from "./lib/color";
import { colorRowMatches, lightnessRange, type SearchFilters } from "./lib/search_filters";
import { createReadBudget, PREVIEW_READ_BUDGET, type ReadBudget } from "./lib/read_budget";

/**
 * Most captures a narrow filter may leave for them to be ranked exhaustively
 * (search: exact cosine over each one's stored vector; browse with a colour:
 * sorted in memory). Loading them also stops at the query's read budget
 * (lib/read_budget), in which case the shortcut is not taken.
 */
export const CANDIDATE_CAP = 500;

/**
 * Significant captureColors rows one colour filter reads. Past this the
 * matching set is incomplete; captures outside it are then checked one by
 * one through by_capture, so results stay exact, just without the shortcut.
 *
 * A row is ~200 B (ids, hex, four floats, a flag; budgeted at 256 B), so
 * 15,001 rows are ~3.7 MiB and 15,001 of the 32,000 documents a query may
 * read; lib/read_budget adds up the rest of the worst case. The L band
 * keeps the rows read near what can match: 10,000 captures x 12 colours
 * spread over L are ~1,200 rows per unit of L, and the band at the default
 * tolerance is ~21 units wide around mid-greys (~35 at the extremes),
 * before insignificant rows (weight <= 0.05) are left out by the index.
 */
export const MAX_COLOR_ROWS = 15_000;

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

/** UTF-8 byte caps on the text of a link row's preview, so a row stays small whatever the page said. */
export const PREVIEW_CAPS = { title: 300, description: 500, short: 200, url: 2048, keywords: 10, keyword: 64 } as const;

/**
 * What a link card and its hover card show of the capture's link_previews
 * document: the display fields only, capped (PREVIEW_CAPS).
 */
export type LinkPreviewSummary = {
  domain: string | null;
  siteName: string | null;
  title: string | null;
  description: string | null;
  /** http(s) only; null when longer than PREVIEW_CAPS.url (a cut URL is a broken one). */
  faviconUrl: string | null;
  imageUrl: string | null;
  contentType: string | null;
  author: string | null;
  publishedDate: string | null;
  keywords: string[];
  /** HTTP status of the last fetch. */
  status: number | null;
};

function capText(x: unknown, bytes: number): string | null {
  if (typeof x !== "string") return null;
  const t = x.trim();
  return t ? truncateUtf8(t, bytes) : null;
}

function capUrl(x: unknown): string | null {
  if (typeof x !== "string" || x.length > PREVIEW_CAPS.url) return null;
  return /^https?:\/\//i.test(x) ? x : null;
}

export function summarizePreview(p: Doc<"link_previews">): LinkPreviewSummary {
  return {
    domain: capText(p.domain, PREVIEW_CAPS.short),
    siteName: capText(p.siteName, PREVIEW_CAPS.short),
    title: capText(p.title, PREVIEW_CAPS.title),
    description: capText(p.description, PREVIEW_CAPS.description),
    faviconUrl: capUrl(p.faviconUrl),
    imageUrl: capUrl(p.imageUrl),
    contentType: capText(p.contentType, PREVIEW_CAPS.short),
    author: capText(p.author, PREVIEW_CAPS.short),
    publishedDate: capText(p.publishedDate, PREVIEW_CAPS.short),
    keywords: (p.keywords ?? [])
      .slice(0, PREVIEW_CAPS.keywords)
      .map((k) => capText(k, PREVIEW_CAPS.keyword))
      .filter((k): k is string => k !== null),
    status: p.status ?? null,
  };
}

/**
 * The previews of the link captures among `docs`, by capture id. Read one at
 * a time, deduplicated, within PREVIEW_READ_BUDGET (lib/read_budget): once it
 * is spent, the remaining links go without one. A preview that is missing or
 * is not the caller's is left out.
 */
export async function loadLinkPreviews(
  ctx: QueryCtx,
  userId: string,
  docs: readonly any[]
): Promise<Map<string, LinkPreviewSummary>> {
  const budget = createReadBudget(PREVIEW_READ_BUDGET);
  const byPreview = new Map<string, LinkPreviewSummary | null>();
  const out = new Map<string, LinkPreviewSummary>();
  for (const d of docs) {
    if (d?.kind !== "link" || !d.linkPreviewId) continue;
    let summary = byPreview.get(d.linkPreviewId);
    if (summary === undefined) {
      if (budget.exhausted) continue;
      const p = await ctx.db.get(d.linkPreviewId as Id<"link_previews">);
      if (p) budget.charge(p);
      summary = p && p.userId === userId ? summarizePreview(p) : null;
      byPreview.set(d.linkPreviewId, summary);
    }
    if (summary) out.set(d._id, summary);
  }
  return out;
}

/** Rows for `docs`, in order, with session names and link previews. */
export async function toRows(ctx: QueryCtx, userId: string, docs: readonly any[]): Promise<CaptureRow[]> {
  const names = sessionNameLoader(ctx, userId);
  const previews = await loadLinkPreviews(ctx, userId, docs);
  return await Promise.all(docs.map((d) => toRow(ctx, d, names, previews.get(d._id) ?? null)));
}

/**
 * One capture as the dashboard grid, the detail view and the in-page overlay
 * render it. `preview` is its link preview (loadLinkPreviews); use toRows.
 */
export async function toRow(ctx: QueryCtx, d: any, sessionName: SessionNames, preview: LinkPreviewSummary | null = null) {
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
    /** Link captures: the page's title, description, favicon and image, when fetched. */
    preview,
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
    /** A text field was cut to its cap when saved (lib/capture_text). */
    truncated: (d.truncated ?? false) as boolean,
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

/** Index bounds on `_creationTime`, both inclusive. */
export type TimeBounds = { atOrBefore?: number; atOrAfter?: number };

/**
 * The caller's captures newest first, through by_user_session when a
 * session is set and by_user otherwise (both end in `_creationTime`), with
 * the date filters and `bounds` (page cursors, a search snapshot) as the
 * index range.
 */
export function captureRange(ctx: QueryCtx, userId: string, f: Filters, bounds: TimeBounds = {}) {
  const upper = minDefined(f.dateTo, bounds.atOrBefore);
  const lower = maxDefined(f.dateFrom, bounds.atOrAfter);
  const dates = (q: any) => {
    let r = q;
    if (lower !== undefined) r = r.gte("_creationTime", lower);
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

function minDefined(a: number | undefined, b: number | undefined) {
  return a === undefined ? b : b === undefined ? a : Math.min(a, b);
}

function maxDefined(a: number | undefined, b: number | undefined) {
  return a === undefined ? b : b === undefined ? a : Math.max(a, b);
}

async function captureHasColor(ctx: QueryCtx, id: Id<"captures">, target: Lab, tolerance: number) {
  const rows = await ctx.db
    .query("captureColors")
    .withIndex("by_capture", (q) => q.eq("captureId", id))
    .take(MAX_CAPTURE_COLORS);
  return rows.some((r) => colorRowMatches(target, r, tolerance));
}

/* ---------- the colour set ---------- */

/**
 * The captures the colour filter matched, from the significant rows in its
 * L band. `complete` is false when there were more than MAX_COLOR_ROWS rows;
 * captures outside `ids` must then be checked one by one.
 */
export type ColorSet = { ids: Set<string>; complete: boolean };

/** A ColorSet as an internal function argument: ids in chunks, since a Convex array holds at most 8,192 values. */
export type ColorSetArg = { ids: Id<"captures">[][]; complete: boolean };

export const colorSetValidator = v.object({ ids: v.array(v.array(v.id("captures"))), complete: v.boolean() });

const ID_CHUNK = 8000;

export function colorSetToArg(set: ColorSet): ColorSetArg {
  const ids = [...set.ids] as Id<"captures">[];
  const chunks: Id<"captures">[][] = [];
  for (let i = 0; i < ids.length; i += ID_CHUNK) chunks.push(ids.slice(i, i + ID_CHUNK));
  return { ids: chunks, complete: set.complete };
}

export function colorSetFromArg(arg: ColorSetArg): ColorSet {
  return { ids: new Set(arg.ids.flat()), complete: arg.complete };
}

/**
 * Read the colour filter's matching set. Rows written before `significant`
 * existed lack it; they are read through the same index (as `undefined`)
 * until captures.backfillColorSignificance has run, after which that range
 * is empty.
 */
async function readColorSet(ctx: QueryCtx, userId: string, target: Lab, tolerance: number): Promise<ColorSet> {
  const [lo, hi] = lightnessRange(target[0], tolerance);
  const band = (significant: true | undefined, n: number) =>
    ctx.db
      .query("captureColors")
      .withIndex("by_user_significant_l", (q) =>
        q.eq("userId", userId).eq("significant", significant).gte("l", lo).lte("l", hi)
      )
      .take(n);
  const rows = await band(true, MAX_COLOR_ROWS + 1);
  if (rows.length <= MAX_COLOR_ROWS) rows.push(...(await band(undefined, MAX_COLOR_ROWS + 1 - rows.length)));
  const complete = rows.length <= MAX_COLOR_ROWS;
  const ids = new Set<string>();
  for (const r of rows.slice(0, MAX_COLOR_ROWS)) {
    if (colorRowMatches(target, r, tolerance)) ids.add(r.captureId);
  }
  return { ids, complete };
}

/* ---------- scope ---------- */

export type Scope = {
  /** Nothing can match: the session filter names a session the caller does not own, or none at all. */
  empty: boolean;
  /**
   * Every capture the session, date and colour filters can leave, when that
   * is known to be at most CANDIDATE_CAP and loading them fitted in the
   * read budget; else null. A superset: callers still apply
   * `filterPredicate`, `colorOk` and any time bound to each.
   */
  candidates: CaptureDoc[] | null;
  /** Whether a capture passes the colour filter; always true without one. */
  colorOk: (id: Id<"captures">) => Promise<boolean>;
  /** The colour filter's matching set; null without a colour filter. */
  color: ColorSet | null;
  diagnostics: Record<string, number | boolean | null>;
};

export type ScopeOptions = {
  /** Which candidate sets to load: "color" only the colour set (browse), "any" also a session/date range (search), "none" neither. */
  materialize: "none" | "color" | "any";
  /** Charged for every capture loaded; loading gives up once it is spent. */
  budget: ReadBudget;
  /** Bounds a session/date range is loaded within (a search snapshot). */
  bounds?: TimeBounds;
  /** The colour set an earlier query of the same search already read. */
  color?: ColorSet;
};

/** Load captures one at a time within the budget; null once it is spent. */
async function loadWithin(
  ctx: QueryCtx,
  userId: string,
  ids: Iterable<string>,
  budget: ReadBudget
): Promise<CaptureDoc[] | null> {
  const out: CaptureDoc[] = [];
  for (const id of ids) {
    if (budget.exhausted) return null;
    const d = await ctx.db.get(id as Id<"captures">);
    if (!d) continue;
    budget.charge(d);
    if (d.userId === userId) out.push(d);
  }
  return out;
}

/** A session/date range of at most CANDIDATE_CAP captures that fits in the budget, else null. */
async function rangeWithin(
  ctx: QueryCtx,
  userId: string,
  f: Filters,
  bounds: TimeBounds,
  budget: ReadBudget
): Promise<CaptureDoc[] | null> {
  const out: CaptureDoc[] = [];
  for await (const d of captureRange(ctx, userId, f, bounds)) {
    if (out.length === CANDIDATE_CAP || budget.exhausted) return null;
    budget.charge(d);
    out.push(d);
  }
  return out;
}

/**
 * Resolve the filters that narrow the library before any ranking.
 *
 * The colour filter is turned into the set of matching capture ids FIRST,
 * from the caller's significant captureColors rows in the L band a match
 * can lie in (by_user_significant_l). Ranking then happens within that set,
 * so a colour filter never has to post-filter a top-k vector list down to
 * nothing.
 */
export async function resolveScope(ctx: QueryCtx, userId: string, f: Filters, opts: ScopeOptions): Promise<Scope> {
  if (f.sessionId !== undefined) {
    const session = await ctx.db.get(f.sessionId);
    if (!session || session.userId !== userId) {
      return { empty: true, candidates: [], colorOk: async () => false, color: null, diagnostics: {} };
    }
  }

  const diagnostics: Scope["diagnostics"] = {};
  let color: ColorSet | null = null;
  let colorOk: Scope["colorOk"] = async () => true;
  if (f.color !== undefined) {
    const target = hexToLab(f.color)!;
    const tol = f.colorTolerance;
    const set = opts.color ?? (await readColorSet(ctx, userId, target, tol));
    color = set;
    colorOk = set.complete
      ? async (id) => set.ids.has(id)
      : async (id) => set.ids.has(id) || (await captureHasColor(ctx, id, target, tol));
    diagnostics.colorMatches = set.ids.size;
    diagnostics.colorRowsTruncated = !set.complete;
  }

  let candidates: CaptureDoc[] | null = null;
  if (opts.materialize !== "none") {
    if (color?.complete && color.ids.size <= CANDIDATE_CAP) {
      candidates = await loadWithin(ctx, userId, color.ids, opts.budget);
    } else if (
      opts.materialize === "any" &&
      (f.sessionId !== undefined || f.dateFrom !== undefined || f.dateTo !== undefined)
    ) {
      candidates = await rangeWithin(ctx, userId, f, opts.bounds ?? {}, opts.budget);
    }
  }
  diagnostics.candidates = candidates ? candidates.length : null;
  return { empty: false, candidates, colorOk, color, diagnostics };
}
