import { createClerkClient } from '@clerk/chrome-extension/background';
import { ConvexClient } from "convex/browser";
import { api } from "../../../../packages/backend/convex/_generated/api";
import { getImageDimensions } from "~contents/utils/image-utils";
import { saveNonImageCapture } from '~background/functions/save-non-image-capture';
import { saveImageCapture } from '~background/functions/save-image-capture';
import { screenshotElement } from '~background/functions/screenshot-element';
import { uploadCroppedImage } from '~background/functions/upload-cropped-image';
import { uploadCroppedDataurl } from '~background/functions/upload-cropped-dataurl';


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
  if (token) {
    try {
      const [, payloadB64] = token.split('.');
      const json = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(payloadB64), c => c.charCodeAt(0))));
    } catch (e) {
      console.warn('[Service Worker]: Failed to decode JWT payload for logging')
    }
  }
  return token ?? null
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  ;(async () => {
    try {
      const token = await getToken();
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
         

          saveNonImageCapture({
            captureData: {
              kind: msg.data.kind,
              ...msg.data,
              url: msg.data.url || 'unknown',
              timestamp: Date.now(),
            },
            convex,
            sendResponse,
          });
        }

        if (msg.type === 'SAVE_IMAGE_CAPTURE') {
        
          saveImageCapture({
            msg,
            convex,
            sendResponse,
          });
        }

        if (msg.type === 'SCREENSHOT_ELEMENT') {
        
          screenshotElement({
            msg,
            sender,
            sendResponse,
          });
        }

        if (msg.type === 'UPLOAD_CROPPED_IMAGE') {
          
          uploadCroppedImage({
            msg,
            convex,
            sendResponse,
          });
        }

        if (msg.type === 'UPLOAD_CROPPED_DATAURL') {
         
          uploadCroppedDataurl({
            msg,
            convex,
            sendResponse,
          });
        }
      }

      const tokenForCaller = await getToken();
   
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


