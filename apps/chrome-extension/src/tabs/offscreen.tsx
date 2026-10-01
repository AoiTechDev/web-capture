/**
 * Offscreen document running the local model (SigLIP2 via
 * @huggingface/transformers) for the service worker.
 *
 * Service workers can't run ONNX Runtime's WASM backend, so inference runs
 * here and the worker talks to this page via chrome.runtime messages.
 *
 * MV3 forbids remote code, and the library's default is to fetch ONNX
 * Runtime's WASM and its JS loader from cdn.jsdelivr.net. So the runtime is
 * set up here before the library loads (see loadRuntime): the onnxruntime-web
 * bundle whose JS loader is built in, and the .wasm shipped inside the
 * extension. Threads would need cross-origin isolation, which an offscreen
 * document does not have, hence numThreads = 1. The model weights (data, not
 * code) still download from huggingface.co once and are then served from the
 * browser cache.
 */

import {
  LOCAL_MODEL_ID,
  LOCAL_TEXT_DTYPE,
  LOCAL_TEXT_MAX_TOKENS,
  LOCAL_VISION_DTYPE,
} from "../../../../packages/backend/convex/lib/ai_config"

/* ─── Model management ─────────────────────────────────────────── */

/**
 * The runtime's .wasm, shipped with the extension. Written as a `new URL()`
 * to the same file the ORT bundle refers to internally, so Parcel emits one
 * copy (a `url:` import made a second 27 MB copy).
 */
const ORT_WASM_URL = new URL(
  "../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.wasm",
  import.meta.url
).href

type Transformers = typeof import("@huggingface/transformers")

let _transformers: Promise<Transformers> | null = null
let _text: Promise<{ tokenizer: any; model: any }> | null = null
let _vision: Promise<{ processor: any; model: any }> | null = null

// Set in one place for the whole repo; see lib/ai_config.
const MODEL_ID = LOCAL_MODEL_ID

/**
 * The library takes an ONNX Runtime registered under this symbol instead of
 * its own import, and skips its CDN defaults when wasmPaths is already set.
 */
const ORT_SYMBOL = Symbol.for("onnxruntime")

/**
 * ONNX Runtime, configured to run from the extension's own files. The
 * `.bundle` build embeds the JS loader, which it uses when only the .wasm
 * path is overridden and it runs single-threaded; any other build imports
 * the loader from a URL, which an extension cannot serve through Parcel.
 *
 * onnxruntime-web is patched (patches/ at the repo root, pnpm
 * patchedDependencies): the bundle's em-pthread bootstrap, a
 * `new Worker(new URL(..., import.meta.url))`, is never reached with
 * numThreads = 1, but Parcel leaves its `import.meta` untranspiled, which
 * makes the chunk a syntax error in Plasmo's classic scripts.
 * tests/ort-bundle.test.ts fails if the installed bundle loses the patch.
 *
 * The library still bundles its own ORT import (Parcel resolves it to a
 * build without the loader); that copy is evaluated but never used.
 */
async function loadRuntime() {
  // Package dist/ paths, not a vendored copy: Parcel 2.9 (Plasmo) ignores
  // package.json "exports", so both ORT here and transformers.web.js below
  // (whose "main" is the Node build) are imported by file path.
  // @ts-ignore no typings at this path; only `env` is touched here
  const ort: any = await import("onnxruntime-web/dist/ort.webgpu.bundle.min.mjs")
  ort.env.wasm.wasmPaths = { wasm: ORT_WASM_URL }
  ort.env.wasm.numThreads = 1
  ort.env.wasm.proxy = false
  ;(globalThis as any)[ORT_SYMBOL] = ort
}

function getTransformers(): Promise<Transformers> {
  _transformers ??= retryable(
    (async () => {
      await loadRuntime()
      // Browser build by dist/ path: see loadRuntime.
      const T = (await import(
        // @ts-ignore no typings at this path; typed as the package below
        "@huggingface/transformers/dist/transformers.web.js"
      )) as Transformers
      if (T.env.backends.onnx.wasm?.wasmPaths !== (globalThis as any)[ORT_SYMBOL].env.wasm.wasmPaths) {
        throw new Error("ONNX Runtime was not taken from the extension; refusing to load it from a CDN")
      }
      T.env.allowLocalModels = false
      T.env.useBrowserCache = true
      // The runtime files are local already; no Cache-API copy of them.
      T.env.useWasmCache = false
      return T
    })(),
    () => (_transformers = null)
  )
  return _transformers
}

/** A failed load is not cached, so the next request retries it. */
function retryable<T>(p: Promise<T>, reset: () => void): Promise<T> {
  p.catch(() => reset())
  return p
}

/**
 * Per-model load options, a fresh object on every call: a shared one has made
 * a model load the other tower's weights. With ORT supplied by us, the
 * library lists no devices of its own, so the WASM provider is named here
 * and "auto" keeps it from validating a device against that empty list.
 */
function modelOptions(dtype: string) {
  return {
    dtype: dtype as any,
    device: "auto" as const,
    session_options: { executionProviders: ["wasm"] },
  }
}

function ensureTextModel() {
  _text ??= retryable(
    (async () => {
      const T = await getTransformers()
      const tokenizer = await T.AutoTokenizer.from_pretrained(MODEL_ID)
      const model = await T.SiglipTextModel.from_pretrained(MODEL_ID, modelOptions(LOCAL_TEXT_DTYPE))
      return { tokenizer, model }
    })(),
    () => (_text = null)
  )
  return _text
}

function ensureVisionModel() {
  _vision ??= retryable(
    (async () => {
      const T = await getTransformers()
      const processor = await T.AutoProcessor.from_pretrained(MODEL_ID)
      const model = await T.SiglipVisionModel.from_pretrained(MODEL_ID, modelOptions(LOCAL_VISION_DTYPE))
      return { processor, model }
    })(),
    () => (_vision = null)
  )
  return _vision
}

/** L2-normalised plain array: cosine becomes a dot product everywhere downstream. */
function unit(data: ArrayLike<number>): number[] {
  const v = Array.from(data, Number)
  const n = Math.sqrt(v.reduce((a, x) => a + x * x, 0)) || 1
  return v.map((x) => x / n)
}

async function embedText(text: string): Promise<number[]> {
  const { tokenizer, model } = await ensureTextModel()
  // SigLIP2 was trained on lowercased text, and transformers.js ignores the
  // tokenizer's do_lower_case, so every caller's text is lowercased here.
  // SigLIP was trained on fixed-length text: padding to max_length is required.
  const inputs = tokenizer([text.toLowerCase()], {
    padding: "max_length",
    max_length: LOCAL_TEXT_MAX_TOKENS,
    truncation: true,
  })
  const { pooler_output } = await model(inputs)
  return unit(pooler_output.data)
}

async function embedImageFromUrl(imageUrl: string): Promise<number[]> {
  const T = await getTransformers()
  const { processor, model } = await ensureVisionModel()
  const image = await T.RawImage.fromURL(imageUrl)
  const inputs = await processor(image)
  const { pooler_output } = await model(inputs)
  return unit(pooler_output.data)
}

async function warmup() {
  // Text first: it is what search needs, and loads are serialised anyway.
  await ensureTextModel()
  await ensureVisionModel()
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
  .then(() => console.log("[Offscreen] ✅ SigLIP2 models loaded and ready"))
  .catch((e: any) => console.warn("[Offscreen] Model warmup deferred:", e))

/* ─── React component (required by Plasmo tabs, renders nothing) ─ */

export default function OffscreenPage() {
  return null
}
