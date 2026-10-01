/**
 * searchCaptures with filters: each alone and ANDed, the colour filter's
 * tolerance and weight cut-offs, exact ranking within narrow filters (so a
 * match below the vector index's top-k still surfaces), the fallback to the
 * indexes for broad ones, paging, ownership and validation.
 *
 * convex-test's in-memory vectorSearch crashes on rows lacking the index's
 * vector field, so tests that reach the vector indexes seed only embedded
 * rows of one space and pass `kinds`. Exact mode never calls vectorSearch.
 */
import { describe, expect, test } from "vitest";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { deltaE2000, hexToLab } from "../convex/lib/color";
import { SEARCH_TUNING } from "../convex/lib/ai_config";
import { CANDIDATE_CAP, MAX_COLOR_ROWS } from "../convex/search_scope";
import { makeT, userA, userB, type T } from "./fixtures";
import { addCapture, addColor, addSession, atCosine, axis, creationTime } from "./filter_fixtures";

type Args = Record<string, unknown>;

const search = (t: T, args: Args, who = userA) =>
  t.withIdentity(who).action(api.search.searchCaptures, { query: "alpha", ...args } as any);
const ids = async (t: T, args: Args, who = userA) => (await search(t, args, who)).results.map((r) => r.id);
const sorted = (xs: string[]) => [...xs].sort();

/** A library where every capture matches the keyword "alpha". */
async function seed(t: T, userId: string) {
  const s1 = await addSession(t, userId, "one");
  const s2 = await addSession(t, userId, "two");
  const heroRed = await addCapture(t, userId, { title: "alpha", sessionId: s1, aiCategory: "hero" });
  await addColor(t, heroRed, userId, "#ff0000");
  const pricingBlue = await addCapture(t, userId, { title: "alpha", sessionId: s1, aiCategory: "pricing" });
  await addColor(t, pricingBlue, userId, "#0000ff");
  const text = await addCapture(t, userId, { kind: "text", title: "alpha", sessionId: s2 });
  const heroBlue = await addCapture(t, userId, { title: "alpha", sessionId: s2, aiCategory: "hero" });
  await addColor(t, heroBlue, userId, "#0000ff");
  const link = await addCapture(t, userId, { kind: "link", title: "alpha" });
  return { s1, s2, heroRed, pricingBlue, text, heroBlue, link };
}

describe("searchCaptures filters (keyword search)", () => {
  test("each filter alone", async () => {
    const t = makeT();
    const w = await seed(t, userA.subject);
    expect(sorted(await ids(t, {}))).toEqual(sorted([w.heroRed, w.pricingBlue, w.text, w.heroBlue, w.link]));
    expect(sorted(await ids(t, { kinds: ["text", "link"] }))).toEqual(sorted([w.text, w.link]));
    expect(sorted(await ids(t, { aiCategories: ["hero"] }))).toEqual(sorted([w.heroRed, w.heroBlue]));
    expect(await ids(t, { aiCategories: ["pricing"] })).toEqual([w.pricingBlue]);
    expect(sorted(await ids(t, { sessionId: w.s2 }))).toEqual(sorted([w.text, w.heroBlue]));
    expect(sorted(await ids(t, { color: "#0000FF" }))).toEqual(sorted([w.pricingBlue, w.heroBlue]));
    const tText = await creationTime(t, w.text);
    expect(sorted(await ids(t, { dateFrom: tText }))).toEqual(sorted([w.text, w.heroBlue, w.link]));
    expect(sorted(await ids(t, { dateTo: tText }))).toEqual(sorted([w.heroRed, w.pricingBlue, w.text]));
  });

  test("filters combine with AND", async () => {
    const t = makeT();
    const w = await seed(t, userA.subject);
    expect(await ids(t, { aiCategories: ["hero"], color: "#0000ff" })).toEqual([w.heroBlue]);
    expect(await ids(t, { sessionId: w.s1, color: "#0000ff" })).toEqual([w.pricingBlue]);
    expect(await ids(t, { sessionId: w.s2, kinds: ["viewport"] })).toEqual([w.heroBlue]);
    expect(await ids(t, { sessionId: w.s1, aiCategories: ["hero"], color: "#0000ff" })).toEqual([]);
    const tText = await creationTime(t, w.text);
    expect(await ids(t, { color: "#0000ff", dateTo: tText })).toEqual([w.pricingBlue]);
    expect(await ids(t, { kinds: ["viewport"], aiCategories: ["hero", "pricing"], dateFrom: tText })).toEqual([
      w.heroBlue,
    ]);
  });

  test("the keyword still has to match within the filtered set", async () => {
    const t = makeT();
    const w = await seed(t, userA.subject);
    const other = await addCapture(t, userA.subject, { title: "beta", sessionId: w.s1 });
    expect(await ids(t, { query: "beta", sessionId: w.s1 })).toEqual([other]);
    expect(await ids(t, { query: "gamma", sessionId: w.s1 })).toEqual([]);
  });
});

