/**
 * Per-user counters (user_stats.ts): the backfill, every write path that
 * changes what is counted, writes that race the backfill, and the two
 * queries that read them.
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import crons from "../convex/crons";
import { applyStatsDelta, backfillStopsBefore, emptyStats, STATS_RULE } from "../convex/lib/capture_stats";
import { BACKFILL_STALL_MS } from "../convex/user_stats";
import {
  backfillStats,
  DIM,
  makeT,
  recountStats,
  seedAB,
  storeBlob,
  storedStats,
  userA,
  userB,
  vec,
  type T,
} from "./fixtures";

const asA = (t: T) => t.withIdentity(userA);

/** The kept counters must equal a recount of the user's captures. */
async function expectConsistent(t: T, userId = userA.subject) {
  expect(await storedStats(t, userId)).toEqual(await recountStats(t, userId));
}

/** Raw inserts: captures that predate the counters. */
async function legacyTexts(t: T, n: number, userId = userA.subject) {
  return await t.run(async (ctx) => {
    const ids: Id<"captures">[] = [];
    for (let i = 0; i < n; i++) {
      ids.push(
        await ctx.db.insert("captures", {
          kind: "text",
          content: `c${i}`,
          url: "u",
          timestamp: i,
          userId,
          ...(i % 3 === 0 ? { status: "ready" as const, textEmbedding: vec(DIM) } : {}),
          ...(i % 3 === 1 ? { status: "skipped" as const } : {}),
        })
      );
    }
    return ids;
  });
}

describe("user_stats.backfillUserStats", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test("until it has run the counters are empty and marked incomplete", async () => {
    const t = makeT();
    await seedAB(t);
    await asA(t).mutation(api.upload.uploadCapture, { capture: { kind: "text", content: "x", url: "u", timestamp: 1 } });
    // Not partial numbers: none at all, until the counters cover the library.
    expect(await asA(t).query(api.captures.countsByKind, {})).toBeNull();
    expect(await asA(t).query(api.local_ai.embeddingStats, {})).toMatchObject({ total: 0, complete: false });
    expect(await t.run((ctx) => ctx.db.query("userStats").collect())).toEqual([]);
  });

  test("counts every user's existing captures across batches", async () => {
    vi.useFakeTimers();
    const t = makeT();
    await legacyTexts(t, 620);
    await legacyTexts(t, 30, userB.subject);
    // An ownerless legacy row is skipped, not counted for anyone.
    await t.run((ctx) => ctx.db.insert("captures", { kind: "text", content: "x", url: "u", timestamp: 1 }));

    const first = await t.mutation(internal.user_stats.backfillUserStats, {});
    expect(first).toEqual({ counted: 500, done: false });
    expect((await asA(t).query(api.local_ai.embeddingStats, {})).complete).toBe(false);
    expect(await asA(t).query(api.captures.countsByKind, {})).toBeNull();
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    await expectConsistent(t);
    await expectConsistent(t, userB.subject);
    expect(await asA(t).query(api.captures.countsByKind, {})).toEqual({ text: 620, all: 620 });
    expect(await asA(t).query(api.local_ai.embeddingStats, {})).toEqual({
      total: 620,
      withLocalEmbedding: 207,
      withImageEmbedding: 0,
      searchable: 207,
      byKind: { text: { total: 620, withLocalEmbedding: 207 } },
      byStatus: { ready: 207, skipped: 207, none: 206 },
      complete: true,
    });
  });

  test("is a no-op once done, and does not reschedule", async () => {
    const t = makeT();
    await legacyTexts(t, 5);
    expect(await t.mutation(internal.user_stats.backfillUserStats, {})).toEqual({ counted: 5, done: true });
    expect(await t.mutation(internal.user_stats.backfillUserStats, {})).toEqual({ counted: 0, done: true });
    await expectConsistent(t);
    expect(await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect())).toHaveLength(0);
  });

  test("restart recounts from scratch, repairing drifted counters", async () => {
    const t = makeT();
    await legacyTexts(t, 9);
    await backfillStats(t);
    await t.run(async (ctx) => {
      const row = (await ctx.db.query("userStats").first())!;
      await ctx.db.patch(row._id, { kinds: { text: 999, image: 3 } });
    });
    const r = await t.mutation(internal.user_stats.backfillUserStats, { restart: true });
    expect(r).toEqual({ counted: 9, done: true });
    await expectConsistent(t);
    expect(await asA(t).query(api.captures.countsByKind, {})).toEqual({ text: 9, all: 9 });
  });

  test("writes that race the backfill are neither lost nor counted twice", async () => {
    vi.useFakeTimers();
    const t = makeT();
    const ids = await legacyTexts(t, 600);
    expect((await t.mutation(internal.user_stats.backfillUserStats, {})).done).toBe(false);

    // Counted already (in the first batch): live writes adjust the counters.
    await asA(t).mutation(api.upload.deleteById, { docId: ids[1]! });
    await asA(t).mutation(api.local_ai.retryProcessing, { captureId: ids[3]! });
    // Not counted yet: live writes leave the counters to the backfill.
    await asA(t).mutation(api.upload.deleteById, { docId: ids[590]! });
    await asA(t).mutation(api.local_ai.retryProcessing, { captureId: ids[591]! });
    await asA(t).mutation(api.upload.uploadCapture, { capture: { kind: "link", href: "h", url: "u", timestamp: 1 } });

    await t.finishAllScheduledFunctions(vi.runAllTimers);
    await expectConsistent(t);

    // Done: new writes count straight away.
    await asA(t).mutation(api.upload.uploadCapture, { capture: { kind: "text", content: "y", url: "u", timestamp: 2 } });
    await asA(t).mutation(api.upload.deleteById, { docId: ids[599]! });
    await expectConsistent(t);
    expect((await asA(t).query(api.captures.countsByKind, {}))!.all).toBe(599); // 600 - 3 deleted + 2 uploaded
  });
});

