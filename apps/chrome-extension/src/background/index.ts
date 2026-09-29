import { createClerkClient } from '@clerk/chrome-extension/background';
import { ConvexClient } from "convex/browser";
import { api } from "../../../../packages/backend/convex/_generated/api";
import { saveNonImageCapture } from '~background/functions/save-non-image-capture';
import { saveImageCapture } from '~background/functions/save-image-capture';
import { screenshotElement } from '~background/functions/screenshot-element';
// Static: reindex is reached from a message handler, past the point where an
// MV3 worker is still allowed to importScripts().
import { runReindex, isReindexing } from '~background/functions/reindex';
import { broadcastSessionState } from '~background/functions/session-broadcast';
import { kickProcessingQueue, notifySignedIn, startProcessingQueue } from '~background/functions/processing-queue';
import { embedText } from '~background/functions/local-embeddings';
import { imageQueryText } from '../../../../packages/backend/convex/lib/ai_config';


const publishableKey = process.env.PLASMO_PUBLIC_CLERK_PUBLISHABLE_KEY
if (!publishableKey) {
  throw new Error('Please add the PLASMO_PUBLIC_CLERK_PUBLISHABLE_KEY to the .env.development file')
}

const convex = new ConvexClient(process.env.PLASMO_PUBLIC_CONVEX_URL!);

// Build marker: prints on every service worker start. If the value below
// does not match the running console output, Chrome is serving a cached
// worker and the extension needs a real reload.
const BUILD_MARKER = 'phase-3 ai-queue 2026-09-29';
console.log('[Service Worker] BUILD:', BUILD_MARKER);

/* ─── Auth ──────────────────────────────────────────────────────── */

type ClerkClient = Awaited<ReturnType<typeof createClerkClient>>;

// A signed-in Clerk client is kept for the worker's lifetime: creating one
// loads the client from Clerk's API, too slow to repeat on every message.
let clerkPromise: Promise<ClerkClient> | null = null;

function loadClerk(): Promise<ClerkClient> {
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
  // A signed-out client never learns about a sign-in made in the popup or on
  // the web app, so it is only reused while it has a session.
  return clerk.session ? clerk : loadClerk();
}

async function tokenFrom(clerk: ClerkClient, forceRefresh: boolean): Promise<string | null> {
  if (!clerk.session) return null;
  return (await clerk.session.getToken({ template: 'convex', skipCache: forceRefresh })) ?? null;
}

/** A Convex JWT for the signed-in user, or null. Never leaves the worker. */
async function getToken(forceRefresh = false): Promise<string | null> {
  try {
    return await tokenFrom(await getClerk(), forceRefresh);
  } catch (e) {
    // A cached session can go stale (revoked, expired while the worker slept):
    // retry once on a freshly loaded client before reporting signed out.
    console.warn('[Service Worker]: Session token failed, reloading Clerk:', e);
    try {
      return await tokenFrom(await loadClerk(), true);
    } catch (e2) {
      console.warn('[Service Worker]: Could not get a session token:', e2);
      clerkPromise = null;
      return null;
    }
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
    // Signed in (at start, or later from the popup / web app): wake the queue.
    if (signedIn) void notifySignedIn();
  }
  return signedIn;
}

/**
 * Messages that save something; each answers { ok, sessionName } once the
 * capture is stored, so the page can say where it went.
 */
const CAPTURE_MESSAGES = new Set([
  'SAVE_NON_IMAGE_CAPTURE',
  'SAVE_IMAGE_CAPTURE',
  'SCREENSHOT_ELEMENT',
]);

function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === 'object' && 'message' in e) return String((e as any).message);
  return String(e ?? 'Unknown error');
}

/**
 * Search the caller's captures through the one hybrid search action. With
 * `embed`, the query is embedded twice - caption-phrased for image captures,
 * raw for text captures - and fused with keyword hits; without it (or if the
 * model is unavailable) the same action runs keyword-only.
 */
async function searchCaptures(q: string, limit: number, embed: boolean) {
  let vectors: { vector?: number[]; textVector?: number[] } = {};
  if (embed && q) {
    try {
      // Sequential: the offscreen document runs one inference at a time.
      const vector = await embedText(imageQueryText(q));
      const textVector = await embedText(q);
      vectors = { vector, textVector };
    } catch (e) {
      console.log('[Search] query embedding unavailable, keyword only:', e);
    }
  }
  const { results, diagnostics } = await convex.action(api.search.searchCaptures, {
    query: q,
    limit,
    ...vectors,
  });
  console.log('[Search]', JSON.stringify(q), '->', results.length, 'results', JSON.stringify(diagnostics));
  return { results, mode: vectors.vector ? 'hybrid' : 'keyword' };
}

// ── Enrichment queue: embeds and tags pending captures locally ──
// Started unconditionally: signed out it just waits, and syncAuth wakes it
// (notifySignedIn) as soon as a session appears.
void startProcessingQueue(convex, { isSignedIn: syncAuth });

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
          // isAuthenticated: the field name content scripts from older builds
          // read, so tabs opened before an update don't report signed out.
          sendResponse({ signedIn, isAuthenticated: signedIn });
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
            let saved: { sessionName: string | null };
            if (msg.type === 'SAVE_NON_IMAGE_CAPTURE') {
              saved = await saveNonImageCapture({
                captureData: {
                  kind: msg.data.kind,
                  ...msg.data,
                  url: msg.data.url || 'unknown',
                  timestamp: Date.now(),
                },
                convex,
              });
            } else if (msg.type === 'SAVE_IMAGE_CAPTURE') {
              saved = await saveImageCapture({ msg, convex });
            } else {
              saved = await screenshotElement({ msg, sender, convex });
            }
            sendResponse({ ok: true, sessionName: saved.sessionName });
            // Saved as pending; analyse it now rather than on the next update.
            void kickProcessingQueue();
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

        // Hybrid search: image-space and text-space vector hits fused with
        // keyword hits. Kept as two message types for content scripts built
        // before the merge; SEARCH_CAPTURES skips the model.
        if (msg.type === 'SEARCH_SEMANTIC' || msg.type === 'SEARCH_CAPTURES') {
          const q = String((msg as any).q ?? '').trim();
          const limit = typeof (msg as any).limit === 'number' ? (msg as any).limit : 30;
          try {
            sendResponse(await searchCaptures(q, limit, msg.type === 'SEARCH_SEMANTIC'));
          } catch (e) {
            console.error('[Search] failed:', e);
            sendResponse({ results: [], mode: 'error' });
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
          const { remaining } = await convex.query(api.local_ai.listNeedingEmbedding, { limit: 1 });
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


