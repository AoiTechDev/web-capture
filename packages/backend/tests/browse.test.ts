/**
 * Browse mode: browse.browseCaptures and searchCaptures with a blank query
 * and no vectors. Newest first, every filter ANDed, cursor pagination.
 */
import { describe, expect, test } from "vitest";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { MAX_BROWSE_SCAN } from "../convex/browse";
import { MAX_COLOR_ROWS } from "../convex/search_scope";
import { makeT, userA, userB, type T } from "./fixtures";
import { addCapture, addColor, addSession, creationTime } from "./filter_fixtures";

type BrowseArgs = Record<string, unknown>;

const browse = (t: T, args: BrowseArgs = {}, who = userA) =>
  t.withIdentity(who).query(api.browse.browseCaptures, args as any);

/** Every page, following cursors; asserts the paging invariants on the way. */
async function allPages(t: T, args: BrowseArgs, who = userA) {
  const pages: Id<"captures">[][] = [];
  let cursor: string | undefined;
  for (let i = 0; i < 50; i++) {
    const r = await browse(t, { ...args, ...(cursor ? { cursor } : {}) }, who);
    pages.push(r.results.map((x) => x.id));
    if (r.isDone) {
      expect(r.cursor).toBeNull();
      return pages;
    }
    expect(r.cursor).toEqual(expect.any(String));
    cursor = r.cursor!;
  }
  throw new Error("paging did not finish");
}

describe("browse: order and pagination", () => {
  test("newest first, with session name and creation time on each row", async () => {
    const t = makeT();
    const s = await addSession(t, userA.subject, "Pricing pages");
    const old = await addCapture(t, userA.subject);
    const mid = await addCapture(t, userA.subject, { sessionId: s });
    const latest = await addCapture(t, userA.subject, { kind: "text", title: "note" });
    const r = await browse(t);
    expect(r.results.map((x) => x.id)).toEqual([latest, mid, old]);
    expect(r.isDone).toBe(true);
    expect(r.cursor).toBeNull();
    const row = r.results[1]!;
    expect(row).toMatchObject({ sessionId: s, sessionName: "Pricing pages", kind: "viewport" });
    expect(row.createdAt).toBe(await creationTime(t, mid));
    expect(r.results[0]!.sessionName).toBeNull();
  });

  test("pages across a cursor without gaps or repeats; the last page says isDone", async () => {
    const t = makeT();
    const ids: Id<"captures">[] = [];
    for (let i = 0; i < 7; i++) ids.push(await addCapture(t, userA.subject));
    const pages = await allPages(t, { limit: 3 });
    expect(pages.map((p) => p.length)).toEqual([3, 3, 1]);
    expect(pages.flat()).toEqual([...ids].reverse());
  });

  test("an exact multiple of the limit ends on a full page marked done", async () => {
    const t = makeT();
    for (let i = 0; i < 6; i++) await addCapture(t, userA.subject);
    const pages = await allPages(t, { limit: 3 });
    expect(pages.map((p) => p.length)).toEqual([3, 3]);
  });

  test("captures added after page 1 do not shift page 2", async () => {
    const t = makeT();
    const ids: Id<"captures">[] = [];
    for (let i = 0; i < 4; i++) ids.push(await addCapture(t, userA.subject));
    const p1 = await browse(t, { limit: 2 });
    await addCapture(t, userA.subject);
    const p2 = await browse(t, { limit: 2, cursor: p1.cursor });
    expect(p2.results.map((x) => x.id)).toEqual([ids[1], ids[0]]);
  });

  test("searchCaptures with a blank query browses the same pages", async () => {
    const t = makeT();
    for (let i = 0; i < 5; i++) await addCapture(t, userA.subject, { title: `item ${i}` });
    const viaQuery = await browse(t, { limit: 2 });
    const viaSearch = await t.withIdentity(userA).action(api.search.searchCaptures, { query: "  ", limit: 2 });
    expect(viaSearch.results.map((x) => x.id)).toEqual(viaQuery.results.map((x) => x.id));
    expect(viaSearch.cursor).toBe(viaQuery.cursor);
    expect(viaSearch.diagnostics).toEqual({ mode: "browse" });
    expect(viaSearch.results[0]).toMatchObject({ fusedScore: null, score: null, sources: {} });
    const next = await t
      .withIdentity(userA)
      .action(api.search.searchCaptures, { query: "", limit: 2, cursor: viaSearch.cursor! });
    expect(next.results.map((x) => x.id)).toEqual(
      (await browse(t, { limit: 2, cursor: viaQuery.cursor })).results.map((x) => x.id)
    );
  });

  test(`a page examines at most MAX_BROWSE_SCAN (${MAX_BROWSE_SCAN}) captures, then resumes`, async () => {
    const t = makeT();
    const shots = [await addCapture(t, userA.subject), await addCapture(t, userA.subject)];
    await t.run(async (ctx) => {
      for (let i = 0; i < MAX_BROWSE_SCAN + 10; i++) {
        await ctx.db.insert("captures", { kind: "link", href: "h", url: "u", timestamp: 1, userId: userA.subject });
      }
    });
    const p1 = await browse(t, { kinds: ["viewport"], limit: 10 });
    expect(p1.results).toEqual([]);
    expect(p1.isDone).toBe(false);
    const p2 = await browse(t, { kinds: ["viewport"], limit: 10, cursor: p1.cursor });
    expect(p2.results.map((x) => x.id)).toEqual([shots[1], shots[0]]);
    expect(p2.isDone).toBe(true);
  });
});

