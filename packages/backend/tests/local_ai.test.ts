import { afterEach, describe, expect, test, vi } from "vitest";
import { api } from "../convex/_generated/api";
import { AI_STALE_PROCESSING_MS } from "../convex/lib/ai_config";
import { makeT, seedAB, userA, userB, vec, DIM } from "./fixtures";

describe("local_ai.embeddingStats", () => {
  test("rejects anonymous callers", async () => {
    const t = makeT();
    await seedAB(t);
    await expect(t.query(api.local_ai.embeddingStats, {})).rejects.toThrow(/Unauthorized/);
  });

  test("takes no userId argument", async () => {
    const t = makeT();
    await seedAB(t);
    await expect(
      t.withIdentity(userA).query(api.local_ai.embeddingStats, { userId: userB.subject } as any)
    ).rejects.toThrow();
  });

  test("reports only the caller's own captures", async () => {
    const t = makeT();
    await seedAB(t);
    // Extra captures for B only; A's numbers must not move.
    await t.run(async (ctx) => {
      for (let i = 0; i < 3; i++) {
        await ctx.db.insert("captures", {
          kind: "text",
          content: "b",
          url: "u",
          timestamp: i,
          userId: userB.subject,
          textEmbedding: vec(DIM),
        });
      }
    });
    const a = await t.withIdentity(userA).query(api.local_ai.embeddingStats, {});
    expect(a.total).toBe(2);
    expect(a.withLocalEmbedding).toBe(1);
    expect(a.byKind).toEqual({
      link: { total: 1, withLocalEmbedding: 0 },
      screenshot: { total: 1, withLocalEmbedding: 1 },
    });
    const b = await t.withIdentity(userB).query(api.local_ai.embeddingStats, {});
    expect(b.total).toBe(5);
    expect(b.withLocalEmbedding).toBe(4);
  });
});


/** Put one of A's seeded captures back in the queue and claim it as A; returns the claim token. */
async function claimAs(t: ReturnType<typeof makeT>, id: any): Promise<string> {
  await t.run((ctx) => ctx.db.patch(id, { status: "pending", aiAttempts: 0 }));
  const res = await t.withIdentity(userA).mutation(api.local_ai.claimCapture, { id });
  expect(res.claimed).toBe(true);
  return res.claim!;
}

const STALE_MS = AI_STALE_PROCESSING_MS;

