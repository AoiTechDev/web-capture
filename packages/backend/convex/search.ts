import { action, query } from "./_generated/server";
import { v } from "convex/values";
import { api } from "./_generated/api";

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
      const hay = [d.title, d.alt, d.category, d.url]
        .concat(Array.isArray(d.tags) ? d.tags : [])
        .filter(Boolean)
        .join(" \n")
        .toLowerCase();
      return hay.includes(lc);
    });

    const images = filtered.filter((d: any) => (d.kind === "image" || d.kind === "screenshot") && d.storageId);

    const results = await Promise.all(
      images.slice(0, take).map(async (d: any) => ({
        id: d._id,
        imageUrl: await ctx.storage.getUrl(d.storageId),
        pageUrl: d.url,
        title: d.title ?? d.alt ?? null,
        alt: d.alt ?? null,
        tags: d.tags ?? [],
        category: d.category ?? null,
        width: d.width,
        height: d.height,
        storageId: d.storageId,
      }))
    );

    return { results } as const;
  },
});

export const searchCapturesSemantic = action({
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


