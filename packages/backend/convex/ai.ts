import { internalAction } from "./_generated/server";
import { v } from "convex/values";

// Avoid needing Node types in this package
declare const process: any;

const OPENAI_API_URL = "https://api.openai.com/v1";

// Internal: no client calls it, and as a public action any signed-in user
// could spend the project's OpenAI quota.
export const embedQuery = internalAction({
  args: { q: v.string() },
  handler: async (ctx, { q }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");

    const apiKey = process.env?.OPENAI_API_KEY;
    if (!apiKey) throw new Error("Missing OPENAI_API_KEY environment variable");

    const resp = await fetch(`${OPENAI_API_URL}/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model: "text-embedding-3-small", input: q }),
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`OpenAI embeddings failed: ${resp.status} ${text}`);
    }
    const data: any = await resp.json();
    const vec: number[] | undefined = data?.data?.[0]?.embedding;
    if (!Array.isArray(vec)) throw new Error("Embedding not returned");
    return { vector: vec.map((x) => Number(x)) } as const;
  },
});


