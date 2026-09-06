import { createClerkClient } from '@clerk/chrome-extension/background';
import { ConvexClient } from "convex/browser";
import { api } from "../../../../packages/backend/convex/_generated/api";
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

// ── Pre-load CLIP models in the background so first capture is fast ──
// This is fire-and-forget; if it fails the models load lazily on first use.
import('./functions/local-embeddings')
  .then((m) => m.warmup())
  .then(() => console.log('[Service Worker] ✅ CLIP models pre-loaded'))
  .catch((e) => console.log('[Service Worker] CLIP warmup skipped:', e));

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

        if (msg.type === 'SEARCH_SEMANTIC') {
          const q = String((msg as any).q ?? '').trim();
          const limit = typeof (msg as any).limit === 'number' ? (msg as any).limit : 30;

          // ── Try local CLIP-based search first (no API call) ───────
          try {
            const { embedText } = await import('./functions/local-embeddings');
            const vector = await embedText(q);
            if (vector && vector.length > 0) {
              const { results } = await convex.query(
                (api as any).local_ai.searchByVector,
                { vector, limit, minScore: 0.19 }
              );
              console.log('[Search] Local results:', results?.length, 'scores:', results?.map((r: any) => r.score?.toFixed(3)));
              if (results && results.length > 0) {
                sendResponse({ results, mode: 'local' });
                return;
              }
            }
          } catch (e) {
            console.log('[Service Worker] Local search unavailable, falling back to API:', e);
          }

          // ── Fallback: original OpenAI API search (preserved) ──────
          try {
            const { results } = await convex.action((api as any).search.searchCapturesSemantic, { q, limit });
            sendResponse({ results, mode: 'semantic' });
          } catch (e) {
            sendResponse({ results: [], mode: 'semantic' });
          }
          return;
        }

        if (msg.type === 'SEARCH_CAPTURES') {
          const q = String((msg as any).q ?? '').trim();
          const limit = typeof (msg as any).limit === 'number' ? (msg as any).limit : 30;
          try {
            const { results } = await convex.query(api.search.searchCapturesFallback, { q, limit });
            sendResponse({ results });
          } catch (e) {
            sendResponse({ results: [] });
          }
          return;
        }

        if (msg.type === 'SEARCH_LINKS') {
          const q = String((msg as any).q ?? '').trim();
          const limit = typeof (msg as any).limit === 'number' ? (msg as any).limit : 30;
          console.log('[SEARCH_LINKS] Query:', q, 'Limit:', limit);
          try {
            const { results } = await convex.query((api as any).link_search.searchLinks, { q, limit });
            console.log('[SEARCH_LINKS] Results:', results?.length || 0, results);
            sendResponse({ results });
          } catch (e) {
            console.error('[SEARCH_LINKS] Error:', e);
            sendResponse({ results: [] });
          }
          return;
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


