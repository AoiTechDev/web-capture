import { describe, expect, test } from "vitest";
import { api } from "../convex/_generated/api";
import { makeT, seedUser, userA, userB, vec, type T } from "./fixtures";

type Seed = Awaited<ReturnType<typeof seedUser>>;
type Kind = "query" | "mutation" | "action";
type Case = { name: string; kind: Kind; fn: any; args: (a: Seed) => Record<string, unknown> };

/** Every public function in the in-scope modules, with args aimed at A's data. */
const CASES: Case[] = [
  // captures
  { name: "captures.byCategoryAndKind(link)", kind: "query", fn: api.captures.byCategoryAndKind, args: () => ({ category: "unsorted", kind: "link" }) },
  { name: "captures.byCategoryAndKind(screenshot)", kind: "query", fn: api.captures.byCategoryAndKind, args: () => ({ category: "unsorted", kind: "screenshot" }) },
  { name: "captures.getCaptureById", kind: "query", fn: api.captures.getCaptureById, args: (a) => ({ id: a.linkId }) },
  { name: "captures.patchImageCaptionAndEmbedding", kind: "mutation", fn: api.captures.patchImageCaptionAndEmbedding, args: (a) => ({ id: a.shotId, caption: "pwned" }) },
  { name: "captures.listAllForUser", kind: "query", fn: api.captures.listAllForUser, args: () => ({}) },
  { name: "captures.countsByKind", kind: "query", fn: api.captures.countsByKind, args: () => ({}) },
  { name: "captures.listCategories", kind: "query", fn: api.captures.listCategories, args: () => ({}) },
  { name: "captures.listTags", kind: "query", fn: api.captures.listTags, args: () => ({}) },
  // sessions
  { name: "sessions.endSession(id)", kind: "mutation", fn: api.sessions.endSession, args: (a) => ({ id: a.sessionId }) },
  { name: "sessions.assignCapture", kind: "mutation", fn: api.sessions.assignCapture, args: (a) => ({ captureId: a.linkId, domain: "evil" }) },
  { name: "sessions.mergeCaptureTags", kind: "mutation", fn: api.sessions.mergeCaptureTags, args: (a) => ({ captureId: a.linkId, tags: ["pwned"] }) },
  { name: "sessions.renameSession", kind: "mutation", fn: api.sessions.renameSession, args: (a) => ({ id: a.sessionId, name: "pwned" }) },
  { name: "sessions.getActiveSession", kind: "query", fn: api.sessions.getActiveSession, args: () => ({}) },
  { name: "sessions.listSessions", kind: "query", fn: api.sessions.listSessions, args: () => ({}) },
  { name: "sessions.getSession", kind: "query", fn: api.sessions.getSession, args: (a) => ({ id: a.sessionId }) },
  // upload
  { name: "upload.deleteById", kind: "mutation", fn: api.upload.deleteById, args: (a) => ({ docId: a.shotId }) },
  { name: "upload.reassignCaptureCategory", kind: "mutation", fn: api.upload.reassignCaptureCategory, args: (a) => ({ docId: a.linkId, newCategory: "pwned" }) },
  { name: "upload.uploadCapture(A session)", kind: "mutation", fn: api.upload.uploadCapture, args: (a) => ({ capture: { kind: "text", content: "x", url: "u", timestamp: 1, sessionId: a.sessionId } }) },
  { name: "upload.uploadCapture(A preview)", kind: "mutation", fn: api.upload.uploadCapture, args: (a) => ({ capture: { kind: "link", href: "h", url: "u", timestamp: 1, linkPreviewId: a.previewId } }) },
  { name: "upload.uploadCapture(A storage)", kind: "mutation", fn: api.upload.uploadCapture, args: (a) => ({ capture: { kind: "screenshot", url: "u", timestamp: 1, storageId: a.storageId } }) },
  { name: "upload.saveImageCapture(A storage)", kind: "mutation", fn: api.upload.saveImageCapture, args: (a) => ({ storageId: a.storageId, url: "u", timestamp: 1, width: 1, height: 1 }) },
  // links
  { name: "links.enrichLinkPreviewForCapture", kind: "action", fn: api.links.enrichLinkPreviewForCapture, args: (a) => ({ captureId: a.linkId }) },
  { name: "links.getByUserAndCanonicalUrl", kind: "query", fn: api.links.getByUserAndCanonicalUrl, args: () => ({ canonicalUrl: "https://example.com/A" }) },
  // local_ai
  { name: "local_ai.applyAutoMetadata", kind: "mutation", fn: api.local_ai.applyAutoMetadata, args: (a) => ({ id: a.linkId, tags: ["pwned"], domain: "evil" }) },
  { name: "local_ai.listPendingCaptures", kind: "query", fn: api.local_ai.listPendingCaptures, args: () => ({ limit: 20 }) },
  { name: "local_ai.claimCapture", kind: "mutation", fn: api.local_ai.claimCapture, args: (a) => ({ id: a.linkId }) },
  { name: "local_ai.completeProcessing", kind: "mutation", fn: api.local_ai.completeProcessing, args: (a) => ({ id: a.linkId, claim: "forged", textEmbedding: vec(512, 0.9), aiTags: ["pwned"] }) },
  { name: "local_ai.failProcessing", kind: "mutation", fn: api.local_ai.failProcessing, args: (a) => ({ id: a.linkId, claim: "forged", error: "pwned" }) },
  { name: "local_ai.retryProcessing", kind: "mutation", fn: api.local_ai.retryProcessing, args: (a) => ({ captureId: a.shotId }) },
  { name: "local_ai.recoverStaleProcessing", kind: "mutation", fn: api.local_ai.recoverStaleProcessing, args: () => ({}) },
  { name: "local_ai.requeueUnindexed", kind: "mutation", fn: api.local_ai.requeueUnindexed, args: () => ({ limit: 500 }) },
  { name: "local_ai.listNeedingEmbedding", kind: "query", fn: api.local_ai.listNeedingEmbedding, args: () => ({ limit: 50 }) },
  { name: "local_ai.embeddingStats", kind: "query", fn: api.local_ai.embeddingStats, args: () => ({}) },
  // search
  { name: "search.searchCaptures", kind: "action", fn: api.search.searchCaptures, args: () => ({ query: "secret link example page", folder: "unsorted" }) },
  { name: "search.searchCapturesFallback", kind: "query", fn: api.search.searchCapturesFallback, args: () => ({ q: "link" }) },
  // link_search
  { name: "link_search.searchLinks", kind: "query", fn: api.link_search.searchLinks, args: () => ({ q: "secret example link" }) },
];

