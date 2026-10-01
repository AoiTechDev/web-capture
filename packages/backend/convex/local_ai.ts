/**
 * Backend side of the local (Transformers.js) enrichment pipeline.
 *
 * The model runs in the extension, never here. New captures are saved as
 * `pending`; the extension's service worker subscribes to
 * `listPendingCaptures`, claims one capture at a time (`claimCapture`), embeds
 * and zero-shot tags it locally, then reports back with `completeProcessing`
 * or `failProcessing`. Every function is scoped to the caller's own captures.
 *
 * Search over the results lives in search.ts (`searchCaptures`).
 */

import { internalMutation, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { assertLocalEmbedding } from "./helpers";
import { aiCategoryValidator } from "./schema";
import { AI_MAX_ATTEMPTS, AI_STALE_PROCESSING_MS, LOCAL_EMBEDDING_DIM } from "./lib/ai_config";
import { buildSearchText } from "./lib/search_rank";
import { normalizeUserTags, TEXT_CAPS, truncateUtf8 } from "./lib/capture_text";

/* ---------- helpers ---------- */

/** Capture kinds whose content is a stored image. */
const VISUAL_KINDS = new Set(["image", "screenshot", "element", "viewport"]);

export function isVisualKind(kind: string): boolean {
  return VISUAL_KINDS.has(kind);
}

/**
 * Whether a capture has the embedding its kind is searched by, from the
 * current model. A vector of another size (512-d, from the earlier CLIP
 * model) is in no index and counts as none.
 */
function hasEmbedding(d: any): boolean {
  const vec = isVisualKind(d.kind) ? d.localEmbedding : d.textEmbedding;
  return Array.isArray(vec) && vec.length === LOCAL_EMBEDDING_DIM;
}

/** Unsets whichever vector fields hold a stale (wrong-size) vector. */
function staleVectorPatch(d: any): { localEmbedding?: undefined; textEmbedding?: undefined } {
  const stale = (vec: unknown) => Array.isArray(vec) && vec.length !== LOCAL_EMBEDDING_DIM;
  return {
    ...(stale(d.localEmbedding) ? { localEmbedding: undefined } : {}),
    ...(stale(d.textEmbedding) ? { textEmbedding: undefined } : {}),
  };
}

const MAX_STYLES = 4;
const MAX_AI_TAGS = 10;
const MAX_LABEL_LENGTH = 40;
const MAX_ERROR_LENGTH = 500;
const MAX_EMBED_TEXT = 1000;

/** Lowercase, trimmed, deduped, length-capped labels. */
function cleanLabels(labels: string[] | undefined, max: number): string[] | undefined {
  if (!labels) return undefined;
  const out: string[] = [];
  for (const raw of labels) {
    const label = raw.trim().toLowerCase().replace(/\s+/g, " ").slice(0, MAX_LABEL_LENGTH);
    if (label && !out.includes(label)) out.push(label);
    if (out.length >= max) break;
  }
  return out;
}

/** The text a text-ish capture is embedded from. */
function embeddableText(d: any): string | null {
  const parts =
    d.kind === "link" ? [d.title, d.text, d.href] : d.kind === "text" || d.kind === "code" ? [d.content] : [];
  const text = parts.filter(Boolean).join(" ").trim().slice(0, MAX_EMBED_TEXT);
  return text || null;
}

/** Load a capture the caller owns, or throw. */
async function ownCapture(ctx: MutationCtx, id: Id<"captures">): Promise<Doc<"captures">> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Unauthorized");
  const doc = await ctx.db.get(id);
  if (!doc || doc.userId !== identity.subject) throw new Error("Not found or forbidden");
  return doc;
}

/* ---------- metadata ---------- */

/**
 * Apply metadata derived without a model (source domain, shape tags) at save
 * time. Kept separate from the insert so it never blocks the capture itself.
 */
export const applyAutoMetadata = mutation({
  args: {
    id: v.id("captures"),
    tags: v.optional(v.array(v.string())),
    domain: v.optional(v.string()),
  },
  handler: async (ctx, { id, tags, domain }) => {
    const doc = await ownCapture(ctx, id);

    const patch: { tags?: string[]; domain?: string } = {};
    const cleanTags = normalizeUserTags(tags ?? []);
    if (cleanTags.length) patch.tags = cleanTags;
    if (domain) patch.domain = truncateUtf8(domain, TEXT_CAPS.domain);
    if (Object.keys(patch).length === 0) return { ok: true, patched: false } as const;

    await ctx.db.patch(id, { ...patch, searchText: buildSearchText({ ...(doc as any), ...patch }) });
    return { ok: true, patched: true } as const;
  },
});

