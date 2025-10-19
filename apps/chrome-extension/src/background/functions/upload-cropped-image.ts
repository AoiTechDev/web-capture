import type { ConvexClient } from "convex/browser";
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

    await convex.mutation(api.upload.saveImageCapture, {
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
    });
    if (Array.isArray(msg.tags)) {
      try {
        await convex.mutation(api.upload.upsertTags, { names: msg.tags });
      } catch {}
    }

    sendResponse({ statusCode: 200, message: 'Screenshot saved' });
    return;
}