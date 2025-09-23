import { v } from "convex/values";
import { mutation } from "./_generated/server";
import { captureValidator } from "./schema";

// 1) Generate a short-lived upload URL (expires in ~1 hour)
export const generateUploadUrl = mutation(async (ctx) => {
  return await ctx.storage.generateUploadUrl();
});

// 2) Save the storageId (returned by the upload POST) into your DB

export const uploadCapture = mutation({
  // Make args an object
  args: v.object({
    capture: captureValidator,
  }),
  handler: async (ctx, { capture }) => {
    return await ctx.db.insert("captures", {
      ...capture,
      category: (capture as any).category ?? "unsorted",
    });
  },
});

export const saveImageCapture = mutation({
  args: v.object({
    storageId: v.id("_storage"),
    src: v.optional(v.string()),
    alt: v.optional(v.string()),
    url: v.string(),
    timestamp: v.float64(),
    width: v.number(),
    height: v.number(),
    category: v.optional(v.string()),
  }),
  handler: async (
    ctx,
    { storageId, src, alt, url, timestamp, width, height, category }
  ) => {
    await ctx.db.insert("captures", {
      kind: "image",
      storageId,
      src: src ?? "",
      alt,
      url,
      timestamp,
      width,
      height,
      category: category ?? "unsorted",
    });
  },
});

export const deleteById = mutation({
  args: {
    storageId: v.id("_storage"),
    docId: v.id("captures"),
  },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.docId);
    await ctx.storage.delete(args.storageId);
  },
});

export const createCategory = mutation({
  args: {
    name: v.string(),
  },
  handler: async (ctx, args) => {
    const name = args.name.trim();
    if (!name) return null;
    // ensure unique by name
    const existing = await ctx.db
      .query("categories")
      .withIndex("by_name", (q) => q.eq("name", name))
      .unique();
    if (existing) return existing._id;
    return await ctx.db.insert("categories", { name, createdAt: Date.now() });
  },
});
