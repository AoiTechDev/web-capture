/**
 * searchCaptures paging that holds still: the cursor's snapshot keeps
 * captures added after page 1 out of later pages, its mode is kept, a blank
 * query drops a search cursor and browses; and session-scoped vector
 * search, so a session's best match is found however many better ones the
 * rest of the library has.
 */
import { describe, expect, test } from "vitest";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { CANDIDATE_CAP } from "../convex/search_scope";
import { decodeSearchCursor, encodeSearchCursor } from "../convex/lib/search_filters";
import { makeT, userA, userB, type T } from "./fixtures";
import { addCapture, addSession, atCosine, axis, creationTime } from "./filter_fixtures";

type Args = Record<string, unknown>;

const search = (t: T, args: Args, who = userA) =>
  t.withIdentity(who).action(api.search.searchCaptures, { query: "alpha", ...args } as any);
const ids = (r: { results: Array<{ id: string }> }) => r.results.map((x) => x.id);

describe("search cursors: snapshot and mode", () => {
  test("captures added between pages never shift the list: no repeats, no gaps", async () => {
    const t = makeT();
    const all: Id<"captures">[] = [];
    for (let i = 0; i < 5; i++) all.push(await addCapture(t, userA.subject, { title: "alpha" }));
    const p1 = await search(t, { limit: 2 });
    const c1 = decodeSearchCursor(p1.cursor!);
    expect(c1).toEqual({ offset: 2, snapshot: await creationTime(t, all[4]!), mode: "index" });

    // Equal keyword scores rank newest first, so without the snapshot these
    // would push page 1's captures onto page 2.
    for (let i = 0; i < 3; i++) await addCapture(t, userA.subject, { title: "alpha" });
    const p2 = await search(t, { limit: 2, cursor: p1.cursor });
    const p3 = await search(t, { limit: 2, cursor: p2.cursor });
    expect(p3).toMatchObject({ isDone: true, cursor: null });
    expect([...ids(p1), ...ids(p2), ...ids(p3)]).toEqual([...all].reverse());
    expect(decodeSearchCursor(p2.cursor!).snapshot).toBe(c1.snapshot);
  });

  test("the snapshot also bounds exact mode", async () => {
    const t = makeT();
    const s = await addSession(t, userA.subject);
    const first: Id<"captures">[] = [];
    for (let i = 0; i < 3; i++) first.push(await addCapture(t, userA.subject, { title: "alpha", sessionId: s }));
    const p1 = await search(t, { sessionId: s, limit: 2 });
    expect(decodeSearchCursor(p1.cursor!).mode).toBe("exact");
    await addCapture(t, userA.subject, { title: "alpha", sessionId: s });
    const p2 = await search(t, { sessionId: s, limit: 2, cursor: p1.cursor });
    expect(p2).toMatchObject({ isDone: true, cursor: null });
    expect([...ids(p1), ...ids(p2)]).toEqual([...first].reverse());
    expect(p2.diagnostics).toMatchObject({ mode: "exact" });
  });

  test("later pages keep the cursor's mode, whichever the filters would pick now", async () => {
    const t = makeT();
    const s = await addSession(t, userA.subject);
    for (let i = 0; i < 4; i++) await addCapture(t, userA.subject, { title: "alpha", sessionId: s });
    const snapshot = Date.now() + 1e6;
    const asIndex = await search(t, {
      sessionId: s,
      limit: 2,
      cursor: encodeSearchCursor({ offset: 2, snapshot, mode: "index" }),
    });
    expect(asIndex.diagnostics).toMatchObject({ mode: "index" });
    expect(asIndex.results).toHaveLength(2);
    expect(asIndex.cursor).toBeNull();

    // An exact cursor on a filter that no longer allows exact ranking falls
    // back to the indexes and says so.
    await addCapture(t, userA.subject, { title: "alpha" });
    const unfiltered = await search(t, { cursor: encodeSearchCursor({ offset: 0, snapshot, mode: "exact" }) });
    expect(unfiltered.diagnostics).toMatchObject({ mode: "index", modeChanged: true });
    expect(unfiltered.results).toHaveLength(5);
  });

  test("a blank query with a search cursor browses from the top instead of failing", async () => {
    const t = makeT();
    for (let i = 0; i < 3; i++) await addCapture(t, userA.subject, { title: "alpha" });
    const p1 = await search(t, { limit: 2 });
    const browsed = await search(t, { query: "  ", limit: 2, cursor: p1.cursor });
    const top = await t.withIdentity(userA).query(api.browse.browseCaptures, { limit: 2 });
    expect(browsed.diagnostics).toEqual({ mode: "browse" });
    expect(ids(browsed)).toEqual(top.results.map((x) => x.id));
    expect(browsed.cursor).toBe(top.cursor);
  });
});

describe("session-scoped vector search", () => {
  test("a session's match is found below the user's top hits elsewhere", async () => {
    const t = makeT();
    const s = await addSession(t, userA.subject);
    await t.run(async (ctx) => {
      const storageId = await ctx.storage.store(new Blob(["x"]));
      const shot = { kind: "viewport" as const, storageId, width: 1, height: 1, url: "u", timestamp: 1, userId: userA.subject };
      // Better matches outside the session than the index returns at once.
      for (let i = 0; i < 300; i++) await ctx.db.insert("captures", { ...shot, localEmbedding: axis(0) });
      // More session captures than exact ranking takes, none matching.
      for (let i = 0; i < CANDIDATE_CAP; i++) {
        await ctx.db.insert("captures", { ...shot, sessionId: s, localEmbedding: axis(5) });
      }
    });
    const target = await addCapture(t, userA.subject, { sessionId: s, localEmbedding: atCosine(0.5) });

    const r = await search(t, { query: "", vector: axis(0), kinds: ["viewport"], sessionId: s });
    expect(r.diagnostics).toMatchObject({ mode: "index", candidates: null });
    expect(ids(r)).toEqual([target]);
  });

  test("another user's session reveals nothing through the vector path, not even counts", async () => {
    const t = makeT();
    const sA = await addSession(t, userA.subject);
    await addCapture(t, userA.subject, { sessionId: sA, localEmbedding: axis(0) });
    const gone = await addSession(t, userB.subject);
    await t.run((ctx) => ctx.db.delete(gone));
    const cursor = encodeSearchCursor({ offset: 0, snapshot: Date.now() + 1e6, mode: "index" });
    const args = { query: "", vector: axis(0), kinds: ["viewport"], cursor };
    const foreign = await search(t, { ...args, sessionId: sA }, userB);
    const missing = await search(t, { ...args, sessionId: gone }, userB);
    expect(foreign).toEqual({ results: [], cursor: null, isDone: true, diagnostics: { mode: "index" } });
    expect(missing).toEqual(foreign);
  });
});
