import { v } from "convex/values";
import { mutation } from "./_generated/server";
import { captureValidator } from "./schema";

export const generateUploadUrl = mutation(async (ctx) => {
  const identity = await ctx.auth.getUserIdentity();

  return await ctx.storage.generateUploadUrl();
});


export const uploadCapture = mutation({
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
    tags: v.optional(v.array(v.string())),
    title: v.optional(v.string()),
    note: v.optional(v.string()),
    kind: v.optional(v.union(v.literal("image"), v.literal("screenshot"))),
  }),
  handler: async (
    ctx,
    { storageId, src, alt, url, timestamp, width, height, category, tags, title, note, kind }
  ) => {
    const identity = await ctx.auth.getUserIdentity();
    
    if (!identity) throw new Error("Unauthorized");
    const insertedId = await ctx.db.insert("captures", {
      kind: kind ?? "image",
      storageId,
      src: src ?? "",
      alt,
      url,
      timestamp,
      width,
      height,
      category: category ?? "unsorted",
      tags: (tags ?? []).map((t) => t.trim().toLowerCase()).filter(Boolean),
      title,
      note,
      userId: identity.subject,
    });
    return insertedId;
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

export const upsertTags = mutation({
  args: v.object({
    names: v.array(v.string()),
  }),
  handler: async (ctx, { names }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");

    const normalized = Array.from(
      new Set(names.map((n) => n.trim().toLowerCase()).filter(Boolean))
    );
    const now = Date.now();
    for (const name of normalized) {
      const existing = await ctx.db
        .query("tags")
        .withIndex("by_user_and_name", (q) =>
          q.eq("userId", identity.subject).eq("name", name)
        )
        .unique();
      if (existing) {
        await ctx.db.patch(existing._id, {
          useCount: (existing as any).useCount + 1,
          lastUsedAt: now,
        });
      } else {
        await ctx.db.insert("tags", {
          name,
          userId: identity.subject,
          lastUsedAt: now,
          useCount: 1,
        });
      }
    }
  },
});

export const reassignCaptureCategory = mutation({
  args: v.object({
    docId: v.id("captures"),
    newCategory: v.string(),
  }),
  handler: async (ctx, { docId, newCategory }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");

    const capture = await ctx.db.get(docId);
    if (!capture || (capture as any).userId !== identity.subject) {
      throw new Error("Not found or permission denied");
    }

    const name = newCategory.trim();
    const categoryName = name.length > 0 ? name : "unsorted";

    const existing = await ctx.db
      .query("categories")
      .withIndex("by_user_and_name", (q) =>
        q.eq("userId", identity.subject).eq("name", categoryName)
      )
      .unique();
    if (!existing) {
      await ctx.db.insert("categories", {
        name: categoryName,
        createdAt: Date.now(),
        userId: identity.subject,
      });
    }

    await ctx.db.patch(docId, { category: categoryName });
  },
});