describe("every capture write keeps the counters right", () => {
  test("upload, processing, retries, re-index, delete and the status backfill", async () => {
    const t = makeT();
    const { a } = await seedAB(t);
    await backfillStats(t);
    await expectConsistent(t);
    const A = asA(t);

    // Uploads, every kind.
    const text = await A.mutation(api.upload.uploadCapture, { capture: { kind: "text", content: "x", url: "u", timestamp: 1 } });
    const link = await A.mutation(api.upload.uploadCapture, { capture: { kind: "link", href: "h", url: "u", timestamp: 1 } });
    const shots: Id<"captures">[] = [];
    for (const kind of ["image", "screenshot", "element", "viewport"] as const) {
      shots.push(
        await A.mutation(api.upload.saveImageCapture, {
          storageId: await storeBlob(t, kind), url: "u", timestamp: 1, width: 1, height: 1, kind,
        })
      );
    }
    await expectConsistent(t);
    expect(await A.query(api.captures.countsByKind, {})).toEqual({
      link: 2, screenshot: 2, text: 1, image: 1, element: 1, viewport: 1, all: 8,
    });

    // Claim and complete, in both embedding spaces.
    const c1 = await A.mutation(api.local_ai.claimCapture, { id: shots[0]! });
    await expectConsistent(t);
    await A.mutation(api.local_ai.completeProcessing, { id: shots[0]!, claim: c1.claim!, localEmbedding: vec(DIM) });
    const c2 = await A.mutation(api.local_ai.claimCapture, { id: text });
    await A.mutation(api.local_ai.completeProcessing, { id: text, claim: c2.claim!, textEmbedding: vec(DIM) });
    await expectConsistent(t);
    expect((await A.query(api.local_ai.embeddingStats, {})).withLocalEmbedding).toBe(3);

    // A failure goes back to pending, the second one to failed; then a manual retry.
    let c = await A.mutation(api.local_ai.claimCapture, { id: link });
    await A.mutation(api.local_ai.failProcessing, { id: link, claim: c.claim!, error: "boom" });
    await expectConsistent(t);
    c = await A.mutation(api.local_ai.claimCapture, { id: link });
    await A.mutation(api.local_ai.failProcessing, { id: link, claim: c.claim!, error: "boom" });
    expect((await A.query(api.local_ai.embeddingStats, {})).byStatus.failed).toBe(1);
    await A.mutation(api.local_ai.retryProcessing, { captureId: link });
    await expectConsistent(t);

    // A claim released when it goes stale, by the scheduled release and by recovery.
    c = await A.mutation(api.local_ai.claimCapture, { id: shots[1]! });
    await t.mutation(internal.local_ai.releaseStaleClaim, { id: shots[1]!, claim: c.claim! });
    await expectConsistent(t);
    await A.mutation(api.local_ai.claimCapture, { id: shots[2]! });
    await t.run((ctx) => ctx.db.patch(shots[2]!, { aiStartedAt: 0 }));
    expect((await A.mutation(api.local_ai.recoverStaleProcessing, {})).recovered).toBe(1);
    await expectConsistent(t);

    // Re-index: a stale (512-d) vector is unset and the capture requeued.
    await t.run((ctx) => ctx.db.patch(a.shotId, { localEmbedding: vec(512), status: "ready" }));
    // (That raw patch changed what is counted behind the counters' back; recount.)
    await t.mutation(internal.user_stats.backfillUserStats, { restart: true });
    await A.mutation(api.local_ai.requeueUnindexed, {});
    expect((await t.run((ctx) => ctx.db.get(a.shotId)))!.status).toBe("pending");
    await expectConsistent(t);

    // The one-off status backfill.
    await t.run((ctx) => ctx.db.patch(a.linkId, { status: undefined }));
    await t.mutation(internal.user_stats.backfillUserStats, { restart: true });
    await t.mutation(internal.captures.backfillCaptureStatus, {});
    expect((await t.run((ctx) => ctx.db.get(a.linkId)))!.status).toBe("skipped");
    await expectConsistent(t);

    // Delete.
    await A.mutation(api.upload.deleteById, { docId: shots[3]! });
    await A.mutation(api.upload.deleteById, { docId: a.linkId });
    await expectConsistent(t);
    expect((await A.query(api.captures.countsByKind, {}))!.all).toBe(6);

    // B's numbers never moved with A's writes.
    await expectConsistent(t, userB.subject);
  });

  test("writes that change nothing counted leave the counters' row alone", async () => {
    const t = makeT();
    const { a } = await seedAB(t);
    await backfillStats(t);
    const before = await t.run((ctx) => ctx.db.query("userStats").collect());
    await asA(t).mutation(api.captures.setCaptureTags, { captureId: a.linkId, tags: ["x"] });
    await asA(t).mutation(api.local_ai.applyAutoMetadata, { id: a.shotId, domain: "d.example" });
    await asA(t).mutation(api.sessions.setCaptureSession, { captureId: a.linkId, sessionId: null });
    expect(await t.run((ctx) => ctx.db.query("userStats").collect())).toEqual(before);
  });
});

