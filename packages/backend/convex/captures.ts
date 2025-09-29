import { query } from "./_generated/server";
import { v } from "convex/values";

// export const imageUrls = query({
//   args: {
//     category: v.optional(v.string()),
//   },
//   handler: async (ctx, args) => {
//     const captures = await ctx.db.query("captures").collect();
//     const images = captures.filter(
//       (d): d is Extract<(typeof captures)[number], { kind: "image" }> =>
//         d.kind === "image" && d.storageId !== undefined
//     );

//     const filtered = args.category
//       ? images.filter((d) => (d as any).category === args.category)
//       : images;

//     return Promise.all(
//       filtered.map(async (d) => ({
//         _id: d._id,
//         url: await ctx.storage.getUrl(d.storageId!),
//         width: d.width,
//         height: d.height,
//         storageId: d.storageId,
//         category: (d as any).category ?? "unsorted",
//       }))
//     );
//   },
// });

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
    // Efficiently filter by user, category and kind using the compound index
    const captures = await ctx.db
      .query("captures")
      .withIndex("by_user_category_and_kind", (q) =>
        q
          .eq("userId", identity.subject)
          .eq("category", args.category)
          .eq("kind", args.kind)
      )
      .collect();

    if (args.kind === "image") {
      const imagesWithStorage = captures.filter(
        (d): d is Extract<(typeof captures)[number], { kind: "image" }> =>
          d.kind === "image" && d.storageId !== undefined
      );

      return Promise.all(
        imagesWithStorage.map(async (d) => ({
          ...d,
          url: await ctx.storage.getUrl(d.storageId!),
        }))
      );
    }

    // Non-image kinds are returned as-is
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
