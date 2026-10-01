/**
 * captureColors `significant`: written on save, read through
 * by_user_significant_l, rows from before it still matched until the
 * backfill has run, and the backfill itself. Also the exact search
 * handing its colour set to the index pass.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { CANDIDATE_CAP } from "../convex/search_scope";
import { makeT, storeBlob, userA, type T } from "./fixtures";
import { addCapture, addColor } from "./filter_fixtures";

const rows = (t: T) => t.run((ctx) => ctx.db.query("captureColors").collect());
const browseIds = async (t: T, args: Record<string, unknown>) =>
  (await t.withIdentity(userA).query(api.browse.browseCaptures, args as any)).results.map((x) => x.id);

describe("captureColors.significant", () => {
  test("saveImageCapture writes it from the weight", async () => {
    const t = makeT();
    await t.withIdentity(userA).mutation(api.upload.saveImageCapture, {
      storageId: await storeBlob(t),
      url: "u",
      timestamp: 1,
      width: 1,
      height: 1,
      palette: [
        { hex: "#ff0000", lab: [53, 80, 67], weight: 0.97 },
        { hex: "#0000ff", lab: [32, 79, -108], weight: 0.03 },
      ],
    });
    const saved = await rows(t);
    expect(saved).toHaveLength(2);
    for (const r of saved) expect(r.significant).toBe(r.weight > 0.05);
  });

  test("rows written before the field are still matched, and the backfill keeps them matched", async () => {
    vi.useFakeTimers();
    try {
      const t = makeT();
      const legacy = await addCapture(t, userA.subject);
      await addColor(t, legacy, userA.subject, "#ff0000", 0.5, true);
      const thin = await addCapture(t, userA.subject);
      await addColor(t, thin, userA.subject, "#ff0000", 0.04, true);
      const fresh = await addCapture(t, userA.subject);
      await addColor(t, fresh, userA.subject, "#ff0000");
      expect(await browseIds(t, { color: "#ff0000" })).toEqual([fresh, legacy]);

      await t.mutation(internal.captures.backfillColorSignificance, {});
      await t.finishAllScheduledFunctions(vi.runAllTimers);
      const byCapture = new Map((await rows(t)).map((r) => [r.captureId, r.significant]));
      expect(byCapture.get(legacy)).toBe(true);
      expect(byCapture.get(thin)).toBe(false);
      expect(await browseIds(t, { color: "#ff0000" })).toEqual([fresh, legacy]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("captures.backfillColorSignificance", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test("patches only rows lacking the field, across more than one batch", async () => {
    const t = makeT();
    const id = await addCapture(t, userA.subject);
    await t.run(async (ctx) => {
      for (let i = 0; i < 1200; i++) {
        await ctx.db.insert("captureColors", {
          captureId: id,
          userId: userA.subject,
          hex: "#000000",
          l: i % 100,
          a: 0,
          b: 0,
          weight: i % 2 ? 0.5 : 0.01,
          // Every 10th row is already set and must be left alone, even if "wrong".
          ...(i % 10 === 0 ? { significant: true } : {}),
        });
      }
    });
    const first = await t.mutation(internal.captures.backfillColorSignificance, {});
    expect(first).toEqual({ patched: 450, done: false });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const all = await rows(t);
    expect(all.filter((r) => r.significant === undefined)).toHaveLength(0);
    for (const r of all) {
      if (r.l % 10 === 0 && Number.isInteger(r.l)) continue;
      expect(r.significant).toBe(r.weight > 0.05);
    }
  });
});

describe("the exact attempt hands its colour set to the index pass", () => {
  test(`a colour matching more than CANDIDATE_CAP (${CANDIDATE_CAP}) captures is ranked through the indexes, exactly`, async () => {
    const t = makeT();
    const reds: Id<"captures">[] = [];
    await t.run(async (ctx) => {
      for (let i = 0; i <= CANDIDATE_CAP; i++) {
        const captureId = await ctx.db.insert("captures", {
          kind: "link",
          href: "h",
          url: "u",
          timestamp: 1,
          userId: userA.subject,
          title: "alpha",
          searchText: "alpha",
        });
        await ctx.db.insert("captureColors", {
          captureId,
          userId: userA.subject,
          hex: "#ff0000",
          l: 53.24,
          a: 80.09,
          b: 67.2,
          weight: 0.5,
          significant: true,
        });
        reds.push(captureId);
      }
    });
    const blue = await addCapture(t, userA.subject, { kind: "link", title: "alpha" });
    await addColor(t, blue, userA.subject, "#0000ff");
    const r = await t.withIdentity(userA).action(api.search.searchCaptures, { query: "alpha", color: "#ff0000" });
    expect(r.diagnostics).toMatchObject({ mode: "index", colorMatches: CANDIDATE_CAP + 1, colorRowsTruncated: false });
    expect(r.results.length).toBeGreaterThan(0);
    expect(r.results.map((x) => x.id)).not.toContain(blue);
    for (const x of r.results) expect(reds).toContain(x.id);
  });
});
