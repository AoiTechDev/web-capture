/**
 * Re-indexing captures whose vector is stale: a size other than
 * LOCAL_EMBEDDING_DIM, i.e. embedded by the earlier 512-d CLIP model.
 */
import { describe, expect, test } from "vitest";
import { api } from "../convex/_generated/api";
import { backfillStats, makeT, userA, userB, vec, DIM } from "./fixtures";

describe("local_ai re-index of stale (wrong-size) vectors", () => {
  /** A `ready` capture of `userId`'s with a vector of `n` dimensions. */
  async function readyRow(t: ReturnType<typeof makeT>, n: number, kind: "viewport" | "text", userId = userA.subject) {
    return await t.run(async (ctx) =>
      ctx.db.insert("captures", {
        ...(kind === "viewport"
          ? { kind, storageId: await ctx.storage.store(new Blob(["x"])), width: 1, height: 1, localEmbedding: vec(n) }
          : { kind, content: "c", textEmbedding: vec(n) }),
        url: "u",
        timestamp: 1,
        userId,
        status: "ready",
      } as any)
    );
  }

  test("512-d ready rows are requeued with the stale vector unset; 768-d ones are left alone", async () => {
    const t = makeT();
    const oldShot = await readyRow(t, 512, "viewport");
    const oldText = await readyRow(t, 512, "text");
    const current = await readyRow(t, DIM, "viewport");
    const asA = t.withIdentity(userA);

    expect((await asA.query(api.local_ai.listNeedingEmbedding, {})).remaining).toBe(2);
    const res = await asA.mutation(api.local_ai.requeueUnindexed, {});
    expect(res).toMatchObject({ requeued: 2, remaining: 0, capped: false, readyCursor: null });

    const [shot, text, cur] = await t.run(async (ctx) =>
      Promise.all([ctx.db.get(oldShot), ctx.db.get(oldText), ctx.db.get(current)])
    );
    expect(shot).toMatchObject({ status: "pending", aiAttempts: 0 });
    expect((shot as any).localEmbedding).toBeUndefined();
    expect(text).toMatchObject({ status: "pending", aiAttempts: 0 });
    expect((text as any).textEmbedding).toBeUndefined();
    expect(cur!.status).toBe("ready");
    expect((cur as any).localEmbedding).toHaveLength(DIM);
    expect((await asA.mutation(api.local_ai.requeueUnindexed, {})).requeued).toBe(0);
  });

  test("embeddingStats counts a 512-d vector as no embedding", async () => {
    const t = makeT();
    await readyRow(t, 512, "viewport");
    await readyRow(t, DIM, "viewport");
    await readyRow(t, 512, "text");
    await backfillStats(t);
    const stats = await t.withIdentity(userA).query(api.local_ai.embeddingStats, {});
    expect(stats).toMatchObject({ total: 3, withLocalEmbedding: 1, searchable: 1 });
    expect(stats.byKind).toEqual({
      viewport: { total: 2, withLocalEmbedding: 1 },
      text: { total: 1, withLocalEmbedding: 0 },
    });
  });

  test("another user's stale rows are never touched", async () => {
    const t = makeT();
    const theirs = await readyRow(t, 512, "viewport", userB.subject);
    expect((await t.withIdentity(userA).mutation(api.local_ai.requeueUnindexed, {})).requeued).toBe(0);
    const doc = await t.run((ctx) => ctx.db.get(theirs));
    expect(doc!.status).toBe("ready");
    expect((doc as any).localEmbedding).toHaveLength(512);
  });

  test("a batch smaller than the stale rows found keeps the ready cursor where it was", async () => {
    const t = makeT();
    for (let i = 0; i < 3; i++) await readyRow(t, 512, "text");
    const asA = t.withIdentity(userA);
    const first = await asA.mutation(api.local_ai.requeueUnindexed, { limit: 2 });
    expect(first).toMatchObject({ requeued: 2, remaining: 1, readyCursor: null });
    const second = await asA.mutation(api.local_ai.requeueUnindexed, { limit: 2, readyCursor: first.readyCursor });
    expect(second).toMatchObject({ requeued: 1, remaining: 0, readyCursor: null });
  });

  test("ready rows past the first page are reached by passing readyCursor back", async () => {
    const t = makeT();
    // One full page (400) of current rows, then a stale one behind it.
    await t.run(async (ctx) => {
      for (let i = 0; i < 400; i++) {
        await ctx.db.insert("captures", {
          kind: "text",
          content: `c${i}`,
          url: "u",
          timestamp: i,
          userId: userA.subject,
          status: "ready",
          textEmbedding: vec(DIM),
        });
      }
    });
    const stale = await readyRow(t, 512, "text");
    const asA = t.withIdentity(userA);

    const first = await asA.mutation(api.local_ai.requeueUnindexed, {});
    expect(first).toMatchObject({ requeued: 0, remaining: 0, capped: true });
    expect(first.readyCursor).toEqual(expect.any(String));
    const second = await asA.mutation(api.local_ai.requeueUnindexed, { readyCursor: first.readyCursor });
    expect(second).toMatchObject({ requeued: 1, remaining: 0, capped: false, readyCursor: null });
    expect((await t.run((ctx) => ctx.db.get(stale)))!.status).toBe("pending");
  });
});
