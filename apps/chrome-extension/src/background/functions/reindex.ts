import type { ConvexClient } from "convex/browser"
import { api } from "../../../../../packages/backend/convex/_generated/api"
// Static imports: see the note in save-image-capture.ts (MV3 importScripts).
import { embedImageFromUrl, embedText } from "./local-embeddings"
import { suggestTags } from "./auto-tag"
import { deriveMetadata, mergeTags } from "./derive-metadata"

/**
 * Backfill embeddings and auto-tags for captures saved before local CLIP
 * existed. Without this, everything in an existing library stays invisible to
 * vector search no matter how the thresholds are tuned.
 *
 * Runs in batches and reports progress, because embedding a few hundred images
 * takes minutes and a silent multi-minute stall reads as a hang.
 */

export type ReindexProgress = {
  processed: number
  embedded: number
  failed: number
  remaining: number
  done: boolean
}

const BATCH_SIZE = 5

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

  try {
    // Re-fetch each batch rather than paging by offset: successfully embedded
    // rows drop out of the pending set, so the head of the list always holds
    // work that still needs doing.
    for (;;) {
      const { items, remaining: left } = await convex.query(
        (api as any).local_ai.listNeedingEmbedding,
        { limit: BATCH_SIZE }
      )
      remaining = left

      if (!items.length) break
      if (maxItems && processed >= maxItems) break

      let progressedThisBatch = false

      for (const item of items) {
        if (maxItems && processed >= maxItems) break
        processed++

        try {
          // Images embed from pixels; text-ish captures from their content.
          const isVisual = item.kind === "image" || item.kind === "screenshot"
          const textForEmbedding = [item.content, item.text, item.href]
            .filter(Boolean)
            .join(" ")
            .slice(0, 500)

          let vector: number[] | null = null
          if (isVisual && item.imageUrl) {
            vector = await embedImageFromUrl(item.imageUrl)
          } else if (textForEmbedding) {
            vector = await embedText(textForEmbedding)
          }

          if (!vector || vector.length === 0) {
            failed++
            continue
          }

          await convex.mutation((api as any).local_ai.patchLocalEmbedding, {
            id: item.id,
            localEmbedding: vector,
          })
          embedded++
          progressedThisBatch = true

          const derived = deriveMetadata({
            url: item.url,
            width: item.width,
            height: item.height,
          })
          const autoTags = isVisual ? (await suggestTags(vector)).map((t) => t.tag) : []
          const allTags = mergeTags(item.tags, derived.tags, autoTags)

          if (allTags.length) {
            await convex.mutation((api as any).local_ai.applyAutoMetadata, {
              id: item.id,
              tags: allTags,
              domain: derived.domain ?? undefined,
            })
          }
        } catch (e) {
          failed++
          console.warn("[reindex] failed for", item.id, e)
        }

        onProgress?.({ processed, embedded, failed, remaining, done: false })
      }

      // Every item in the batch failed and none left the pending set, so the
      // next fetch would return the same rows forever.
      if (!progressedThisBatch) {
        console.warn("[reindex] no progress in batch, stopping to avoid a loop")
        break
      }
    }
  } finally {
    _running = false
  }

  const final = { processed, embedded, failed, remaining, done: true }
  onProgress?.(final)
  console.log("[reindex] complete:", final)
  return final
}
