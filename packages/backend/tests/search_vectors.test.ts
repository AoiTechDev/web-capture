/**
 * searchCaptures with 768-d SigLIP2 query vectors, beyond local_ai.test.ts:
 * non-finite components, a malformed textVector, the score floors, the
 * vector-only admission rule, and cross-user isolation in both vector
 * indexes (including the `textVector ?? vector` fallback).
 *
 * convex-test's in-memory vectorSearch crashes on any row lacking the index's
 * vector field, so each test seeds a table holding only rows embedded in the
 * space it searches, and passes `kinds` to keep the other index out.
 */
import { describe, expect, test } from "vitest";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { MATCH_DISPLAY_BANDS, SEARCH_TUNING } from "../convex/lib/ai_config";
import { admitVectorOnly } from "../convex/search";
import { buildSearchText } from "../convex/lib/search_rank";
import { DIM, makeT, userA, userB, vec, type T } from "./fixtures";

/** Unit vector along axis `i`. */
const axis = (i: number) => Array.from({ length: DIM }, (_, j) => (j === i ? 1 : 0));
/** Unit vector whose cosine with axis(0) is exactly `c`. */
const atCosine = (c: number) => Array.from({ length: DIM }, (_, j) => (j === 0 ? c : j === 1 ? Math.sqrt(1 - c * c) : 0));

async function imageRow(t: T, userId: string, localEmbedding: number[], title = "") {
  return await t.run(async (ctx) =>
    ctx.db.insert("captures", {
      kind: "viewport",
      storageId: await ctx.storage.store(new Blob(["x"])),
      width: 1,
      height: 1,
      url: "https://page.example",
      timestamp: 1,
      userId,
      localEmbedding,
      ...(title ? { title } : {}),
      // Always set: convex-test's search index crashes on rows without it.
      searchText: buildSearchText({ url: "https://page.example", title } as any),
    } as any)
  );
}

async function textRow(t: T, userId: string, textEmbedding: number[], content = "x") {
  return await t.run(async (ctx) =>
    ctx.db.insert("captures", {
      kind: "text",
      content,
      url: "https://page.example",
      timestamp: 1,
      userId,
      textEmbedding,
      searchText: buildSearchText({ url: "https://page.example", content } as any),
    } as any)
  );
}

describe("searchCaptures: query vector validation (768-d)", () => {
  const bads: Array<[string, number]> = [
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["-Infinity", Number.NEGATIVE_INFINITY],
  ];

  test.each(bads)("rejects a vector with a %s component", async (_label, bad) => {
    const t = makeT();
    const vector = vec(DIM);
    vector[DIM - 1] = bad;
    await expect(
      t.withIdentity(userA).action(api.search.searchCaptures, { query: "x", vector, kinds: ["viewport"] })
    ).rejects.toThrow(/vector must contain only finite numbers/);
  });

  test.each(bads)("rejects a textVector with a %s component", async (_label, bad) => {
    const t = makeT();
    const textVector = vec(DIM);
    textVector[0] = bad;
    await expect(
      t.withIdentity(userA).action(api.search.searchCaptures, { query: "x", textVector, kinds: ["text"] })
    ).rejects.toThrow(/textVector must contain only finite numbers/);
  });

  test.each([0, 1, 512, 767, 769, 1536])("rejects a textVector of length %i, naming the field", async (n) => {
    const t = makeT();
    await expect(
      t.withIdentity(userA).action(api.search.searchCaptures, { query: "x", textVector: vec(n), kinds: ["text"] })
    ).rejects.toThrow(/textVector must have 768 dimensions/);
  });

  test("a valid vector with a malformed textVector is still refused", async () => {
    const t = makeT();
    await expect(
      t
        .withIdentity(userA)
        .action(api.search.searchCaptures, { query: "x", vector: vec(DIM), textVector: vec(512), kinds: ["text"] })
    ).rejects.toThrow(/textVector/);
  });

  test("exactly 768 finite components are accepted (empty library: no results, no error)", async () => {
    const t = makeT();
    const r = await t
      .withIdentity(userA)
      .action(api.search.searchCaptures, { query: "", vector: vec(DIM), kinds: ["viewport"] });
    expect(r.results).toEqual([]);
    expect(r.diagnostics).toMatchObject({ imageCandidates: 0 });
  });

  test("anonymous callers are refused before the vector is even looked at", async () => {
    const t = makeT();
    const r = await t.action(api.search.searchCaptures, { query: "x", vector: vec(3) });
    expect(r).toEqual({ results: [], diagnostics: { error: "Unauthorized" } });
  });
});

