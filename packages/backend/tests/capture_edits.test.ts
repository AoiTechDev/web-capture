/**
 * Detail-view edits: captures.setCaptureTags (and keyword search staying in
 * step with it) and sessions.setCaptureSession (and the session counts).
 */
import { describe, expect, test } from "vitest";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { MAX_TAG_LENGTH, MAX_USER_TAGS, normalizeUserTags } from "../convex/captures";
import { makeT, userA, userB, type T } from "./fixtures";
import { addCapture, addSession } from "./filter_fixtures";

const doc = (t: T, id: Id<"captures">) => t.run((ctx) => ctx.db.get(id));
const session = (t: T, id: Id<"sessions">) => t.run((ctx) => ctx.db.get(id));
const find = async (t: T, query: string) =>
  (await t.withIdentity(userA).action(api.search.searchCaptures, { query })).results.map((r) => r.id);

describe("normalizeUserTags", () => {
  test("trims, lowercases, collapses spaces, drops empties and duplicates, keeps order", () => {
    expect(normalizeUserTags(["  Hero ", "hero", "Dark   Mode", "", "   ", "cta"])).toEqual(["hero", "dark mode", "cta"]);
  });

  test(`cuts tags to ${MAX_TAG_LENGTH} characters and keeps at most ${MAX_USER_TAGS}`, () => {
    expect(normalizeUserTags(["x".repeat(MAX_TAG_LENGTH + 20)])).toEqual(["x".repeat(MAX_TAG_LENGTH)]);
    const many = Array.from({ length: MAX_USER_TAGS + 5 }, (_, i) => `t${i}`);
    expect(normalizeUserTags(many)).toEqual(many.slice(0, MAX_USER_TAGS));
    // Duplicates do not use up the cap.
    expect(normalizeUserTags(["a", "a", "A", ...many]).length).toBe(MAX_USER_TAGS);
  });

  test("a tag that is only whitespace after cutting is dropped", () => {
    expect(normalizeUserTags([" ".repeat(10) + "x"])).toEqual(["x"]);
    expect(normalizeUserTags(["a" + " ".repeat(MAX_TAG_LENGTH)])).toEqual(["a"]);
  });
});

describe("captures.setCaptureTags", () => {
  test("stores the normalised list and returns it", async () => {
    const t = makeT();
    const id = await addCapture(t, userA.subject, { tags: ["old"] });
    const r = await t
      .withIdentity(userA)
      .mutation(api.captures.setCaptureTags, { captureId: id, tags: [" Moodboard ", "moodboard", "Hero"] });
    expect(r).toEqual({ tags: ["moodboard", "hero"] });
    expect((await doc(t, id))!.tags).toEqual(["moodboard", "hero"]);
  });

  test("keyword search follows the edit: new tags found, removed ones not, AI labels kept", async () => {
    const t = makeT();
    const id = await addCapture(t, userA.subject, { title: "landing", tags: ["oldtag"] });
    await t.run((ctx) => ctx.db.patch(id, { aiTags: ["gradient"] }));
    expect(await find(t, "oldtag")).toEqual([id]);

    await t.withIdentity(userA).mutation(api.captures.setCaptureTags, { captureId: id, tags: ["Zebra"] });
    expect(await find(t, "zebra")).toEqual([id]);
    expect(await find(t, "oldtag")).toEqual([]);
    expect(await find(t, "landing")).toEqual([id]);
    expect(await find(t, "gradient")).toEqual([id]);
    expect((await doc(t, id))!.aiTags).toEqual(["gradient"]);

    await t.withIdentity(userA).mutation(api.captures.setCaptureTags, { captureId: id, tags: [] });
    expect((await doc(t, id))!.tags).toEqual([]);
    expect(await find(t, "zebra")).toEqual([]);
  });

  test("tags new to the capture are counted once in the suggestions list", async () => {
    const t = makeT();
    const id = await addCapture(t, userA.subject, { tags: ["kept"] });
    const asA = t.withIdentity(userA);
    await asA.mutation(api.captures.setCaptureTags, { captureId: id, tags: ["kept", "fresh"] });
    await asA.mutation(api.captures.setCaptureTags, { captureId: id, tags: ["kept", "fresh"] });
    const tags = await asA.query(api.captures.listTags, {});
    expect(tags.map((x) => [x.name, x.useCount])).toEqual([["fresh", 1]]);
  });

  test(`refuses more than 100 entries at once`, async () => {
    const t = makeT();
    const id = await addCapture(t, userA.subject);
    const tags = Array.from({ length: 101 }, (_, i) => `t${i}`);
    await expect(
      t.withIdentity(userA).mutation(api.captures.setCaptureTags, { captureId: id, tags })
    ).rejects.toThrow(/more than 100/);
  });

  test("owner only: another user and anonymous callers are refused, the capture untouched", async () => {
    const t = makeT();
    const id = await addCapture(t, userA.subject, { tags: ["mine"] });
    const before = await doc(t, id);
    await expect(
      t.withIdentity(userB).mutation(api.captures.setCaptureTags, { captureId: id, tags: ["pwned"] })
    ).rejects.toThrow(/Not found or forbidden/);
    await expect(t.mutation(api.captures.setCaptureTags, { captureId: id, tags: ["pwned"] })).rejects.toThrow(
      /Unauthorized/
    );
    expect(await doc(t, id)).toEqual(before);
    expect(await t.run((ctx) => ctx.db.query("tags").collect())).toEqual([]);
  });
});

