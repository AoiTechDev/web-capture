import { api } from "../../../../../packages/backend/convex/_generated/api";
import type { ConvexClient } from "convex/browser";

export const uploadCroppedDataurl = async ({msg, convex, sendResponse}:{
    msg: any;
    convex: ConvexClient;
    sendResponse: (response: { statusCode: number; message: string }) => void;
}) => {
    const res = await fetch(msg.dataUrl as string);
    const blob = await res.blob();
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
      kind: 'screenshot',
    });
    try {
      if (docId) {
        await convex.action(api.ai.generateImageCaptionAndEmbedding, { captureId: docId as any });
      }
    } catch {}
    if (Array.isArray(msg.tags)) {
      try {
        await convex.mutation(api.upload.upsertTags, { names: msg.tags });
      } catch {}
    }

    sendResponse({ statusCode: 200, message: 'Screenshot saved' });
    return; 
}