/** Every A-owned document, for a before/after comparison. */
async function snapshotA(t: T) {
  return await t.run(async (ctx) => {
    const own = (d: any) => d.userId === userA.subject;
    return {
      captures: (await ctx.db.query("captures").collect()).filter(own),
      sessions: (await ctx.db.query("sessions").collect()).filter(own),
      previews: (await ctx.db.query("link_previews").collect()).filter(own),
      categories: (await ctx.db.query("categories").collect()).filter(own),
      files: (await ctx.db.system.query("_storage").collect()).length,
    };
  });
}

function aMarkers(a: Seed): string[] {
  return [a.linkId, a.shotId, a.sessionId, a.previewId, a.storageId, "secret-title-A", "secret-desc-A", "link-A", userA.subject];
}

async function call(t: any, c: Case, args: Record<string, unknown>) {
  return await t[c.kind](c.fn, args);
}

/** True for results that carry no data: null, [], {}, or wrappers of those. */
function isEmpty(r: unknown): boolean {
  if (r === null || r === undefined) return true;
  if (Array.isArray(r)) return r.length === 0;
  if (typeof r === "object") {
    const o = r as Record<string, unknown>;
    for (const key of ["results", "sessions", "items"]) {
      if (key in o) return Array.isArray(o[key]) && (o[key] as unknown[]).length === 0;
    }
    if ("ok" in o) return o.ok === false;
    return Object.keys(o).length === 0;
  }
  return false;
}

async function seedWorld() {
  const t = makeT();
  const a = await seedUser(t, userA.subject, "A");
  await t.run(async (ctx) => {
    await ctx.db.insert("categories", { name: "a-private-cat", createdAt: 1, userId: userA.subject });
    await ctx.db.insert("tags", { name: "a-private-tag", userId: userA.subject, lastUsedAt: 1, useCount: 1 });
    // Make A's session the running one so getActiveSession has something to leak.
    await ctx.db.patch(a.sessionId, { endedAt: undefined });
  });
  const b = await seedUser(t, userB.subject, "B");
  // B's own session is ended, so B has no running session of its own.
  await t.run((ctx) => ctx.db.patch(b.sessionId, { endedAt: 5 }));
  return { t, a, b };
}

describe("cross-user matrix: userB against userA's data", () => {
  test.each(CASES.map((c) => [c.name, c] as const))("%s", async (_name, c) => {
    const { t, a } = await seedWorld();
    const before = await snapshotA(t);

    let result: unknown;
    let threw = false;
    try {
      result = await call(t.withIdentity(userB), c, c.args(a));
    } catch {
      threw = true;
    }

    if (!threw) {
      const json = JSON.stringify(result);
      for (const m of [...aMarkers(a), "a-private-cat", "a-private-tag"]) {
        expect(json, `leaked ${m}`).not.toContain(m);
      }
    }
    expect(await snapshotA(t)).toEqual(before);
  });
});

describe("cross-user matrix: anonymous caller", () => {
  test.each(CASES.map((c) => [c.name, c] as const))("%s", async (_name, c) => {
    const { t, a } = await seedWorld();
    const before = await snapshotA(t);

    let result: unknown;
    let threw = false;
    try {
      result = await call(t, c, c.args(a));
    } catch {
      threw = true;
    }

    if (!threw) {
      expect(isEmpty(result), `anonymous got ${JSON.stringify(result)}`).toBe(true);
    }
    expect(await snapshotA(t)).toEqual(before);
  });
});

describe("cross-user matrix: sanity (userA sees own data)", () => {
  test("A's reads return A's data, so the B/anon checks are meaningful", async () => {
    const { t, a } = await seedWorld();
    const asA = t.withIdentity(userA);
    expect(await asA.query(api.captures.getCaptureById, { id: a.linkId })).not.toBeNull();
    expect((await asA.query(api.captures.listAllForUser, {})).length).toBe(2);
    expect((await asA.query(api.sessions.getActiveSession, {}))?.id).toBe(a.sessionId);
    expect(await asA.query(api.sessions.getSession, { id: a.sessionId })).not.toBeNull();
    expect((await asA.query(api.link_search.searchLinks, { q: "secret" })).results).toHaveLength(1);
    expect((await asA.query(api.local_ai.listNeedingEmbedding, {})).items).toHaveLength(1);
    expect((await asA.query(api.captures.listCategories, {})).map((c) => c.name)).toContain("a-private-cat");
  });
});
