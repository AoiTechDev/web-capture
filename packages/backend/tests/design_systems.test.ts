/**
 * design_systems.ts: eligibility, generate, getForSession and save, owner
 * checks and cross-user isolation.
 */
import { describe, expect, test } from "vitest";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { checkContrast } from "../convex/lib/design_system/contrast";
import { validateTokens } from "../convex/lib/design_system/validate";
import { LIGHT_SAAS, designDna, palette, seedFixtureSession } from "./design_system_fixtures";
import { makeT, userA, userB, type T } from "./fixtures";

/** A session of `userId` holding the first `n` SaaS fixture captures (n ≤ 7). */
async function sessionWith(t: T, n: number, userId = userA.subject) {
  return await seedFixtureSession(t, userId, { ...LIGHT_SAAS, captures: LIGHT_SAAS.captures.slice(0, n) });
}

async function addCapture(t: T, sessionId: Id<"sessions">, extra: Record<string, unknown>, userId = userA.subject) {
  return await t.run(async (ctx) =>
    ctx.db.insert("captures", {
      kind: "viewport",
      storageId: await ctx.storage.store(new Blob(["x"])),
      width: 10,
      height: 10,
      url: "https://other.example/page",
      timestamp: 99,
      userId,
      sessionId,
      ...extra,
    } as any)
  );
}

describe("design_systems.eligibility", () => {
  test("needs 5 captures with DNA or a palette; other captures do not count", async () => {
    const t = makeT();
    const sessionId = await sessionWith(t, 4);
    await t.run((ctx) =>
      ctx.db.insert("captures", { kind: "link", href: "https://x.example", url: "https://x.example", timestamp: 5, userId: userA.subject, sessionId })
    );
    await addCapture(t, sessionId, {}); // a viewport without a palette
    const asA = t.withIdentity(userA);
    expect(await asA.query(api.design_systems.eligibility, { sessionId })).toEqual({ eligible: false, count: 4, need: 5 });
    await addCapture(t, sessionId, { palette: palette([["#ffffff", 0.8], ["#111111", 0.2]]) });
    expect(await asA.query(api.design_systems.eligibility, { sessionId })).toEqual({ eligible: true, count: 5, need: 5 });
  });

  test("signed out or another user's session: ineligible, count 0", async () => {
    const t = makeT();
    const sessionId = await sessionWith(t, 7);
    expect(await t.query(api.design_systems.eligibility, { sessionId })).toEqual({ eligible: false, count: 0, need: 5 });
    expect(await t.withIdentity(userB).query(api.design_systems.eligibility, { sessionId })).toEqual({
      eligible: false,
      count: 0,
      need: 5,
    });
  });
});

describe("design_systems.generate", () => {
  test("too few captures: a reason, and nothing stored", async () => {
    const t = makeT();
    const sessionId = await sessionWith(t, 3);
    const asA = t.withIdentity(userA);
    expect(await asA.mutation(api.design_systems.generate, { sessionId })).toEqual({
      ok: false,
      reason: "not_enough_captures",
      count: 3,
      need: 5,
    });
    expect(await asA.query(api.design_systems.getForSession, { sessionId })).toBeNull();
  });

  test("stores valid tokens, contrast, description, notes and sources", async () => {
    const t = makeT();
    const sessionId = await sessionWith(t, 7);
    await addCapture(t, sessionId, { palette: palette([["#ffffff", 0.9], ["#635bff", 0.1]]), domain: "inspo.example" });
    const asA = t.withIdentity(userA);
    const res = await asA.mutation(api.design_systems.generate, { sessionId });
    expect(res.ok).toBe(true);
    const row = (await asA.query(api.design_systems.getForSession, { sessionId }))!;
    expect(row._id).toBe(res.ok && res.designSystemId);
    expect(validateTokens(row.tokens)).toEqual(row.tokens);
    expect(row.generatedTokens).toEqual(row.tokens);
    expect(row.contrast).toEqual(checkContrast(row.tokens));
    expect(row.contrast.every((c) => c.passes)).toBe(true);
    expect(row.description).toMatch(/^Light theme · indigo primary/);
    expect(Array.isArray(row.notes)).toBe(true);
    expect(row).toMatchObject({
      userId: userA.subject,
      sessionId,
      edited: false,
      sourceCount: 8,
      sourceDomains: ["acme-saas.com", "inspo.example"],
    });
    expect(row.updatedAt).toBe(row.generatedAt);
  });

  test("falls back to stored captureColors when a capture has DNA without colours", async () => {
    const t = makeT();
    const grey = { kind: "element" as const, url: "https://grey.example/", dna: {
      colors: [["#ffffff", "background", 0.8], ["#111111", "text", 0.2]] as [string, "background" | "text", number][],
      fonts: [],
    } };
    const sessionId = await seedFixtureSession(t, userA.subject, { name: "Greys", domain: "grey.example", captures: [grey, grey, grey, grey] });
    const captureId = await addCapture(t, sessionId, {
      kind: "element",
      designDna: designDna("https://acme-saas.com/x", { colors: [], fonts: [["Inter", 16, 400, 24, 1]] }),
    });
    await t.run(async (ctx) => {
      for (const [hex, l, weight] of [["#ffffff", 100, 0.7], ["#ff00aa", 55, 0.3]] as const) {
        await ctx.db.insert("captureColors", { captureId, userId: userA.subject, hex, l, a: 0, b: 0, weight });
      }
    });
    const asA = t.withIdentity(userA);
    expect((await asA.mutation(api.design_systems.generate, { sessionId })).ok).toBe(true);
    const row = (await asA.query(api.design_systems.getForSession, { sessionId }))!;
    // The magenta only exists in the captureColors rows.
    expect(row.tokens.colors.primary["500"]).toBe("#ff00aa");
  });

  test("regenerating overwrites the same row and clears edited", async () => {
    const t = makeT();
    const sessionId = await sessionWith(t, 6);
    const asA = t.withIdentity(userA);
    const first = await asA.mutation(api.design_systems.generate, { sessionId });
    const row = (await asA.query(api.design_systems.getForSession, { sessionId }))!;
    const edited = structuredClone(row.tokens);
    edited.typography.fontBody = "Lato";
    await asA.mutation(api.design_systems.save, { designSystemId: row._id, tokens: edited });
    const again = await asA.mutation(api.design_systems.generate, { sessionId });
    expect(again).toEqual(first);
    const after = (await asA.query(api.design_systems.getForSession, { sessionId }))!;
    expect(after.edited).toBe(false);
    expect(after.tokens).toEqual(row.tokens);
    expect(await t.run((ctx) => ctx.db.query("designSystems").collect())).toHaveLength(1);
  });

  test("signed out or another user's session: refused", async () => {
    const t = makeT();
    const sessionId = await sessionWith(t, 7);
    await expect(t.mutation(api.design_systems.generate, { sessionId })).rejects.toThrow(/Unauthorized/);
    await expect(t.withIdentity(userB).mutation(api.design_systems.generate, { sessionId })).rejects.toThrow(/Not found or forbidden/);
    expect(await t.run((ctx) => ctx.db.query("designSystems").collect())).toEqual([]);
  });

  test("only the caller's captures are read, even in a session id they own", async () => {
    const t = makeT();
    const sessionId = await sessionWith(t, 4);
    // userB's captures pointing at userA's session must not count for userA.
    for (let i = 0; i < 3; i++) await addCapture(t, sessionId, { palette: palette([["#ffffff", 1]]) }, userB.subject);
    expect(await t.withIdentity(userA).query(api.design_systems.eligibility, { sessionId })).toMatchObject({ count: 4 });
  });
});

