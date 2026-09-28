import { describe, expect, test } from "vitest";
import { api } from "../convex/_generated/api";
import { makeT, seedAB, userA, userB, vec } from "./fixtures";

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
          localEmbedding: vec(512),
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

describe("local_ai.patchLocalEmbedding", () => {
  test("rejects anonymous callers", async () => {
    const t = makeT();
    const { a } = await seedAB(t);
    await expect(
      t.mutation(api.local_ai.patchLocalEmbedding, { id: a.linkId, localEmbedding: vec(512) })
    ).rejects.toThrow(/Unauthorized/);
  });

  test.each([0, 384, 511, 513])("rejects length %i", async (n) => {
    const t = makeT();
    const { a } = await seedAB(t);
    await expect(
      t.withIdentity(userA).mutation(api.local_ai.patchLocalEmbedding, {
        id: a.linkId,
        localEmbedding: vec(n),
      })
    ).rejects.toThrow(/512/);
    expect((await t.run((ctx) => ctx.db.get(a.linkId)))!.localEmbedding).toBeUndefined();
  });

  test("patches the caller's own capture with 512 dims", async () => {
    const t = makeT();
    const { a } = await seedAB(t);
    await t.withIdentity(userA).mutation(api.local_ai.patchLocalEmbedding, {
      id: a.linkId,
      localEmbedding: vec(512, 0.5),
    });
    expect((await t.run((ctx) => ctx.db.get(a.linkId)))!.localEmbedding).toHaveLength(512);
  });

  test("rejects another user's capture", async () => {
    const t = makeT();
    const { a } = await seedAB(t);
    await expect(
      t.withIdentity(userB).mutation(api.local_ai.patchLocalEmbedding, {
        id: a.linkId,
        localEmbedding: vec(512),
      })
    ).rejects.toThrow(/forbidden/);
  });
});

describe("local_ai.searchIndexed", () => {
  test("anonymous gets no results", async () => {
    const t = makeT();
    await seedAB(t);
    const r = await t.action(api.local_ai.searchIndexed, { vector: vec(512) });
    expect(r.results).toEqual([]);
  });

  test.each([0, 511, 513])("rejects a query vector of length %i", async (n) => {
    const t = makeT();
    await seedAB(t);
    await expect(
      t.withIdentity(userA).action(api.local_ai.searchIndexed, { vector: vec(n) })
    ).rejects.toThrow(/512/);
  });

  test("returns only the caller's captures", async () => {
    // convex-test's in-memory vectorSearch crashes on rows lacking the vector
    // field (harness limitation), so this test seeds only embedded rows.
    const t = makeT();
    const [a, b] = await t.run(async (ctx) => {
      const mk = (userId: string) =>
        ctx.db.insert("captures", {
          kind: "text",
          content: userId,
          url: "u",
          timestamp: 1,
          userId,
          localEmbedding: vec(512),
        });
      return [await mk(userA.subject), await mk(userB.subject)];
    });
    const r = await t
      .withIdentity(userA)
      .action(api.local_ai.searchIndexed, { vector: vec(512), minScore: -1 });
    const ids = r.results.map((x: any) => String(x.id));
    expect(ids).toEqual([String(a)]);
    expect(ids).not.toContain(String(b));
  });
});
