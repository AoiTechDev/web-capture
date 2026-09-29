import type { ConvexClient } from "convex/browser"
import { api } from "../../../../../packages/backend/convex/_generated/api"
// Static imports: see the note in save-image-capture.ts (MV3 importScripts).
import { mergeTags, type DerivedMetadata } from "./derive-metadata"
import { broadcastSessionState } from "./session-broadcast"
import { suggestTags } from "./auto-tag"
import { embedImageFromBlob, embedImageFromUrl } from "./local-embeddings"

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
 * Local CLIP embedding, zero-shot tags and the session's tag aggregate.
 * Never throws: a capture without a vector is picked up by a later re-index.
 */
export async function enrichImageCapture(
  convex: ConvexClient,
  {
    docId,
    image,
    derived,
    userTags,
    logTag,
  }: { docId: string; image: Blob | string; derived: DerivedMetadata; userTags: string[] | undefined; logTag: string }
): Promise<void> {
  let autoTags: string[] = []
  try {
    const localVec = typeof image === "string" ? await embedImageFromUrl(image) : await embedImageFromBlob(image)
    if (localVec && localVec.length > 0) {
      await convex.mutation((api as any).local_ai.patchLocalEmbedding, {
        id: docId,
        localEmbedding: localVec,
      })
      console.log(`[${logTag}] ✅ Local CLIP embedding saved (${localVec.length}d)`)

      // Zero-shot classification against the label vocabulary. Same vector,
      // no extra inference on the image itself.
      const suggested = await suggestTags(localVec)
      autoTags = suggested.map((t) => t.tag)
      console.log(`[${logTag}] auto tags:`, suggested.map((t) => `${t.tag} (${t.score.toFixed(3)})`).join(", "))
    }
  } catch (e) {
    // No API fallback by design.
    console.warn(`[${logTag}] Local embedding failed:`, e)
  }

  // User-supplied tags win over derived ones, which win over model guesses.
  const allTags = mergeTags(userTags, derived.tags, autoTags)
  if (allTags.length) {
    try {
      await convex.mutation((api as any).local_ai.applyAutoMetadata, {
        id: docId,
        tags: allTags,
        domain: derived.domain ?? undefined,
      })
      await convex.mutation(api.upload.upsertTags, { names: allTags })
    } catch (e) {
      console.warn(`[${logTag}] Failed to apply auto metadata:`, e)
    }
  }

  // Carry the model's tags into the session; the item is already counted.
  if (autoTags.length) {
    try {
      const merged = await convex.mutation((api as any).sessions.mergeCaptureTags, {
        captureId: docId,
        tags: allTags,
      })
      if (merged?.merged) void broadcastSessionState(convex)
    } catch (e) {
      console.warn(`[${logTag}] Failed to merge session tags:`, e)
    }
  }
}