describe("design_systems.save / getForSession", () => {
  async function generated(t: T) {
    const sessionId = await sessionWith(t, 7);
    await t.withIdentity(userA).mutation(api.design_systems.generate, { sessionId });
    const row = (await t.withIdentity(userA).query(api.design_systems.getForSession, { sessionId }))!;
    return { sessionId, row };
  }

  test("saves valid edits, reports contrast without fixing it, keeps generatedTokens", async () => {
    const t = makeT();
    const { sessionId, row } = await generated(t);
    const tokens = structuredClone(row.tokens);
    tokens.colors.textMuted = "#cccccc";
    tokens.colors.primary["500"] = "#FF8800";
    const asA = t.withIdentity(userA);
    const { contrast } = await asA.mutation(api.design_systems.save, { designSystemId: row._id, tokens });
    const muted = contrast.find((c) => c.pair === "textMuted/background")!;
    expect(muted).toMatchObject({ foreground: "#cccccc", passes: false });
    const after = (await asA.query(api.design_systems.getForSession, { sessionId }))!;
    expect(after.tokens.colors.textMuted).toBe("#cccccc");
    expect(after.tokens.colors.primary["500"]).toBe("#ff8800");
    expect(after.contrast).toEqual(contrast);
    expect(after.edited).toBe(true);
    expect(after.generatedTokens).toEqual(row.generatedTokens);
    expect(after.description).toMatch(/orange primary/);
    expect(after.updatedAt).toBeGreaterThanOrEqual(row.updatedAt);
  });

  test("invalid tokens are refused and nothing changes", async () => {
    const t = makeT();
    const { sessionId, row } = await generated(t);
    const asA = t.withIdentity(userA);
    const bad = structuredClone(row.tokens) as any;
    bad.typography.fontHeading = 'Inter"; } :root { --x: url(evil)';
    await expect(asA.mutation(api.design_systems.save, { designSystemId: row._id, tokens: bad })).rejects.toThrow(
      /Invalid design system tokens: typography.fontHeading/
    );
    await expect(asA.mutation(api.design_systems.save, { designSystemId: row._id, tokens: { ...row.tokens, extra: true } })).rejects.toThrow(
      /not a known key/
    );
    expect(await asA.query(api.design_systems.getForSession, { sessionId })).toEqual(row);
  });

  test("another user can neither read nor save it", async () => {
    const t = makeT();
    const { sessionId, row } = await generated(t);
    const asB = t.withIdentity(userB);
    expect(await asB.query(api.design_systems.getForSession, { sessionId })).toBeNull();
    expect(await t.query(api.design_systems.getForSession, { sessionId })).toBeNull();
    await expect(asB.mutation(api.design_systems.save, { designSystemId: row._id, tokens: row.tokens })).rejects.toThrow(
      /Not found or forbidden/
    );
    await expect(t.mutation(api.design_systems.save, { designSystemId: row._id, tokens: row.tokens })).rejects.toThrow(/Unauthorized/);
    expect(await t.withIdentity(userA).query(api.design_systems.getForSession, { sessionId })).toEqual(row);
  });

  test("each user's own session has its own row", async () => {
    const t = makeT();
    const a = await sessionWith(t, 6);
    const b = await sessionWith(t, 6, userB.subject);
    await t.withIdentity(userA).mutation(api.design_systems.generate, { sessionId: a });
    expect(await t.withIdentity(userB).query(api.design_systems.getForSession, { sessionId: b })).toBeNull();
    await t.withIdentity(userB).mutation(api.design_systems.generate, { sessionId: b });
    const rowB = (await t.withIdentity(userB).query(api.design_systems.getForSession, { sessionId: b }))!;
    expect(rowB.userId).toBe(userB.subject);
    expect(await t.run((ctx) => ctx.db.query("designSystems").collect())).toHaveLength(2);
  });
});