describe("sessions.setCaptureSession", () => {
  async function world(t: T) {
    const s1 = await addSession(t, userA.subject);
    const s2 = await addSession(t, userA.subject, "Named");
    const id = await addCapture(t, userA.subject, { tags: ["pricing"] });
    await t.run((ctx) => ctx.db.patch(id, { domain: "stripe.com", aiTags: ["dark"] }));
    return { s1, s2, id };
  }
  const move = (t: T, captureId: Id<"captures">, sessionId: Id<"sessions"> | null, who = userA) =>
    t.withIdentity(who).mutation(api.sessions.setCaptureSession, { captureId, sessionId });

  test("files an unfiled capture: count, aggregates and auto-name follow", async () => {
    const t = makeT();
    const { s1, id } = await world(t);
    expect(await move(t, id, s1)).toEqual({ sessionId: s1, moved: true });
    expect((await doc(t, id))!.sessionId).toBe(s1);
    const s = (await session(t, s1))!;
    expect(s.itemCount).toBe(1);
    expect(s.domains).toEqual(["stripe.com"]);
    expect(s.tags).toEqual(["pricing", "dark"]);
    expect(s.autoName).toBe("stripe.com · pricing, dark");
  });

  test("moves between sessions, keeping both counts right; a named session keeps its name", async () => {
    const t = makeT();
    const { s1, s2, id } = await world(t);
    await move(t, id, s1);
    await move(t, id, s2);
    expect((await session(t, s1))!.itemCount).toBe(0);
    const named = (await session(t, s2))!;
    expect(named.itemCount).toBe(1);
    expect(named.name).toBe("Named");
    expect(named.autoName).toBeUndefined();
    const browse = await t.withIdentity(userA).query(api.browse.browseCaptures, { sessionId: s2 });
    expect(browse.results.map((r) => [r.id, r.sessionName])).toEqual([[id, "Named"]]);
  });

  test("null unfiles the capture", async () => {
    const t = makeT();
    const { s1, id } = await world(t);
    await move(t, id, s1);
    expect(await move(t, id, null)).toEqual({ sessionId: null, moved: true });
    expect((await doc(t, id))!.sessionId).toBeUndefined();
    expect((await session(t, s1))!.itemCount).toBe(0);
  });

  test("moving to the session it is already in changes nothing", async () => {
    const t = makeT();
    const { s1, id } = await world(t);
    await move(t, id, s1);
    expect(await move(t, id, s1)).toEqual({ sessionId: s1, moved: false });
    expect(await move(t, (await addCapture(t, userA.subject))!, null)).toEqual({ sessionId: null, moved: false });
    expect((await session(t, s1))!.itemCount).toBe(1);
  });

  test("an ended session can be chosen", async () => {
    const t = makeT();
    const { s1, id } = await world(t);
    await t.run((ctx) => ctx.db.patch(s1, { endedAt: 5 }));
    expect(await move(t, id, s1)).toMatchObject({ moved: true });
  });

  test("another user's session is refused like a missing one, and nothing changes", async () => {
    const t = makeT();
    const { s1, id } = await world(t);
    await move(t, id, s1);
    const theirs = await addSession(t, userB.subject);
    const gone = await addSession(t, userA.subject);
    await t.run((ctx) => ctx.db.delete(gone));
    const errors: string[] = [];
    for (const target of [theirs, gone]) {
      try {
        await move(t, id, target);
      } catch (e) {
        errors.push(String((e as Error).message).replace(/^.*Uncaught Error: /s, "").split("\n")[0]!);
      }
    }
    expect(errors).toHaveLength(2);
    expect(errors[0]).toBe(errors[1]);
    expect((await doc(t, id))!.sessionId).toBe(s1);
    expect((await session(t, s1))!.itemCount).toBe(1);
    expect((await session(t, theirs))!.itemCount).toBe(0);
  });

  test("another user's capture is refused, even into the caller's own session", async () => {
    const t = makeT();
    const { id } = await world(t);
    const sB = await addSession(t, userB.subject);
    await expect(move(t, id, sB, userB)).rejects.toThrow(/Not found or forbidden/);
    expect((await doc(t, id))!.sessionId).toBeUndefined();
    expect((await session(t, sB))!.itemCount).toBe(0);
    await expect(
      t.mutation(api.sessions.setCaptureSession, { captureId: id, sessionId: null })
    ).rejects.toThrow(/Unauthorized/);
  });
});