describe("backfill chains, rule changes and drift", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const state = (t: T) => t.run((ctx) => ctx.db.query("userStatsBackfill").first());
  const scheduled = (t: T) => t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());

  test("a call while a walk is running neither counts nor starts a second chain", async () => {
    vi.useFakeTimers();
    const t = makeT();
    await legacyTexts(t, 1100);
    expect((await t.mutation(internal.user_stats.backfillUserStats, {})).done).toBe(false);
    expect(await scheduled(t)).toHaveLength(1);

    expect(await t.mutation(internal.user_stats.backfillUserStats, {})).toEqual({ counted: 0, done: false, skipped: "running" });
    expect(await scheduled(t)).toHaveLength(1);

    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect((await state(t))!.done).toBe(true);
    await expectConsistent(t);
    // One chain: the first call plus two continuations.
    expect(await scheduled(t)).toHaveLength(2);
  });

  test("a continuation from a superseded walk stops", async () => {
    const t = makeT();
    await legacyTexts(t, 3);
    await backfillStats(t);
    const s = (await state(t))!;
    const stale = { generation: s.generation - 1, cursor: s.countedThrough };
    expect(await t.mutation(internal.user_stats.backfillUserStats, { continuation: stale })).toEqual({
      counted: 0, done: true, skipped: "superseded",
    });
    await t.mutation(internal.user_stats.backfillUserStats, { restart: true });
    const old = { generation: s.generation, cursor: s.countedThrough };
    expect((await t.mutation(internal.user_stats.backfillUserStats, { continuation: old })).skipped).toBe("superseded");
    await expectConsistent(t);
  });

  test("a stalled walk is taken over by the next call", async () => {
    const t = makeT();
    await legacyTexts(t, 4);
    // A walk that died after starting: not done, last batch long ago, nothing scheduled.
    await t.run((ctx) =>
      ctx.db.insert("userStatsBackfill", {
        generation: 1, rule: STATS_RULE, countedThrough: 0, done: false, lastBatchAt: Date.now() - BACKFILL_STALL_MS - 1,
      })
    );
    expect(await t.mutation(internal.user_stats.backfillUserStats, {})).toEqual({ counted: 4, done: true });
    await expectConsistent(t);
  });

  test("a changed counting rule reads as incomplete, then recounts from scratch", async () => {
    const t = makeT();
    await legacyTexts(t, 6);
    await backfillStats(t);
    const before = (await state(t))!;
    await t.run((ctx) => ctx.db.patch(before._id, { rule: "dim=512;visual=image" }));

    expect(await asA(t).query(api.captures.countsByKind, {})).toBeNull();
    expect((await asA(t).query(api.local_ai.embeddingStats, {})).complete).toBe(false);
    // Writes meanwhile are left to the recount.
    await asA(t).mutation(api.upload.uploadCapture, { capture: { kind: "text", content: "x", url: "u", timestamp: 1 } });

    expect(await t.mutation(internal.user_stats.backfillUserStats, {})).toEqual({ counted: 7, done: true });
    expect(await state(t)).toMatchObject({ rule: STATS_RULE, generation: before.generation + 1, done: true });
    await expectConsistent(t);
    expect(await asA(t).query(api.captures.countsByKind, {})).toEqual({ text: 7, all: 7 });
  });

  test("a counter clamped at zero is logged with the user and field", async () => {
    const t = makeT();
    const [id] = await legacyTexts(t, 1);
    await backfillStats(t);
    await t.run(async (ctx) => {
      const row = (await ctx.db.query("userStats").first())!;
      await ctx.db.patch(row._id, { kinds: {}, statuses: {} });
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await asA(t).mutation(api.upload.deleteById, { docId: id! });
    const lines = warn.mock.calls.map((c) => String(c[0]));
    expect(lines.some((l) => l.includes("kinds.text") && l.includes(userA.subject))).toBe(true);
    expect(lines.some((l) => l.includes("statuses.ready"))).toBe(true);
  });

  test("the cron runs the backfill every 10 minutes, with no arguments", () => {
    const job = (crons as any).crons["library counters"];
    expect(job).toMatchObject({ name: "user_stats:backfillUserStats", schedule: { type: "interval", minutes: 10 } });
    expect(job.args).toEqual([{}]);
  });
});

