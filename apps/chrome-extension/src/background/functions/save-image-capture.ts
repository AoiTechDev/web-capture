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
    await convex.mutation(api.upload.saveImageCapture, {
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
    if (Array.isArray(msg.data.tags)) {
      try {
        await convex.mutation(api.upload.upsertTags, { names: msg.data.tags });
      } catch {}
    }

    sendResponse({ statusCode: 200, message: 'Image capture saved' });
    return;
}