import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { internal } from "../convex/_generated/api";
import { makeT, userA } from "./fixtures";

describe("captures.backfillCaptureStatus", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test("marks only status-less captures as skipped, across > 1 batch", async () => {
    const t = makeT();
    const statuses = ["pending", "processing", "ready", "failed", "skipped"] as const;
    await t.run(async (ctx) => {
      for (let i = 0; i < 450; i++) {
        await ctx.db.insert("captures", {
          kind: "text",
          content: `c${i}`,
          url: "u",
          timestamp: i,
          userId: userA.subject,
          // Every 10th row already has a status that must be left alone.
          ...(i % 10 === 0 ? { status: statuses[(i / 10) % statuses.length] } : {}),
        });
      }
    });

    const first = await t.mutation(internal.captures.backfillCaptureStatus, {});
    expect(first.done).toBe(false);
    expect(first.patched).toBe(180); // 200 rows, 20 had a status

    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const all = await t.run((ctx) => ctx.db.query("captures").collect());
    expect(all).toHaveLength(450);
    expect(all.filter((d) => d.status === undefined)).toHaveLength(0);

    for (const d of all) {
      const i = Number((d as any).content.slice(1));
      if (i % 10 === 0) expect(d.status).toBe(statuses[(i / 10) % statuses.length]);
      else expect(d.status).toBe("skipped");
    }

    const scheduled = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
    expect(scheduled).toHaveLength(2); // pages 2 and 3
    expect(scheduled.every((s) => s.state.kind === "success")).toBe(true);
  });

  test("is a no-op on an empty table and does not reschedule", async () => {
    const t = makeT();
    const r = await t.mutation(internal.captures.backfillCaptureStatus, {});
    expect(r).toEqual({ patched: 0, done: true });
    const scheduled = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
    expect(scheduled).toHaveLength(0);
  });

  test("re-running after completion patches nothing", async () => {
    const t = makeT();
    await t.run(async (ctx) => {
      for (let i = 0; i < 5; i++) {
        await ctx.db.insert("captures", { kind: "text", content: "x", url: "u", timestamp: i });
      }
    });
    expect((await t.mutation(internal.captures.backfillCaptureStatus, {})).patched).toBe(5);
    expect((await t.mutation(internal.captures.backfillCaptureStatus, {})).patched).toBe(0);
  });
});
