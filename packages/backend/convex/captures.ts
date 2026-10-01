import { internalMutation, query } from "./_generated/server";
import { v } from "convex/values";
import { mutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { buildSearchText } from "./lib/search_rank";
import { normalizeTag, normalizeUserTags } from "./lib/capture_text";
import { isSignificantColor } from "./lib/search_filters";
import { recordTagUse } from "./upload";
import { patchCapture, readUserStats } from "./user_stats";
import { sumCounts } from "./lib/capture_stats";

/**
 * Legacy folders, for the extension's "choose category" overlay; the
 * dashboard no longer shows them (see the `categories` table).
 */
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
 * Per-kind capture counts for the dashboard's type chips, plus `all`.
 *
 * Read from the caller's counters (user_stats.ts): two small reads, however
 * large the library. Null until user_stats.backfillUserStats has counted
 * the captures that predate the counters, rather than partial numbers.
 */
export const countsByKind = query({
  args: {},
  handler: async (ctx): Promise<Record<string, number> | null> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return {};

    const { stats, complete } = await readUserStats(ctx, identity.subject);
    if (!complete) return null;
    const counts: Record<string, number> = { ...stats.kinds };
    counts.all = sumCounts(stats.kinds);
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
        await patchCapture(ctx, doc, { status: "skipped" });
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
