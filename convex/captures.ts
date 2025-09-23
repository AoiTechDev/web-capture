import { query } from "./_generated/server";
import { v } from "convex/values";

export const imageUrls = query({
  args: {
    category: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const captures = await ctx.db.query("captures").collect();
    const images = captures.filter(
      (d): d is Extract<(typeof captures)[number], { kind: "image" }> =>
        d.kind === "image" && d.storageId !== undefined
    );

    const filtered = args.category
      ? images.filter((d) => (d as any).category === args.category)
      : images;

    return Promise.all(
      filtered.map(async (d) => ({
        _id: d._id,
        url: await ctx.storage.getUrl(d.storageId!),
        width: d.width,
        height: d.height,
        storageId: d.storageId,
        category: (d as any).category ?? "unsorted",
      }))
    );
  },
});

export const imageCategories = query({
  args: {},
  handler: async (ctx) => {
    const captures = await ctx.db.query("captures").collect();
    const images = captures.filter(
      (d): d is Extract<(typeof captures)[number], { kind: "image" }> =>
        d.kind === "image" && d.storageId !== undefined
    );

    const counts = new Map<string, number>();
    for (const img of images) {
      const cat = (img as any).category ?? "unsorted";
      counts.set(cat, (counts.get(cat) ?? 0) + 1);
    }

    return Array.from(counts.entries()).map(([name, count]) => ({ name, count }));
  },
});

export const kindsForCategory = query({
  args: { category: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const captures = await ctx.db.query("captures").collect();
    const filtered = args.category
      ? captures.filter((c) => (c as any).category === args.category)
      : captures;
    const counts = new Map<string, number>();
    for (const c of filtered) {
      counts.set(c.kind, (counts.get(c.kind) ?? 0) + 1);
    }
    return Array.from(counts.entries()).map(([kind, count]) => ({ kind, count }));
  },
});

export const byCategoryAndKind = query({
  args: {
    category: v.optional(v.string()),
    kind: v.optional(v.union(
      v.literal("image"),
      v.literal("text"),
      v.literal("link"),
      v.literal("code"),
      v.literal("element")
    )),
  },
  handler: async (ctx, args) => {
    const captures = await ctx.db.query("captures").collect();
    const filtered = captures.filter((d) => {
      if (args.category && (d as any).category !== args.category) return false;
      if (args.kind && d.kind !== args.kind) return false;
      return true;
    });

    const result = await Promise.all(
      filtered.map(async (d) => {
        if (d.kind === "image" && d.storageId) {
          return {
            _id: d._id,
            kind: d.kind,
            url: await ctx.storage.getUrl(d.storageId),
            width: (d as any).width,
            height: (d as any).height,
            storageId: (d as any).storageId,
            alt: (d as any).alt,
            src: (d as any).src,
            category: (d as any).category ?? "unsorted",
            timestamp: (d as any).timestamp,
          };
        }
        return { ...d, category: (d as any).category ?? "unsorted" } as any;
      })
    );
    return result;
  },
});

export const listCategories = query({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query("categories").order("desc").collect();
    return all.map((c) => ({ _id: c._id, name: c.name }));
  },
});

