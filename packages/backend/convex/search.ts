import { action, internalAction, internalQuery, query, type QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { api, internal } from "./_generated/api";
import { assertLocalEmbedding } from "./helpers";
import { isVisualKind } from "./local_ai";
import { aiCategoryValidator } from "./schema";
import { SEARCH_TUNING } from "./lib/ai_config";
import { keywordScore, rrfFuse, tokenize, type FusedHit, type KeywordDoc, type RankedHit } from "./lib/search_rank";

declare const process: any;

function cosineSimilarity(a: number[], b: number[]): number {
  if (!a.length || !b.length || a.length !== b.length) return -1;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb) || 1e-9;
  return dot / denom;
}

/** One search result, as the dashboard grid and the in-page overlay render it. */
async function toRow(ctx: QueryCtx, d: any) {
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
    timestamp: (d.timestamp ?? d._creationTime) as number,
    status: (d.status ?? null) as string | null,
    error: (d.error ?? null) as string | null,
    aiCategory: (d.aiCategory ?? null) as string | null,
    aiStyle: (d.aiStyle ?? []) as string[],
    aiTags: (d.aiTags ?? []) as string[],
  };
}

type SearchRow = Awaited<ReturnType<typeof toRow>>;

/** Highest cosine among a hit's vector sources; null when only keywords found it. */
function bestVectorScore(f: FusedHit): number | null {
  const scores = [f.sources.image?.score, f.sources.text?.score].filter(
    (x): x is number => typeof x === "number"
  );
  return scores.length ? Number(Math.max(...scores).toFixed(4)) : null;
}

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

    const results = await Promise.all(filtered.slice(0, take).map((d) => toRow(ctx, d)));
    return { results } as const;
  },
});

/* ---------- hybrid search ---------- */

const kindValidator = v.union(
  v.literal("image"),
  v.literal("text"),
  v.literal("link"),
  v.literal("code"),
  v.literal("screenshot"),
  v.literal("element"),
  v.literal("viewport")
);

const hitValidator = v.object({ id: v.id("captures"), score: v.float64() });

/**
 * Keyword candidates read from the full-text index, the bound on what one
 * search reads. The index returns them by relevance; they are then re-scored
 * (every term must match, weighted by field).
 */
const MAX_KEYWORD_CANDIDATES = 100;
/** Convex full-text search accepts at most 16 terms. */
const MAX_QUERY_TERMS = 16;

export type SearchResponse = {
  results: Array<
    SearchRow & {
      fusedScore: number;
      /** Best vector cosine (image or text), for "% match" labels; null for keyword-only hits. */
      score: number | null;
      sources: FusedHit["sources"];
    }
  >;
  diagnostics: Record<string, unknown>;
};

/**
 * Search the caller's captures: image-space vector hits, text-space vector
 * hits and keyword hits, fused with Reciprocal Rank Fusion into one list.
 *
 * `vector` is the query embedded with the image template (lib/ai_config
 * `imageQueryText`) and is matched against image captures; `textVector` is
 * the raw query embedded, matched against text captures. Both are optional:
 * without them (the dashboard, for now) this is keyword search through the
 * same path. Each result carries its rank and score per source in `sources`.
 */