describe("local_ai processing queue", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test("lists only the caller's pending captures", async () => {
    const t = makeT();
    const { a, b } = await seedAB(t);
    await t.run(async (ctx) => {
      await ctx.db.patch(a.linkId, { status: "pending" });
      await ctx.db.patch(b.linkId, { status: "pending" });
    });
    const res = await t.withIdentity(userA).query(api.local_ai.listPendingCaptures, {});
    expect(res.items.map((i) => i.id)).toEqual([a.linkId]);
    expect((await t.query(api.local_ai.listPendingCaptures, {})).items).toEqual([]);
  });

  test("a capture can be claimed once, and returns its payload and a token", async () => {
    const t = makeT();
    const { a } = await seedAB(t);
    await t.run((ctx) => ctx.db.patch(a.shotId, { status: "pending" }));
    const first = await t.withIdentity(userA).mutation(api.local_ai.claimCapture, { id: a.shotId });
    expect(first.claimed).toBe(true);
    expect(typeof first.claim).toBe("string");
    expect(first.item).toMatchObject({ kind: "screenshot", visual: true });
    expect(typeof first.item!.imageUrl).toBe("string");
    const second = await t.withIdentity(userA).mutation(api.local_ai.claimCapture, { id: a.shotId });
    expect(second.claimed).toBe(false);
    const doc = await t.run((ctx) => ctx.db.get(a.shotId));
    expect(doc).toMatchObject({ status: "processing", aiAttempts: 1, aiClaim: first.claim });
  });

  test("another user cannot claim, complete, fail or retry", async () => {
    const t = makeT();
    const { a } = await seedAB(t);
    const claim = await claimAs(t, a.linkId);
    const asB = t.withIdentity(userB);
    await expect(asB.mutation(api.local_ai.claimCapture, { id: a.linkId })).rejects.toThrow(/forbidden/);
    await expect(
      asB.mutation(api.local_ai.completeProcessing, { id: a.linkId, claim, textEmbedding: vec(DIM) })
    ).rejects.toThrow(/forbidden/);
    await expect(asB.mutation(api.local_ai.failProcessing, { id: a.linkId, claim, error: "x" })).rejects.toThrow(
      /forbidden/
    );
    await expect(asB.mutation(api.local_ai.retryProcessing, { captureId: a.linkId })).rejects.toThrow(/forbidden/);
  });

  test.each([0, 512, 767, 769])("complete rejects an embedding of length %i", async (n) => {
    const t = makeT();
    const { a } = await seedAB(t);
    const claim = await claimAs(t, a.linkId);
    await expect(
      t.withIdentity(userA).mutation(api.local_ai.completeProcessing, { id: a.linkId, claim, textEmbedding: vec(n) })
    ).rejects.toThrow(/768/);
  });

  test.each([Number.NaN, Number.POSITIVE_INFINITY])("complete rejects a %s component", async (bad) => {
    const t = makeT();
    const { a } = await seedAB(t);
    const claim = await claimAs(t, a.linkId);
    const textEmbedding = vec(DIM);
    textEmbedding[7] = bad;
    await expect(
      t.withIdentity(userA).mutation(api.local_ai.completeProcessing, { id: a.linkId, claim, textEmbedding })
    ).rejects.toThrow(/finite/);
  });

  test("complete stores each kind in its own embedding space and refreshes searchText", async () => {
    const t = makeT();
    const { a } = await seedAB(t);
    const asA = t.withIdentity(userA);
    const linkClaim = await claimAs(t, a.linkId);
    await expect(
      asA.mutation(api.local_ai.completeProcessing, { id: a.linkId, claim: linkClaim, localEmbedding: vec(DIM) })
    ).rejects.toThrow(/textEmbedding/);
    await asA.mutation(api.local_ai.completeProcessing, { id: a.linkId, claim: linkClaim, textEmbedding: vec(DIM) });
    const shotClaim = await claimAs(t, a.shotId);
    await asA.mutation(api.local_ai.completeProcessing, {
      id: a.shotId,
      claim: shotClaim,
      localEmbedding: vec(DIM, 0.3),
      aiCategory: "pricing",
      aiStyle: ["Dark", "dark", "minimal"],
      aiTags: ["Landing Page"],
    });
    const link = (await t.run((ctx) => ctx.db.get(a.linkId))) as any;
    const shot = (await t.run((ctx) => ctx.db.get(a.shotId))) as any;
    expect(link).toMatchObject({ status: "ready" });
    expect(link.textEmbedding).toHaveLength(DIM);
    expect(link.localEmbedding).toBeUndefined();
    expect(link.aiClaim).toBeUndefined();
    expect(shot).toMatchObject({
      status: "ready",
      aiCategory: "pricing",
      aiStyle: ["dark", "minimal"],
      aiTags: ["landing page"],
    });
    expect(shot.searchText.split(" ")).toEqual(expect.arrayContaining(["pricing", "dark", "landing", "page"]));
  });

  test("a failure is retried once, then marked failed; retryProcessing re-queues", async () => {
    const t = makeT();
    const { a } = await seedAB(t);
    const asA = t.withIdentity(userA);
    const first = await claimAs(t, a.linkId);
    expect(await asA.mutation(api.local_ai.failProcessing, { id: a.linkId, claim: first, error: "boom" })).toMatchObject(
      { retry: true }
    );
    expect((await t.run((ctx) => ctx.db.get(a.linkId)))!.status).toBe("pending");
    const second = (await asA.mutation(api.local_ai.claimCapture, { id: a.linkId })).claim!;
    expect(await asA.mutation(api.local_ai.failProcessing, { id: a.linkId, claim: second, error: "boom" })).toMatchObject(
      { retry: false }
    );
    expect(await t.run((ctx) => ctx.db.get(a.linkId))).toMatchObject({
      status: "failed",
      error: "boom",
      aiAttempts: 2,
    });

    await asA.mutation(api.local_ai.retryProcessing, { captureId: a.linkId });
    const doc = (await t.run((ctx) => ctx.db.get(a.linkId))) as any;
    expect(doc).toMatchObject({ status: "pending", aiAttempts: 0 });
    expect(doc.error).toBeUndefined();
  });

  test("a stale worker cannot complete or fail a capture claimed again since", async () => {
    const t = makeT();
    const { a } = await seedAB(t);
    const asA = t.withIdentity(userA);
    const old = await claimAs(t, a.linkId);
    // The claim is released (e.g. by the scheduled release) and claimed anew.
    await t.run((ctx) => ctx.db.patch(a.linkId, { status: "pending", aiClaim: undefined }));
    const fresh = (await asA.mutation(api.local_ai.claimCapture, { id: a.linkId })).claim!;
    expect(fresh).not.toBe(old);

    expect(
      await asA.mutation(api.local_ai.completeProcessing, { id: a.linkId, claim: old, textEmbedding: vec(DIM) })
    ).toMatchObject({ ok: false });
    expect(await asA.mutation(api.local_ai.failProcessing, { id: a.linkId, claim: old, error: "x" })).toMatchObject({
      ok: false,
    });
    const doc = (await t.run((ctx) => ctx.db.get(a.linkId))) as any;
    expect(doc).toMatchObject({ status: "processing", aiClaim: fresh });
    expect(doc.textEmbedding).toBeUndefined();
  });

  test("an abandoned claim is released by the scheduled release", async () => {
    vi.useFakeTimers();
    const t = makeT();
    const { a } = await seedAB(t);
    const claim = await claimAs(t, a.linkId);
    vi.advanceTimersByTime(STALE_MS + 1);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const doc = (await t.run((ctx) => ctx.db.get(a.linkId))) as any;
    expect(doc).toMatchObject({ status: "pending", error: "Processing was interrupted" });
    expect(doc.aiClaim).toBeUndefined();
    // The dead worker's late result is refused.
    expect(
      await t
        .withIdentity(userA)
        .mutation(api.local_ai.completeProcessing, { id: a.linkId, claim, textEmbedding: vec(DIM) })
    ).toMatchObject({ ok: false });
  });

  test("the scheduled release fails a capture whose attempts are used up", async () => {
    vi.useFakeTimers();
    const t = makeT();
    const { a } = await seedAB(t);
    await t.run((ctx) => ctx.db.patch(a.linkId, { status: "pending", aiAttempts: 1 }));
    await t.withIdentity(userA).mutation(api.local_ai.claimCapture, { id: a.linkId });
    vi.advanceTimersByTime(STALE_MS + 1);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await t.run((ctx) => ctx.db.get(a.linkId))).toMatchObject({ status: "failed", aiAttempts: 2 });
  });

  test("the scheduled release leaves a finished capture alone", async () => {
    vi.useFakeTimers();
    const t = makeT();
    const { a } = await seedAB(t);
    const claim = await claimAs(t, a.linkId);
    await t
      .withIdentity(userA)
      .mutation(api.local_ai.completeProcessing, { id: a.linkId, claim, textEmbedding: vec(DIM) });
    vi.advanceTimersByTime(STALE_MS + 1);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await t.run((ctx) => ctx.db.get(a.linkId))).toMatchObject({ status: "ready" });
  });

  test("retryProcessing takes back a stale processing claim, not a live one", async () => {
    const t = makeT();
    const { a } = await seedAB(t);
    const asA = t.withIdentity(userA);
    await t.run((ctx) =>
      ctx.db.patch(a.linkId, { status: "processing", aiAttempts: 1, aiStartedAt: Date.now(), aiClaim: "live" })
    );
    expect(await asA.mutation(api.local_ai.retryProcessing, { captureId: a.linkId })).toMatchObject({ queued: false });
    expect((await t.run((ctx) => ctx.db.get(a.linkId)))!.status).toBe("processing");

    await t.run((ctx) => ctx.db.patch(a.linkId, { aiStartedAt: Date.now() - STALE_MS - 1 }));
    expect(await asA.mutation(api.local_ai.retryProcessing, { captureId: a.linkId })).toMatchObject({ queued: true });
    const doc = (await t.run((ctx) => ctx.db.get(a.linkId))) as any;
    expect(doc).toMatchObject({ status: "pending", aiAttempts: 0 });
    expect(doc.aiClaim).toBeUndefined();
  });

  test("stale processing claims are released at worker start", async () => {
    const t = makeT();
    const { a } = await seedAB(t);
    await t.run((ctx) => ctx.db.patch(a.linkId, { status: "processing", aiAttempts: 1, aiStartedAt: 0 }));
    await t.run((ctx) => ctx.db.patch(a.shotId, { status: "processing", aiAttempts: 1, aiStartedAt: Date.now() }));
    const res = await t.withIdentity(userA).mutation(api.local_ai.recoverStaleProcessing, {});
    expect(res.recovered).toBe(1);
    expect((await t.run((ctx) => ctx.db.get(a.linkId)))!.status).toBe("pending");
    expect((await t.run((ctx) => ctx.db.get(a.shotId)))!.status).toBe("processing");
  });
});