/* ---------- processing queue ---------- */

/**
 * The caller's oldest pending captures. Ids and kinds only: the worker
 * subscribes to this, and the payload it needs comes with the claim.
 */
export const listPendingCaptures = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return { items: [] as Array<{ id: Id<"captures">; kind: string }> };
    const take = Math.max(1, Math.min(20, limit ?? 5));
    const rows = await ctx.db
      .query("captures")
      .withIndex("by_user_status", (q) => q.eq("userId", identity.subject).eq("status", "pending"))
      .take(take);
    return { items: rows.map((d) => ({ id: d._id, kind: d.kind as string })) };
  },
});

/** Unique enough per claim; Convex seeds Math.random per mutation. */
function newClaimToken(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Give up a claim: back to `pending` while attempts remain (the retry),
 * otherwise `failed`. Clearing `aiClaim` voids the old worker's token.
 */
async function releaseClaim(ctx: MutationCtx, doc: Doc<"captures">, error: string): Promise<boolean> {
  const retry = (doc.aiAttempts ?? 1) < AI_MAX_ATTEMPTS;
  await ctx.db.patch(doc._id, {
    status: retry ? "pending" : "failed",
    error: error.slice(0, MAX_ERROR_LENGTH) || "Unknown error",
    aiStartedAt: undefined,
    aiClaim: undefined,
  });
  return retry;
}

/** Whether a `processing` claim is old enough to be presumed abandoned. */
function isStaleClaim(doc: Doc<"captures">): boolean {
  return (doc.aiStartedAt ?? 0) <= Date.now() - AI_STALE_PROCESSING_MS;
}

/**
 * Take a pending capture for processing. Only succeeds while it is still
 * `pending`, so two workers (two browsers on one account) never both run it.
 * Returns a claim token (quoted back with the result) and what the worker
 * needs to embed and tag the capture. A release is scheduled for when the
 * claim goes stale, so a worker that dies mid-way never strands it.
 */
export const claimCapture = mutation({
  args: { id: v.id("captures") },
  handler: async (ctx, { id }) => {
    const doc = (await ownCapture(ctx, id)) as any;
    if (doc.status !== "pending") return { claimed: false as const, claim: null, item: null };

    const claim = newClaimToken();
    await ctx.db.patch(id, {
      status: "processing",
      aiAttempts: (doc.aiAttempts ?? 0) + 1,
      aiStartedAt: Date.now(),
      aiClaim: claim,
    });
    await ctx.scheduler.runAfter(AI_STALE_PROCESSING_MS, internal.local_ai.releaseStaleClaim, { id, claim });

    const visual = isVisualKind(doc.kind);
    const storageUrl = visual && doc.storageId ? await ctx.storage.getUrl(doc.storageId) : null;
    const thumbUrl = visual && doc.thumbStorageId ? await ctx.storage.getUrl(doc.thumbStorageId) : null;
    const backgroundHexes: string[] = (doc.designDna?.colors ?? [])
      .filter((c: any) => c.usage === "background")
      .sort((a: any, b: any) => b.weight - a.weight)
      .map((c: any) => c.hex);

    return {
      claimed: true as const,
      claim,
      item: {
        id: doc._id as Id<"captures">,
        kind: doc.kind as string,
        visual,
        /** Grid thumbnail; embedding it is cheaper and the model resizes to its own input size anyway. */
        thumbUrl,
        imageUrl: storageUrl ?? (visual ? doc.src || null : null),
        text: visual ? null : embeddableText(doc),
        palette: (doc.palette ?? null) as Array<{ hex: string; lab: number[]; weight: number }> | null,
        backgroundHexes,
        width: (doc.width ?? null) as number | null,
        height: (doc.height ?? null) as number | null,
      },
    };
  },
});

/**
 * Scheduled by claimCapture: release the claim if that same claim still
 * holds the capture once it has gone stale. Anything else (finished,
 * failed, re-queued, re-claimed, deleted) is left alone.
 */
export const releaseStaleClaim = internalMutation({
  args: { id: v.id("captures"), claim: v.string() },
  handler: async (ctx, { id, claim }) => {
    const doc = await ctx.db.get(id);
    if (!doc || doc.status !== "processing" || doc.aiClaim !== claim) return { released: false };
    await releaseClaim(ctx, doc, "Processing was interrupted");
    return { released: true };
  },
});

/** Store the results of a claimed capture and mark it `ready`. */
export const completeProcessing = mutation({
  args: {
    id: v.id("captures"),
    /** Token from claimCapture; a stale worker's result is refused. */
    claim: v.string(),
    localEmbedding: v.optional(v.array(v.float64())),
    textEmbedding: v.optional(v.array(v.float64())),
    aiCategory: v.optional(aiCategoryValidator),
    aiStyle: v.optional(v.array(v.string())),
    aiTags: v.optional(v.array(v.string())),
  },
  handler: async (ctx, { id, claim, localEmbedding, textEmbedding, aiCategory, aiStyle, aiTags }) => {
    const doc = await ownCapture(ctx, id);
    // Released, retried or re-claimed meanwhile: this result is stale.
    if (doc.status !== "processing" || doc.aiClaim !== claim) {
      return { ok: false as const, reason: "claim no longer held" };
    }

    assertLocalEmbedding(localEmbedding, "localEmbedding");
    assertLocalEmbedding(textEmbedding, "textEmbedding");
    // Each kind lives in exactly one embedding space; see the schema's indexes.
    const visual = isVisualKind(doc.kind);
    if (visual && (textEmbedding || !localEmbedding)) {
      throw new Error("Image captures take localEmbedding, not textEmbedding");
    }
    if (!visual && (localEmbedding || !textEmbedding)) {
      throw new Error("Text captures take textEmbedding, not localEmbedding");
    }

    const labels = {
      aiCategory,
      aiStyle: cleanLabels(aiStyle, MAX_STYLES),
      aiTags: cleanLabels(aiTags, MAX_AI_TAGS),
    };
    await ctx.db.patch(id, {
      ...(visual ? { localEmbedding } : { textEmbedding }),
      ...labels,
      searchText: buildSearchText({ ...(doc as any), ...labels }),
      status: "ready",
      error: undefined,
      aiStartedAt: undefined,
      aiClaim: undefined,
    } as any);
    return { ok: true as const };
  },
});

/**
 * Record a failed attempt. Goes back to `pending` for one automatic retry
 * (the worker waits a little before taking it again), then `failed`.
 */
export const failProcessing = mutation({
  args: { id: v.id("captures"), claim: v.string(), error: v.string() },
  handler: async (ctx, { id, claim, error }) => {
    const doc = await ownCapture(ctx, id);
    if (doc.status !== "processing" || doc.aiClaim !== claim) return { ok: false as const, retry: false };
    const retry = await releaseClaim(ctx, doc, error);
    return { ok: true as const, retry };
  },
});

/**
 * Queue a capture again from the dashboard (after `failed`, or to redo it).
 * A `processing` capture is only taken back once its claim has gone stale.
 */
export const retryProcessing = mutation({
  args: { captureId: v.id("captures") },
  handler: async (ctx, { captureId }) => {
    const doc = await ownCapture(ctx, captureId);
    // Already queued, or a live worker is on it right now.
    if (doc.status === "pending" || (doc.status === "processing" && !isStaleClaim(doc))) {
      return { ok: true as const, queued: false };
    }
    await ctx.db.patch(captureId, {
      status: "pending",
      aiAttempts: 0,
      error: undefined,
      aiStartedAt: undefined,
      aiClaim: undefined,
    });
    return { ok: true as const, queued: true };
  },
});

/**
 * Release the caller's stale claims now, e.g. at worker start after the
 * previous worker was killed. The scheduled release does the same later.
 */
export const recoverStaleProcessing = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    const stuck = await ctx.db
      .query("captures")
      .withIndex("by_user_status", (q) => q.eq("userId", identity.subject).eq("status", "processing"))
      .take(100);
    let recovered = 0;
    for (const doc of stuck) {
      if (!isStaleClaim(doc)) continue;
      await releaseClaim(ctx, doc, "Processing was interrupted");
      recovered++;
    }
    return { recovered };
  },
});

