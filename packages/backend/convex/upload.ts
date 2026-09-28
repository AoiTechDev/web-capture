import { v } from "convex/values";
import { mutation, type MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { captureValidator } from "./schema";
import { assertLocalEmbedding } from "./helpers";

export const generateUploadUrl = mutation(async (ctx) => {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Unauthorized");

  return await ctx.storage.generateUploadUrl();
});

/**
 * Check every reference a client put on a new capture before it is stored.
 *
 * A capture may only point at the caller's own session and link preview, and
 * at a storage object no other capture already owns - otherwise a client could
 * adopt (and later delete) someone else's file by guessing its id.
 */
async function assertCaptureRefs(
  ctx: MutationCtx,
  userId: string,
  refs: {
    sessionId?: Id<"sessions">;
    linkPreviewId?: Id<"link_previews">;
    storageId?: Id<"_storage">;
    localEmbedding?: number[];
  }
) {
  if (refs.sessionId) {
    const session = await ctx.db.get(refs.sessionId);
    if (!session || session.userId !== userId) throw new Error("Session not found");
  }
  if (refs.linkPreviewId) {
    const preview = await ctx.db.get(refs.linkPreviewId);
    if (!preview || preview.userId !== userId) throw new Error("Link preview not found");
  }
  if (refs.storageId) {
    const taken = await ctx.db
      .query("captures")
      .withIndex("by_storageId", (q) => q.eq("storageId", refs.storageId))
      .first();
    if (taken) throw new Error("Storage object already in use");
  }
  assertLocalEmbedding(refs.localEmbedding);
}

export const uploadCapture = mutation({
  args: v.object({
    capture: captureValidator,
  }),
  handler: async (ctx, { capture }) => {
    const identity = await ctx.auth.getUserIdentity();
    
    if (!identity) throw new Error("Unauthorized");
    // Server-owned fields: whatever the client sent for these is discarded.
    // sessionId is attached by sessions.assignCapture, which also keeps the
    // session's itemCount in step; accepting it here would bypass that count.
    const {
      userId: _userId,
      status: _status,
      error: _error,
      sessionId: _sessionId,
      ...rest
    } = capture;
    const c = rest as {
      linkPreviewId?: Id<"link_previews">;
      storageId?: Id<"_storage">;
      localEmbedding?: number[];
      category?: string;
    };
    await assertCaptureRefs(ctx, identity.subject, {
      linkPreviewId: c.linkPreviewId,
      storageId: c.storageId,
      localEmbedding: c.localEmbedding,
    });
    return await ctx.db.insert("captures", {
      ...rest,
      category: c.category ?? "unsorted",
      userId: identity.subject,
      status: "pending",
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
    kind: v.optional(
      v.union(
        v.literal("image"),
        v.literal("screenshot"),
        v.literal("element"),
        v.literal("viewport")
      )
    ),
    /** element only: the picked element's tag. */
    tagName: v.optional(v.string()),
    /** element / viewport: cropped to the visible part of the page. */
    clipped: v.optional(v.boolean()),
  }),
  handler: async (
    ctx,
    { storageId, src, alt, url, timestamp, width, height, category, tags, title, note, kind, tagName, clipped }
  ) => {
    const identity = await ctx.auth.getUserIdentity();
    
    if (!identity) throw new Error("Unauthorized");
    await assertCaptureRefs(ctx, identity.subject, { storageId });

    const common = {
      storageId,
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
      status: "pending" as const,
    };

    if (kind === "element") {
      return await ctx.db.insert("captures", { ...common, kind: "element", tagName, clipped });
    }
    if (kind === "viewport") {
      return await ctx.db.insert("captures", { ...common, kind: "viewport", clipped });
    }
    if (kind === "screenshot") {
      return await ctx.db.insert("captures", { ...common, kind: "screenshot", src: src ?? "" });
    }
    return await ctx.db.insert("captures", { ...common, kind: "image", src: src ?? "" });
  },
});




export const deleteById = mutation({
  args: {
    docId: v.id("captures"),
    /**
     * Ignored: the file deleted is always the capture's own. Still accepted so
     * dashboard tabs loaded before this change can delete until they reload.
     */
    storageId: v.optional(v.id("_storage")),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    
    if (!identity) throw new Error("Unauthorized");
    const doc = await ctx.db.get(args.docId);
    if (!doc || doc.userId !== identity.subject) {
      throw new Error("Not found or permission denied");
    }
    await ctx.db.delete(args.docId);

    // Only ever the capture's own file, never an id supplied by the client.
    // Legacy rows may share a storage object, so keep it while anything else
    // still points at it.
    const storageId = (doc as { storageId?: Id<"_storage"> }).storageId;
    if (storageId) {
      const stillUsed = await ctx.db
        .query("captures")
        .withIndex("by_storageId", (q) => q.eq("storageId", storageId))
        .first();
      const exists = await ctx.db.system.get(storageId);
      if (!stillUsed && exists) await ctx.storage.delete(storageId);
    }

    if (doc.sessionId) {
      const session = await ctx.db.get(doc.sessionId);
      if (session && session.userId === identity.subject) {
        await ctx.db.patch(session._id, {
          itemCount: Math.max(0, (session.itemCount ?? 0) - 1),
        });
      }
    }
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
