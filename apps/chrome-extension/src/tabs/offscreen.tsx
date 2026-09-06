/**
 * Offscreen document for running Transformers.js (CLIP) inference.
 *
 * Service workers can't run WASM threads (no URL.createObjectURL, no Atomics.wait).
 * This offscreen page has full DOM access, so ONNX Runtime works perfectly here.
 * The service worker communicates with this page via chrome.runtime messages.
 */

/* ─── Transformers.js model management ─────────────────────────── */

let _tokenizer: any = null
let _textModel: any = null
let _processor: any = null
let _visionModel: any = null
let _transformers: any = null

const MODEL_ID = "Xenova/clip-vit-base-patch32"

async function getTransformers() {
  if (!_transformers) {
    _transformers = await import("@xenova/transformers")
    _transformers.env.allowLocalModels = false
    _transformers.env.useBrowserCache = true
  }
  return _transformers
}

async function ensureTextModel() {
  if (_tokenizer && _textModel) return
  const T = await getTransformers()
  if (!_tokenizer) _tokenizer = await T.AutoTokenizer.from_pretrained(MODEL_ID)
  if (!_textModel)
    _textModel = await T.CLIPTextModelWithProjection.from_pretrained(MODEL_ID)
}

async function ensureVisionModel() {
  if (_processor && _visionModel) return
  const T = await getTransformers()
  if (!_processor) _processor = await T.AutoProcessor.from_pretrained(MODEL_ID)
  if (!_visionModel)
    _visionModel =
      await T.CLIPVisionModelWithProjection.from_pretrained(MODEL_ID)
}

async function embedText(text: string): Promise<number[]> {
  await ensureTextModel()
  const inputs = _tokenizer([text], { padding: true, truncation: true })
  const { text_embeds } = await _textModel(inputs)
  return Array.from(text_embeds.data as Float32Array).map(Number)
}

async function embedImageFromUrl(imageUrl: string): Promise<number[]> {
  const T = await getTransformers()
  await ensureVisionModel()
  const image = await T.RawImage.fromURL(imageUrl)
  const inputs = await _processor(image)
  const { image_embeds } = await _visionModel(inputs)
  return Array.from(image_embeds.data as Float32Array).map(Number)
}

async function warmup() {
  await Promise.all([ensureTextModel(), ensureVisionModel()])
}

/* ─── Message handler (receives requests from service worker) ──── */

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.target !== "offscreen") return false

  ;(async () => {
    try {
      switch (msg.type) {
        case "EMBED_TEXT": {
          const vector = await embedText(String(msg.text ?? ""))
          sendResponse({ vector })
          break
        }
        case "EMBED_IMAGE_URL": {
          const vector = await embedImageFromUrl(String(msg.url ?? ""))
          sendResponse({ vector })
          break
        }
        case "WARMUP": {
          await warmup()
          sendResponse({ ok: true })
          break
        }
        case "PING": {
          sendResponse({ ok: true })
          break
        }
        default:
          sendResponse({ error: "Unknown offscreen message type: " + msg.type })
      }
    } catch (e: any) {
      console.error("[Offscreen] Error handling message:", e)
      sendResponse({ error: e?.message || String(e) })
    }
  })()

  return true // keep channel open for async sendResponse
})

/* ─── Auto-warmup on load ──────────────────────────────────────── */

warmup()
  .then(() => console.log("[Offscreen] ✅ CLIP models loaded and ready"))
  .catch((e: any) => console.warn("[Offscreen] Model warmup deferred:", e))

/* ─── React component (required by Plasmo tabs, renders nothing) ─ */

export default function OffscreenPage() {
  return null
}