describe("searchCaptures: score floors", () => {
  // Keyword-matched rows, so only the floors apply (not the vector-only rule).
  test("image hits below SEARCH_TUNING.imageMinScore are dropped, those above kept", async () => {
    const t = makeT();
    const floor = SEARCH_TUNING.imageMinScore;
    const below = await imageRow(t, userA.subject, atCosine(floor - 0.01), "quokka");
    const above = await imageRow(t, userA.subject, atCosine(floor + 0.01), "quokka");
    const r = await t
      .withIdentity(userA)
      .action(api.search.searchCaptures, { query: "quokka", vector: axis(0), kinds: ["viewport"] });
    const withImage = r.results.filter((x) => x.sources.image).map((x) => x.id);
    expect(withImage).toEqual([above]);
    expect(withImage).not.toContain(below);
    expect(r.diagnostics).toMatchObject({ imageCandidates: 2, minImageScore: floor });
  });

  test("text hits below SEARCH_TUNING.textMinScore are dropped, those above kept", async () => {
    const t = makeT();
    const floor = SEARCH_TUNING.textMinScore;
    const below = await textRow(t, userA.subject, atCosine(floor - 0.01), "quokka");
    const above = await textRow(t, userA.subject, atCosine(floor + 0.01), "quokka");
    const r = await t
      .withIdentity(userA)
      .action(api.search.searchCaptures, { query: "quokka", vector: axis(0), kinds: ["text"] });
    const withText = r.results.filter((x) => x.sources.text);
    expect(withText.map((x) => x.id)).toEqual([above]);
    expect(withText.map((x) => x.id)).not.toContain(below);
    expect(withText[0]!.sources.text!.score).toBeCloseTo(floor + 0.01, 3);
  });

  test("a hit just above the image floor shows a 0-1 display score, not the raw cosine", async () => {
    const t = makeT();
    await imageRow(t, userA.subject, atCosine(0.5));
    const r = await t
      .withIdentity(userA)
      .action(api.search.searchCaptures, { query: "", vector: axis(0), kinds: ["viewport"] });
    expect(r.results[0]!.sources.image!.score).toBeCloseTo(0.5, 3);
    expect(r.results[0]!.score).toBe(1); // above the image band's top
  });
});

describe("admitVectorOnly (pure)", () => {
  const hit = (id: string, score: number) => ({ id, score });
  const none = new Set<string>();

  test("keeps vector-only hits above the band low and within the margin of the best", () => {
    const hits = [hit("a", 0.2), hit("b", 0.15), hit("c", 0.13), hit("d", 0.06)];
    expect(admitVectorOnly(hits, none, 0.05, 0.06).map((h) => h.id)).toEqual(["a", "b"]);
  });

  test("drops vector-only hits at or below the band low, even the best one", () => {
    const hits = [hit("a", 0.05), hit("b", 0.04)];
    expect(admitVectorOnly(hits, none, 0.05, 0.06)).toEqual([]);
  });

  test("keyword-matched hits are kept whatever their score", () => {
    const hits = [hit("a", 0.3), hit("kw", 0.031)];
    expect(admitVectorOnly(hits, new Set(["kw"]), 0.05, 0.06).map((h) => h.id)).toEqual(["a", "kw"]);
  });

  test("the best is taken over every hit in the space, keyword-matched ones included", () => {
    const hits = [hit("kw", 0.3), hit("b", 0.2)];
    expect(admitVectorOnly(hits, new Set(["kw"]), 0.05, 0.06).map((h) => h.id)).toEqual(["kw"]);
  });

  test("empty in, empty out", () => {
    expect(admitVectorOnly([], none, 0.05, 0.06)).toEqual([]);
  });
});

