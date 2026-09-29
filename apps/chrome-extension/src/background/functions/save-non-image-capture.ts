import type { ConvexClient } from "convex/browser";
import { api } from "../../../../../packages/backend/convex/_generated/api";
// Static imports: an MV3 worker may only importScripts() during initial
// evaluation, so lazy imports inside a handler fail at message time.
import { embedText } from "./local-embeddings";
import { deriveMetadata, mergeTags } from "./derive-metadata";
import { assignToSession } from "./finish-image-capture";

/**
 * Returns a representative text string for a capture, used as input to
 * the CLIP text encoder so that text/code/link captures become searchable.
 */
function getEmbeddableText(data: any): string | null {
  switch (data?.kind) {
    case "text":
      return (data.content ?? "").slice(0, 500);
    case "code":
      return (data.content ?? "").slice(0, 500);
    case "link": {
      const parts = [data.text, data.href].filter(Boolean);
      return parts.join(" ").slice(0, 500) || null;
    }
    default:
      return null;
  }
}

/**
 * Resolves once the capture is stored, with the session it joined; throws if
 * it could not be saved.
 */
export const saveNonImageCapture = async ({
    captureData, convex
}: {
    captureData: any;
    convex: ConvexClient;
}): Promise<{ sessionName: string | null }> => {

      if (Array.isArray((captureData as any).tags)) {
        try {
          await convex.mutation(api.upload.upsertTags, { names: (captureData as any).tags });
        } catch {}
      }
      const insertedId = await convex.mutation(api.upload.uploadCapture, {
        capture: captureData,
      });
      
      // Trigger async link enrichment for link captures
      try {
        if (captureData?.kind === "link" && insertedId) {
          await convex.action((api as any).links.enrichLinkPreviewForCapture, { captureId: insertedId });
        }
      } catch {}

      // ── Local CLIP text embedding (no API call) ───────────────────
      // Generates a 512-dim vector from the capture's text content.
      try {
        if (insertedId) {
          const textToEmbed = getEmbeddableText(captureData);
          if (textToEmbed) {
            const localVec = await embedText(textToEmbed);
            if (localVec && localVec.length > 0) {
              await convex.mutation((api as any).local_ai.patchLocalEmbedding, {
                id: insertedId,
                localEmbedding: localVec,
              });
              console.log('[save-non-image] ✅ Local CLIP embedding saved (' + localVec.length + 'd) for', captureData?.kind);
            }
          }
        }
      } catch (e) {
        console.warn('[save-non-image] Local embedding failed (non-blocking):', e);
      }

      // Same grouping as the visual paths: text and links saved while the user
      // has a session running join that session.
      let sessionName: string | null = null;
      if (insertedId) {
        const derived = deriveMetadata({ url: captureData?.url });
        const userTags: string[] | undefined = Array.isArray(captureData?.tags) ? captureData.tags : undefined;
        try {
          const allTags = mergeTags(userTags, derived.tags);
          if (allTags.length || derived.domain) {
            await convex.mutation((api as any).local_ai.applyAutoMetadata, {
              id: insertedId,
              tags: allTags.length ? allTags : undefined,
              domain: derived.domain ?? undefined,
            });
          }
        } catch (e) {
          console.warn('[save-non-image] Failed to apply metadata:', e);
        }
        sessionName = await assignToSession(convex, insertedId, derived, userTags, 'save-non-image');
      }
      return { sessionName };
}