describe("browse: filters", () => {
  /** A's library: a mix of kinds, categories, sessions, colours and times. */
  async function seed(t: T, userId: string) {
    const s1 = await addSession(t, userId, "one");
    const s2 = await addSession(t, userId, "two");
    const heroRed = await addCapture(t, userId, { sessionId: s1, aiCategory: "hero" });
    await addColor(t, heroRed, userId, "#ff0000");
    const pricingBlue = await addCapture(t, userId, { sessionId: s1, aiCategory: "pricing" });
    await addColor(t, pricingBlue, userId, "#0000ff");
    const text = await addCapture(t, userId, { kind: "text", title: "words", sessionId: s2 });
    const heroBlue = await addCapture(t, userId, { sessionId: s2, aiCategory: "hero" });
    await addColor(t, heroBlue, userId, "#0000ff");
    const link = await addCapture(t, userId, { kind: "link" });
    return { s1, s2, heroRed, pricingBlue, text, heroBlue, link };
  }

  test("each filter alone", async () => {
    const t = makeT();
    const w = await seed(t, userA.subject);
    const ids = async (args: BrowseArgs) => (await browse(t, args)).results.map((x) => x.id);
    expect(await ids({ kinds: ["text", "link"] })).toEqual([w.link, w.text]);
    expect(await ids({ aiCategories: ["hero"] })).toEqual([w.heroBlue, w.heroRed]);
    expect(await ids({ aiCategory: "pricing" })).toEqual([w.pricingBlue]);
    expect(await ids({ sessionId: w.s1 })).toEqual([w.pricingBlue, w.heroRed]);
    expect(await ids({ color: "#0000ff" })).toEqual([w.heroBlue, w.pricingBlue]);
    expect(await ids({ color: "#f00" })).toEqual([w.heroRed]);
    const tText = await creationTime(t, w.text);
    const tHeroBlue = await creationTime(t, w.heroBlue);
    expect(await ids({ dateFrom: tText })).toEqual([w.link, w.heroBlue, w.text]);
    expect(await ids({ dateTo: tText })).toEqual([w.text, w.pricingBlue, w.heroRed]);
    expect(await ids({ dateFrom: tText, dateTo: tHeroBlue })).toEqual([w.heroBlue, w.text]);
  });

  test("filters combine with AND", async () => {
    const t = makeT();
    const w = await seed(t, userA.subject);
    const ids = async (args: BrowseArgs) => (await browse(t, args)).results.map((x) => x.id);
    expect(await ids({ aiCategories: ["hero"], color: "#0000ff" })).toEqual([w.heroBlue]);
    expect(await ids({ sessionId: w.s1, color: "#0000ff" })).toEqual([w.pricingBlue]);
    expect(await ids({ sessionId: w.s2, kinds: ["viewport"], aiCategories: ["hero", "pricing"] })).toEqual([
      w.heroBlue,
    ]);
    expect(await ids({ sessionId: w.s1, aiCategories: ["hero"], color: "#0000ff" })).toEqual([]);
    // The text capture was created between the two blue ones.
    expect(await ids({ color: "#0000ff", dateTo: await creationTime(t, w.text) })).toEqual([w.pricingBlue]);
  });

  test("a colour filter pages through its matching set newest first", async () => {
    const t = makeT();
    const reds: Id<"captures">[] = [];
    for (let i = 0; i < 5; i++) {
      const id = await addCapture(t, userA.subject);
      await addColor(t, id, userA.subject, "#ff0000");
      reds.push(id);
      await addCapture(t, userA.subject);
    }
    const pages = await allPages(t, { color: "#ff0000", limit: 2 });
    expect(pages.flat()).toEqual([...reds].reverse());
    expect(pages.map((p) => p.length)).toEqual([2, 2, 1]);
  });

  test("filtered pages across cursors keep the filter", async () => {
    const t = makeT();
    const heroes: Id<"captures">[] = [];
    for (let i = 0; i < 6; i++) {
      heroes.push(await addCapture(t, userA.subject, { aiCategory: "hero" }));
      await addCapture(t, userA.subject, { aiCategory: "footer" });
    }
    const pages = await allPages(t, { aiCategories: ["hero"], limit: 4 });
    expect(pages.flat()).toEqual([...heroes].reverse());
  });

  test(`colour filter past MAX_COLOR_ROWS (${MAX_COLOR_ROWS}) rows still finds every match`, async () => {
    const t = makeT();
    const filler = await addCapture(t, userA.subject);
    // Within red's L band but far in hue, and sorting before red in L.
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
        });
      }
    });
    const red = await addCapture(t, userA.subject);
    await addColor(t, red, userA.subject, "#ff0000");
    expect((await browse(t, { color: "#ff0000" })).results.map((x) => x.id)).toEqual([red]);
  });
});