describe("colour filter cut-offs", () => {
  const target = "#3366cc";
  const near = "#4a7ad8";
  const d = deltaE2000(hexToLab(target)!, hexToLab(near)!);

  test("the fixture pair sits inside the tolerance range", () => {
    expect(d).toBeGreaterThan(1);
    expect(d).toBeLessThan(50);
  });

  test("a colour just inside the tolerance matches; just outside it does not", async () => {
    const t = makeT();
    const id = await addCapture(t, userA.subject, { title: "alpha" });
    await addColor(t, id, userA.subject, near);
    for (const query of ["alpha", ""]) {
      expect(await ids(t, { query, color: target, colorTolerance: d + 0.01 })).toEqual([id]);
      expect(await ids(t, { query, color: target, colorTolerance: d - 0.01 })).toEqual([]);
    }
  });

  test("a colour covering 5% or less of a capture does not count", async () => {
    const t = makeT();
    const thin = await addCapture(t, userA.subject, { title: "alpha" });
    await addColor(t, thin, userA.subject, "#ff0000", 0.05);
    const enough = await addCapture(t, userA.subject, { title: "alpha" });
    await addColor(t, enough, userA.subject, "#ff0000", 0.06);
    expect(await ids(t, { color: "#ff0000" })).toEqual([enough]);
    expect(await ids(t, { query: "", color: "#ff0000" })).toEqual([enough]);
  });

  test("the default tolerance is 10 and a tolerance below 1 is raised to 1", async () => {
    const t = makeT();
    const base = hexToLab("#808080")!;
    const at = (dl: number) => [base[0] + dl, base[1], base[2]] as [number, number, number];
    const close = await addCapture(t, userA.subject, { title: "alpha" });
    await addColor(t, close, userA.subject, at(0.5));
    const mid = await addCapture(t, userA.subject, { title: "alpha" });
    await addColor(t, mid, userA.subject, at(8));
    const far = await addCapture(t, userA.subject, { title: "alpha" });
    await addColor(t, far, userA.subject, at(30));
    expect(sorted(await ids(t, { color: "#808080" }))).toEqual(sorted([close, mid]));
    expect(await ids(t, { color: "#808080", colorTolerance: 0 })).toEqual([close]);
    expect(sorted(await ids(t, { color: "#808080", colorTolerance: 1e6 }))).toEqual(sorted([close, mid, far]));
  });

  test(`past MAX_COLOR_ROWS (${MAX_COLOR_ROWS}) rows the search falls back to per-capture checks, still exact`, async () => {
    const t = makeT();
    const filler = await addCapture(t, userA.subject, { title: "alpha" });
    await t.run(async (ctx) => {
      for (let i = 0; i <= MAX_COLOR_ROWS; i++) {
        await ctx.db.insert("captureColors", {
          captureId: filler,
          userId: userA.subject,
          hex: "#000000",
          l: 50,
          a: -60,
          b: 40,
          weight: 0.5,
          significant: true,
        });
      }
    });
    const red = await addCapture(t, userA.subject, { title: "alpha" });
    await addColor(t, red, userA.subject, "#ff0000");
    const r = await search(t, { color: "#ff0000" });
    expect(r.results.map((x) => x.id)).toEqual([red]);
    expect(r.diagnostics).toMatchObject({ mode: "index", colorRowsTruncated: true });
  });
});

