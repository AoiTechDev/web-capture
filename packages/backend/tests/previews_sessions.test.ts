import { describe, expect, test } from "vitest";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { backfillStats, makeT, seedAB, storeBlob, userA, userB, type T } from "./fixtures";

/** A's link capture pointing at B's preview (legacy / forged data). */
async function linkToForeignPreview(t: T, foreignPreview: Id<"link_previews">, sessionId?: Id<"sessions">) {
  return await t.run((ctx) =>
    ctx.db.insert("captures", {
      kind: "link",
      href: "https://evil.example/secret",
      url: "https://p",
      timestamp: 5,
      category: "unsorted",
      userId: userA.subject,
      linkPreviewId: foreignPreview,
      sessionId,
    })
  );
}

describe("link previews never leak across users", () => {
  test("browse.browseCaptures drops a foreign preview", async () => {
    const t = makeT();
    const { a, b } = await seedAB(t);
    const forged = await linkToForeignPreview(t, b.previewId);
    const { results: rows } = await t.withIdentity(userA).query(api.browse.browseCaptures, { kinds: ["link"] });
    const own = rows.find((r) => r.id === a.linkId)!;
    const bad = rows.find((r) => r.id === forged);
    expect(own.preview).toMatchObject({ title: "secret-title-A", description: "secret-desc-A", domain: "example.com" });
    expect(bad).toBeDefined();
    expect(bad!.preview).toBeNull();
    expect(JSON.stringify(rows)).not.toContain("secret-title-B");
  });

  test("sessions.getSession drops a foreign preview", async () => {
    const t = makeT();
    const { a, b } = await seedAB(t);
    await linkToForeignPreview(t, b.previewId, a.sessionId);
    const s = await t.withIdentity(userA).query(api.sessions.getSession, { id: a.sessionId });
    expect(s!.items).toHaveLength(3);
    expect(JSON.stringify(s)).not.toContain("secret-title-B");
    expect(JSON.stringify(s)).toContain("secret-title-A");
  });

  test("link_search.searchLinks ignores a foreign preview's text", async () => {
    const t = makeT();
    const { b } = await seedAB(t);
    await linkToForeignPreview(t, b.previewId);
    const hitB = await t.withIdentity(userA).query(api.link_search.searchLinks, { q: "secret-desc-B" });
    expect(hitB.results).toEqual([]);
    const hitA = await t.withIdentity(userA).query(api.link_search.searchLinks, { q: "secret-desc-A" });
    expect(hitA.results).toHaveLength(1);
    const all = await t.withIdentity(userA).query(api.link_search.searchLinks, { q: "example" });
    expect(JSON.stringify(all)).not.toContain("secret-title-B");
  });

  test("links.getByUserAndCanonicalUrl is scoped to the caller", async () => {
    const t = makeT();
    await seedAB(t);
    const url = "https://example.com/A";
    expect(await t.withIdentity(userB).query(api.links.getByUserAndCanonicalUrl, { canonicalUrl: url })).toBeNull();
    expect(await t.query(api.links.getByUserAndCanonicalUrl, { canonicalUrl: url })).toBeNull();
    const own = await t.withIdentity(userA).query(api.links.getByUserAndCanonicalUrl, { canonicalUrl: url });
    expect(own!.userId).toBe(userA.subject);
  });

  test("links.insertPreview stamps the caller's userId", async () => {
    const t = makeT();
    const id = await t.withIdentity(userA).mutation(api.links.insertPreview, {
      canonicalUrl: "https://x",
      originalUrl: "https://x",
      domain: "x",
      createdAt: 1,
      updatedAt: 1,
      userId: userB.subject,
    } as any).catch(() => null);
    // Either the extra userId arg is rejected by the validator, or it is ignored.
    if (id) expect((await t.run((ctx) => ctx.db.get(id)))!.userId).toBe(userA.subject);
  });
});

