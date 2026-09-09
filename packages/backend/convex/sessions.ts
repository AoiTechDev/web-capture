/**
 * Capture sessions.
 *
 * A session is started and finished explicitly by the user. While one is
 * running, every capture joins it; when none is running, captures are simply
 * unfiled and show up under All Captures.
 *
 * An earlier version inferred sessions from the gap between captures. It
 * grouped things correctly most of the time, but the rule was invisible: you
 * could not tell where a capture had gone without opening the dashboard, and
 * you could not deliberately put two unrelated-looking things together.
 * Predictable beats clever for something that files your data.
 */

import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";

/** Cap on the aggregate lists kept per session, so they cannot grow unbounded. */
const MAX_AGGREGATE = 12;

/* ---------- naming ---------- */

/** Most frequent values first, ties broken by first appearance. */
function topBy(values: string[], limit: number): string[] {
  const counts = new Map<string, number>();
  for (const raw of values) {
    const value = String(raw ?? "").trim();
    if (!value) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([value]) => value);
}

/**
 * Fallback name for a session the user did not name, derived from what it
 * actually contains.
 *
 * Deliberately excludes the date: the UI renders that from `startedAt`, which
 * avoids baking a timezone into stored text.
 */
function buildAutoName(domains: string[], tags: string[]): string {
  const site = domains[0];
  const topic = tags.slice(0, 2).join(", ");
  if (site && topic) return `${site} · ${topic}`;
  if (site) return site;
  if (topic) return topic;
  return "Untitled session";
}

/* ---------- session resolution ---------- */

/**
 * The user's running session, if any.
 *
 * "Running" means started and not yet finished. There is deliberately no time
 * limit: a session ends when the user says so, not when a timer decides.
 */
async function findRunningSession(
  ctx: { db: any },
  userId: string
): Promise<Doc<"sessions"> | null> {
  const latest = await ctx.db
    .query("sessions")
    .withIndex("by_user_startedAt", (q: any) => q.eq("userId", userId))
    .order("desc")
    .first();

  if (!latest || latest.endedAt) return null;
  return latest;
}

/* ---------- writes ---------- */

/**
 * Begin a session. Any session still running is finished first, so there is
 * never more than one place a capture could land.
 */
export const startSession = mutation({
  args: { name: v.optional(v.string()) },
  handler: async (ctx, { name }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");

    const running = await findRunningSession(ctx, identity.subject);
    if (running) await ctx.db.patch(running._id, { endedAt: Date.now() });

    const trimmed = (name ?? "").trim().slice(0, 120);
    const now = Date.now();

    const sessionId = await ctx.db.insert("sessions", {
      userId: identity.subject,
      name: trimmed.length ? trimmed : undefined,
      startedAt: now,
      lastCaptureAt: now,
      itemCount: 0,
      domains: [],
      tags: [],
    });

    return { sessionId, replacedPrevious: !!running } as const;
  },
});

/** Finish the running session. Subsequent captures stay unfiled. */
export const endSession = mutation({
  args: { id: v.optional(v.id("sessions")) },
  handler: async (ctx, { id }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");

    const session = id
      ? await ctx.db.get(id)
      : await findRunningSession(ctx, identity.subject);

    if (!session || session.userId !== identity.subject) {
      return { ok: false, reason: "no running session" } as const;
    }
    if (session.endedAt) return { ok: true, alreadyEnded: true } as const;

    await ctx.db.patch(session._id, { endedAt: Date.now() });
    return { ok: true, alreadyEnded: false } as const;
  },
});

/**
 * Attach a capture to the running session, if there is one.
 *
 * Never creates a session. With none running the capture stays unfiled, which
 * is a legitimate resting place rather than an error: most saves are one-offs
 * made while browsing, not part of a project.
 */
export const assignCapture = mutation({
  args: {
    captureId: v.id("captures"),
    domain: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
  },
  handler: async (ctx, { captureId, domain, tags }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");

    const capture = await ctx.db.get(captureId);
    if (!capture || (capture as any).userId !== identity.subject) {
      throw new Error("Not found or forbidden");
    }

    // Idempotent: a re-run must not double-count an item.
    if ((capture as any).sessionId) {
      return { sessionId: (capture as any).sessionId, assigned: false } as const;
    }

    const running = await findRunningSession(ctx, identity.subject);
    if (!running) return { sessionId: null, assigned: false } as const;

    const domains = topBy(
      [...(running.domains ?? []), ...(domain ? [domain] : [])],
      MAX_AGGREGATE
    );
    const mergedTags = topBy([...(running.tags ?? []), ...(tags ?? [])], MAX_AGGREGATE);

    await ctx.db.patch(running._id, {
      lastCaptureAt: Date.now(),
      itemCount: (running.itemCount ?? 0) + 1,
      domains,
      tags: mergedTags,
      // Only derive a name for sessions the user did not name themselves.
      autoName: running.name ? running.autoName : buildAutoName(domains, mergedTags),
    });

    await ctx.db.patch(captureId, { sessionId: running._id });
    return { sessionId: running._id, assigned: true } as const;
  },
});

/**
 * Fold a capture's tags into its session's aggregates.
 *
 * Session membership is recorded the moment a capture is saved, so the
 * indicator reacts immediately; auto-tags only exist a few seconds later, once
 * the model has run. This carries them across without re-counting the item.
 */
