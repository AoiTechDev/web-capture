import type { ConvexClient } from "convex/browser";
// Static imports: see the note in save-image-capture.ts (MV3 importScripts).
import { deriveMetadata, mergeTags } from "./derive-metadata";
import { suggestTags } from "./auto-tag";
import { embedImageFromBlob } from "./local-embeddings";
import { api } from "../../../../../packages/backend/convex/_generated/api";

export const uploadCroppedImage = async ({msg, convex, sendResponse}:{
    msg: any;
    convex: ConvexClient;
    sendResponse: (response: { statusCode: number; message: string }) => void;
}) =>  {
    const bytes = new Uint8Array(msg.bytes as ArrayBuffer);
    const blob = new Blob([bytes], { type: 'image/png' });
    const postUrl = await convex.mutation(api.upload.generateUploadUrl, {});
    const uploadRes = await fetch(postUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'image/png' },
      body: blob,
    });
    if (!uploadRes.ok) throw new Error('Upload failed');
    const { storageId } = await uploadRes.json();

    const docId = await convex.mutation(api.upload.saveImageCapture, {
      storageId,
      src: undefined,
      alt: 'screenshot',
      url: msg.url || 'unknown',
      timestamp: Date.now(),
      width: msg.width,
      height: msg.height,
      category: msg.category ?? undefined,
      tags: Array.isArray(msg.tags) ? msg.tags : undefined,
      title: typeof msg.title === 'string' ? msg.title : undefined,
      note: typeof msg.note === 'string' ? msg.note : undefined,
      kind: msg.kind ?? undefined,
    });
    // Signals that need no model: source domain and image shape.
    const derived = deriveMetadata({ url: msg.url, width: msg.width, height: msg.height });

    let autoTags: string[] = [];
    try {
      if (docId) {
        const localVec = await embedImageFromBlob(blob);
        if (localVec && localVec.length > 0) {
          await convex.mutation((api as any).local_ai.patchLocalEmbedding, {
            id: docId,
            localEmbedding: localVec,
          });
          console.log('[screenshot] ✅ Local CLIP embedding saved (' + localVec.length + 'd)');

          const suggested = await suggestTags(localVec);
          autoTags = suggested.map((t) => t.tag);
          console.log('[screenshot] auto tags:', suggested.map((t) => `${t.tag} (${t.score.toFixed(3)})`).join(', '));
        }
      }
    } catch (e) {
      console.warn('[screenshot] Local embedding failed:', e);
    }

    const allTags = mergeTags(msg.tags, derived.tags, autoTags);
    if (allTags.length && docId) {
      try {
        await convex.mutation((api as any).local_ai.applyAutoMetadata, {
          id: docId,
          tags: allTags,
          domain: derived.domain ?? undefined,
        });
        await convex.mutation(api.upload.upsertTags, { names: allTags });
      } catch (e) {
        console.warn('[screenshot] Failed to apply auto metadata:', e);
      }
    }

    sendResponse({ statusCode: 200, message: 'Screenshot saved' });
    return;
}