import { createClerkClient } from '@clerk/chrome-extension/background';
import { ConvexClient } from "convex/browser";
import { api } from "../../../../packages/backend/convex/_generated/api";
import { saveNonImageCapture } from '~background/functions/save-non-image-capture';
import { saveImageCapture } from '~background/functions/save-image-capture';
import { screenshotElement } from '~background/functions/screenshot-element';
import { uploadCroppedImage } from '~background/functions/upload-cropped-image';
import { uploadCroppedDataurl } from '~background/functions/upload-cropped-dataurl';
// Static: reindex is reached from a message handler, past the point where an
// MV3 worker is still allowed to importScripts().
import { runReindex, isReindexing } from '~background/functions/reindex';
import { broadcastSessionState } from '~background/functions/session-broadcast';


const publishableKey = process.env.PLASMO_PUBLIC_CLERK_PUBLISHABLE_KEY
if (!publishableKey) {
  throw new Error('Please add the PLASMO_PUBLIC_CLERK_PUBLISHABLE_KEY to the .env.development file')
}

const convex = new ConvexClient(process.env.PLASMO_PUBLIC_CONVEX_URL!);

// Build marker: prints on every service worker start. If the value below
// does not match the running console output, Chrome is serving a cached
// worker and the extension needs a real reload.
const BUILD_MARKER = 'live-count 00:19:48';
console.log('[Service Worker] BUILD:', BUILD_MARKER);

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
      if (msg?.type?.startsWith?.('SEARCH')) {
        console.log('[Search] msg=', msg.type, 'authenticated=', token !== null);
      }

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
              // Action, not query: Convex vector search is only callable from
              // an action. Backed by the by_localEmbedding vector index rather
              // than a full scan of the user's captures.
              const { results, diagnostics } = await convex.action(
                (api as any).local_ai.searchIndexed,
                { vector, limit, minScore: 0.15 }
              );
              console.log('[Search] Local results:', results?.length, 'scores:', results?.map((r: any) => r.score?.toFixed(3)));
              console.log('[Search] diagnostics:', JSON.stringify(diagnostics, null, 2));
              if (results && results.length > 0) {
                sendResponse({ results, mode: 'local' });
                return;
              }
            }
          } catch (e) {
            console.log('[Service Worker] Local search unavailable, falling back to API:', e);
          }

          // No OpenAI fallback: if the local vector search found nothing the
          // caller drops through to SEARCH_CAPTURES (keyword) on its own.
          sendResponse({ results: [], mode: 'local-empty' });
          return;
        }

        if (msg.type === 'SEARCH_CAPTURES') {
          const q = String((msg as any).q ?? '').trim();
          const limit = typeof (msg as any).limit === 'number' ? (msg as any).limit : 30;
          try {
            const { results } = await convex.query(api.search.searchCapturesFallback, { q, limit });
            console.log('[Search] keyword fallback for', JSON.stringify(q), '->', results?.length ?? 0, 'results');
            sendResponse({ results });
          } catch (e) {
            console.error('[Search] keyword fallback threw:', e);
            sendResponse({ results: [] });
          }
          return;
        }

        if (msg.type === 'SESSION_STATUS') {
          const session = await convex.query((api as any).sessions.getActiveSession, {});
          sendResponse({ session });
          return;
        }

        if (msg.type === 'SESSION_START') {
          try {
            const args: { name?: string } = {};
            if (typeof msg.name === 'string' && msg.name.trim()) args.name = msg.name.trim();
            const res = await convex.mutation((api as any).sessions.startSession, args);
            console.log('[Session] started:', res);
            void broadcastSessionState(convex);
            sendResponse({ ok: true, sessionId: res?.sessionId ?? null });
          } catch (e) {
            console.error('[Session] start failed:', e);
            sendResponse({ ok: false, error: String((e as any)?.message ?? e) });
          }
          return;
        }

        // Single keystroke toggles recording; the shortcut should not require
        // the user to remember which state they are in.
        if (msg.type === 'SESSION_TOGGLE') {
          try {
            const current = await convex.query((api as any).sessions.getActiveSession, {});
            if (current) {
              await convex.mutation((api as any).sessions.endSession, {});
              void broadcastSessionState(convex);
              sendResponse({ ok: true, running: false });
            } else {
              await convex.mutation((api as any).sessions.startSession, {});
              void broadcastSessionState(convex);
              sendResponse({ ok: true, running: true });
            }
          } catch (e) {
            console.error('[Session] toggle failed:', e);
            sendResponse({ ok: false, error: String((e as any)?.message ?? e) });
          }
          return;
        }

        if (msg.type === 'SESSION_END') {
          try {
            const res = await convex.mutation((api as any).sessions.endSession, {});
            void broadcastSessionState(convex);
            sendResponse({ ok: !!res?.ok });
          } catch (e) {
            console.error('[Session] end failed:', e);
            sendResponse({ ok: false });
          }
          return;
        }

        if (msg.type === 'SESSION_RENAME') {
          try {
            await convex.mutation((api as any).sessions.renameSession, {
              id: msg.id,
              name: String(msg.name ?? ''),
            });
            void broadcastSessionState(convex);
            sendResponse({ ok: true });
          } catch (e) {
            console.error('[Session] rename failed:', e);
            sendResponse({ ok: false });
          }
          return;
        }

        if (msg.type === 'REINDEX_STATUS') {
          const { remaining } = await convex.query((api as any).local_ai.listNeedingEmbedding, { limit: 1 });
          sendResponse({ remaining, running: isReindexing() });
          return;
        }

        if (msg.type === 'REINDEX_START') {
          if (isReindexing()) {
            sendResponse({ started: false, reason: 'already running' });
            return;
          }
          // Acknowledge immediately: a full re-index runs for minutes, far past
          // the lifetime of this message channel. Progress is broadcast instead.
          sendResponse({ started: true });
          void runReindex({
            convex,
            maxItems: typeof msg.maxItems === 'number' ? msg.maxItems : undefined,
            onProgress: (p) => {
              chrome.runtime.sendMessage({ type: 'REINDEX_PROGRESS', progress: p }).catch(() => {
                // nothing listening (popup closed) - progress is advisory only
              });
            },
          }).catch((e) => console.error('[reindex] failed:', e));
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