/**
 * Statuses a capture without an embedding can sit in outside the queue:
 * never processed (no status), backfilled `skipped`, or `failed`. Failed
 * last, so a re-index reaches untried captures before retrying failures.
 */
const UNINDEXED_STATUSES = [undefined, "skipped", "failed"] as const;
/** Rows read per status bucket (and per page of `ready`); bounds every scan below. */
const UNINDEXED_SCAN = 400;

/**
 * The caller's unindexed captures, bounded; `capped` when a bucket was cut off.
 *
 * `ready` captures are included when their vector is stale (another model's
 * size): they are re-embedded like any other. Being the bulk of a library,
 * `ready` is read a page at a time from `readyCursor`; the page's
 * `continueCursor` is null once the last page has been read.
 */
async function findUnindexed(ctx: QueryCtx, userId: string, readyCursor: string | null = null) {
  const found: Doc<"captures">[] = [];
  let capped = false;
  for (const status of UNINDEXED_STATUSES) {
    const rows = await ctx.db
      .query("captures")
      .withIndex("by_user_status", (q) => q.eq("userId", userId).eq("status", status))
      .take(UNINDEXED_SCAN);
    if (rows.length === UNINDEXED_SCAN) capped = true;
    found.push(...rows.filter((d) => !hasEmbedding(d)));
  }
  const ready = await ctx.db
    .query("captures")
    .withIndex("by_user_status", (q) => q.eq("userId", userId).eq("status", "ready"))
    .paginate({ cursor: readyCursor, numItems: UNINDEXED_SCAN });
  if (!ready.isDone) capped = true;
  found.push(...ready.page.filter((d) => !hasEmbedding(d)));
  return { found, capped, continueCursor: ready.isDone ? null : ready.continueCursor };
}

