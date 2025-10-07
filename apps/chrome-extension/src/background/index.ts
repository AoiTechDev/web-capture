import { createClerkClient } from '@clerk/chrome-extension/background';
import { ConvexClient } from "convex/browser";
import { api } from "../../../../packages/backend/convex/_generated/api";
import { getImageDimensions } from "~utlis-content/get-image-dimensions";

console.log('[Service Worker]: Loaded')

const publishableKey = process.env.PLASMO_PUBLIC_CLERK_PUBLISHABLE_KEY
if (!publishableKey) {
  throw new Error('Please add the PLASMO_PUBLIC_CLERK_PUBLISHABLE_KEY to the .env.development file')
}

const convex = new ConvexClient(process.env.PLASMO_PUBLIC_CONVEX_URL!);

async function getToken() {
  const clerk = await createClerkClient({
    publishableKey,
    syncHost: process.env.PLASMO_PUBLIC_CLERK_SYNC_HOST
  });

  if (!clerk.session) {
    return null;
  }

  const token = await clerk.session?.getToken({ template: 'convex' });
  console.log('[Service Worker]: Fetched Clerk token (convex template):', token ? 'present' : 'null')
  if (token) {
    try {
      const [, payloadB64] = token.split('.');
      const json = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(payloadB64), c => c.charCodeAt(0))));
      console.log('[Service Worker]: JWT claims:', {
        iss: json.iss,
        aud: json.aud,
        sub: json.sub,
        tokenIdentifier: json.tokenIdentifier,
        exp: json.exp,
      })
    } catch (e) {
      console.warn('[Service Worker]: Failed to decode JWT payload for logging')
    }
  }
  return token ?? null
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  console.log('[Service Worker]: Handling message')
  ;(async () => {
    try {
      const token = await getToken();
      console.log('[Service Worker]: Setting Convex auth token:', token ? 'present' : 'null')
      if (token) convex.setAuth(async () => token);
      else convex.setAuth(async () => null);

      if (msg && typeof msg === 'object' && 'type' in msg) {

        // Check authentication status
        if (msg.type === 'CHECK_AUTH') {
          const isAuthenticated = token !== null;
          sendResponse({ isAuthenticated, token: isAuthenticated ? token : null });
          return;
        }


        if (msg.type === 'GET_CATEGORIES') {
          const categories = await convex.query(api.captures.listCategories, {});
          sendResponse({ categories });
          return;
        }

        if (msg.type === 'GET_TAGS') {
          const tags = await convex.query(api.captures.listTags, {});
          sendResponse({ tags });
          return;
        }

        if (msg.type === 'CREATE_CATEGORY') {
          const id = await convex.mutation(api.upload.createCategory, {
            name: String(msg.name ?? '').trim(),
          });
          sendResponse({ id });
          return;
        }

        if (msg.type === 'SAVE_NON_IMAGE_CAPTURE') {
          const captureData = {
            kind: msg.data.kind,
            ...msg.data,
            url: msg.data.url || 'unknown',
            timestamp: Date.now(),
          };
          if (Array.isArray((captureData as any).tags)) {
            try {
              await convex.mutation(api.upload.upsertTags, { names: (captureData as any).tags });
            } catch {}
          }
          await convex.mutation(api.upload.uploadCapture, {
            capture: captureData,
          });
          sendResponse({ statusCode: 200, message: 'Non-image capture saved' });
          return;
        }

        if (msg.type === 'SAVE_IMAGE_CAPTURE') {
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
          console.log('[Service Worker]: Uploaded image to Convex storage, storageId:', storageId)
          const { width, height } = (await getImageDimensions(blob)) as {
            width: number;
            height: number;
          };
          console.log('[Service Worker]: Image dimensions:', { width, height })
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

        if (msg.type === 'SCREENSHOT_ELEMENT') {
          const dataUrl = await new Promise<string>((resolve, reject) => {
            try {
              chrome.tabs.captureVisibleTab(
                { format: 'png', quality: 100 },
                (url) => {
                  if (chrome.runtime.lastError || !url) reject(chrome.runtime.lastError);
                  else resolve(url);
                }
              );
            } catch (e) {
              reject(e);
            }
          });
          if (sender?.tab?.id) {
            chrome.tabs.sendMessage(sender.tab.id, {
              type: 'CROP_AND_UPLOAD',
              dataUrl,
              rect: msg.rect,
            });
          }
          sendResponse({ statusCode: 200, message: 'Screenshot captured' });
          return;
        }

        if (msg.type === 'UPLOAD_CROPPED_IMAGE') {
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
          console.log('[Service Worker]: Uploaded cropped image, storageId:', storageId)

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

        if (msg.type === 'UPLOAD_CROPPED_DATAURL') {
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
          console.log('[Service Worker]: Uploaded cropped dataUrl, storageId:', storageId)

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
      }

      const tokenForCaller = await getToken();
      console.log('[Service Worker]: Sending token in response')
      console.log('[Service Worker]:', tokenForCaller)
      sendResponse({ token: tokenForCaller })
    } catch (error) {
      console.error('[Service Worker]: Error occured -> ', JSON.stringify(error))
      if (error && typeof error === 'object') {
        console.error('[Service Worker]: Error details -> ', error)
      }
      sendResponse({ token: null, statusCode: 500, message: 'Failed to handle message' })
    }
  })();
  return true;
});


