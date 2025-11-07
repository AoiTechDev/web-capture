import { query } from "./_generated/server";
import { v } from "convex/values";



export const byCategoryAndKind = query({
  args: {
    category: v.string(),
    kind: v.union(
      v.literal("image"),
      v.literal("text"),
      v.literal("link"),
      v.literal("code"),
      v.literal("screenshot")
    ),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
   
    if (!identity) throw new Error("Unauthorized");
    const captures = await ctx.db
      .query("captures")
      .withIndex("by_user_category_and_kind", (q) =>
        q
          .eq("userId", identity.subject)
          .eq("category", args.category)
          .eq("kind", args.kind)
      )
      .collect();

    if (args.kind === "image" || args.kind === "screenshot") {
      const imagesWithStorage = captures.filter(
        (d): d is Extract<(typeof captures)[number], { kind: "image" | "screenshot" }> =>
          (d.kind === "image" || d.kind === "screenshot") && d.storageId !== undefined
      );

      return Promise.all(
        imagesWithStorage.map(async (d) => ({
          ...d,
          url: await ctx.storage.getUrl(d.storageId!),
          pageUrl: d.url,
        }))
      );
    }

    return captures;
  },
});

export const listCategories = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    
    if (!identity) return [];
    const all = await ctx.db
      .query("categories")
      .withIndex("by_user_createdAt", (q) => q.eq("userId", identity.subject))
      .order("desc")
      .collect();
    return all.map((c) => ({ _id: c._id, name: c.name }));
  },
});

export const listTags = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [] as Array<{ name: string; useCount: number; lastUsedAt: number }>;
    const all = await ctx.db
      .query("tags")
      .withIndex("by_user_lastUsedAt", (q) => q.eq("userId", identity.subject))
      .order("desc")
      .collect();
    return all.map((t) => ({ name: t.name, useCount: t.useCount, lastUsedAt: t.lastUsedAt }));
  },
});

export const getCaptureById = query({
  args: { id: v.id("captures") },
  handler: async (ctx, { id }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const doc = await ctx.db.get(id);
    if (!doc || (doc as any).userId !== identity.subject) return null;
    return doc;
  },
});

import { mutation } from "./_generated/server";

export const patchImageCaptionAndEmbedding = mutation({
  args: {
    id: v.id("captures"),
    caption: v.optional(v.string()),
    imageEmbedding: v.optional(v.array(v.float64())),
  },
  handler: async (ctx, { id, caption, imageEmbedding }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    const doc = await ctx.db.get(id);
    if (!doc || (doc as any).userId !== identity.subject) throw new Error("Not found or forbidden");
    await ctx.db.patch(id, {
      ...(caption !== undefined ? { caption } : {}),
      ...(imageEmbedding !== undefined ? { imageEmbedding } : {}),
    });
    return { ok: true } as const;
  },
});

export const listAllForUser = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [] as any[];
    const all = await ctx.db
      .query("captures")
      .withIndex("by_user", (q) => q.eq("userId", identity.subject))
      .collect();
    return all as any[];
  },
});