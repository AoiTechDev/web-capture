import { api } from "../../../../../packages/backend/convex/_generated/api";
import type { ConvexClient } from "convex/browser";
// Static imports: see the note in save-image-capture.ts (MV3 importScripts).
import { deriveMetadata, mergeTags } from "./derive-metadata";
import { broadcastSessionState } from "./session-broadcast";
import { suggestTags } from "./auto-tag";
import { embedImageFromUrl } from "./local-embeddings";

/** Kinds a cropped screenshot may be saved as; anything else is a region shot. */
function captureKind(kind: unknown): 'screenshot' | 'element' | 'viewport' {
    return kind === 'element' || kind === 'viewport' ? kind : 'screenshot';
}

/** Resolves once the capture is stored; throws if it could not be saved. */
export const uploadCroppedDataurl = async ({msg, convex}:{
    msg: any;
    convex: ConvexClient;
}): Promise<void> => {
    const res = await fetch(msg.dataUrl as string);
    const blob = await res.blob();
    const postUrl = await convex.mutation(api.upload.generateUploadUrl, {});
    const uploadRes = await fetch(postUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'image/png' },
      body: blob,
    });
    if (!uploadRes.ok) throw new Error(`Upload failed (HTTP ${uploadRes.status})`);
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
      kind: captureKind(msg.kind),
      tagName: typeof msg.tagName === 'string' ? msg.tagName : undefined,
      clipped: typeof msg.clipped === 'boolean' ? msg.clipped : undefined,
    });
    // Signals that need no model: source domain and image shape.
    const derived = deriveMetadata({ url: msg.url, width: msg.width, height: msg.height });

    // Join the session before the model runs, so the indicator reacts at
    // capture time rather than after inference.
    if (docId) {
      try {
        const assigned = await convex.mutation((api as any).sessions.assignCapture, {
          captureId: docId,
          domain: derived.domain ?? undefined,
          tags: mergeTags(msg.tags, derived.tags),
        });
        if (assigned?.assigned) void broadcastSessionState(convex);
      } catch (e) {
        console.warn('[screenshot] Failed to assign session:', e);
      }
    }

    let autoTags: string[] = [];
    try {
      if (docId) {
        const localVec = await embedImageFromUrl(msg.dataUrl as string);
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

    // Carry the model's tags into the session; the item is already counted.
    if (docId && autoTags.length) {
      try {
        const merged = await convex.mutation((api as any).sessions.mergeCaptureTags, {
          captureId: docId,
          tags: allTags,
        });
        if (merged?.merged) void broadcastSessionState(convex);
      } catch (e) {
        console.warn('[screenshot] Failed to merge session tags:', e);
      }
    }
}