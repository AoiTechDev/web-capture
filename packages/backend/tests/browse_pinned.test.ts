/**
 * browse.browseCaptures pinned pages (`endCursor`): a page re-run after an
 * insert or delete grows or shrinks in place, and the pages after it
 * neither skip nor repeat; `splitCursor` when a pinned range is too long to
 * examine at once; and the one browse order both sources share.
 */
import { describe, expect, test } from "vitest";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { browseOrder, comparePosition, inBrowseOrder, MAX_BROWSE_SCAN } from "../convex/browse";
import { createReadBudget } from "../convex/lib/read_budget";
import { makeT, userA, type T } from "./fixtures";
import { addCapture, addColor } from "./filter_fixtures";

type Args = Record<string, unknown>;

const browse = (t: T, args: Args = {}) => t.withIdentity(userA).query(api.browse.browseCaptures, args as any);

/**
 * Load pages as the dashboard does the first time: each from the previous
 * page's cursor. Returns the page bounds to pin them by.
 */
async function firstLoad(t: T, args: Args, pages: number) {
  const bounds: Array<{ cursor?: string; endCursor?: string }> = [];
  let cursor: string | undefined;
  for (let i = 0; i < pages; i++) {
    const r = await browse(t, { ...args, ...(cursor ? { cursor } : {}) });
    bounds.push({ ...(cursor ? { cursor } : {}), ...(r.cursor ? { endCursor: r.cursor } : {}) });
    if (!r.cursor) break;
    cursor = r.cursor;
  }
  return bounds;
}

/** Re-run every page with its pinned bounds, as the live subscriptions would. */
async function rerun(t: T, args: Args, bounds: Array<{ cursor?: string; endCursor?: string }>) {
  const pages: Id<"captures">[][] = [];
  for (const b of bounds) {
    const r = await browse(t, { ...args, ...b });
    expect(r.splitCursor).toBeUndefined();
    if (b.endCursor) expect(r).toMatchObject({ cursor: b.endCursor, isDone: false });
    pages.push(r.results.map((x) => x.id));
  }
  return pages;
}

async function newestFirst(t: T, n: number) {
  const ids: Id<"captures">[] = [];
  for (let i = 0; i < n; i++) ids.push(await addCapture(t, userA.subject));
  return ids.reverse();
}