describe("narrow filters rank their whole candidate set", () => {
  test("a colour match far below the vector index's top-k still surfaces", async () => {
    const t = makeT();
    for (let i = 0; i < SEARCH_TUNING.vectorCandidates + 6; i++) {
      await addCapture(t, userA.subject, { localEmbedding: axis(0) });
    }
    const red = await addCapture(t, userA.subject, { localEmbedding: atCosine(0.15) });
    await addColor(t, red, userA.subject, "#ff0000");

    // Unfiltered, the 70 better matches crowd it out.
    const unfiltered = await search(t, { query: "", vector: axis(0), kinds: ["viewport"] });
    expect(unfiltered.results.map((x) => x.id)).not.toContain(red);

    const r = await search(t, { query: "", vector: axis(0), color: "#ff0000" });
    expect(r.results.map((x) => x.id)).toEqual([red]);
    expect(r.results[0]!.sources.image!.score).toBeCloseTo(0.15, 4);
    expect(r.diagnostics).toMatchObject({ mode: "exact", candidates: 1, colorMatches: 1 });
  });

  test("exact mode scores text captures in the text space and keeps the floors and margins", async () => {
    const t = makeT();
    const s = await addSession(t, userA.subject);
    const best = await addCapture(t, userA.subject, { kind: "text", sessionId: s, textEmbedding: atCosine(0.9) });
    const near = await addCapture(t, userA.subject, { kind: "text", sessionId: s, textEmbedding: atCosine(0.86) });
    await addCapture(t, userA.subject, { kind: "text", sessionId: s, textEmbedding: atCosine(0.8) });
    await addCapture(t, userA.subject, { kind: "text", sessionId: s, textEmbedding: atCosine(0.5) });
    const shot = await addCapture(t, userA.subject, { sessionId: s, localEmbedding: atCosine(0.1) });
    const r = await search(t, { query: "", vector: axis(0), sessionId: s });
    // Each tops its own space (equal RRF scores); `near` is second in text;
    // 0.8 is outside the text margin and 0.5 below the text floor.
    expect(sorted(r.results.slice(0, 2).map((x) => x.id))).toEqual(sorted([best, shot]));
    expect(r.results.map((x) => x.id)).toHaveLength(3);
    expect(r.results[2]!.id).toBe(near);
    const byId = new Map(r.results.map((x) => [x.id, x]));
    expect(byId.get(best)!.sources.text!.score).toBeCloseTo(0.9, 4);
    expect(byId.get(shot)!.sources.image!.score).toBeCloseTo(0.1, 4);
    expect(r.diagnostics).toMatchObject({ mode: "exact" });
    // kinds still apply inside the candidate set.
    expect(await ids(t, { query: "", vector: axis(0), sessionId: s, kinds: ["viewport"] })).toEqual([shot]);
  });

  test(`more than CANDIDATE_CAP (${CANDIDATE_CAP}) candidates fall back to the indexes, still filtered`, async () => {
    const t = makeT();
    const s = await addSession(t, userA.subject);
    const outside = await addCapture(t, userA.subject, { title: "alpha" });
    await t.run(async (ctx) => {
      for (let i = 0; i < CANDIDATE_CAP; i++) {
        await ctx.db.insert("captures", { kind: "link", href: "h", url: "u", timestamp: 1, userId: userA.subject, sessionId: s, searchText: "filler" });
      }
    });
    const inside = await addCapture(t, userA.subject, { title: "alpha", sessionId: s });
    const r = await search(t, { sessionId: s });
    expect(r.results.map((x) => x.id)).toEqual([inside]);
    expect(r.results.map((x) => x.id)).not.toContain(outside);
    expect(r.diagnostics).toMatchObject({ mode: "index", candidates: null });
  });

  test("with kind or category filters the vector index is asked for filteredVectorCandidates", async () => {
    const t = makeT();
    for (let i = 0; i < SEARCH_TUNING.vectorCandidates + 6; i++) {
      await addCapture(t, userA.subject, { localEmbedding: axis(0), aiCategory: "footer" });
    }
    const hero = await addCapture(t, userA.subject, { localEmbedding: atCosine(0.99), aiCategory: "hero" });
    const r = await search(t, { query: "", vector: axis(0), kinds: ["viewport"], aiCategories: ["hero"] });
    expect(r.results.map((x) => x.id)).toEqual([hero]);
    expect(r.diagnostics).toMatchObject({ mode: "index", imageCandidates: SEARCH_TUNING.vectorCandidates + 7 });
  });
});

describe("search paging", () => {
  test("cursors walk the ranked list without repeats", async () => {
    const t = makeT();
    const all: Id<"captures">[] = [];
    for (let i = 0; i < 5; i++) all.push(await addCapture(t, userA.subject, { title: "alpha" }));
    const p1 = await search(t, { limit: 2 });
    expect(p1).toMatchObject({ isDone: false });
    expect(p1.cursor).toMatch(/^s\|2\|[0-9.]+\|index$/);
    const p2 = await search(t, { limit: 2, cursor: p1.cursor });
    const p3 = await search(t, { limit: 2, cursor: p2.cursor });
    expect(p3).toMatchObject({ cursor: null, isDone: true });
    const seen = [...p1.results, ...p2.results, ...p3.results].map((x) => x.id);
    expect(seen).toEqual([...all].reverse());
  });

  test("a filtered (exact-mode) search pages the same way", async () => {
    const t = makeT();
    const s = await addSession(t, userA.subject);
    for (let i = 0; i < 3; i++) await addCapture(t, userA.subject, { title: "alpha", sessionId: s });
    const p1 = await search(t, { sessionId: s, limit: 2 });
    const p2 = await search(t, { sessionId: s, limit: 2, cursor: p1.cursor });
    expect(p1.results).toHaveLength(2);
    expect(p2).toMatchObject({ isDone: true, cursor: null });
    expect(p2.results).toHaveLength(1);
  });

  test("a cursor past the end gives an empty, finished page", async () => {
    const t = makeT();
    await addCapture(t, userA.subject, { title: "alpha" });
    expect(await search(t, { cursor: "s|50|9000000000000000|index" })).toMatchObject({
      results: [],
      cursor: null,
      isDone: true,
    });
  });
});

