import { action, internalAction, internalQuery, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { api, internal } from "./_generated/api";
import { assertLocalEmbedding } from "./helpers";
import { isVisualKind } from "./local_ai";
import type { BrowseResponse } from "./browse";
import { MATCH_DISPLAY_BANDS, matchScore, SEARCH_TUNING } from "./lib/ai_config";
import {
  clampLimit,
  decodeSearchCursor,
  encodeSearchCursor,
  normalizeFilters,
} from "./lib/search_filters";
import {
  cosineSimilarity,
  rankByCosine,
  rankByKeyword,
  rrfFuse,
  tokenize,
  type FusedHit,
  type RankedHit,
} from "./lib/search_rank";
import {
  filterArgs,
  filterPredicate,
  filtersValidator,
  hasNarrowFilter,
  resolveScope,
  sessionNameLoader,
  toRow,
  type CaptureRow,
} from "./search_scope";

declare const process: any;

/**
 * Substring search over one user's captures, as a plain reactive query.
 * @deprecated Kept for callers built before `searchCaptures`; that action
 * does keyword matching too, fused with the vector lists.
 */
export const searchCapturesFallback = query({
  args: { q: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, { q, limit }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return { results: [] } as const;
    const take = Math.max(1, Math.min(100, limit ?? 30));

    const all = await ctx.db
      .query("captures")
      .withIndex("by_user", (q2) => q2.eq("userId", identity.subject))
      .collect();

    const lc = q.toLowerCase();
    const filtered = all.filter((d: any) => {
      // Include the body of text/code/link captures, not just their metadata,
      // otherwise a text capture can never be found by its own content.
      const hay = [d.title, d.alt, d.category, d.url, d.content, d.text, d.href]
        .concat(Array.isArray(d.tags) ? d.tags : [])
        .filter(Boolean)
        .join(" \n")
        .toLowerCase();
      return hay.includes(lc);
    });

    const names = sessionNameLoader(ctx, identity.subject);
    const results = await Promise.all(filtered.slice(0, take).map((d) => toRow(ctx, d, names)));
    return { results } as const;
  },
});

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

/** Tuning overrides are cosines. */
function cosineArg(x: number | undefined, fallback: number, what: string): number {
  if (x === undefined) return fallback;
  if (!Number.isFinite(x)) throw new Error(`${what} must be a finite number`);
  return Math.max(-1, Math.min(1, x));
}

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
 * library newest first, exactly as `browse.browseCaptures` pages it.
 *
 * Every filter must hold (AND). Session, date and colour filters narrow the
 * library before ranking: when they leave at most CANDIDATE_CAP captures,
 * those are ranked exhaustively (exact cosine over each one's stored vector,
 * keyword score over each one's fields), so a match deep in the library
 * still surfaces. A vector index can only filter by user, and taking its top
 * 64 then filtering by colour would often leave nothing. Broader filters
 * fall back to the indexes, fetching more vector candidates
 * (filteredVectorCandidates) and filtering them.
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
      const page: BrowseResponse = await ctx.runQuery(api.browse.browseCaptures, browseArgs);
      return {
        results: page.results.map((r) => ({ ...r, fusedScore: null, score: null, sources: {} })),
        cursor: page.cursor,
        isDone: page.isDone,
        diagnostics: { mode: "browse" },
      };
    }

    const offset = cursor ? decodeSearchCursor(cursor) : 0;
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
      offset,
      minImageScore: minImage,
      minTextScore: minText,
    };
    const tuning = { minImageScore: minImage, minTextScore: minText };

    if (hasNarrowFilter(filters)) {
      const exact: SearchResponse & { tooBroad?: boolean } = await ctx.runQuery(internal.search.rankAndHydrate, {
        ...base,
        exact: { ...(imageVector ? { vector: imageVector } : {}), ...(textVector ? { textVector } : {}) },
      });
      if (!exact.tooBroad) {
        const { tooBroad: _tooBroad, ...response } = exact;
        return { ...response, diagnostics: { ...response.diagnostics, mode: "exact", ...tuning } };
      }
    }

    const filtered = hasNarrowFilter(filters) || !!kinds || !!filters.aiCategories;
    const limitPerIndex = filtered ? SEARCH_TUNING.filteredVectorCandidates : SEARCH_TUNING.vectorCandidates;
    const [imageRaw, textRaw] = await Promise.all([
      imageVector
        ? ctx.vectorSearch("captures", "by_localEmbedding", {
            vector: imageVector,
            limit: limitPerIndex,
            filter: (q) => q.eq("userId", userId),
          })
        : Promise.resolve([]),
      textVector
        ? ctx.vectorSearch("captures", "by_textEmbedding", {
            vector: textVector,
            limit: limitPerIndex,
            filter: (q) => q.eq("userId", userId),
          })
        : Promise.resolve([]),
    ]);
    const hits = (raw: Array<{ _id: Id<"captures">; _score: number }>) =>
      raw.map((h) => ({ id: h._id, score: h._score }));

    const ranked: SearchResponse = await ctx.runQuery(internal.search.rankAndHydrate, {
      ...base,
      imageHits: hits(imageRaw),
      textHits: hits(textRaw),
    });
    return {
      ...ranked,
      diagnostics: {
        ...ranked.diagnostics,
        mode: "index",
        imageCandidates: imageRaw.length,
        textCandidates: textRaw.length,
        ...tuning,
        topImageScores: imageRaw.slice(0, 5).map((h) => Number(h._score.toFixed(4))),
        topTextScores: textRaw.slice(0, 5).map((h) => Number(h._score.toFixed(4))),
      },
    };
  },
});

