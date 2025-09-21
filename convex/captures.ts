import { query } from "./_generated/server";

export const imageUrls = query({
  args: {},
  handler: async (ctx) => {
    const captures = await ctx.db.query("captures").collect();
    const images = captures.filter(
      (d): d is Extract<(typeof captures)[number], { kind: "image" }> =>
        d.kind === "image" && d.storageId !== undefined
    );
    return Promise.all(
      images.map(async (d) => ({
        _id: d._id,
        url: await ctx.storage.getUrl(d.storageId!), 
        width: d.width,
        height: d.height,
        storageId: d.storageId,
      }))
    );
  },
});

