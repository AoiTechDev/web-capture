/**
 * Backend functions for the local (Transformers.js) embedding pipeline.
 *
 * These work alongside the existing OpenAI-based functions in ai.ts / search.ts.
 * Nothing in ai.ts or search.ts is modified — both paths can coexist.
 */

import { action, internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

/* ---------- helpers ---------- */

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

/* ---------- mutations ---------- */

/**
 * Patch a capture with a locally-generated CLIP embedding.
 * Called by the Chrome extension after generating the vector client-side.
 */
export const patchLocalEmbedding = mutation({
  args: {
    id: v.id("captures"),
    localEmbedding: v.array(v.float64()),
  },
  handler: async (ctx, { id, localEmbedding }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    const doc = await ctx.db.get(id);
    if (!doc || (doc as any).userId !== identity.subject)
      throw new Error("Not found or forbidden");
    await ctx.db.patch(id, { localEmbedding });
    return { ok: true } as const;
  },
});

/**
 * Apply automatically derived metadata to a capture.
 *
 * Kept separate from the insert so that tagging failures (model not loaded,
 * offscreen document evicted) never block the capture itself from saving.
 */
export const applyAutoMetadata = mutation({
  args: {
    id: v.id("captures"),
    tags: v.optional(v.array(v.string())),
    domain: v.optional(v.string()),
  },
  handler: async (ctx, { id, tags, domain }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    const doc = await ctx.db.get(id);
    if (!doc || (doc as any).userId !== identity.subject)
      throw new Error("Not found or forbidden");

    const patch: Record<string, unknown> = {};
    if (tags && tags.length) patch.tags = tags;
    if (domain) patch.domain = domain;
    if (Object.keys(patch).length === 0) return { ok: true, patched: false } as const;

    await ctx.db.patch(id, patch);
    return { ok: true, patched: true } as const;
  },
});

/* ---------- queries ---------- */

/**
 * @deprecated Superseded by `searchIndexed`, which uses the by_localEmbedding
 * vector index. This version collects every capture for the user and scores it
 * in JS, which is O(n) per keystroke and will exceed Convex read limits once a
 * library grows past a few thousand items. Kept only for comparison.
 *
 * Semantic search across ALL capture types using localEmbedding vectors.
 */
export const searchByVector = query({
  args: {
    vector: v.array(v.float64()),
    limit: v.optional(v.number()),
    minScore: v.optional(v.number()),
  },
  handler: async (ctx, { vector, limit, minScore: argMinScore }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return { results: [] as any[] };

    const take = Math.max(1, Math.min(100, limit ?? 30));
    const minScore = Math.max(-1, Math.min(1, argMinScore ?? 0.18));

    const all = await ctx.db
      .query("captures")
      .withIndex("by_user", (q) => q.eq("userId", identity.subject))
      .collect();

    // 1. Score every document that has a local embedding. Keep the unfiltered
    //    ranking around so the diagnostics below can show what a query actually
    //    scored, including the matches that minScore rejected.
    const ranked = all
      .filter(
        (d: any) =>
          Array.isArray(d.localEmbedding) && d.localEmbedding.length > 0
      )
      .map((d: any) => ({
        doc: d,
        score: cosineSimilarity(d.localEmbedding as number[], vector),
      }))
      .filter((x) => Number.isFinite(x.score))
      .sort((a, b) => b.score - a.score);

    const allScored = ranked.filter((x) => x.score >= minScore);

    // 2. Adaptive threshold: only keep results within 75% of the top score.
    //    This prevents low-relevance items from appearing when there are
    //    clearly better matches (e.g. top=0.32, cutoff=0.24).
    // Only meaningful once there is a real spread to compare against; with one
    // or two candidates the top score is trivially within ratio of itself, so
    // the filter does nothing except hide the fact that the pool is tiny.
    const ADAPTIVE_RATIO = 0.65;
    const ADAPTIVE_MIN_CANDIDATES = 3;
    const topScore = allScored.length > 0 ? allScored[0]!.score : 0;
    const adaptiveMin =
      allScored.length >= ADAPTIVE_MIN_CANDIDATES ? topScore * ADAPTIVE_RATIO : -1;

    const scored = allScored
      .filter((x) => x.score >= adaptiveMin)
      .slice(0, take);

    // Pre-filter picture of the corpus: how many vectors were even eligible,
    // and what the best raw scores were. Without this a zero-result search is
    // indistinguishable from "threshold too high".
    const diagnostics = {
      totalForUser: all.length,
      withEmbedding: all.filter(
        (d: any) => Array.isArray(d.localEmbedding) && d.localEmbedding.length > 0
      ).length,
      passedMinScore: allScored.length,
      minScore,
      adaptiveMin,
      topScores: ranked.slice(0, 5).map((x) => ({
        score: Number(x.score.toFixed(4)),
        kind: x.doc.kind,
        title: x.doc.title ?? x.doc.alt ?? x.doc.url ?? null,
      })),
    };

    const results = await Promise.all(
      scored.map(async ({ doc, score }: { doc: any; score: number }) => {
        let imageUrl: string | null = null;
        if (
          (doc.kind === "image" || doc.kind === "screenshot") &&
          doc.storageId
        ) {
          imageUrl = await ctx.storage.getUrl(doc.storageId);
        }
        return {
          id: doc._id,
          kind: doc.kind as string,
          score,
          imageUrl,
          pageUrl: doc.url ?? null,
          title: doc.title ?? doc.alt ?? null,
          alt: doc.alt ?? null,
          tags: doc.tags ?? [],
          category: doc.category ?? null,
          width: doc.width ?? null,
          height: doc.height ?? null,
          storageId: doc.storageId ?? null,
          // text / code
          content: doc.content ?? null,
          // link
          href: doc.href ?? null,
          text: doc.text ?? null,
          linkPreviewId: doc.linkPreviewId ?? null,
        };
      })
    );

    return { results, diagnostics } as const;
  },
});

/**
 * Diagnostic: how much of this user's data is actually reachable by
 * searchByVector. Anything without a localEmbedding is invisible to search,
 * so a low `withLocalEmbedding` count relative to `total` means the corpus
 * needs backfilling, not that the scoring is wrong.
 */
export const embeddingStats = query({
  args: { userId: v.optional(v.string()) },
  handler: async (ctx, { userId: argUserId }) => {
    // Dashboard / CLI calls have no end-user identity, so allow an explicit
    // userId there; in-app callers keep using their own authenticated subject.
    const identity = await ctx.auth.getUserIdentity();
    const userId = argUserId ?? identity?.subject;
    if (!userId) return { error: "Pass a userId (no authenticated identity)" } as const;

    const all = await ctx.db
      .query("captures")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    const byKind: Record<string, { total: number; withLocalEmbedding: number }> = {};
    let withLocalEmbedding = 0;
    let withImageEmbedding = 0;

    for (const d of all as any[]) {
      const kind = String(d.kind ?? "unknown");
      byKind[kind] ??= { total: 0, withLocalEmbedding: 0 };
      byKind[kind].total++;

      if (Array.isArray(d.localEmbedding) && d.localEmbedding.length > 0) {
        withLocalEmbedding++;
        byKind[kind].withLocalEmbedding++;
      }
      if (Array.isArray(d.imageEmbedding) && d.imageEmbedding.length > 0) {
        withImageEmbedding++;
      }
    }

    return {
      total: all.length,
      withLocalEmbedding,
      withImageEmbedding,
      searchable: withLocalEmbedding,
      byKind,
    } as const;
  },
});

/* ---------- indexed vector search ---------- */

/**
 * Hydrate vector-search hits into result rows.
 *
 * ctx.vectorSearch returns only { _id, _score }, and it is only callable from
 * an action, so the documents are loaded here and re-attached to their scores.
 */
export const hydrateSearchHits = internalQuery({
  args: {
    ids: v.array(v.id("captures")),
    scores: v.array(v.float64()),
    userId: v.string(),
  },
  handler: async (ctx, { ids, scores, userId }) => {
    const scoreById = new Map<string, number>();
    ids.forEach((id, i) => scoreById.set(id, scores[i] ?? 0));

    const docs = await Promise.all(ids.map((id) => ctx.db.get(id)));

    const rows = await Promise.all(
      docs
        // Defensive: the vector index is filtered by userId, but never return a
        // row we cannot prove belongs to the caller.
        .filter((d): d is NonNullable<typeof d> => !!d && (d as any).userId === userId)
        .map(async (doc: any) => {
          let imageUrl: string | null = null;
          if ((doc.kind === "image" || doc.kind === "screenshot") && doc.storageId) {
            imageUrl = await ctx.storage.getUrl(doc.storageId);
          }
          return {
            id: doc._id,
            kind: doc.kind as string,
            score: scoreById.get(doc._id) ?? 0,
            imageUrl,
            pageUrl: doc.url ?? null,
            title: doc.title ?? doc.alt ?? null,
            alt: doc.alt ?? null,
            tags: doc.tags ?? [],
            category: doc.category ?? null,
            width: doc.width ?? null,
            height: doc.height ?? null,
            storageId: doc.storageId ?? null,
            content: doc.content ?? null,
            href: doc.href ?? null,
            text: doc.text ?? null,
            linkPreviewId: doc.linkPreviewId ?? null,
          };
        })
    );

    return rows.sort((a, b) => b.score - a.score);
  },
});

/**
 * Semantic search backed by the Convex vector index.
 *
 * Replaces the full-table scan in `searchByVector`, which loaded every capture
 * for the user and scored it in JS on each keystroke.
 */
export const searchIndexed = action({
  args: {
    vector: v.array(v.float64()),
    limit: v.optional(v.number()),
    minScore: v.optional(v.number()),
    minZ: v.optional(v.number()),
  },
  handler: async (
    ctx,
    { vector, limit, minScore: argMinScore, minZ: argMinZ }
  ): Promise<{ results: any[]; diagnostics: any }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return { results: [], diagnostics: { error: "Unauthorized" } };

    const take = Math.max(1, Math.min(256, limit ?? 30));

    // A floor, not the decision. CLIP text/image cosines are compressed into a
    // narrow band by the modality gap, so an absolute cutoff cannot separate a
    // real match from the nearest irrelevant neighbour. It only discards the
    // obviously hopeless.
    const minScore = Math.max(-1, Math.min(1, argMinScore ?? 0.15));

    // The actual decision: how far above this query's own score distribution a
    // result stands. Unlike an absolute threshold, this transfers across
    // queries, models and library sizes, because it is measured in standard
    // deviations rather than raw cosine units.
    const minZ = argMinZ ?? 1.2;

    // Overfetch: the distribution needs enough samples to have a meaningful
    // mean and spread. Scoring 4 neighbours tells us nothing about what
    // "unusually close" looks like for this query.
    const candidateCount = Math.min(256, Math.max(take * 4, 40));

    const hits = await ctx.vectorSearch("captures", "by_localEmbedding", {
      vector,
      limit: candidateCount,
      filter: (q) => q.eq("userId", identity.subject),
    });

    const scores = hits.map((h) => h._score);
    const mean =
      scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
    const variance =
      scores.length > 1
        ? scores.reduce((acc, x) => acc + (x - mean) ** 2, 0) / (scores.length - 1)
        : 0;
    const std = Math.sqrt(variance);

    // With too few samples, or a degenerate distribution where everything is
    // equally (dis)similar, there is no outlier to find. Returning the nearest
    // neighbours anyway is what produced "man eating banana" -> four unrelated
    // LinkedIn posts.
    const canUseZ = hits.length >= 8 && std > 1e-6;

    const kept = hits
      .filter((h) => h._score >= minScore)
      .filter((h) => (canUseZ ? (h._score - mean) / std >= minZ : true))
      .slice(0, take);

    const results: any[] = await ctx.runQuery(internal.local_ai.hydrateSearchHits, {
      ids: kept.map((h) => h._id),
      scores: kept.map((h) => h._score),
      userId: identity.subject,
    });

    return {
      results,
      diagnostics: {
        candidates: hits.length,
        kept: kept.length,
        mean: Number(mean.toFixed(4)),
        std: Number(std.toFixed(4)),
        minScore,
        minZ,
        usedZ: canUseZ,
        topScores: hits.slice(0, 5).map((h) => ({
          score: Number(h._score.toFixed(4)),
          z: std > 1e-6 ? Number(((h._score - mean) / std).toFixed(2)) : null,
        })),
      },
    };
  },
});