export const searchCaptures = action({
  args: {
    query: v.string(),
    vector: v.optional(v.array(v.float64())),
    textVector: v.optional(v.array(v.float64())),
    limit: v.optional(v.number()),
    kinds: v.optional(v.array(kindValidator)),
    /** The user's own folder (`category` on a capture), e.g. "unsorted". */
    folder: v.optional(v.string()),
    /** The model's category (`aiCategory`), e.g. "pricing". */
    aiCategory: v.optional(aiCategoryValidator),
    /** Overrides for tuning; defaults in lib/ai_config SEARCH_TUNING. */
    minImageScore: v.optional(v.number()),
    minTextScore: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<SearchResponse> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return { results: [], diagnostics: { error: "Unauthorized" } };
    assertLocalEmbedding(args.vector, "vector");
    assertLocalEmbedding(args.textVector, "textVector");

    const userId = identity.subject;
    const take = Math.max(1, Math.min(100, args.limit ?? 30));
    const kinds = args.kinds?.length ? args.kinds : undefined;
    const wantImages = !kinds || kinds.some(isVisualKind);
    const wantText = !kinds || kinds.some((k) => !isVisualKind(k));
    const minImage = args.minImageScore ?? SEARCH_TUNING.imageMinScore;
    const minText = args.minTextScore ?? SEARCH_TUNING.textMinScore;
    const limit = SEARCH_TUNING.vectorCandidates;

    const [imageRaw, textRaw] = await Promise.all([
      args.vector && wantImages
        ? ctx.vectorSearch("captures", "by_localEmbedding", {
            vector: args.vector,
            limit,
            filter: (q) => q.eq("userId", userId),
          })
        : Promise.resolve([]),
      args.textVector && wantText
        ? ctx.vectorSearch("captures", "by_textEmbedding", {
            vector: args.textVector,
            limit,
            filter: (q) => q.eq("userId", userId),
          })
        : Promise.resolve([]),
    ]);
    const floor = (hits: Array<{ _id: Id<"captures">; _score: number }>, min: number) =>
      hits.filter((h) => h._score >= min).map((h) => ({ id: h._id, score: h._score }));

    const ranked: SearchResponse = await ctx.runQuery(internal.search.rankAndHydrate, {
      userId,
      query: args.query.slice(0, 500),
      imageHits: floor(imageRaw, minImage),
      textHits: floor(textRaw, minText),
      limit: take,
      kinds,
      folder: args.folder,
      aiCategory: args.aiCategory,
    });
    return {
      results: ranked.results,
      diagnostics: {
        ...ranked.diagnostics,
        imageCandidates: imageRaw.length,
        textCandidates: textRaw.length,
        minImageScore: minImage,
        minTextScore: minText,
        topImageScores: imageRaw.slice(0, 5).map((h) => Number(h._score.toFixed(4))),
        topTextScores: textRaw.slice(0, 5).map((h) => Number(h._score.toFixed(4))),
      },
    };
  },
});

/**
 * Keyword retrieval, filtering, fusion and hydration for `searchCaptures`.
 * Internal: it trusts `userId`, which only the action may supply.
 */
export const rankAndHydrate = internalQuery({
  args: {
    userId: v.string(),
    query: v.string(),
    imageHits: v.array(hitValidator),
    textHits: v.array(hitValidator),
    limit: v.number(),
    kinds: v.optional(v.array(v.string())),
    folder: v.optional(v.string()),
    aiCategory: v.optional(v.string()),
  },
  handler: async (
    ctx,
    { userId, query: q, imageHits, textHits, limit, kinds, folder, aiCategory }
  ): Promise<SearchResponse> => {
    const passes = (d: any) =>
      !!d &&
      d.userId === userId &&
      (!kinds || kinds.includes(d.kind)) &&
      (folder === undefined || d.category === folder) &&
      (aiCategory === undefined || d.aiCategory === aiCategory);

    const docs = new Map<string, any>();
    const terms = tokenize(q);
    let keywordHits: RankedHit[] = [];
    if (terms.length > 0) {
      // Bounded: the full-text index finds candidates (any term), then each
      // is re-scored so every term must match as a word or word prefix.
      const candidates = await ctx.db
        .query("captures")
        .withSearchIndex("search_text", (x) =>
          x.search("searchText", terms.slice(0, MAX_QUERY_TERMS).join(" ")).eq("userId", userId)
        )
        .take(MAX_KEYWORD_CANDIDATES);
      for (const d of candidates) docs.set(d._id, d);
      keywordHits = candidates
        .filter(passes)
        .map((d) => ({ id: d._id as string, score: keywordScore(d as KeywordDoc, terms), t: d._creationTime }))
        .filter((h) => h.score > 0)
        // Equal scores: newest first, the order the dashboard lists in.
        .sort((a, b) => b.score - a.score || b.t - a.t)
        .map(({ id, score }) => ({ id, score }));
    }

    // Vector hits are re-checked here: the indexes filter by user only, so
    // kind and category filters (and a defensive owner check) apply now.
    const load = async (hits: Array<{ id: Id<"captures">; score: number }>): Promise<RankedHit[]> => {
      const out: RankedHit[] = [];
      for (const h of hits) {
        const d = docs.get(h.id) ?? (await ctx.db.get(h.id));
        if (d) docs.set(h.id, d);
        if (passes(d)) out.push({ id: h.id, score: h.score });
      }
      return out;
    };
    const image = await load(imageHits);
    const text = await load(textHits);

    const fused = rrfFuse({ image, text, keyword: keywordHits }, SEARCH_TUNING.rrfK).slice(0, limit);
    const results = await Promise.all(
      fused.map(async (f) => ({
        ...(await toRow(ctx, docs.get(f.id))),
        fusedScore: Number(f.fused.toFixed(6)),
        score: bestVectorScore(f),
        sources: f.sources,
      }))
    );

    return {
      results,
      diagnostics: {
        terms,
        imageHits: image.length,
        textHits: text.length,
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