/**
 * Filtering, keyword retrieval, fusion, paging and hydration for
 * `searchCaptures`. Internal: it trusts `userId` and the already-validated
 * filters, which only the action may supply.
 *
 * Two modes. `exact`: rank every capture the narrow filters leave, given
 * the query vectors; returns `tooBroad` when that is more than CANDIDATE_CAP
 * captures (or no narrow filter applies). Otherwise: the vector-index hits
 * the action found, plus keyword candidates from the full-text index, each
 * re-checked against every filter.
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
    /** Vector-index hits, best first. */
    imageHits: v.optional(v.array(hitValidator)),
    textHits: v.optional(v.array(hitValidator)),
    exact: v.optional(
      v.object({ vector: v.optional(v.array(v.float64())), textVector: v.optional(v.array(v.float64())) })
    ),
  },
  handler: async (ctx, a): Promise<SearchResponse & { tooBroad?: boolean }> => {
    const { userId, filters, exact } = a;
    const scope = await resolveScope(ctx, userId, filters, exact ? "any" : "none");
    const nothing = { results: [], cursor: null, isDone: true, diagnostics: { ...scope.diagnostics } };
    if (scope.empty) return nothing;
    if (exact && !scope.candidates) return { ...nothing, tooBroad: true };

    const passes = filterPredicate(userId, filters);
    const accept = async (d: any) => passes(d) && (await scope.colorOk(d._id));
    const docs = new Map<string, any>();
    const terms = tokenize(a.query);
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
      const found = terms.length
        ? await ctx.db
            .query("captures")
            .withSearchIndex("search_text", (x) =>
              x.search("searchText", terms.slice(0, MAX_QUERY_TERMS).join(" ")).eq("userId", userId)
            )
            .take(MAX_KEYWORD_CANDIDATES)
        : [];
      const pool: any[] = [];
      for (const d of found) {
        docs.set(d._id, d);
        if (await accept(d)) pool.push(d);
      }
      keywordHits = rankByKeyword(pool, terms);

      // Vector hits are re-checked here: the indexes filter by user only, so
      // every other filter (and a defensive owner check) applies now.
      const load = async (hits: Array<{ id: Id<"captures">; score: number }>, floor: number) => {
        const out: RankedHit[] = [];
        for (const h of hits) {
          if (h.score < floor) continue;
          const d = docs.get(h.id) ?? (await ctx.db.get(h.id));
          if (d) docs.set(h.id, d);
          if (await accept(d)) out.push({ id: h.id, score: h.score });
        }
        return out;
      };
      imageLoaded = await load(a.imageHits ?? [], a.minImageScore);
      textLoaded = await load(a.textHits ?? [], a.minTextScore);
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
    const names = sessionNameLoader(ctx, userId);
    const results = await Promise.all(
      fused.slice(a.offset, end).map(async (f) => ({
        ...(await toRow(ctx, docs.get(f.id), names)),
        fusedScore: Number(f.fused.toFixed(6)),
        score: matchScore(f.sources),
        sources: f.sources,
      }))
    );

    return {
      results,
      cursor: end < fused.length ? encodeSearchCursor(end) : null,
      isDone: end >= fused.length,
      diagnostics: {
        ...scope.diagnostics,
        terms,
        imageHits: image.length,
        textHits: text.length,
        vectorOnlyDropped: imageLoaded.length - image.length + textLoaded.length - text.length,
        keywordHits: keywordHits.length,
        fused: fused.length,
        rrfK: SEARCH_TUNING.rrfK,
      },
    };
  },
});

/**
 * OpenAI-backed semantic search. Internal: no client calls it, and a public
 * action would let any signed-in user spend the project's OpenAI quota.
 */
export const searchCapturesSemantic = internalAction({
  args: { q: v.string(), limit: v.optional(v.number()), minScore: v.optional(v.number()) },
  handler: async (ctx, { q, limit, minScore: argMinScore }): Promise<{ results: any[] }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    const take = Math.max(1, Math.min(100, limit ?? 30));
    const minScore = Math.max(-1, Math.min(1, argMinScore ?? 0.25));

    const apiKey = process.env?.OPENAI_API_KEY;
    if (!apiKey) throw new Error("Missing OPENAI_API_KEY environment variable");

    // 1) Embed the query
    const embedResp = await (globalThis as any).fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model: "text-embedding-3-small", input: q }),
    });
    if (!embedResp.ok) {
      const text = await embedResp.text();
      throw new Error(`OpenAI embeddings failed: ${embedResp.status} ${text}`);
    }
    const embedData: any = await embedResp.json();
    const qVec: number[] = (embedData?.data?.[0]?.embedding ?? []).map((x: any) => Number(x));

    const all: any[] = await ctx.runQuery(api.captures.listAllForUser, {});

    const scored: Array<{ doc: any; score: number }> = all
      .filter((d: any) => (d.kind === "image" || d.kind === "screenshot") && Array.isArray(d.imageEmbedding) && d.imageEmbedding.length)
      .map((d: any) => ({
        doc: d,
        score: cosineSimilarity(d.imageEmbedding as number[], qVec),
      }))
      .filter((x: { doc: any; score: number }) => Number.isFinite(x.score) && x.score >= minScore)
      .sort((a: { score: number }, b: { score: number }) => b.score - a.score)
      .slice(0, take);

    const results: any[] = await Promise.all(
      scored.map(async ({ doc }: { doc: any }) => ({
        id: doc._id,
        imageUrl: await ctx.storage.getUrl(doc.storageId),
        pageUrl: doc.url,
        title: doc.title ?? doc.alt ?? null,
        alt: doc.alt ?? null,
        tags: doc.tags ?? [],
        category: doc.category ?? null,
        width: doc.width,
        height: doc.height,
        storageId: doc.storageId,
      }))
    );

    return { results } as const;
  },
});