/* ---------- re-index ---------- */

/**
 * Captures that predate local embeddings, oldest first.
 *
 * Returns a resolved image URL alongside each row so the extension can embed
 * without a second round trip. Paged rather than returning everything, since a
 * large library would otherwise blow the query read limit.
 */
export const listNeedingEmbedding = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return { items: [], remaining: 0 } as const;

    const take = Math.max(1, Math.min(50, limit ?? 10));

    const all = await ctx.db
      .query("captures")
      .withIndex("by_user", (q) => q.eq("userId", identity.subject))
      .collect();

    const pending = all.filter(
      (d: any) => !Array.isArray(d.localEmbedding) || d.localEmbedding.length === 0
    );

    const items = await Promise.all(
      pending.slice(0, take).map(async (d: any) => ({
        id: d._id,
        kind: d.kind as string,
        url: d.url ?? null,
        // Prefer stored bytes over the original src: the source page may be
        // gone, auth-walled, or hotlink-protected by the time we re-index.
        imageUrl: d.storageId ? await ctx.storage.getUrl(d.storageId) : (d.src ?? null),
        width: d.width ?? null,
        height: d.height ?? null,
        content: d.content ?? null,
        text: d.text ?? null,
        href: d.href ?? null,
        tags: d.tags ?? [],
      }))
    );

    return { items, remaining: pending.length } as const;
  },
});
