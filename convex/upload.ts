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
  }),
  handler: async (ctx, { storageId, src, alt, url, timestamp }) => {
    await ctx.db.insert("captures", {
      kind: "image",
      storageId,
      src: src ?? "",
      alt,
      url,
      timestamp,
    });
  },
});
