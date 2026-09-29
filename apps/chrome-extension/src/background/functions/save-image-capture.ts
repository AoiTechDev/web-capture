import type { ConvexClient } from "convex/browser";
import { api } from "../../../../../packages/backend/convex/_generated/api";
// Static, not dynamic: an MV3 service worker may only call importScripts()
// during initial evaluation, and Parcel compiles runtime import() to exactly
// that. A dynamic import here fails with a NetworkError at message time.
import { deriveMetadata } from "./derive-metadata";
import { applyDerivedMetadata, assignToSession } from "./finish-image-capture";
import { assertImageSize, deriveImageExtras, uploadBlob } from "./image-processing";

/**
 * Save an image from the page: download it, store it with a thumbnail and a
 * pixel palette, and file it in the running session. Resolves once the
 * capture is stored, with the session it joined; throws if it was not saved.
 */
export const saveImageCapture = async ({
    msg, convex
}: {
    msg: any;
    convex: ConvexClient;
}): Promise<{ sessionName: string | null }> => {
    const imageResp = await fetch(msg.data.src);
    if (!imageResp.ok) throw new Error(`Failed to download image (HTTP ${imageResp.status})`);
    const blob = await imageResp.blob();
    assertImageSize(blob);

    // One decode serves the dimensions, the thumbnail and the palette.
    const bitmap = await createImageBitmap(blob);
    const { width, height } = bitmap;
    let extras;
    try {
      extras = await deriveImageExtras(convex, bitmap);
    } finally {
      bitmap.close();
    }

    const storageId = await uploadBlob(convex, blob);
    const tags: string[] | undefined = Array.isArray(msg.data.tags) ? msg.data.tags : undefined;
    const docId = await convex.mutation(api.upload.saveImageCapture, {
      storageId,
      thumbStorageId: extras.thumbStorageId,
      palette: extras.palette,
      src: msg.data.src,
      alt: msg.data.alt ?? undefined,
      url: msg.data.url || 'unknown',
      timestamp: Date.now(),
      width,
      height,
      category: msg.data.category ?? undefined,
      tags,
      title: typeof msg.data.title === 'string' ? msg.data.title : undefined,
      note: typeof msg.data.note === 'string' ? msg.data.note : undefined,
    });

    // Signals that need no model: source domain and image shape.
    const derived = deriveMetadata({ url: msg.data.url, width, height });

    // Join the session before the model runs, so the indicator and the toast
    // react at capture time rather than once inference finishes.
    const sessionName = await assignToSession(convex, docId, derived, tags, 'save-image');

    // Domain and shape tags now; the embedding and AI labels come from the
    // processing queue, which the caller kicks once this resolves.
    void applyDerivedMetadata(convex, { docId, derived, userTags: tags, logTag: 'save-image' });
    return { sessionName };
}
