import type { ConvexClient } from "convex/browser"
import { api } from "../../../../../packages/backend/convex/_generated/api"
// Static imports: see the note in save-image-capture.ts (MV3 importScripts).
import { isQueueIdle, kickProcessingQueue, onQueueEvent } from "./processing-queue"

/**
 * Re-index: queue captures that have no embedding for their kind yet
 * (failed, skipped, or saved before the pipeline) in bounded batches until
 * none remain, letting the processing queue do the work and reporting its
 * progress.
 *
 * Progress counts every capture the queue finishes meanwhile, so a capture
 * saved during a re-index shows up in the numbers too.
 */

export type ReindexProgress = {
  processed: number
  embedded: number
  failed: number
  remaining: number
  done: boolean
}

/** Captures queued per round trip; requeueUnindexed caps it at 200. */
const BATCH_SIZE = 50
/** Hard stop for one run (BATCH_SIZE x MAX_BATCHES captures). */
const MAX_BATCHES = 200

let _running = false

export function isReindexing(): boolean {
  return _running
}

export const runReindex = async ({
  convex,
  onProgress,
  maxItems,
}: {
  convex: ConvexClient
  onProgress?: (p: ReindexProgress) => void
  maxItems?: number
}): Promise<ReindexProgress> => {
  if (_running) {
    throw new Error("A re-index is already running")
  }
  _running = true

  let processed = 0
  let embedded = 0
  let failed = 0
  let remaining = 0

  /** Let the queue work through what was just queued; resolves once it is idle. */
  const drainBatch = (queued: number, leftAfter: number) =>
    new Promise<void>((resolve) => {
      let done = 0
      // Only an idle reported after the fresh pending list was fetched
      // means the requeued captures are done.
      let armed = false
      const off = onQueueEvent((e) => {
        if (e.type === "idle") {
          if (!armed) return
          off()
          resolve()
          return
        }
        if (e.type === "retry") return
        processed++
        done++
        if (e.type === "done") embedded++
        else failed++
        remaining = Math.max(0, queued - done) + leftAfter
        onProgress?.({ processed, embedded, failed, remaining, done: false })
      })
      void kickProcessingQueue().then(() => {
        armed = true
        // The kick may have found nothing to do and gone idle already.
        if (isQueueIdle()) {
          off()
          resolve()
        }
      })
    })

  try {
    // Bounded batches until nothing is left. A batch in which nothing got
    // embedded ends the run: whatever is left keeps failing, and queuing it
    // again would loop forever.
    for (let batch = 0; batch < MAX_BATCHES; batch++) {
      const limit = maxItems ? Math.min(BATCH_SIZE, maxItems - processed) : BATCH_SIZE
      if (limit <= 0) break
      const res = await convex.mutation(api.local_ai.requeueUnindexed, { limit })
      remaining = res.requeued + res.remaining
      if (res.requeued === 0) break
      const embeddedBefore = embedded
      await drainBatch(res.requeued, res.remaining)
      if (embedded === embeddedBefore) break
      if (res.remaining === 0 && !res.capped) break
    }
  } finally {
    _running = false
  }

  const final = { processed, embedded, failed, remaining, done: true }
  onProgress?.(final)
  console.log("[reindex] complete:", final)
  return final
}
