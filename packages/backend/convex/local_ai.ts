/**
 * Backend functions for the local (Transformers.js) embedding pipeline.
 *
 * These work alongside the existing OpenAI-based functions in ai.ts / search.ts.
 * Nothing in ai.ts or search.ts is modified — both paths can coexist.
 */

import { mutation, query } from "./_generated/server";
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

/* ---------- queries ---------- */

/**
 * Semantic search across ALL capture types using localEmbedding vectors.
 *
 * The caller passes in a pre-computed query vector (generated client-side
 * with CLIP's text encoder) so no server-side API call is needed.
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
