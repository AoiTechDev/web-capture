import type { ConvexClient } from "convex/browser";
import { api } from "../../../../../packages/backend/convex/_generated/api";
// Static imports: an MV3 worker may only importScripts() during initial
// evaluation, so lazy imports inside a handler fail at message time.
import { deriveMetadata } from "./derive-metadata";
import { applyDerivedMetadata, assignToSession } from "./finish-image-capture";

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

      // The text embedding is made by the processing queue (the capture is
      // saved as pending), which the caller kicks once this resolves.

      // Same grouping as the visual paths: text and links saved while the user
      // has a session running join that session.
      let sessionName: string | null = null;
      if (insertedId) {
        const derived = deriveMetadata({ url: captureData?.url });
        const userTags: string[] | undefined = Array.isArray(captureData?.tags) ? captureData.tags : undefined;
        await applyDerivedMetadata(convex, { docId: insertedId, derived, userTags, logTag: 'save-non-image', upsert: false });
        sessionName = await assignToSession(convex, insertedId, derived, userTags, 'save-non-image');
      }
      return { sessionName };
}