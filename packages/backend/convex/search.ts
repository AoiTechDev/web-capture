import { action, internalQuery, type QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { api, internal } from "./_generated/api";
import { assertLocalEmbedding } from "./helpers";
import { isVisualKind } from "./lib/capture_stats";
import type { BrowseResponse } from "./browse";
import { MATCH_DISPLAY_BANDS, matchScore, SEARCH_TUNING } from "./lib/ai_config";
import {
  clampLimit,
  decodeSearchCursor,
  encodeSearchCursor,
  isSearchCursor,
  normalizeFilters,
  type SearchMode,
} from "./lib/search_filters";
import { createReadBudget } from "./lib/read_budget";
import { rankByCosine, rankByKeyword, rrfFuse, tokenize, type FusedHit, type RankedHit } from "./lib/search_rank";
import {
  colorSetFromArg,
  colorSetToArg,
  colorSetValidator,
  filterArgs,
  filterPredicate,
  filtersValidator,
  hasNarrowFilter,
  resolveScope,
  toRows,
  type CaptureRow,
  type ColorSetArg,
} from "./search_scope";

/* ---------- hybrid search ---------- */

const hitValidator = v.object({ id: v.id("captures"), score: v.float64() });

/**
 * Keyword candidates read from the full-text index, the bound on what one
 * search reads. The index returns them by relevance; they are then re-scored
 * (every term must match, weighted by field).
 */
const MAX_KEYWORD_CANDIDATES = 100;
/** Convex full-text search accepts at most 16 terms. */
const MAX_QUERY_TERMS = 16;
/** Characters of the query kept. */
const MAX_QUERY_CHARS = 500;

/**
 * One space's vector hits, minus the vector-only ones too weak to show (see
 * SEARCH_TUNING `imageRelativeMargin`). A hit the keyword search also found
 * is kept as is. Any other must be above the space's display band low end
 * (so it shows a match above 0%) and within `margin` of the best cosine in
 * the space. Order is preserved.
 */
export function admitVectorOnly(
  hits: RankedHit[],
  keywordIds: ReadonlySet<string>,
  bandLow: number,
  margin: number
): RankedHit[] {
  if (hits.length === 0) return hits;
  const best = Math.max(...hits.map((h) => h.score));
  return hits.filter((h) => keywordIds.has(h.id) || (h.score > bandLow && h.score >= best - margin));
}

export type SearchResult = CaptureRow & {
  /** RRF score; null in browse mode. */
  fusedScore: number | null;
  /**
   * Display match 0-1 from the vector cosines (lib/ai_config `matchScore`),
   * for "% match" labels; null for keyword-only hits and in browse mode.
   * Raw cosines are in `sources`.
   */
  score: number | null;
  /** Rank and score per source list; empty in browse mode. */
  sources: FusedHit["sources"];
};

export type SearchResponse = {
  results: SearchResult[];
  /** Pass back as `cursor` (with the same query and filters) for the next page; null once `isDone`. */
  cursor: string | null;
  isDone: boolean;
  diagnostics: Record<string, unknown>;
};

/** What one ranking pass found: a page, nothing (the session is not the caller's), or too many to rank exactly. */
type Ranked =
  | { outcome: "ranked"; response: SearchResponse }
  | { outcome: "empty" }
  | { outcome: "tooBroad"; snapshot: number; color: ColorSetArg | null };

/** Tuning overrides are cosines. */
function cosineArg(x: number | undefined, fallback: number, what: string): number {
  if (x === undefined) return fallback;
  if (!Number.isFinite(x)) throw new Error(`${what} must be a finite number`);
  return Math.max(-1, Math.min(1, x));
}

const emptyResponse = (mode: string): SearchResponse => ({
  results: [],
  cursor: null,
  isDone: true,
  diagnostics: { mode },
});

/**
 * Search the caller's captures: image-space vector hits, text-space vector
 * hits and keyword hits, fused with Reciprocal Rank Fusion into one list.
 *
 * `vector` is the query embedded with the local model's text encoder
 * (lib/ai_config `imageQueryText`, the raw query for SigLIP2). It is matched
 * against image captures and, unless `textVector` is given, text captures
 * too. `textVector` overrides the text-space query (callers built for
 * CLIP sent a second, raw-query vector). Both are optional: without them this
 * is keyword search through the same path, which is what the dashboard does
 * when the extension is not installed. Each result carries its rank and
 * score per source in `sources`.
 *
 * With a blank query and no vectors this browses instead: the filtered
 * library newest first, exactly as `browse.browseCaptures` pages it (a
 * search cursor left over from an earlier query then starts from the top).
 *
 * Every filter must hold (AND). Session, date and colour filters narrow the
 * library before ranking: when they leave at most CANDIDATE_CAP captures,
 * those are ranked exhaustively (exact cosine over each one's stored vector,
 * keyword score over each one's fields), so a match deep in the library
 * still surfaces. Broader filters fall back to the indexes: the vector
 * indexes filter by session when one is set, else by user; kind and
 * category cannot be index filters (see the schema), so for those more
 * vector candidates are fetched (filteredVectorCandidates) and filtered.
 *
 * Paging is by offset into the fused list. The cursor also carries the
 * first page's snapshot (its newest creation time; later pages ignore
 * captures created after it) and its mode (exact or index; later pages
 * keep it), so the list does not shift under the offset as captures are
 * added. Edits and deletions between pages can still move it slightly.
 */
export const searchCaptures = action({
  args: {
    query: v.string(),
    vector: v.optional(v.array(v.float64())),
    textVector: v.optional(v.array(v.float64())),
    ...filterArgs,
    /** Overrides for tuning; defaults in lib/ai_config SEARCH_TUNING. */
    minImageScore: v.optional(v.number()),
    minTextScore: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<SearchResponse> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return { results: [], cursor: null, isDone: true, diagnostics: { error: "Unauthorized" } };
    assertLocalEmbedding(args.vector, "vector");
    assertLocalEmbedding(args.textVector, "textVector");
    const { query: rawQuery, vector, textVector: textArg, minImageScore, minTextScore, ...browseArgs } = args;
    const { limit: rawLimit, cursor, ...rawFilters } = browseArgs;
    const filters = normalizeFilters(rawFilters);
    const limit = clampLimit(rawLimit);
    const userId = identity.subject;

    if (!rawQuery.trim() && !vector && !textArg) {
      const { cursor: _cursor, ...fresh } = browseArgs;
      const page: BrowseResponse = await ctx.runQuery(
        api.browse.browseCaptures,
        cursor && isSearchCursor(cursor) ? fresh : browseArgs
      );
      return {
        results: page.results.map((r) => ({ ...r, fusedScore: null, score: null, sources: {} })),
        cursor: page.cursor,
        isDone: page.isDone,
        diagnostics: { mode: "browse" },
      };
    }

    const position = cursor ? decodeSearchCursor(cursor) : null;
    const minImage = cosineArg(minImageScore, SEARCH_TUNING.imageMinScore, "minImageScore");
    const minText = cosineArg(minTextScore, SEARCH_TUNING.textMinScore, "minTextScore");
    const kinds = filters.kinds;
    const imageVector = vector && (!kinds || kinds.some(isVisualKind)) ? vector : undefined;
    const textQuery = textArg ?? vector;
    const textVector = textQuery && (!kinds || kinds.some((k) => !isVisualKind(k))) ? textQuery : undefined;
    const base = {
      userId,
      query: rawQuery.slice(0, MAX_QUERY_CHARS),
      filters,
      limit,
      offset: position?.offset ?? 0,
      minImageScore: minImage,
      minTextScore: minText,
    };
    const tuning = { minImageScore: minImage, minTextScore: minText };

    // Later pages keep the first page's mode, so the offset indexes the same list.
    let snapshot = position?.snapshot;
    let color: ColorSetArg | null = null;
    const exactFirst = position ? position.mode === "exact" : hasNarrowFilter(filters);
    if (exactFirst) {
      const exact: Ranked = await ctx.runQuery(internal.search.rankAndHydrate, {
        ...base,
        ...(snapshot !== undefined ? { snapshot } : {}),
        exact: { ...(imageVector ? { vector: imageVector } : {}), ...(textVector ? { textVector } : {}) },
      });
      if (exact.outcome === "empty") return emptyResponse("exact");
      if (exact.outcome === "ranked") {
        const r = exact.response;
        return { ...r, diagnostics: { ...r.diagnostics, mode: "exact", ...tuning } };
      }
      snapshot = exact.snapshot;
      color = exact.color;
    }

    // The session filter is applied by the vector indexes themselves; the
    // ranking pass below checks the session is the caller's before using
    // any hit, and re-checks every hit's owner.
    const sessionId = filters.sessionId;
    const scoped = (q: any) => (sessionId !== undefined ? q.eq("sessionId", sessionId) : q.eq("userId", userId));
    const filtered = hasNarrowFilter(filters) || !!kinds || !!filters.aiCategories;
    const limitPerIndex = filtered ? SEARCH_TUNING.filteredVectorCandidates : SEARCH_TUNING.vectorCandidates;
    const [imageRaw, textRaw] = await Promise.all([
      imageVector
        ? ctx.vectorSearch("captures", "by_localEmbedding", { vector: imageVector, limit: limitPerIndex, filter: scoped })
        : Promise.resolve([]),
      textVector
        ? ctx.vectorSearch("captures", "by_textEmbedding", { vector: textVector, limit: limitPerIndex, filter: scoped })
        : Promise.resolve([]),
    ]);
    const hits = (raw: Array<{ _id: Id<"captures">; _score: number }>) =>
      raw.map((h) => ({ id: h._id, score: h._score }));

    const ranked: Ranked = await ctx.runQuery(internal.search.rankAndHydrate, {
      ...base,
      ...(snapshot !== undefined ? { snapshot } : {}),
      ...(color ? { color } : {}),
      imageHits: hits(imageRaw),
      textHits: hits(textRaw),
    });
    // Nothing about the hits is reported for a session that is not the caller's.
    if (ranked.outcome !== "ranked") return emptyResponse("index");
    const r = ranked.response;
    return {
      ...r,
      diagnostics: {
        ...r.diagnostics,
        mode: "index",
        ...(position?.mode === "exact" ? { modeChanged: true } : {}),
        imageCandidates: imageRaw.length,
        textCandidates: textRaw.length,
        ...tuning,
        topImageScores: imageRaw.slice(0, 5).map((h) => Number(h._score.toFixed(4))),
        topTextScores: textRaw.slice(0, 5).map((h) => Number(h._score.toFixed(4))),
      },
    };
  },
});

/** Creation time of the user's newest capture (0 for none): the snapshot bound of a search's later pages. */
async function newestCreationTime(ctx: QueryCtx, userId: string): Promise<number> {
  const newest = await ctx.db
    .query("captures")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .order("desc")
    .first();
  return newest?._creationTime ?? 0;
}

/** Hits of both spaces alternately, best first in each, so a spent read budget cuts both lists at the same depth. */
function interleave(image: RankedHit[], text: RankedHit[]): Array<["image" | "text", RankedHit]> {
  const out: Array<["image" | "text", RankedHit]> = [];
  for (let i = 0; i < Math.max(image.length, text.length); i++) {
    if (i < image.length) out.push(["image", image[i]!]);
    if (i < text.length) out.push(["text", text[i]!]);
  }
  return out;
}

/**
 * Filtering, keyword retrieval, fusion, paging and hydration for
 * `searchCaptures`. Internal: it trusts `userId` and the already-validated
 * filters, which only the action may supply.
 *
 * Two modes. `exact`: rank every capture the narrow filters leave, given
 * the query vectors; `tooBroad` when that is more than CANDIDATE_CAP
 * captures or more than the read budget (or no narrow filter applies),
 * with the snapshot and colour set it read so the index pass need not read
 * them again. Otherwise: the vector-index hits the action found, plus
 * keyword candidates from the full-text index, each re-checked against
 * every filter. Both stop reading captures at the read budget
 * (lib/read_budget); index mode then drops its lowest-ranked hits.
 */
export const rankAndHydrate = internalQuery({
  args: {
    userId: v.string(),
    query: v.string(),
    filters: filtersValidator,
    limit: v.number(),
    offset: v.number(),
    minImageScore: v.number(),
    minTextScore: v.number(),
    /** Newest creation time a result may have; the first page's, from its cursor. */
    snapshot: v.optional(v.number()),
    /** The colour set an exact attempt of the same page already read. */
    color: v.optional(colorSetValidator),
    /** Vector-index hits, best first. */
    imageHits: v.optional(v.array(hitValidator)),
    textHits: v.optional(v.array(hitValidator)),
    exact: v.optional(
      v.object({ vector: v.optional(v.array(v.float64())), textVector: v.optional(v.array(v.float64())) })
    ),
  },
  handler: async (ctx, a): Promise<Ranked> => {
    const { userId, filters, exact } = a;
    const budget = createReadBudget();
    const snapshot = a.snapshot ?? (await newestCreationTime(ctx, userId));
    const scope = await resolveScope(ctx, userId, filters, {
      materialize: exact ? "any" : "none",
      budget,
      bounds: { atOrBefore: snapshot },
      ...(a.color ? { color: colorSetFromArg(a.color) } : {}),
    });
    if (scope.empty) return { outcome: "empty" };
    if (exact && !scope.candidates) {
      return { outcome: "tooBroad", snapshot, color: scope.color ? colorSetToArg(scope.color) : null };
    }

    const passes = filterPredicate(userId, filters);
    const accept = async (d: any) => passes(d) && d._creationTime <= snapshot && (await scope.colorOk(d._id));
    const docs = new Map<string, any>();
    const terms = tokenize(a.query);
    const diagnostics: Record<string, unknown> = { ...scope.diagnostics, terms };
    let keywordHits: RankedHit[];
    let imageLoaded: RankedHit[];
    let textLoaded: RankedHit[];

    if (exact) {
      const pool: any[] = [];
      for (const d of scope.candidates!) {
        if (await accept(d)) {
          pool.push(d);
          docs.set(d._id, d);
        }
      }
      keywordHits = rankByKeyword(pool, terms);
      imageLoaded = exact.vector ? rankByCosine(pool, (d) => d.localEmbedding, exact.vector, a.minImageScore) : [];
      textLoaded = exact.textVector
        ? rankByCosine(pool, (d) => d.textEmbedding, exact.textVector, a.minTextScore)
        : [];
    } else {
      // Bounded: the full-text index finds candidates (any term), then each
      // is re-scored so every term must match as a word or word prefix.
      const pool: any[] = [];
      if (terms.length) {
        const found = ctx.db
          .query("captures")
          .withSearchIndex("search_text", (x) =>
            x.search("searchText", terms.slice(0, MAX_QUERY_TERMS).join(" ")).eq("userId", userId)
          );
        let read = 0;
        for await (const d of found) {
          budget.charge(d);
          docs.set(d._id, d);
          if (await accept(d)) pool.push(d);
          if (++read === MAX_KEYWORD_CANDIDATES || budget.exhausted) break;
        }
      }
      keywordHits = rankByKeyword(pool, terms);

      // Vector hits are re-checked here: the indexes filter by user or
      // session only, so every other filter (and the owner) applies now.
      const loaded = { image: [] as RankedHit[], text: [] as RankedHit[] };
      const image = (a.imageHits ?? []).filter((h) => h.score >= a.minImageScore);
      const text = (a.textHits ?? []).filter((h) => h.score >= a.minTextScore);
      let unread = 0;
      for (const [space, h] of interleave(image, text)) {
        let d = docs.get(h.id);
        if (d === undefined) {
          if (budget.exhausted) {
            unread++;
            continue;
          }
          d = await ctx.db.get(h.id as Id<"captures">);
          budget.charge(d);
          docs.set(h.id, d);
        }
        if (d && (await accept(d))) loaded[space].push({ id: h.id, score: h.score });
      }
      imageLoaded = loaded.image;
      textLoaded = loaded.text;
      if (unread) diagnostics.hitsUnreadForBudget = unread;
    }

    const keywordIds = new Set(keywordHits.map((h) => h.id));
    const image = admitVectorOnly(
      imageLoaded,
      keywordIds,
      MATCH_DISPLAY_BANDS.image[0],
      SEARCH_TUNING.imageRelativeMargin
    );
    const text = admitVectorOnly(textLoaded, keywordIds, MATCH_DISPLAY_BANDS.text[0], SEARCH_TUNING.textRelativeMargin);

    const fused = rrfFuse({ image, text, keyword: keywordHits }, SEARCH_TUNING.rrfK);
    const end = a.offset + a.limit;
    const shown = fused.slice(a.offset, end);
    const rows = await toRows(ctx, userId, shown.map((f) => docs.get(f.id)));
    const results = shown.map((f, i) => ({
      ...rows[i]!,
      fusedScore: Number(f.fused.toFixed(6)),
      score: matchScore(f.sources),
      sources: f.sources,
    }));
    const mode: SearchMode = exact ? "exact" : "index";

    return {
      outcome: "ranked",
      response: {
        results,
        cursor: end < fused.length ? encodeSearchCursor({ offset: end, snapshot, mode }) : null,
        isDone: end >= fused.length,
        diagnostics: {
          ...diagnostics,
          imageHits: image.length,
          textHits: text.length,
          vectorOnlyDropped: imageLoaded.length - image.length + textLoaded.length - text.length,
          keywordHits: keywordHits.length,
          fused: fused.length,
          rrfK: SEARCH_TUNING.rrfK,
        },
      },
    };
  },
});
