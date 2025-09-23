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

export const listCategories = query({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query("categories").order("desc").collect();
    return all.map((c) => ({ _id: c._id, name: c.name }));
  },
});