describe("local_ai re-index (bounded)", () => {
  /** n text captures of A's in `status`, without embeddings. */
  async function seedUnindexed(t: ReturnType<typeof makeT>, n: number, status?: "failed" | "skipped" | "pending") {
    await t.run(async (ctx) => {
      for (let i = 0; i < n; i++) {
        await ctx.db.insert("captures", {
          kind: "text",
          content: `t${i}`,
          url: "u",
          timestamp: i,
          userId: userA.subject,
          ...(status ? { status } : {}),
        });
      }
    });
  }

  test("requeues in batches until nothing remains, skipping queued and embedded captures", async () => {
    const t = makeT();
    const { a } = await seedAB(t); // A: link (no status, no embedding) + shot (embedded)
    await seedUnindexed(t, 3, "failed");
    await seedUnindexed(t, 2, "skipped");
    await seedUnindexed(t, 4, "pending");
    const asA = t.withIdentity(userA);

    expect((await asA.query(api.local_ai.listNeedingEmbedding, {})).remaining).toBe(6);
    const first = await asA.mutation(api.local_ai.requeueUnindexed, { limit: 4 });
    expect(first).toMatchObject({ requeued: 4, remaining: 2, capped: false });
    const second = await asA.mutation(api.local_ai.requeueUnindexed, { limit: 4 });
    expect(second).toMatchObject({ requeued: 2, remaining: 0 });
    expect((await asA.mutation(api.local_ai.requeueUnindexed, { limit: 4 })).requeued).toBe(0);

    const pending = (await asA.query(api.local_ai.listPendingCaptures, { limit: 20 })).items;
    expect(pending).toHaveLength(10);
    expect((await t.run((ctx) => ctx.db.get(a.shotId)))!.status).toBeUndefined();
  });

  test("never touches another user's captures", async () => {
    const t = makeT();
    const { b } = await seedAB(t);
    await t.withIdentity(userA).mutation(api.local_ai.requeueUnindexed, {});
    expect((await t.run((ctx) => ctx.db.get(b.linkId)))!.status).toBeUndefined();
  });
});