describe("lib/capture_stats", () => {
  test("a batch never stops between two captures created at the same time", () => {
    // Full batch, next capture at a later time: stop.
    expect(backfillStopsBefore(11, 10, 500, 500, false)).toBe(true);
    // Full batch, but the next capture ties the last one: keep going.
    expect(backfillStopsBefore(10, 10, 500, 500, false)).toBe(false);
    expect(backfillStopsBefore(10, 10, 501, 500, true)).toBe(false);
    // Budget spent: stop at the next distinct time.
    expect(backfillStopsBefore(12, 10, 3, 500, true)).toBe(true);
    // Room left: never stop.
    expect(backfillStopsBefore(12, 10, 3, 500, false)).toBe(false);
    // Nothing counted yet: always count at least one.
    expect(backfillStopsBefore(5, null, 0, 0, true)).toBe(false);
  });

  test("applyStatsDelta names what it clamps", () => {
    const { stats, clamped } = applyStatsDelta(
      { kinds: { text: 1 }, statuses: {}, embedded: {}, withImageEmbedding: 0 },
      { kinds: { text: -2 }, statuses: { ready: -1 }, embedded: {}, withImageEmbedding: -1 }
    );
    expect(stats).toEqual(emptyStats());
    expect(clamped.sort()).toEqual(["kinds.text", "statuses.ready", "withImageEmbedding"]);
  });

  test("the rule names the embedding size and the visual kinds", () => {
    expect(STATS_RULE).toBe(`dim=${DIM};visual=element,image,screenshot,viewport`);
  });
});
