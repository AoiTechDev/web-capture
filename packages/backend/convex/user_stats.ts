/**
 * Per-user library counters (`userStats`), so the dashboard's type counts
 * and the embedding stats never read the whole library.
 *
 * Every write that inserts or deletes a capture, or changes its `kind`,
 * `status` or vectors, goes through `insertCapture`, `patchCapture` or
 * `deleteCapture` here, which adjust the owner's counters in the same
 * transaction (lib/capture_stats says what is counted). Writes that touch
 * none of those fields (tags, session, preview, metadata) need not.
 *
 * Captures that predate the counters are counted by `backfillUserStats`,
 * which walks the captures table in creation order. While it runs, a
 * capture counts once it has been passed (`_creationTime <= countedThrough`):
 * live writes adjust the counters only for those, and the walk picks up the
 * rest as they are when it gets to them, so nothing is counted twice or
 * missed. The cron in crons.ts starts the walk, resumes one that stalled,
 * and recounts when the counting rule (lib/capture_stats STATS_RULE)
 * changes; `npx convex run user_stats:backfillUserStats` does the same by
 * hand. Until a walk under the current rule has finished, the counters
 * read as incomplete.
 */
import { internalMutation, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { WithoutSystemFields } from "convex/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import {
  addStats,
  applyStatsDelta,
  backfillStopsBefore,
  captureContribution,
  emptyStats,
  STATS_RULE,
  statsDelta,
  type CaptureStats,
} from "./lib/capture_stats";
import { createReadBudget } from "./lib/read_budget";

type CaptureDoc = Doc<"captures">;
type BackfillState = Doc<"userStatsBackfill">;

/** The backfill's progress: one row for the whole deployment. */
async function backfillState(ctx: QueryCtx): Promise<BackfillState | null> {
  return await ctx.db.query("userStatsBackfill").first();
}

/** Whether the counters are being kept under the code's counting rule (a walk may still be running). */
const currentRule = (state: BackfillState | null): state is BackfillState => !!state && state.rule === STATS_RULE;

async function statsRow(ctx: QueryCtx, userId: string): Promise<Doc<"userStats"> | null> {
  return await ctx.db
    .query("userStats")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
}

function rowStats(row: Doc<"userStats">): CaptureStats {
  return {
    kinds: row.kinds,
    statuses: row.statuses,
    embedded: row.embedded,
    withImageEmbedding: row.withImageEmbedding,
  };
}

/** Add `delta` to the user's counters of `generation`; a row from an earlier generation starts from zero. */
async function addToUserStats(ctx: MutationCtx, userId: string, generation: number, delta: CaptureStats) {
  const row = await statsRow(ctx, userId);
  const base = row && row.generation === generation ? rowStats(row) : emptyStats();
  const { stats, clamped } = applyStatsDelta(base, delta);
  // A count below zero means some write skipped the counters: drift, which
  // `backfillUserStats({ restart: true })` repairs.
  for (const field of clamped) console.warn(`userStats: clamped ${field} at 0 for user ${userId}`);
  const next = { ...stats, generation };
  if (row) await ctx.db.patch(row._id, next);
  else await ctx.db.insert("userStats", { userId, ...next });
}

/**
 * Adjust the owner's counters for one write: `before` the document as it
 * was (null for an insert), `after` as it is now (null for a delete).
 */
export async function trackCaptureWrite(ctx: MutationCtx, before: CaptureDoc | null, after: CaptureDoc | null) {
  const doc = after ?? before;
  if (!doc?.userId) return;
  const delta = statsDelta(before, after);
  if (!delta) return;
  const state = await backfillState(ctx);
  // Under another rule the counters are recounted from scratch anyway.
  if (!currentRule(state) || (!state.done && doc._creationTime > state.countedThrough)) return;
  await addToUserStats(ctx, doc.userId, state.generation, delta);
}

export async function insertCapture(ctx: MutationCtx, value: WithoutSystemFields<CaptureDoc>): Promise<Id<"captures">> {
  const id = await ctx.db.insert("captures", value);
  await trackCaptureWrite(ctx, null, await ctx.db.get(id));
  return id;
}

/** Patch a capture read in this transaction. A field set to undefined is removed, as with ctx.db.patch. */
export async function patchCapture(ctx: MutationCtx, doc: CaptureDoc, patch: Partial<CaptureDoc>) {
  await ctx.db.patch(doc._id, patch as any);
  await trackCaptureWrite(ctx, doc, { ...doc, ...patch } as CaptureDoc);
}

export async function deleteCapture(ctx: MutationCtx, doc: CaptureDoc) {
  await ctx.db.delete(doc._id);
  await trackCaptureWrite(ctx, doc, null);
}