describe("searchCaptures: vector-only hits", () => {
  const imageLow = MATCH_DISPLAY_BANDS.image[0];
  const textLow = MATCH_DISPLAY_BANDS.text[0];

  test("a junk query whose image cosines sit between the floor and the band returns no matches", async () => {
    const t = makeT();
    for (const c of [0.035, 0.04, 0.045, 0.048]) await imageRow(t, userA.subject, atCosine(c));
    const r = await t
      .withIdentity(userA)
      .action(api.search.searchCaptures, { query: "asdfgh", vector: axis(0), kinds: ["viewport"] });
    expect(r.results).toEqual([]);
    expect(r.diagnostics).toMatchObject({ imageCandidates: 4, vectorOnlyDropped: 4 });
  });

  test("image: only hits within imageRelativeMargin of the best survive", async () => {
    const t = makeT();
    const best = await imageRow(t, userA.subject, atCosine(0.2));
    const near = await imageRow(t, userA.subject, atCosine(0.2 - SEARCH_TUNING.imageRelativeMargin + 0.01));
    const far = await imageRow(t, userA.subject, atCosine(0.2 - SEARCH_TUNING.imageRelativeMargin - 0.01));
    const r = await t
      .withIdentity(userA)
      .action(api.search.searchCaptures, { query: "", vector: axis(0), kinds: ["viewport"] });
    expect(r.results.map((x) => x.id)).toEqual([best, near]);
    expect(r.results.map((x) => x.id)).not.toContain(far);
  });

  test("text: only hits within textRelativeMargin of the best survive", async () => {
    const t = makeT();
    const best = await textRow(t, userA.subject, atCosine(0.9));
    const near = await textRow(t, userA.subject, atCosine(0.9 - SEARCH_TUNING.textRelativeMargin + 0.01));
    const far = await textRow(t, userA.subject, atCosine(0.9 - SEARCH_TUNING.textRelativeMargin - 0.01));
    const r = await t
      .withIdentity(userA)
      .action(api.search.searchCaptures, { query: "", vector: axis(0), kinds: ["text"] });
    expect(r.results.map((x) => x.id)).toEqual([best, near]);
    expect(r.results.map((x) => x.id)).not.toContain(far);
  });

  test("text: hits at or below the band low are dropped, even the best one", async () => {
    const t = makeT();
    await textRow(t, userA.subject, atCosine(textLow));
    await textRow(t, userA.subject, atCosine(textLow - 0.01));
    const r = await t
      .withIdentity(userA)
      .action(api.search.searchCaptures, { query: "", vector: axis(0), kinds: ["text"] });
    expect(r.results).toEqual([]);
  });

  test("a keyword match keeps its weak vector source; a vector-only row as weak is dropped", async () => {
    const t = makeT();
    const kw = await imageRow(t, userA.subject, atCosine(imageLow - 0.01), "pricing");
    const vecOnly = await imageRow(t, userA.subject, atCosine(imageLow - 0.01));
    const r = await t
      .withIdentity(userA)
      .action(api.search.searchCaptures, { query: "pricing", vector: axis(0), kinds: ["viewport"] });
    expect(r.results.map((x) => x.id)).toEqual([kw]);
    expect(r.results[0]!.sources.image).toBeDefined();
    expect(r.results[0]!.sources.keyword).toBeDefined();
    expect(r.results.map((x) => x.id)).not.toContain(vecOnly);
  });
});

