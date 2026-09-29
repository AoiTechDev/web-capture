import type { ConvexClient } from "convex/browser"
import { api } from "../../../../../packages/backend/convex/_generated/api"
// Static imports: see the note in save-image-capture.ts (MV3 importScripts).
import type { Id } from "../../../../../packages/backend/convex/_generated/dataModel"
import { mergeTags, type DerivedMetadata } from "./derive-metadata"
import { broadcastSessionState } from "./session-broadcast"

/**
 * Join the running session, if any, and say which one.
 *
 * Runs before the model: embedding takes seconds, and the on-page indicator
 * and toast should react the instant something is captured. Sessions are only
 * ever assigned server-side by `sessions.assignCapture`.
 */
export async function assignToSession(
  convex: ConvexClient,
  docId: string,
  derived: DerivedMetadata,
  userTags: string[] | undefined,
  logTag: string
): Promise<string | null> {
  try {
    const assigned = await convex.mutation((api as any).sessions.assignCapture, {
      captureId: docId,
      domain: derived.domain ?? undefined,
      tags: mergeTags(userTags, derived.tags),
    })
    if (!assigned?.sessionId) return null
    if (assigned.assigned) void broadcastSessionState(convex)
    const session = await convex.query((api as any).sessions.getActiveSession, {})
    return session?.id === assigned.sessionId ? (session.displayName ?? null) : null
  } catch (e) {
    console.warn(`[${logTag}] Failed to assign session:`, e)
    return null
  }
}

/**
 * Metadata that needs no model: the source domain and source/shape tags,
 * merged into the capture's tags at save time (user tags first). The model's
 * embedding and labels come later from the processing queue, into separate
 * ai* fields. Never throws.
 */
export async function applyDerivedMetadata(
  convex: ConvexClient,
  {
    docId,
    derived,
    userTags,
    logTag,
    upsert = true,
  }: { docId: string; derived: DerivedMetadata; userTags: string[] | undefined; logTag: string; upsert?: boolean }
): Promise<void> {
  const allTags = mergeTags(userTags, derived.tags)
  if (!allTags.length && !derived.domain) return
  try {
    await convex.mutation(api.local_ai.applyAutoMetadata, {
      id: docId as Id<"captures">,
      tags: allTags.length ? allTags : undefined,
      domain: derived.domain ?? undefined,
    })
    if (upsert && allTags.length) await convex.mutation(api.upload.upsertTags, { names: allTags })
  } catch (e) {
    console.warn(`[${logTag}] Failed to apply metadata:`, e)
  }
}
