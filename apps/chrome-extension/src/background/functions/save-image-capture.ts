import type { ConvexClient } from "convex/browser";
import { api } from "../../../../../packages/backend/convex/_generated/api";
import { getImageDimensions } from "~contents/utils/image-utils";

export const saveImageCapture = async ({
    msg, convex, sendResponse
}: {
    msg: any;
    convex: ConvexClient;
    sendResponse: (response: { statusCode: number; message: string }) => void;
}) => {
    const postUrl = await convex.mutation(api.upload.generateUploadUrl, {});

    const imageResp = await fetch(msg.data.src);
    if (!imageResp.ok) throw new Error('Failed to download image');
    const blob = await imageResp.blob();

    const result = await fetch(postUrl, {
      method: 'POST',
      headers: { 'Content-Type': blob.type || 'application/octet-stream' },
      body: blob,
    });
    if (!result.ok) throw new Error('Upload failed');

    const { storageId } = await result.json();
    const { width, height } = (await getImageDimensions(blob)) as {
      width: number;
      height: number;
    };
    const docId = await convex.mutation(api.upload.saveImageCapture, {
      storageId,
      src: msg.data.src,
      alt: msg.data.alt ?? undefined,
      url: msg.data.url || 'unknown',
      timestamp: Date.now(),
      width,
      height,
      category: msg.data.category ?? undefined,
      tags: Array.isArray(msg.data.tags) ? msg.data.tags : undefined,
      title: typeof msg.data.title === 'string' ? msg.data.title : undefined,
      note: typeof msg.data.note === 'string' ? msg.data.note : undefined,
    });

    // ── Local CLIP embedding (no API call) ──────────────────────────
    // Generates a 512-dim vector from the image using Transformers.js.
    // This is the only embedding path: the OpenAI fallback was removed so
    // that saving a capture never incurs API cost.
    try {
      if (docId) {
        const { embedImageFromUrl } = await import('./local-embeddings');
        const localVec = await embedImageFromUrl(msg.data.src);
        if (localVec && localVec.length > 0) {
          await convex.mutation((api as any).local_ai.patchLocalEmbedding, {
            id: docId,
            localEmbedding: localVec,
          });
          console.log('[save-image] ✅ Local CLIP embedding saved (' + localVec.length + 'd)');
        }
      }
    } catch (e) {
      // No API fallback by design; the capture is still saved, just without a
      // vector, and can be picked up by a later re-index.
      console.warn('[save-image] Local embedding failed:', e);
    }

    if (Array.isArray(msg.data.tags)) {
      try {
        await convex.mutation(api.upload.upsertTags, { names: msg.data.tags });
      } catch {}
    }

    sendResponse({ statusCode: 200, message: 'Image capture saved' });
    return;
}