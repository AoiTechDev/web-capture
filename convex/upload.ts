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
    return await ctx.db.insert("captures", capture);
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
  }),
  handler: async (
    ctx,
    { storageId, src, alt, url, timestamp, width, height }
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