describe("browse: ownership and isolation", () => {
  test("another user's session yields no results, exactly like a session that does not exist", async () => {
    const t = makeT();
    const sA = await addSession(t, userA.subject);
    await addCapture(t, userA.subject, { sessionId: sA });
    await addCapture(t, userB.subject);
    const gone = await addSession(t, userB.subject);
    await t.run((ctx) => ctx.db.delete(gone));
    const foreign = await browse(t, { sessionId: sA }, userB);
    const missing = await browse(t, { sessionId: gone }, userB);
    expect(foreign).toEqual({ results: [], cursor: null, isDone: true });
    expect(missing).toEqual(foreign);
    const viaSearch = await t.withIdentity(userB).action(api.search.searchCaptures, { query: "", sessionId: sA });
    expect(viaSearch.results).toEqual([]);
  });

  test.each<[string, BrowseArgs]>([
    ["no filter", {}],
    ["kinds", { kinds: ["viewport", "text"] }],
    ["aiCategories", { aiCategories: ["hero"] }],
    ["color", { color: "#ff0000" }],
    ["dates", { dateFrom: 0, dateTo: 9e15 }],
    ["everything", { kinds: ["viewport"], aiCategories: ["hero"], color: "#ff0000", dateFrom: 0 }],
  ])("B sees only B's captures with %s", async (_name, args) => {
    const t = makeT();
    const mk = async (userId: string) => {
      const id = await addCapture(t, userId, { aiCategory: "hero" });
      await addColor(t, id, userId, "#ff0000");
      return id;
    };
    const a = await mk(userA.subject);
    const b = await mk(userB.subject);
    const r = await browse(t, args, userB);
    expect(r.results.map((x) => x.id)).toEqual([b]);
    expect(JSON.stringify(r)).not.toContain(a);
    expect((await browse(t, args, userA)).results.map((x) => x.id)).toEqual([a]);
  });

  test("B's own session filter never returns A's captures, even ones claiming B's session", async () => {
    const t = makeT();
    const sB = await addSession(t, userB.subject);
    const forged = await addCapture(t, userA.subject, { sessionId: sB });
    const own = await addCapture(t, userB.subject, { sessionId: sB });
    const r = await browse(t, { sessionId: sB }, userB);
    expect(r.results.map((x) => x.id)).toEqual([own]);
    expect(JSON.stringify(r)).not.toContain(forged);
  });

  test("anonymous callers get an empty, finished page", async () => {
    const t = makeT();
    await addCapture(t, userA.subject);
    expect(await t.query(api.browse.browseCaptures, {})).toEqual({ results: [], cursor: null, isDone: true });
  });
});

describe("browse: input validation", () => {
  test.each<[string, BrowseArgs, RegExp]>([
    ["a malformed cursor", { cursor: "garbage" }, /Invalid cursor/],
    ["a search cursor", { cursor: "s|30" }, /Invalid cursor/],
    ["a bad hex", { color: "#12" }, /color must be a hex/],
    ["dateFrom after dateTo", { dateFrom: 10, dateTo: 9 }, /dateFrom must not be after dateTo/],
    ["a negative date", { dateFrom: -1 }, /dateFrom/],
    ["a NaN limit", { limit: Number.NaN }, /limit/],
    ["a NaN tolerance", { color: "#fff", colorTolerance: Number.NaN }, /colorTolerance/],
    ["too many kinds", { kinds: Array.from({ length: 40 }, () => "image") }, /kinds has more than/],
  ])("refuses %s", async (_name, args, error) => {
    const t = makeT();
    await expect(browse(t, args)).rejects.toThrow(error);
  });

  test("an unknown kind or category is refused by the argument validator", async () => {
    const t = makeT();
    await expect(browse(t, { kinds: ["video"] })).rejects.toThrow();
    await expect(browse(t, { aiCategories: ["poster"] })).rejects.toThrow();
  });

  test("limit is clamped, not refused", async () => {
    const t = makeT();
    for (let i = 0; i < 3; i++) await addCapture(t, userA.subject);
    expect((await browse(t, { limit: 0 })).results).toHaveLength(1);
    expect((await browse(t, { limit: 1e9 })).results).toHaveLength(3);
  });
});
