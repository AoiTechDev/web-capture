import type { ConvexClient } from "convex/browser";
import { api } from "../../../../../packages/backend/convex/_generated/api";
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
      
      sendResponse({ statusCode: 200, message: 'Non-image capture saved' });
      return;
}