describe("search: ownership and isolation", () => {
  test("another user's session yields no results and no error, exactly like a missing one", async () => {
    const t = makeT();
    const w = await seed(t, userA.subject);
    await seed(t, userB.subject);
    const gone = await addSession(t, userB.subject);
    await t.run((ctx) => ctx.db.delete(gone));
    for (const args of [{}, { vector: axis(0) }, { query: "" }]) {
      const foreign = await search(t, { ...args, sessionId: w.s1 }, userB);
      const missing = await search(t, { ...args, sessionId: gone }, userB);
      expect(foreign.results).toEqual([]);
      expect(foreign).toEqual(missing);
      expect(JSON.stringify(foreign)).not.toContain(w.heroRed);
    }
  });

  test.each<[string, Args]>([
    ["no filter", {}],
    ["kinds", { kinds: ["viewport"] }],
    ["aiCategories", { aiCategories: ["hero"] }],
    ["color", { color: "#ff0000" }],
    ["dates", { dateFrom: 0, dateTo: 9e15 }],
    ["color + vector (exact mode)", { color: "#ff0000", vector: axis(0) }],
    ["everything", { kinds: ["viewport"], aiCategories: ["hero"], color: "#ff0000", dateFrom: 0 }],
  ])("B finds only B's captures with %s", async (_name, args) => {
    const t = makeT();
    const mk = async (userId: string) => {
      const id = await addCapture(t, userId, { title: "alpha", aiCategory: "hero", localEmbedding: axis(0) });
      await addColor(t, id, userId, "#ff0000");
      return id;
    };
    const a = await mk(userA.subject);
    const b = await mk(userB.subject);
    const r = await search(t, args, userB);
    expect(r.results.map((x) => x.id)).toEqual([b]);
    expect(JSON.stringify(r)).not.toContain(a);
    expect(await ids(t, args, userA)).toEqual([a]);
  });

  test("B's own session never surfaces A's captures that claim it", async () => {
    const t = makeT();
    const sB = await addSession(t, userB.subject);
    const forged = await addCapture(t, userA.subject, { title: "alpha", sessionId: sB, localEmbedding: axis(0) });
    const own = await addCapture(t, userB.subject, { title: "alpha", sessionId: sB, localEmbedding: axis(0) });
    for (const args of [{}, { vector: axis(0) }]) {
      const r = await search(t, { ...args, sessionId: sB }, userB);
      expect(r.results.map((x) => x.id)).toEqual([own]);
      expect(JSON.stringify(r)).not.toContain(forged);
    }
  });
});

describe("search: input validation", () => {
  test.each<[string, Args, RegExp]>([
    ["a bad hex", { color: "blue" }, /color must be a hex/],
    ["dateFrom after dateTo", { dateFrom: 2, dateTo: 1 }, /dateFrom must not be after dateTo/],
    ["a non-finite date", { dateTo: Number.POSITIVE_INFINITY }, /dateTo/],
    ["a non-finite tolerance", { color: "#fff", colorTolerance: Number.NaN }, /colorTolerance/],
    ["a non-finite limit", { limit: Number.NaN }, /limit/],
    ["a non-finite score override", { minImageScore: Number.NaN }, /minImageScore/],
    ["a malformed cursor", { cursor: "s|x" }, /Invalid cursor/],
    ["a browse cursor in search", { cursor: "b|1|x" }, /Invalid cursor/],
    ["an old-format search cursor", { cursor: "s|2" }, /Invalid cursor/],
    ["a search cursor with an unknown mode", { cursor: "s|2|5|browse" }, /Invalid cursor/],
    ["a browse cursor with a blank query that is not one", { query: "", cursor: "b|x|y" }, /Invalid cursor/],
    ["too many categories", { aiCategories: Array.from({ length: 33 }, () => "hero") }, /aiCategories has more than/],
    ["the removed folder filter", { folder: "unsorted" }, /folder/],
  ])("refuses %s", async (_name, args, error) => {
    const t = makeT();
    await expect(search(t, args)).rejects.toThrow(error);
  });
});
