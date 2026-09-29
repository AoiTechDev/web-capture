import { internalMutation, query } from "./_generated/server";
import { v } from "convex/values";
import { mutation } from "./_generated/server";
import { internal } from "./_generated/api";

type Kind = "image" | "text" | "link" | "code" | "screenshot" | "element" | "viewport";
type VisualKind = "image" | "screenshot" | "element" | "viewport";

/**
 * Picked-element and viewport shots are screenshots as far as browsing goes,
 * so the Screenshots tab lists all three.
 */
const KINDS_FOR_TAB: Partial<Record<Kind, Kind[]>> = {
  screenshot: ["screenshot", "element", "viewport"],
};

export const byCategoryAndKind = query({
  args: {
    category: v.string(),
    kind: v.union(
      v.literal("image"),
      v.literal("text"),
      v.literal("link"),
      v.literal("code"),
      v.literal("screenshot"),
      v.literal("element"),
      v.literal("viewport")
    ),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
   
    if (!identity) throw new Error("Unauthorized");
    const kinds = KINDS_FOR_TAB[args.kind] ?? [args.kind];
    const perKind = await Promise.all(
      kinds.map((kind) =>
        ctx.db
          .query("captures")
          .withIndex("by_user_category_and_kind", (q) =>
            q
              .eq("userId", identity.subject)
              .eq("category", args.category)
              .eq("kind", kind)
          )
          .collect()
      )
    );
    // Same order a single index scan gives: oldest first.
    const captures = perKind.flat().sort((a, b) => a._creationTime - b._creationTime);

    if (args.kind === "image" || args.kind === "screenshot" || args.kind === "element" || args.kind === "viewport") {
      const imagesWithStorage = captures.filter(
        (d): d is Extract<(typeof captures)[number], { kind: VisualKind }> =>
          (d.kind === "image" || d.kind === "screenshot" || d.kind === "element" || d.kind === "viewport") &&
          d.storageId !== undefined
      );

      return Promise.all(
        imagesWithStorage.map(async (d) => ({
          ...d,
          url: await ctx.storage.getUrl(d.storageId!),
          // Grid-sized WebP; absent on captures saved before thumbnails existed.
          thumbUrl: d.thumbStorageId ? await ctx.storage.getUrl(d.thumbStorageId) : null,
          pageUrl: d.url,
        }))
      );
    }

    if (args.kind === "link") {
      const linksWithPreview = await Promise.all(
        captures.map(async (d: any) => {
          if (d.linkPreviewId) {
            const preview = await ctx.db.get(d.linkPreviewId);
            // Never hand out a preview that belongs to someone else.
            if (preview && (preview as any).userId === identity.subject) {
              return { ...d, preview };
            }
          }
          return d;
        })
      );
      return linksWithPreview;
    }

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

export const listTags = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [] as Array<{ name: string; useCount: number; lastUsedAt: number }>;
    const all = await ctx.db
      .query("tags")
      .withIndex("by_user_lastUsedAt", (q) => q.eq("userId", identity.subject))
      .order("desc")
      .collect();
    return all.map((t) => ({ name: t.name, useCount: t.useCount, lastUsedAt: t.lastUsedAt }));
  },
});

export const getCaptureById = query({
  args: { id: v.id("captures") },
  handler: async (ctx, { id }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const doc = await ctx.db.get(id);
    if (!doc || (doc as any).userId !== identity.subject) return null;
    return doc;
  },
});


export const patchImageCaptionAndEmbedding = mutation({
  args: {
    id: v.id("captures"),
    caption: v.optional(v.string()),
    imageEmbedding: v.optional(v.array(v.float64())),
  },
  handler: async (ctx, { id, caption, imageEmbedding }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    const doc = await ctx.db.get(id);
    if (!doc || (doc as any).userId !== identity.subject) throw new Error("Not found or forbidden");
    await ctx.db.patch(id, {
      ...(caption !== undefined ? { caption } : {}),
      ...(imageEmbedding !== undefined ? { imageEmbedding } : {}),
    });
    return { ok: true } as const;
  },
});

export const listAllForUser = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [] as any[];
    const all = await ctx.db
      .query("captures")
      .withIndex("by_user", (q) => q.eq("userId", identity.subject))
      .collect();
    return all as any[];
  },
});

/**
 * Per-kind capture counts for the dashboard tabs.
 *
 * The tabs show a total for every kind, not just the selected one, so this
 * cannot come from the already-filtered `byCategoryAndKind` query.
 */
export const countsByKind = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return {} as Record<string, number>;

    const all = await ctx.db
      .query("captures")
      .withIndex("by_user", (q) => q.eq("userId", identity.subject))
      .collect();

    const counts: Record<string, number> = {};
    for (const doc of all as any[]) {
      const kind = String(doc.kind ?? "unknown");
      counts[kind] = (counts[kind] ?? 0) + 1;
    }
    counts.all = all.length;
    return counts;
  },
});

/**
 * One-off backfill: mark captures saved before the enrichment pipeline existed
 * as `skipped`, so they are never processed (or billed) retroactively.
 *
 * Paginated to stay inside mutation limits; each batch schedules the next
 * until the table is exhausted. Run once from the dashboard or CLI:
 * `npx convex run captures:backfillCaptureStatus`.
 */
export const backfillCaptureStatus = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, { cursor }): Promise<{ patched: number; done: boolean }> => {
    const page = await ctx.db
      .query("captures")
      .paginate({ cursor: cursor ?? null, numItems: 200 });

    let patched = 0;
    for (const doc of page.page) {
      if (doc.status === undefined) {
        await ctx.db.patch(doc._id, { status: "skipped" });
        patched++;
      }
    }

    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.captures.backfillCaptureStatus, {
        cursor: page.continueCursor,
      });
    }
    return { patched, done: page.isDone };
  },
});
