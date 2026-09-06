import type { ConvexClient } from "convex/browser";
import { api } from "../../../../../packages/backend/convex/_generated/api";

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

export const saveNonImageCapture = async ({
    captureData, convex, sendResponse
}: {
    captureData: any;
    convex: ConvexClient;
    sendResponse: (response: { statusCode: number; message: string }) => void;
}) => {

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
            const { embedText } = await import('./local-embeddings');
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

      sendResponse({ statusCode: 200, message: 'Non-image capture saved' });
      return;
}