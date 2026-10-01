/**
 * Local embedding generation with SigLIP2 (lib/ai_config LOCAL_MODEL_ID) via
 * an offscreen document.
 *
 * Service workers can't run WASM threads, so the actual Transformers.js
 * inference runs in an offscreen document (tabs/offscreen.html) which has
 * full DOM access. This module creates that document and communicates via
 * chrome.runtime messages.
 *
 * Public API is unchanged — callers still use embedText / embedImageFromUrl etc.
 */

const OFFSCREEN_URL = "tabs/offscreen.html"

/* ─── Offscreen document lifecycle ─────────────────────────────── */

let _creating: Promise<void> | null = null

async function ensureOffscreen(): Promise<void> {
  // Check if offscreen document already exists
  if ("getContexts" in chrome.runtime) {
    const contexts = await (chrome.runtime as any).getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT"],
      documentUrls: [chrome.runtime.getURL(OFFSCREEN_URL)],
    })
    if (contexts.length > 0) return
  }

  // Avoid creating multiple offscreen documents simultaneously
  if (_creating) {
    await _creating
    return
  }

  try {
    _creating = (chrome.offscreen as any).createDocument({
      url: OFFSCREEN_URL,
      reasons: ["WORKERS"],
      justification: "Run the local ML model for content embedding",
    })
    await _creating
  } catch (e: any) {
    // "Only a single offscreen document may be created" — already exists
    if (!e?.message?.includes("single offscreen")) throw e
  } finally {
    _creating = null
  }
}

/* ─── Message helper with retry ────────────────────────────────── */

async function sendToOffscreen(
  msg: Record<string, unknown>,
  retries = 3
): Promise<any> {
  await ensureOffscreen()

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await chrome.runtime.sendMessage({
        ...msg,
        target: "offscreen",
      })
      return response
    } catch (e) {
      if (attempt < retries) {
        // Offscreen script may still be loading — wait and retry
        await new Promise((r) => setTimeout(r, 300 * attempt))
      } else {
        throw e
      }
    }
  }
}

/* ─── Public API (same interface as before) ────────────────────── */

/**
 * Embed a text string with the model's text encoder (runs in offscreen doc).
 * Works for text captures, code, link descriptions, and search queries.
 * Returns a LOCAL_EMBEDDING_DIM vector (same space as embedImageFromUrl).
 */
export async function embedText(text: string): Promise<number[]> {
  const resp = await sendToOffscreen({ type: "EMBED_TEXT", text })
  if (resp?.error) throw new Error(resp.error)
  return resp.vector
}

/**
 * Embed an image from a URL with the model's vision encoder (runs in offscreen doc).
 * Returns a LOCAL_EMBEDDING_DIM vector (same space as embedText).
 */
export async function embedImageFromUrl(imageUrl: string): Promise<number[]> {
  const resp = await sendToOffscreen({ type: "EMBED_IMAGE_URL", url: imageUrl })
  if (resp?.error) throw new Error(resp.error)
  return resp.vector
}

/**
 * Pre-load the models in the offscreen document.
 * The first call downloads the model (~350 MB: text q8 283 MB + vision q4
 * 64 MB, cached afterwards).
 */
export async function warmup(): Promise<void> {
  const resp = await sendToOffscreen({ type: "WARMUP" })
  if (resp?.error) throw new Error(resp.error)
}