describe("search.searchCaptures", () => {
  test("anonymous gets no results", async () => {
    const t = makeT();
    await seedAB(t);
    const r = await t.action(api.search.searchCaptures, { query: "link" });
    expect(r.results).toEqual([]);
  });

  test.each([0, 512, 767, 769])("rejects a query vector of length %i", async (n) => {
    const t = makeT();
    await seedAB(t);
    await expect(
      t.withIdentity(userA).action(api.search.searchCaptures, { query: "x", vector: vec(n) })
    ).rejects.toThrow(/768/);
  });

  test("keyword-only search returns only the caller's captures, with source info", async () => {
    const t = makeT();
    const { a } = await seedAB(t);
    const r = await t.withIdentity(userA).action(api.search.searchCaptures, { query: "link" });
    expect(r.results.map((x) => x.id)).toEqual([a.linkId]);
    expect(r.results[0]!.sources.keyword?.rank).toBe(1);
  });

  test("keyword search matches words, not substrings, and every term must match", async () => {
    const t = makeT();
    const asA = t.withIdentity(userA);
    const mk = (content: string) =>
      asA.mutation(api.upload.uploadCapture, { capture: { kind: "text", content, url: "https://p.example", timestamp: 1 } });
    const platform = await mk("a platform for teams");
    const forms = await mk("contact forms that convert");
    const both = await mk("dark pricing table");
    const ids = async (query: string) =>
      (await asA.action(api.search.searchCaptures, { query })).results.map((r) => r.id);
    expect(await ids("form")).toEqual([forms]);
    expect(await ids("platform")).toEqual([platform]);
    expect(await ids("dark pricing")).toEqual([both]);
    expect(await ids("dark forms")).toEqual([]);
  });

  test("searchText follows metadata and AI labels; filters by folder and aiCategory", async () => {
    const t = makeT();
    const { a } = await seedAB(t);
    const asA = t.withIdentity(userA);
    await asA.mutation(api.local_ai.applyAutoMetadata, { id: a.shotId, tags: ["inspiration"], domain: "dribbble.com" });
    await t.run((ctx) => ctx.db.patch(a.shotId, { status: "pending" }));
    const claim = (await asA.mutation(api.local_ai.claimCapture, { id: a.shotId })).claim!;
    await asA.mutation(api.local_ai.completeProcessing, {
      id: a.shotId,
      claim,
      localEmbedding: vec(DIM),
      aiCategory: "hero",
      aiTags: ["headline"],
    });

    const find = async (args: Record<string, unknown>) =>
      (await asA.action(api.search.searchCaptures, { query: "", ...args } as any)).results.map((r) => r.id);
    expect(await find({ query: "dribbble" })).toEqual([a.shotId]);
    expect(await find({ query: "inspiration headline" })).toEqual([a.shotId]);
    expect(await find({ query: "hero", aiCategory: "hero" })).toEqual([a.shotId]);
    expect(await find({ query: "hero", aiCategory: "pricing" })).toEqual([]);
    expect(await find({ query: "hero", folder: "unsorted" })).toEqual([a.shotId]);
    expect(await find({ query: "hero", folder: "work" })).toEqual([]);
    const [row] = (await asA.action(api.search.searchCaptures, { query: "hero" })).results;
    expect(row!.score).toBeNull(); // keyword-only: no cosine to show
  });

  // convex-test's in-memory vectorSearch crashes on any row lacking the
  // index's vector field (harness limitation), so each space is tested on a
  // table holding only rows embedded in that space, with `kinds` keeping the
  // other index out of the search.
  test("image vector hits come from the image index only", async () => {
    const t = makeT();
    const [mine, theirs] = await t.run(async (ctx) => {
      const mk = async (userId: string) =>
        ctx.db.insert("captures", {
          kind: "viewport",
          storageId: await ctx.storage.store(new Blob([userId])),
          width: 1,
          height: 1,
          url: "u",
          timestamp: 1,
          userId,
          localEmbedding: vec(DIM),
        });
      return [await mk(userA.subject), await mk(userB.subject)];
    });
    const asA = t.withIdentity(userA);
    const visual = await asA.action(api.search.searchCaptures, { query: "", vector: vec(DIM), kinds: ["viewport"] });
    expect(visual.results.map((x) => x.id)).toEqual([mine]);
    expect(visual.results.map((x) => x.id)).not.toContain(theirs);
    expect(Object.keys(visual.results[0]!.sources)).toEqual(["image"]);
    expect(visual.results[0]!.score).toBeCloseTo(1, 3);
  });

  test("score is a display match from the cosine bands, not the raw cosine", async () => {
    const t = makeT();
    const orthogonal = (i: number) => Array.from({ length: DIM }, (_, j) => (j === i ? 1 : 0));
    await t.run(async (ctx) =>
      ctx.db.insert("captures", {
        kind: "viewport",
        storageId: await ctx.storage.store(new Blob(["x"])),
        width: 1,
        height: 1,
        url: "u",
        timestamp: 1,
        userId: userA.subject,
        localEmbedding: orthogonal(0),
      })
    );
    // cosine 0.125 sits mid-way through the image band [0.05, 0.2].
    const q = orthogonal(0).map((x, j) => (j === 1 ? Math.sqrt(1 - 0.125 ** 2) : x * 0.125));
    const r = await t
      .withIdentity(userA)
      .action(api.search.searchCaptures, { query: "", vector: q, kinds: ["viewport"] });
    expect(r.results[0]!.sources.image!.score).toBeCloseTo(0.125, 3);
    expect(r.results[0]!.score).toBeCloseTo(0.5, 2);
  });

  test("text vector hits come from the text index only", async () => {
    const t = makeT();
    const [mine, theirs] = await t.run(async (ctx) => {
      const mk = (userId: string) =>
        ctx.db.insert("captures", {
          kind: "text",
          content: userId,
          url: "u",
          timestamp: 1,
          userId,
          textEmbedding: vec(DIM),
        });
      return [await mk(userA.subject), await mk(userB.subject)];
    });
    const r = await t
      .withIdentity(userA)
      .action(api.search.searchCaptures, { query: "", textVector: vec(DIM) });
    expect(r.results.map((x) => x.id)).toEqual([mine]);
    expect(r.results.map((x) => x.id)).not.toContain(theirs);
    expect(Object.keys(r.results[0]!.sources)).toEqual(["text"]);
    // Without a textVector, the one query vector is used for the text index too.
    const viaVector = await t
      .withIdentity(userA)
      .action(api.search.searchCaptures, { query: "", vector: vec(DIM), kinds: ["text"] });
    expect(viaVector.results.map((x) => x.id)).toEqual([mine]);
  });
});