export const mergeCaptureTags = mutation({
  args: { captureId: v.id("captures"), tags: v.array(v.string()) },
  handler: async (ctx, { captureId, tags }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");

    const capture = await ctx.db.get(captureId);
    if (!capture || (capture as any).userId !== identity.subject) {
      throw new Error("Not found or forbidden");
    }

    const sessionId = (capture as any).sessionId as Id<"sessions"> | undefined;
    if (!sessionId) return { ok: true, merged: false } as const;

    const session = await ctx.db.get(sessionId);
    if (!session || session.userId !== identity.subject) {
      return { ok: true, merged: false } as const;
    }

    const mergedTags = topBy([...(session.tags ?? []), ...tags], MAX_AGGREGATE);
    await ctx.db.patch(sessionId, {
      tags: mergedTags,
      autoName: session.name
        ? session.autoName
        : buildAutoName(session.domains ?? [], mergedTags),
    });

    return { ok: true, merged: true } as const;
  },
});

export const renameSession = mutation({
  args: { id: v.id("sessions"), name: v.string() },
  handler: async (ctx, { id, name }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthorized");

    const session = await ctx.db.get(id);
    if (!session || session.userId !== identity.subject) {
      throw new Error("Not found or forbidden");
    }

    const trimmed = name.trim().slice(0, 120);
    // Clearing the name falls back to autoName rather than leaving it blank.
    await ctx.db.patch(id, { name: trimmed.length ? trimmed : undefined });
    return { ok: true } as const;
  },
});

/* ---------- reads ---------- */

/** The running session, for the popup's status line. */
export const getActiveSession = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;

    const running = await findRunningSession(ctx, identity.subject);
    if (!running) return null;

    return {
      id: running._id,
      name: running.name ?? null,
      autoName: running.autoName ?? null,
      displayName: running.name ?? running.autoName ?? "Untitled session",
      startedAt: running.startedAt,
      lastCaptureAt: running.lastCaptureAt,
      itemCount: running.itemCount ?? 0,
      domains: running.domains ?? [],
      tags: running.tags ?? [],
    };
  },
});

/** Sessions newest first, with a few thumbnails each for the dashboard cards. */
export const listSessions = query({
  args: { limit: v.optional(v.number()), thumbsPerSession: v.optional(v.number()) },
  handler: async (ctx, { limit, thumbsPerSession }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return { sessions: [] } as const;

    const take = Math.max(1, Math.min(100, limit ?? 30));
    const thumbCount = Math.max(0, Math.min(8, thumbsPerSession ?? 4));

    const rows = await ctx.db
      .query("sessions")
      .withIndex("by_user_startedAt", (q) => q.eq("userId", identity.subject))
      .order("desc")
      .take(take);

    const sessions = await Promise.all(
      rows.map(async (s) => {
        let thumbnails: string[] = [];
        if (thumbCount > 0) {
          const captures = await ctx.db
            .query("captures")
            .withIndex("by_user", (q) => q.eq("userId", identity.subject))
            .filter((q) => q.eq(q.field("sessionId"), s._id))
            .take(24);

          const urls = await Promise.all(
            captures
              .filter((c: any) => c.storageId)
              .slice(0, thumbCount)
              .map((c: any) => ctx.storage.getUrl(c.storageId))
          );
          thumbnails = urls.filter((u): u is string => !!u);
        }

        return {
          id: s._id,
          name: s.name ?? null,
          autoName: s.autoName ?? null,
          displayName: s.name ?? s.autoName ?? "Untitled session",
          startedAt: s.startedAt,
          lastCaptureAt: s.lastCaptureAt,
          itemCount: s.itemCount ?? 0,
          domains: s.domains ?? [],
          tags: s.tags ?? [],
          endedAt: s.endedAt ?? null,
          running: !s.endedAt,
          thumbnails,
        };
      })
    );

    return { sessions } as const;
  },
});

/** Everything captured during one session, newest first. */
export const getSession = query({
  args: { id: v.id("sessions") },
  handler: async (ctx, { id }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;

    const session = await ctx.db.get(id);
    if (!session || session.userId !== identity.subject) return null;

    const captures = await ctx.db
      .query("captures")
      .withIndex("by_user", (q) => q.eq("userId", identity.subject))
      .filter((q) => q.eq(q.field("sessionId"), id))
      .collect();

    
    const items = await Promise.all(
      captures
        .sort((a, b) => (b as any).timestamp - (a as any).timestamp)
        .map(async (c: any) => {
          const item = {
            _id: c._id,
            kind: c.kind,
            url: c.storageId
              ? await ctx.storage.getUrl(c.storageId)
              : (c.src ?? null),
            pageUrl: c.url ?? null,
            width: c.width ?? 600,
            height: c.height ?? 400,
            alt: c.alt ?? c.title ?? "",
            tags: c.tags ?? [],
            storageId: c.storageId ?? null,
            content: c.content ?? null,
            href: c.href ?? null,
            domain: c.domain ?? null,
            timestamp: c.timestamp,
          };
    
          if (c.kind === "link" && c.linkPreviewId) {
            const preview = await ctx.db.get(c.linkPreviewId);
            return { ...item, preview };
          }
    
          return item;
        })
    );

    return {
      id: session._id,
      name: session.name ?? null,
      autoName: session.autoName ?? null,
      displayName: session.name ?? session.autoName ?? "Untitled session",
      startedAt: session.startedAt,
      lastCaptureAt: session.lastCaptureAt,
      endedAt: session.endedAt ?? null,
      running: !session.endedAt,
      itemCount: session.itemCount ?? 0,
      domains: session.domains ?? [],
      tags: session.tags ?? [],
      items,
    };
  },
});
