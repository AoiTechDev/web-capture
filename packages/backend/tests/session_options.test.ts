/**
 * The session pickers' queries: sessions.getSessionOption checks one id from
 * a URL; sessions.listSessionOptions pages through every session.
 */
import { describe, expect, test } from "vitest";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { makeT, seedAB, userA, userB, type T } from "./fixtures";

async function sessions(t: T, n: number, userId = userA.subject) {
  return await t.run(async (ctx) => {
    const ids: Id<"sessions">[] = [];
    for (let i = 0; i < n; i++) {
      ids.push(
        await ctx.db.insert("sessions", {
          userId,
          name: `S${i}`,
          startedAt: 1000 + i,
          lastCaptureAt: 1000 + i,
          endedAt: 2000 + i,
          itemCount: 0,
        })
      );
    }
    return ids;
  });
}

describe("sessions.getSessionOption", () => {
  test("returns the caller's session", async () => {
    const t = makeT();
    const { a } = await seedAB(t);
    expect(await t.withIdentity(userA).query(api.sessions.getSessionOption, { id: a.sessionId })).toEqual({
      id: a.sessionId,
      displayName: "Untitled session",
      startedAt: 1,
      running: true,
    });
  });

  test("null for another user's, a deleted one, an id of another table and garbage", async () => {
    const t = makeT();
    const { a, b } = await seedAB(t);
    const [gone] = await sessions(t, 1);
    await t.run((ctx) => ctx.db.delete(gone!));
    const asA = t.withIdentity(userA);
    for (const id of [b.sessionId, gone!, a.linkId, "not-an-id", ""]) {
      expect(await asA.query(api.sessions.getSessionOption, { id })).toBeNull();
    }
    expect(await t.query(api.sessions.getSessionOption, { id: a.sessionId })).toBeNull();
  });
});

describe("sessions.listSessionOptions", () => {
  test("pages through every session, newest first, the caller's only", async () => {
    const t = makeT();
    const ids = await sessions(t, 130);
    await sessions(t, 5, userB.subject);
    const asA = t.withIdentity(userA);

    const seen: string[] = [];
    let cursor: string | null = null;
    for (;;) {
      const page: any = await asA.query(api.sessions.listSessionOptions, { paginationOpts: { numItems: 50, cursor } });
      seen.push(...page.page.map((s: any) => s.id));
      if (page.isDone) break;
      cursor = page.continueCursor;
    }
    expect(seen).toEqual([...ids].reverse());
  });

  test("a page holds at most 100", async () => {
    const t = makeT();
    await sessions(t, 120);
    const page = await t
      .withIdentity(userA)
      .query(api.sessions.listSessionOptions, { paginationOpts: { numItems: 1000, cursor: null } });
    expect(page.page).toHaveLength(100);
    expect(page.isDone).toBe(false);
    expect(page.page[0]).toMatchObject({ displayName: "S119", running: false });
  });
});
