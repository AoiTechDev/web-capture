/**
 * Design systems generated from a session's captures (spec 6.5).
 *
 * One per session: `generate` runs the deterministic generator
 * (lib/design_system/generate) over the session's captures with Design DNA
 * or a pixel palette and upserts the result; `save` stores the user's edits.
 * There is no AI stage (owner's decision) and no plan gate yet (Phase 6; see
 * assertCanGenerate).
 */

import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { createReadBudget } from "./lib/read_budget";
import { checkContrast } from "./lib/design_system/contrast";
import { describeTokens } from "./lib/design_system/describe";
import { generateDesignSystem, sourceFromCapture, type DesignSource } from "./lib/design_system/generate";
import type { DesignSystemTokens } from "./lib/design_system/types";
import { validateTokens } from "./lib/design_system/validate";

/** Captures with DNA or a palette a session needs before it can be generated. */
export const MIN_SOURCES = 5;
/** Newest captures of a session one generate or eligibility read examines. */
export const MAX_SOURCE_SCAN = 500;
export const MAX_SOURCE_DOMAINS = 12;
const MAX_DOMAIN_LENGTH = 253;

type Ctx = QueryCtx | MutationCtx;

const hasDesignData = (c: Doc<"captures">) =>
  ("designDna" in c && !!c.designDna) || ("palette" in c && !!c.palette?.length);

/** The caller's session, or null when it is missing or someone else's. */
async function ownSession(ctx: Ctx, userId: string, sessionId: Id<"sessions">) {
  const session = await ctx.db.get(sessionId);
  return session && session.userId === userId ? session : null;
}

/**
 * The session's captures that hold design data, newest first: at most
 * MAX_SOURCE_SCAN examined, and no more than the capture read budget.
 */
async function designCaptures(ctx: Ctx, userId: string, sessionId: Id<"sessions">): Promise<Doc<"captures">[]> {
  const budget = createReadBudget();
  const out: Doc<"captures">[] = [];
  let scanned = 0;
  const rows = ctx.db
    .query("captures")
    .withIndex("by_user_session", (q) => q.eq("userId", userId).eq("sessionId", sessionId))
    .order("desc");
  for await (const capture of rows) {
    budget.charge(capture);
    if (hasDesignData(capture)) out.push(capture);
    if (++scanned >= MAX_SOURCE_SCAN || budget.exhausted) break;
  }
  return out;
}

function domainOf(capture: Doc<"captures">): string | null {
  if (capture.domain) return capture.domain.slice(0, MAX_DOMAIN_LENGTH);
  try {
    return new URL(capture.url).hostname.slice(0, MAX_DOMAIN_LENGTH) || null;
  } catch {
    return null;
  }
}

/** Most frequent first, ties alphabetical, capped. */
function topDomains(captures: Doc<"captures">[]): string[] {
  const counts = new Map<string, number>();
  for (const c of captures) {
    const d = domainOf(c);
    if (d) counts.set(d, (counts.get(d) ?? 0) + 1);
  }
  return [...counts]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, MAX_SOURCE_DOMAINS)
    .map(([d]) => d);
}

/**
 * Phase 6: the single place to check the caller's plan (spec 6.6 makes the
 * generator a Pro feature). Open to every signed-in user until then.
 */
async function assertCanGenerate(_ctx: MutationCtx, _userId: string): Promise<void> {}

/** Whether the session has enough captures with design data to generate from. */
export const eligibility = query({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, { sessionId }) => {
    const identity = await ctx.auth.getUserIdentity();
    const ineligible = { eligible: false, count: 0, need: MIN_SOURCES };
    if (!identity) return ineligible;
    if (!(await ownSession(ctx, identity.subject, sessionId))) return ineligible;
    const count = (await designCaptures(ctx, identity.subject, sessionId)).length;
    return { eligible: count >= MIN_SOURCES, count, need: MIN_SOURCES };
  },
});

/**
 * Generate (or regenerate) the session's design system. Regenerating
 * overwrites the tokens and clears `edited`.
 */
export const generate = mutation({
  args: { sessionId: v.id("sessions") },
  handler: async (
    ctx,
    { sessionId }
  ): Promise<
    | { ok: true; designSystemId: Id<"designSystems"> }
    | { ok: false; reason: "not_enough_captures"; count: number; need: number }
  > => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    const userId = identity.subject;
    if (!(await ownSession(ctx, userId, sessionId))) throw new Error("Not found or forbidden");
    await assertCanGenerate(ctx, userId);

    const captures = await designCaptures(ctx, userId, sessionId);
    if (captures.length < MIN_SOURCES) {
      return { ok: false, reason: "not_enough_captures", count: captures.length, need: MIN_SOURCES };
    }

    const sources: DesignSource[] = [];
    for (const capture of captures) {
      const dna = "designDna" in capture ? capture.designDna : undefined;
      const palette = "palette" in capture ? capture.palette : undefined;
      // Stored colour rows only matter when neither DNA colours nor a palette exist.
      const rows =
        !dna?.colors.length && !palette?.length
          ? await ctx.db
              .query("captureColors")
              .withIndex("by_capture", (q) => q.eq("captureId", capture._id))
              .take(12)
          : [];
      const source = sourceFromCapture({ designDna: dna, palette }, rows.filter((r) => r.userId === userId));
      if (source) sources.push(source);
    }

    const result = generateDesignSystem(sources);
    const now = Date.now();
    const fields = {
      tokens: result.tokens,
      generatedTokens: result.tokens,
      contrast: result.contrast,
      description: result.description,
      notes: result.notes,
      edited: false,
      sourceCount: sources.length,
      sourceDomains: topDomains(captures),
      generatedAt: now,
      updatedAt: now,
    };
    const existing = await ctx.db
      .query("designSystems")
      .withIndex("by_user_session", (q) => q.eq("userId", userId).eq("sessionId", sessionId))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, fields);
      return { ok: true, designSystemId: existing._id };
    }
    const designSystemId = await ctx.db.insert("designSystems", { userId, sessionId, ...fields });
    return { ok: true, designSystemId };
  },
});

/** The session's design system, or null (none yet, signed out, or not the caller's). */
export const getForSession = query({
  args: { sessionId: v.id("sessions") },
  handler: async (ctx, { sessionId }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    if (!(await ownSession(ctx, identity.subject, sessionId))) return null;
    const row = await ctx.db
      .query("designSystems")
      .withIndex("by_user_session", (q) => q.eq("userId", identity.subject).eq("sessionId", sessionId))
      .first();
    if (!row) return null;
    return {
      ...row,
      tokens: row.tokens as DesignSystemTokens,
      generatedTokens: row.generatedTokens as DesignSystemTokens,
    };
  },
});

/**
 * Save edited tokens. They are validated strictly; contrast is re-checked
 * and reported but never corrected, since these are the user's choices.
 */
export const save = mutation({
  args: { designSystemId: v.id("designSystems"), tokens: v.any() },
  handler: async (ctx, { designSystemId, tokens }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    const row = await ctx.db.get(designSystemId);
    if (!row || row.userId !== identity.subject) throw new Error("Not found or forbidden");
    const valid = validateTokens(tokens);
    const contrast = checkContrast(valid);
    await ctx.db.patch(designSystemId, {
      tokens: valid,
      contrast,
      description: describeTokens(valid),
      edited: true,
      updatedAt: Date.now(),
    });
    return { contrast };
  },
});
