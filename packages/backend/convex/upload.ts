import { v } from "convex/values";
import { mutation } from "./_generated/server";
import { captureValidator } from "./schema";

// 1) Generate a short-lived upload URL (expires in ~1 hour)
export const generateUploadUrl = mutation(async (ctx) => {
  const identity = await ctx.auth.getUserIdentity();

  return await ctx.storage.generateUploadUrl();
});

// 2) Save the storageId (returned by the upload POST) into your DB

export const uploadCapture = mutation({
  // Make args an object
  args: v.object({
    capture: captureValidator,
  }),
  handler: async (ctx, { capture }) => {
    const identity = await ctx.auth.getUserIdentity();
    
    if (!identity) throw new Error("Unauthorized");
    return await ctx.db.insert("captures", {
      ...capture,
      category: (capture as any).category ?? "unsorted",
      userId: identity.subject,
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
    const identity = await ctx.auth.getUserIdentity();
    
    if (!identity) throw new Error("Unauthorized");
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
      userId: identity.subject,
    });
  },
});

export const deleteById = mutation({
  args: {
    storageId: v.id("_storage"),
    docId: v.id("captures"),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    
    if (!identity) throw new Error("Unauthorized");
    const doc = await ctx.db.get(args.docId);
    if (!doc || (doc as any).userId !== identity.subject) {
      throw new Error("Not found or permission denied");
    }
    await ctx.db.delete(args.docId);
    await ctx.storage.delete(args.storageId);
  },
});

export const createCategory = mutation({
  args: {
    name: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
  
    if (!identity) throw new Error("Unauthorized");
    const name = args.name.trim();
    if (!name) return null;
    // ensure unique by name
    const existing = await ctx.db
      .query("categories")
      .withIndex("by_user_and_name", (q) =>
        q.eq("userId", identity.subject).eq("name", name)
      )
      .unique();
    if (existing) return existing._id;
    return await ctx.db.insert("categories", {
      name,
      createdAt: Date.now(),
      userId: identity.subject,
    });
  },
});