/**
 * Queue one bounded batch of captures that are not searchable yet (no
 * embedding for their kind, or a stale one; not already queued). Stale
 * vectors are unset, so nothing searches them meanwhile. The popup's
 * re-index calls this repeatedly, passing `readyCursor` back, until
 * `remaining` is 0 and `readyCursor` is null; the queue does the actual work.
 */
export const requeueUnindexed = mutation({
  args: { limit: v.optional(v.number()), readyCursor: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, { limit, readyCursor }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    const take = Math.max(1, Math.min(200, limit ?? 100));
    const { found, capped, continueCursor } = await findUnindexed(ctx, identity.subject, readyCursor ?? null);
    const batch = found.slice(0, take);
    for (const doc of batch) {
      await ctx.db.patch(doc._id, {
        ...staleVectorPatch(doc),
        status: "pending",
        aiAttempts: 0,
        error: undefined,
        aiStartedAt: undefined,
        aiClaim: undefined,
      });
    }
    const remaining = found.length - batch.length;
    return {
      requeued: batch.length,
      remaining,
      capped,
      // Move past this page of `ready` only once all of it was queued;
      // otherwise the next call reads it again (minus what left the page).
      readyCursor: remaining === 0 ? continueCursor : (readyCursor ?? null),
    };
  },
});

/* ---------- diagnostics ---------- */

/**
 * How much of the caller's library is reachable by vector search. Anything
 * without the embedding for its kind is found by keywords only.
 */
export const embeddingStats = query({
  args: {},
  handler: async (ctx) => {
    // Only ever the caller's own library: a userId argument would let anyone
    // read another user's stats.
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");
    const userId = identity.subject;

    const all = await ctx.db
      .query("captures")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    const byKind: Record<string, { total: number; withLocalEmbedding: number }> = {};
    const byStatus: Record<string, number> = {};
    let withLocalEmbedding = 0;
    let withImageEmbedding = 0;

    for (const d of all as any[]) {
      const kind = String(d.kind ?? "unknown");
      byKind[kind] ??= { total: 0, withLocalEmbedding: 0 };
      byKind[kind].total++;
      const status = String(d.status ?? "none");
      byStatus[status] = (byStatus[status] ?? 0) + 1;

      if (hasEmbedding(d)) {
        withLocalEmbedding++;
        byKind[kind].withLocalEmbedding++;
      }
      if (Array.isArray(d.imageEmbedding) && d.imageEmbedding.length > 0) {
        withImageEmbedding++;
      }
    }

    return {
      total: all.length,
      withLocalEmbedding,
      withImageEmbedding,
      searchable: withLocalEmbedding,
      byKind,
      byStatus,
    } as const;
  },
});

/**
 * Captures a re-index would queue (no embedding, not queued), for the
 * popup. Bounded like requeueUnindexed: `remaining` counts at most
 * UNINDEXED_SCAN rows per status, and `capped` says when it was cut off.
 */
export const listNeedingEmbedding = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return { items: [], remaining: 0, capped: false } as const;

    const take = Math.max(1, Math.min(50, limit ?? 10));
    const { found, capped } = await findUnindexed(ctx, identity.subject);

    const items = found.slice(0, take).map((d: any) => ({
      id: d._id as Id<"captures">,
      kind: d.kind as string,
      status: (d.status ?? null) as string | null,
      url: d.url ?? null,
    }));

    return { items, remaining: found.length, capped } as const;
  },
});
