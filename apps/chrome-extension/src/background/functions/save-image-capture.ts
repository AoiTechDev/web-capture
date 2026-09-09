import type { ConvexClient } from "convex/browser";
import { api } from "../../../../../packages/backend/convex/_generated/api";
import { getImageDimensions } from "~contents/utils/image-utils";
// Static, not dynamic: an MV3 service worker may only call importScripts()
// during initial evaluation, and Parcel compiles runtime import() to exactly
// that. A dynamic import here fails with a NetworkError at message time.
import { deriveMetadata, mergeTags } from "./derive-metadata";
import { broadcastSessionState } from "./session-broadcast";
import { suggestTags } from "./auto-tag";
import { embedImageFromUrl } from "./local-embeddings";

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
    // Signals that need no model: source domain and image shape.
    const derived = deriveMetadata({ url: msg.data.url, width, height });

    // Join the session before the model runs. Embedding takes seconds, and the
    // on-page indicator should move the instant something is captured, not once
    // inference finishes.
    if (docId) {
      try {
        const assigned = await convex.mutation((api as any).sessions.assignCapture, {
          captureId: docId,
          domain: derived.domain ?? undefined,
          tags: mergeTags(msg.data.tags, derived.tags),
        });
        if (assigned?.assigned) void broadcastSessionState(convex);
      } catch (e) {
        console.warn('[save-image] Failed to assign session:', e);
      }
    }

    let autoTags: string[] = [];
    try {
      if (docId) {
        const localVec = await embedImageFromUrl(msg.data.src);
        if (localVec && localVec.length > 0) {
          await convex.mutation((api as any).local_ai.patchLocalEmbedding, {
            id: docId,
            localEmbedding: localVec,
          });
          console.log('[save-image] ✅ Local CLIP embedding saved (' + localVec.length + 'd)');

          // Zero-shot classification against the label vocabulary. Same vector,
          // no extra inference on the image itself.
          const suggested = await suggestTags(localVec);
          autoTags = suggested.map((t) => t.tag);
          console.log('[save-image] auto tags:', suggested.map((t) => `${t.tag} (${t.score.toFixed(3)})`).join(', '));
        }
      }
    } catch (e) {
      // No API fallback by design; the capture is still saved, just without a
      // vector, and can be picked up by a later re-index.
      console.warn('[save-image] Local embedding failed:', e);
    }

    // User-supplied tags win over derived ones, which win over model guesses.
    const allTags = mergeTags(msg.data.tags, derived.tags, autoTags);
    if (allTags.length && docId) {
      try {
        await convex.mutation((api as any).local_ai.applyAutoMetadata, {
          id: docId,
          tags: allTags,
          domain: derived.domain ?? undefined,
        });
        await convex.mutation(api.upload.upsertTags, { names: allTags });
      } catch (e) {
        console.warn('[save-image] Failed to apply auto metadata:', e);
      }
    }

    // Carry the model's tags into the session now that they exist. The item was
    // already counted above, so this only widens the session's tag aggregate.
    if (docId && autoTags.length) {
      try {
        const merged = await convex.mutation((api as any).sessions.mergeCaptureTags, {
          captureId: docId,
          tags: allTags,
        });
        if (merged?.merged) void broadcastSessionState(convex);
      } catch (e) {
        console.warn('[save-image] Failed to merge session tags:', e);
      }
    }

    sendResponse({ statusCode: 200, message: 'Image capture saved' });
    return;
}