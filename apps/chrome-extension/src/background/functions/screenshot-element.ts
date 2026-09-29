import type { ConvexClient } from "convex/browser";
import { api } from "../../../../../packages/backend/convex/_generated/api";
// Static imports: see the note in save-image-capture.ts (MV3 importScripts).
import { deriveMetadata } from "./derive-metadata";
import { assignToSession, enrichImageCapture } from "./finish-image-capture";
import {
    assertImageSize,
    computeCropBox,
    cropToPng,
    deriveImageExtras,
    uploadBlob,
    type CropBox,
} from "./image-processing";

/** Kinds a tab screenshot may be saved as; anything else is a region shot. */
function captureKind(kind: unknown): 'screenshot' | 'element' | 'viewport' {
    return kind === 'element' || kind === 'viewport' ? kind : 'screenshot';
}

/**
 * Screenshot the sender's tab, crop it to `msg.rect` and save it.
 *
 * All image work happens here, so the content script only sends a rectangle
 * and metadata (`msg.meta`: kind, tagName, clipped, category, tags and, for
 * elements, the Design DNA). Resolves once the capture is stored and filed,
 * with the session it joined; embedding and auto-tags continue afterwards so
 * the page can confirm the save straight away.
 */
export const screenshotElement = async ({
    msg, sender, convex
}: {
    msg: any;
    sender: chrome.runtime.MessageSender;
    convex: ConvexClient;
}): Promise<{ sessionName: string | null }> => {
    const tab = sender?.tab;
    if (!tab?.id) throw new Error('No tab to capture');

    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
    if (!dataUrl) throw new Error('Could not capture the tab');
    const shot = await createImageBitmap(await (await fetch(dataUrl)).blob());

    const meta = msg.meta ?? {};
    const kind = captureKind(meta.kind);
    const rect = msg.rect ?? {};
    const dpr = Number(rect.dpr) > 0 ? Number(rect.dpr) : 1;

    // A viewport shot is the whole capture; anything else is cut to its rect.
    const box: CropBox | null =
        kind === 'viewport'
            ? { sx: 0, sy: 0, sw: shot.width, sh: shot.height, clipped: false }
            : computeCropBox(
                { x: Number(rect.x) || 0, y: Number(rect.y) || 0, width: Number(rect.width) || 0, height: Number(rect.height) || 0 },
                dpr,
                shot.width,
                shot.height
              );
    if (!box) {
        shot.close();
        throw new Error('The selected area is not visible on screen.');
    }

    const { blob, bitmap } = await cropToPng(shot, box);
    shot.close();
    try {
        assertImageSize(blob);
        const storageId = await uploadBlob(convex, blob, 'image/png');
        const { thumbStorageId, palette } = await deriveImageExtras(convex, bitmap);

        const width = Math.round(box.sw / dpr);
        const height = Math.round(box.sh / dpr);
        const clipped = kind === 'screenshot' ? undefined : !!meta.clipped || box.clipped;
        // DNA only for picked elements, and it must agree with the final crop.
        const designDna =
            kind === 'element' && meta.designDna && typeof meta.designDna === 'object'
                ? { ...meta.designDna, source: { ...meta.designDna.source, clipped: !!clipped } }
                : undefined;
        const tags: string[] | undefined = Array.isArray(meta.tags) ? meta.tags : undefined;
        const pageUrl = typeof rect.url === 'string' ? rect.url : 'unknown';

        const docId = await convex.mutation(api.upload.saveImageCapture, {
            storageId,
            thumbStorageId,
            palette,
            designDna,
            src: undefined,
            alt: 'screenshot',
            url: pageUrl,
            timestamp: Date.now(),
            width,
            height,
            category: typeof meta.category === 'string' ? meta.category : undefined,
            tags,
            kind,
            tagName: kind === 'element' && typeof meta.tagName === 'string' ? meta.tagName : undefined,
            clipped,
        });

        // Signals that need no model: source domain and image shape.
        const derived = deriveMetadata({ url: pageUrl, width, height });
        const sessionName = await assignToSession(convex, docId, derived, tags, 'screenshot');

        // Not awaited: the model takes seconds and the user already has the
        // confirmation. Failures are logged and left for a re-index.
        void enrichImageCapture(convex, { docId, image: blob, derived, userTags: tags, logTag: 'screenshot' });
        return { sessionName };
    } finally {
        bitmap.close();
    }
}
