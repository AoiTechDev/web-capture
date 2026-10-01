import { internalMutation, query } from "./_generated/server";
import { v } from "convex/values";
import { mutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { buildSearchText } from "./lib/search_rank";
import { normalizeTag, normalizeUserTags } from "./lib/capture_text";
import { isSignificantColor } from "./lib/search_filters";
import { recordTagUse } from "./upload";

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


/* ---------- detail view edits ---------- */

export { MAX_TAG_LENGTH, MAX_USER_TAGS, normalizeTag, normalizeUserTags } from "./lib/capture_text";

/** Entries a client may send at once; a longer list is refused, not cut. */
const MAX_TAGS_INPUT = 100;

/**
 * Replace a capture's user tags (the detail view's editable list); the AI's
 * labels are separate and stay as they are. The list is normalised as every
 * save normalises tags (lib/capture_text normalizeUserTags: at most 20, the
 * first 20 distinct ones of the list given, so a capture saved with more
 * keeps its first 20 once edited). searchText is rebuilt in the same write,
 * so keyword search finds the new tags, and stops finding the removed ones,
 * at once. Tags new to the capture, compared after the same normalisation
 * (so re-saving an existing tag in another case or spacing is not new),
 * count as used in the suggestions list (listTags). Removing a tag does not
 * uncount it: `useCount` counts adds.
 */
export const setCaptureTags = mutation({
  args: { captureId: v.id("captures"), tags: v.array(v.string()) },
  handler: async (ctx, { captureId, tags }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    if (tags.length > MAX_TAGS_INPUT) throw new Error(`tags has more than ${MAX_TAGS_INPUT} entries`);
    const doc = await ctx.db.get(captureId);
    if (!doc || doc.userId !== identity.subject) throw new Error("Not found or forbidden");

    const next = normalizeUserTags(tags);
    const before = new Set((doc.tags ?? []).map(normalizeTag));
    await ctx.db.patch(captureId, { tags: next, searchText: buildSearchText({ ...(doc as any), tags: next }) });
    await recordTagUse(ctx, identity.subject, next.filter((t) => !before.has(t)));
    return { tags: next } as const;
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

/**
 * One-off backfill: set `significant` on captureColors rows written before
 * it existed, so the colour filter reads them through the significant part
 * of by_user_significant_l. Until it has run, the filter also reads the
 * rows lacking the field, so results are right either way; this only makes
 * the filter cheaper.
 *
 * 500 rows a batch (~125 KB read, at most 500 writes); each batch schedules
 * the next until the table is exhausted. Run once from the dashboard or
 * CLI: `npx convex run captures:backfillColorSignificance`.
 */
export const backfillColorSignificance = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, { cursor }): Promise<{ patched: number; done: boolean }> => {
    const page = await ctx.db.query("captureColors").paginate({ cursor: cursor ?? null, numItems: 500 });

    let patched = 0;
    for (const row of page.page) {
      if (row.significant === undefined) {
        await ctx.db.patch(row._id, { significant: isSignificantColor(row.weight) });
        patched++;
      }
    }

    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.captures.backfillColorSignificance, {
        cursor: page.continueCursor,
      });
    }
    return { patched, done: page.isDone };
  },
});