describe("searchCaptures: cross-user isolation in vector search", () => {
  test("image index: B never sees A's identical vectors, and the index filter (not a post-filter) does it", async () => {
    const t = makeT();
    const a1 = await imageRow(t, userA.subject, axis(0));
    const a2 = await imageRow(t, userA.subject, axis(0));
    const b1 = await imageRow(t, userB.subject, axis(0));

    const asB = await t
      .withIdentity(userB)
      .action(api.search.searchCaptures, { query: "", vector: axis(0), kinds: ["viewport"] });
    expect(asB.results.map((x) => x.id)).toEqual([b1]);
    // Only B's rows were candidates: A's never left the index.
    expect(asB.diagnostics).toMatchObject({ imageCandidates: 1 });

    const asA = await t
      .withIdentity(userA)
      .action(api.search.searchCaptures, { query: "", vector: axis(0), kinds: ["viewport"] });
    expect(asA.results.map((x) => x.id).sort()).toEqual([a1, a2].sort());
    expect(asA.diagnostics).toMatchObject({ imageCandidates: 2 });
  });

  test("text index via the `vector` fallback (no textVector): B never sees A's rows", async () => {
    const t = makeT();
    const a1 = await textRow(t, userA.subject, axis(3), "alpha secret");
    const b1 = await textRow(t, userB.subject, axis(3), "beta");
    const asB = await t
      .withIdentity(userB)
      .action(api.search.searchCaptures, { query: "", vector: axis(3), kinds: ["text"] });
    expect(asB.results.map((x) => x.id)).toEqual([b1]);
    expect(asB.results.map((x) => x.id)).not.toContain(a1);
    expect(asB.diagnostics).toMatchObject({ textCandidates: 1 });
  });

  test("text index via an explicit textVector: B never sees A's rows", async () => {
    const t = makeT();
    const a1 = await textRow(t, userA.subject, axis(4));
    const asB = await t
      .withIdentity(userB)
      .action(api.search.searchCaptures, { query: "", textVector: axis(4), kinds: ["text"] });
    expect(asB.results).toEqual([]);
    expect(asB.results.map((x) => x.id)).not.toContain(a1);
    expect(asB.diagnostics).toMatchObject({ textCandidates: 0 });
  });

  test("B with A's exact vector and A's keywords gets nothing of A's (hybrid path)", async () => {
    const t = makeT();
    const a1 = await textRow(t, userA.subject, axis(5), "zanzibar quarterly pricing confidentialmarker");
    const r = await t.withIdentity(userB).action(api.search.searchCaptures, {
      query: "zanzibar quarterly pricing",
      vector: axis(5),
      kinds: ["text"],
    });
    expect(r.results).toEqual([]);
    expect(r.diagnostics).toMatchObject({ textCandidates: 0, keywordHits: 0 });
    expect(JSON.stringify(r)).not.toContain(a1);
    // Diagnostics echo B's own query terms; A's other words must not appear.
    expect(JSON.stringify(r)).not.toContain("confidentialmarker");
  });

  test("results never include another user's ids in `sources` or diagnostics", async () => {
    const t = makeT();
    const ids: Id<"captures">[] = [];
    for (let i = 0; i < 5; i++) ids.push(await imageRow(t, userA.subject, atCosine(0.9 - i * 0.1)));
    const mine = await imageRow(t, userB.subject, atCosine(0.2));
    const r = await t
      .withIdentity(userB)
      .action(api.search.searchCaptures, { query: "", vector: axis(0), kinds: ["viewport"] });
    expect(r.results.map((x) => x.id)).toEqual([mine]);
    const dump = JSON.stringify(r);
    for (const id of ids) expect(dump).not.toContain(id);
    // B's top score is its own row's cosine, not A's better-matching 0.9.
    expect((r.diagnostics as any).topImageScores).toEqual([0.2]);
  });
});
