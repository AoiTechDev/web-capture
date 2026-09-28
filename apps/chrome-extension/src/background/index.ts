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

/* ─── Auth ──────────────────────────────────────────────────────── */

type ClerkClient = Awaited<ReturnType<typeof createClerkClient>>;

// One Clerk client for the worker's lifetime. Creating it loads the client
// from Clerk's API, which is far too slow to repeat on every message.
let clerkPromise: Promise<ClerkClient> | null = null;
let clerkLoadedAt = 0;

// A signed-out instance never learns about a sign-in made in the popup, so it
// is reloaded - but at most this often, not on every message.
const SIGNED_OUT_RELOAD_MS = 5_000;

function loadClerk(): Promise<ClerkClient> {
  clerkLoadedAt = Date.now();
  const p = createClerkClient({
    publishableKey: publishableKey!,
    syncHost: process.env.PLASMO_PUBLIC_CLERK_SYNC_HOST
  });
  clerkPromise = p;
  // A failed load must not be cached forever.
  p.catch(() => {
    if (clerkPromise === p) clerkPromise = null;
  });
  return p;
}

async function getClerk(): Promise<ClerkClient> {
  if (!clerkPromise) return loadClerk();
  const clerk = await clerkPromise;
  if (!clerk.session && Date.now() - clerkLoadedAt > SIGNED_OUT_RELOAD_MS) {
    return loadClerk();
  }
  return clerk;
}

/** A Convex JWT for the signed-in user, or null. Never leaves the worker. */
async function getToken(forceRefresh = false): Promise<string | null> {
  try {
    const clerk = await getClerk();
    if (!clerk.session) return null;
    const token = await clerk.session.getToken({ template: 'convex', skipCache: forceRefresh });
    return token ?? null;
  } catch (e) {
    // Session revoked or network failure: start from a fresh client next time.
    console.warn('[Service Worker]: Could not get a session token:', e);
    clerkPromise = null;
    return null;
  }
}

// Convex asks for a token itself, on connect and whenever the current one
// expires, and gets a fresh one from Clerk each time.
let convexSignedIn: boolean | null = null;

/**
 * Point the shared Convex client at the current auth state.
 *
 * setAuth is only called when the state flips (signed out -> in or back), not
 * per message: concurrent messages re-setting auth used to race each other.
 */
async function syncAuth(): Promise<boolean> {
  const signedIn = (await getToken()) !== null;
  if (signedIn !== convexSignedIn) {
    convexSignedIn = signedIn;
    convex.setAuth(({ forceRefreshToken }) => getToken(forceRefreshToken));
  }
  return signedIn;
}

/** Messages that save something; each answers { ok } once the save finished. */
const CAPTURE_MESSAGES = new Set([
  'SAVE_NON_IMAGE_CAPTURE',
  'SAVE_IMAGE_CAPTURE',
  'SCREENSHOT_ELEMENT',
  'UPLOAD_CROPPED_IMAGE',
  'UPLOAD_CROPPED_DATAURL',
]);

function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === 'object' && 'message' in e) return String((e as any).message);
  return String(e ?? 'Unknown error');
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
      const signedIn = await syncAuth();
      if (msg?.type?.startsWith?.('SEARCH')) {
        console.log('[Search] msg=', msg.type, 'authenticated=', signedIn);
      }

      if (msg && typeof msg === 'object' && 'type' in msg) {

        // Check authentication status. Only a boolean: the token itself is
        // never sent to a content script, where the page could get at it.
        if (msg.type === 'CHECK_AUTH') {
          sendResponse({ signedIn });
          return;
        }

        // Saves are awaited so the caller learns whether it worked and can
        // tell the user; the channel stays open because the listener returns true.
        if (CAPTURE_MESSAGES.has(msg.type)) {
          if (!signedIn) {
            sendResponse({ ok: false, error: 'Not signed in' });
            return;
          }
          try {
            if (msg.type === 'SAVE_NON_IMAGE_CAPTURE') {
              await saveNonImageCapture({
                captureData: {
                  kind: msg.data.kind,
                  ...msg.data,
                  url: msg.data.url || 'unknown',
                  timestamp: Date.now(),
                },
                convex,
              });
            } else if (msg.type === 'SAVE_IMAGE_CAPTURE') {
              await saveImageCapture({ msg, convex });
            } else if (msg.type === 'SCREENSHOT_ELEMENT') {
              await screenshotElement({ msg, sender });
            } else if (msg.type === 'UPLOAD_CROPPED_IMAGE') {
              await uploadCroppedImage({ msg, convex });
            } else {
              await uploadCroppedDataurl({ msg, convex });
            }
            sendResponse({ ok: true });
          } catch (e) {
            console.error(`[Service Worker]: ${msg.type} failed:`, e);
            sendResponse({ ok: false, error: errorMessage(e) });
          }
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

      sendResponse({ ok: false, error: 'Unknown message' })
    } catch (error) {
      console.error('[Service Worker]: Error occured -> ', JSON.stringify(error))
      if (error && typeof error === 'object') {
        console.error('[Service Worker]: Error details -> ', error)
      }
      sendResponse({ ok: false, error: 'Failed to handle message' })
    }
  })();
  return true;
});