/**
 * The user's counters. `complete` is false until a walk under the current
 * counting rule has counted every capture that predates the counters; the
 * numbers are then partial (or, under an older rule, counted by that rule).
 */
export async function readUserStats(ctx: QueryCtx, userId: string): Promise<{ stats: CaptureStats; complete: boolean }> {
  const state = await backfillState(ctx);
  if (!state) return { stats: emptyStats(), complete: false };
  const row = await statsRow(ctx, userId);
  const stats = row && row.generation === state.generation ? rowStats(row) : emptyStats();
  return { stats, complete: state.done && currentRule(state) };
}

/** Captures one backfill batch counts, and the bytes it may read doing so. */
const BACKFILL_BATCH = 500;
const BACKFILL_READ_BUDGET = 8 * 1024 * 1024;
/**
 * A walk whose last batch is older than this is presumed dead (a batch
 * failed and its continuation was never scheduled) and is taken over by the
 * next call that does not continue it. Batches follow each other at once,
 * so a live walk is never this far behind.
 */
export const BACKFILL_STALL_MS = 5 * 60 * 1000;

export type BackfillResult = {
  counted: number;
  done: boolean;
  /** Nothing was done: another call's walk is running, or this continuation was superseded. */
  skipped?: "running" | "superseded";
};

/**
 * Count the captures that predate the counters, a batch at a time (at most
 * BACKFILL_BATCH captures and ~8 MiB read, plus the capture that crosses
 * it, at most 1 MiB, and any created at the same instant as the batch's
 * last), each batch scheduling the next until the table is exhausted.
 *
 * Called with no arguments (the cron every 10 minutes, or by hand:
 * `npx convex run user_stats:backfillUserStats`) it is a single read when
 * the counters are complete. Otherwise it starts a walk, recounts from
 * scratch when the counting rule has changed, resumes a walk that stalled
 * (BACKFILL_STALL_MS), and leaves a running walk alone, so there is only
 * ever one chain. `{ restart: true }` recounts from scratch regardless (a
 * new generation: the old counters read as zero until recounted), should
 * they ever drift. A continuation carries the generation and position it
 * was scheduled at, and stops if the walk has moved on without it.
 */
export const backfillUserStats = internalMutation({
  args: {
    restart: v.optional(v.boolean()),
    /** Set by the walk itself on the batch it schedules. */
    continuation: v.optional(v.object({ generation: v.number(), cursor: v.number() })),
  },
  handler: async (ctx, { restart, continuation }): Promise<BackfillResult> => {
    let state = await backfillState(ctx);
    const now = Date.now();
    if (!state) {
      const id = await ctx.db.insert("userStatsBackfill", {
        generation: 1, rule: STATS_RULE, countedThrough: 0, done: false, lastBatchAt: now,
      });
      state = (await ctx.db.get(id))!;
    } else if (restart || state.rule !== STATS_RULE) {
      await ctx.db.patch(state._id, {
        generation: state.generation + 1, rule: STATS_RULE, countedThrough: 0, done: false, lastBatchAt: now,
      });
      state = (await ctx.db.get(state._id))!;
    } else if (continuation) {
      const current =
        !state.done && state.generation === continuation.generation && state.countedThrough === continuation.cursor;
      if (!current) return { counted: 0, done: state.done, skipped: "superseded" };
    } else if (state.done) {
      return { counted: 0, done: true };
    } else if (now - (state.lastBatchAt ?? 0) < BACKFILL_STALL_MS) {
      return { counted: 0, done: false, skipped: "running" };
    }

    const budget = createReadBudget(BACKFILL_READ_BUDGET);
    const perUser = new Map<string, CaptureStats>();
    let last: number | null = null;
    let counted = 0;
    let more = false;
    const from = state.countedThrough;
    for await (const d of ctx.db.query("captures").withIndex("by_creation_time", (q) => q.gt("_creationTime", from))) {
      if (backfillStopsBefore(d._creationTime, last, counted, BACKFILL_BATCH, budget.exhausted)) {
        more = true;
        break;
      }
      budget.charge(d);
      counted++;
      last = d._creationTime;
      if (d.userId) perUser.set(d.userId, addStats(perUser.get(d.userId) ?? emptyStats(), captureContribution(d)));
    }

    for (const [userId, delta] of perUser) await addToUserStats(ctx, userId, state.generation, delta);
    const countedThrough = last ?? from;
    await ctx.db.patch(state._id, { countedThrough, done: !more, lastBatchAt: now });
    if (more) {
      await ctx.scheduler.runAfter(0, internal.user_stats.backfillUserStats, {
        continuation: { generation: state.generation, cursor: countedThrough },
      });
    }
    return { counted, done: !more };
  },
});