describe("sessions", () => {
  test("listSessions returns only the caller's sessions with correct thumbs/counts", async () => {
    const t = makeT();
    const { a, b } = await seedAB(t);
    // Second A session with 3 image captures + 1 text capture.
    const s2 = await t.run((ctx) =>
      ctx.db.insert("sessions", { userId: userA.subject, startedAt: 10, lastCaptureAt: 10, itemCount: 4 })
    );
    for (let i = 0; i < 3; i++) {
      const storageId = await storeBlob(t, `s2-${i}`);
      await t.run((ctx) =>
        ctx.db.insert("captures", {
          kind: "viewport", storageId, width: 1, height: 1, url: "u", timestamp: i,
          userId: userA.subject, sessionId: s2,
        })
      );
    }
    await t.run((ctx) =>
      ctx.db.insert("captures", { kind: "text", content: "t", url: "u", timestamp: 9, userId: userA.subject, sessionId: s2 })
    );
    // A B capture forged into A's session must not surface as a thumbnail.
    const bStorage = await storeBlob(t, "b-in-a");
    await t.run((ctx) =>
      ctx.db.insert("captures", {
        kind: "screenshot", storageId: bStorage, url: "u", timestamp: 1, userId: userB.subject, sessionId: a.sessionId,
      })
    );

    const { sessions } = await t
      .withIdentity(userA)
      .query(api.sessions.listSessions, { thumbsPerSession: 8 });
    expect(sessions.map((s) => s.id)).toEqual([s2, a.sessionId]); // newest first
    expect(sessions.map((s) => s.id)).not.toContain(b.sessionId);
    expect(sessions[0]!.thumbnails).toHaveLength(3);
    expect(sessions[0]!.itemCount).toBe(4);
    expect(sessions[1]!.thumbnails).toHaveLength(1); // only A's own screenshot
    expect(sessions[1]!.itemCount).toBe(2);

    const limited = await t.withIdentity(userA).query(api.sessions.listSessions, { thumbsPerSession: 2 });
    expect(limited.sessions[0]!.thumbnails).toHaveLength(2);
    const none = await t.withIdentity(userA).query(api.sessions.listSessions, { thumbsPerSession: 0 });
    expect(none.sessions[0]!.thumbnails).toEqual([]);

    const bList = await t.withIdentity(userB).query(api.sessions.listSessions, {});
    expect(bList.sessions.map((s) => s.id)).toEqual([b.sessionId]);
    expect(await t.query(api.sessions.listSessions, {})).toEqual({ sessions: [] });
  });

  test("getSession lists only the caller's captures in that session", async () => {
    const t = makeT();
    const { a } = await seedAB(t);
    await t.run((ctx) =>
      ctx.db.insert("captures", { kind: "text", content: "B-in-A", url: "u", timestamp: 1, userId: userB.subject, sessionId: a.sessionId })
    );
    const s = await t.withIdentity(userA).query(api.sessions.getSession, { id: a.sessionId });
    expect(s!.items.map((i: any) => i._id).sort()).toEqual([a.linkId, a.shotId].sort());
  });

  test("captures by session are served from the by_user_session index", async () => {
    const t = makeT();
    const { a } = await seedAB(t);
    const viaIndex = await t.run((ctx) =>
      ctx.db
        .query("captures")
        .withIndex("by_user_session", (q) => q.eq("userId", userA.subject).eq("sessionId", a.sessionId))
        .collect()
    );
    expect(viaIndex).toHaveLength(2);
  });
});

describe("element / viewport kinds", () => {
  test("schema accepts element and viewport captures", async () => {
    const t = makeT();
    const storageId = await storeBlob(t);
    await t.run(async (ctx) => {
      await ctx.db.insert("captures", {
        kind: "element", storageId, width: 1, height: 1, tagName: "IMG", clipped: false,
        url: "u", timestamp: 1, userId: userA.subject, category: "unsorted",
      });
      await ctx.db.insert("captures", {
        kind: "viewport", storageId, width: 1, height: 1, clipped: true,
        url: "u", timestamp: 2, userId: userA.subject, category: "unsorted",
      });
    });
  });

  test("schema requires storageId on element captures", async () => {
    const t = makeT();
    await expect(
      t.run((ctx) =>
        ctx.db.insert("captures", { kind: "element", width: 1, height: 1, url: "u", timestamp: 1 } as any)
      )
    ).rejects.toThrow();
  });

  test("the screenshot type lists screenshot + element + viewport, newest first, with urls", async () => {
    const t = makeT();
    await backfillStats(t);
    const ids: string[] = [];
    for (const kind of ["viewport", "screenshot", "element"] as const) {
      const storageId = await storeBlob(t, kind);
      ids.push(
        await t.withIdentity(userA).mutation(api.upload.saveImageCapture, {
          storageId, url: `https://page/${kind}`, timestamp: 1, width: 1, height: 1, kind,
        })
      );
    }
    // An image and another user's element must not show up.
    await t.withIdentity(userA).mutation(api.upload.saveImageCapture, {
      storageId: await storeBlob(t, "img"), url: "u", timestamp: 1, width: 1, height: 1, kind: "image",
    });
    await t.withIdentity(userB).mutation(api.upload.saveImageCapture, {
      storageId: await storeBlob(t, "b"), url: "u", timestamp: 1, width: 1, height: 1, kind: "element",
    });

    const { results: rows } = await t
      .withIdentity(userA)
      .query(api.browse.browseCaptures, { kinds: ["screenshot", "element", "viewport"] });
    expect(rows.map((r) => r.id)).toEqual([...ids].reverse());
    expect(rows.map((r) => r.kind)).toEqual(["element", "screenshot", "viewport"]);
    for (const r of rows) {
      expect(typeof r.imageUrl).toBe("string");
      expect(r.pageUrl).toBe(`https://page/${r.kind}`);
    }

    const counts = await t.withIdentity(userA).query(api.captures.countsByKind, {});
    expect(counts).toMatchObject({ element: 1, viewport: 1, screenshot: 1, image: 1, all: 4 });
  });

  test("element and viewport can be queried as their own kind", async () => {
    const t = makeT();
    const storageId = await storeBlob(t);
    await t.withIdentity(userA).mutation(api.upload.saveImageCapture, {
      storageId, url: "u", timestamp: 1, width: 1, height: 1, kind: "element",
    });
    const el = await t.withIdentity(userA).query(api.browse.browseCaptures, { kinds: ["element"] });
    const vp = await t.withIdentity(userA).query(api.browse.browseCaptures, { kinds: ["viewport"] });
    expect(el.results).toHaveLength(1);
    expect(vp.results).toHaveLength(0);
  });
});