describe("browse: pinned pages", () => {
  test("an insert lands in page 1 and shifts nothing after it", async () => {
    const t = makeT();
    const ids = await newestFirst(t, 7);
    const bounds = await firstLoad(t, { limit: 2 }, 4);
    expect(bounds).toHaveLength(4);
    expect(bounds[3]!.endCursor).toBeUndefined(); // the last page stays unpinned

    const fresh = await addCapture(t, userA.subject);
    const pages = await rerun(t, { limit: 2 }, bounds);
    expect(pages).toEqual([[fresh, ids[0], ids[1]], [ids[2], ids[3]], [ids[4], ids[5]], [ids[6]]]);
  });

  test("deletes shrink their page in place, including the capture a cursor names", async () => {
    const t = makeT();
    const ids = await newestFirst(t, 7);
    const bounds = await firstLoad(t, { limit: 2 }, 4);
    // ids[1] is page 1's last capture, so its position is page 2's cursor.
    await t.run(async (ctx) => {
      await ctx.db.delete(ids[1]!);
      await ctx.db.delete(ids[4]!);
    });
    const pages = await rerun(t, { limit: 2 }, bounds);
    expect(pages).toEqual([[ids[0]], [ids[2], ids[3]], [ids[5]], [ids[6]]]);
    expect(pages.flat()).toEqual(ids.filter((_, i) => i !== 1 && i !== 4));
  });

  test("pinned pages ignore limit and keep the filters", async () => {
    const t = makeT();
    const reds: Id<"captures">[] = [];
    for (let i = 0; i < 6; i++) {
      const id = await addCapture(t, userA.subject);
      await addColor(t, id, userA.subject, "#ff0000");
      reds.unshift(id);
      await addCapture(t, userA.subject);
    }
    const args = { color: "#ff0000", limit: 2 };
    const bounds = await firstLoad(t, args, 3);
    for (let i = 0; i < 3; i++) {
      const id = await addCapture(t, userA.subject);
      await addColor(t, id, userA.subject, "#ff0000");
      reds.unshift(id);
    }
    const pages = await rerun(t, args, bounds);
    expect(pages[0]).toHaveLength(5);
    expect(pages.flat()).toEqual(reds);
  });

  test(`a pinned range longer than MAX_BROWSE_SCAN (${MAX_BROWSE_SCAN}) asks to be split, and the halves cover it`, async () => {
    const t = makeT();
    const old = await newestFirst(t, 3);
    const p1 = await browse(t, { kinds: ["viewport"], limit: 2 });
    expect(p1.results.map((x) => x.id)).toEqual([old[0], old[1]]);
    await t.run(async (ctx) => {
      for (let i = 0; i < MAX_BROWSE_SCAN + 10; i++) {
        await ctx.db.insert("captures", { kind: "link", href: "h", url: "u", timestamp: 1, userId: userA.subject });
      }
    });
    const fresh = await addCapture(t, userA.subject);

    const pinned = await browse(t, { kinds: ["viewport"], endCursor: p1.cursor });
    expect(pinned.splitCursor).toEqual(expect.any(String));
    expect(pinned.cursor).toBe(p1.cursor);
    expect(pinned.results.map((x) => x.id)).toEqual([fresh]);

    const head = await browse(t, { kinds: ["viewport"], endCursor: pinned.splitCursor });
    const tail = await browse(t, { kinds: ["viewport"], cursor: pinned.splitCursor, endCursor: p1.cursor });
    expect(head.splitCursor).toBeUndefined();
    expect(tail.splitCursor).toBeUndefined();
    expect([...head.results, ...tail.results].map((x) => x.id)).toEqual([fresh, old[0], old[1]]);
  });

  test("endCursor must come after cursor", async () => {
    const t = makeT();
    await newestFirst(t, 5);
    const p1 = await browse(t, { limit: 2 });
    const p2 = await browse(t, { limit: 2, cursor: p1.cursor });
    await expect(browse(t, { cursor: p2.cursor, endCursor: p1.cursor })).rejects.toThrow(/Invalid cursor/);
    await expect(browse(t, { cursor: p1.cursor, endCursor: p1.cursor })).rejects.toThrow(/Invalid cursor/);
    await expect(browse(t, { endCursor: "s|1|2|index" })).rejects.toThrow(/Invalid cursor/);
  });
});

describe("browse order", () => {
  const doc = (t: number, id: string) => ({ _creationTime: t, _id: id }) as any;

  test("newest first; equal creation times by id, larger first", () => {
    const docs = [doc(1, "b"), doc(2, "a"), doc(1, "c"), doc(2, "z"), doc(1, "a")];
    expect(docs.sort(browseOrder).map((d) => `${d._creationTime}${d._id}`)).toEqual(["2z", "2a", "1c", "1b", "1a"]);
    expect(comparePosition(doc(1, "c"), { t: 1, id: "b" })).toBeLessThan(0);
    expect(comparePosition(doc(1, "a"), { t: 1, id: "b" })).toBeGreaterThan(0);
    expect(comparePosition(doc(1, "b"), { t: 1, id: "b" })).toBe(0);
    expect(comparePosition(doc(3, "a"), { t: 1, id: "z" })).toBeLessThan(0);
  });

  test("the index scan's ties are re-sorted into the same order the in-memory path uses", async () => {
    // An index returns equal creation times in its own id order; browse
    // must not depend on it.
    const scan = [doc(5, "a"), doc(4, "a"), doc(4, "c"), doc(4, "b"), doc(3, "x"), doc(2, "a"), doc(2, "b")];
    async function* source() {
      yield* scan;
    }
    const budget = createReadBudget();
    const out: any[] = [];
    for await (const d of inBrowseOrder(source(), budget)) out.push(d);
    expect(out).toEqual([...scan].sort(browseOrder));
    expect(budget.used).toBeGreaterThan(0);
  });
});
