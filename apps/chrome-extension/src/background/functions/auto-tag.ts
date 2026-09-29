/**
 * Zero-shot image tagging with the local CLIP model, mapped to the spec's
 * taxonomy: one `aiCategory`, 1-4 `aiStyle` labels and 5-10 `aiTags`.
 *
 * CLIP embeds text and images into one space, so an image is classified
 * against arbitrary labels with no training and no API call: embed each
 * label's prompts once, then compare the image vector with them. Label
 * vectors are computed on first use and cached in chrome.storage.local.
 *
 * Scores are softmax probabilities over CLIP logits (cosine x 100, CLIP's
 * learned logit scale), not raw cosines: raw cosines sit in a narrow band
 * (~0.15-0.35) that shifts with prompt wording, while probabilities within a
 * label set are comparable across images.
 *
 * Everything but `getLabelVectors` / `classifyImage` is pure, for tests.
 */

// Static import: an MV3 service worker can only importScripts() during initial
// evaluation, so a lazy import inside a message handler throws NetworkError.
import { embedText } from "./local-embeddings"
import { hexToLab } from "../../../../../packages/backend/convex/lib/color"
import { LOCAL_MODEL_ID } from "../../../../../packages/backend/convex/lib/ai_config"
import type { AiCategory } from "../../../../../packages/backend/convex/schema"

/* ─── Vocabulary ────────────────────────────────────────────────── */

/**
 * `key` is what gets stored; `prompts` are embedded and averaged (prompt
 * ensembling). Prompts are captions, not bare nouns: CLIP was trained on
 * captions and scores natural phrasing noticeably better.
 */
export type Label<K extends string = string> = { key: K; prompts: string[] }

export const CATEGORY_LABELS: Label<Exclude<AiCategory, "other">>[] = [
  { key: "hero", prompts: ["a screenshot of a website hero section with a big headline and a call to action button", "the top of a landing page with a large headline"] },
  { key: "navigation", prompts: ["a screenshot of a website navigation bar with menu links", "a website header with a logo and a navigation menu"] },
  { key: "pricing", prompts: ["a screenshot of a pricing table with plan tiers and prices", "a pricing page comparing subscription plans"] },
  { key: "features", prompts: ["a screenshot of a website features section with icons and short descriptions", "a grid of product features with icons"] },
  { key: "testimonials", prompts: ["a screenshot of customer testimonials with quotes and avatars", "customer reviews and quotes on a website"] },
  { key: "cta", prompts: ["a screenshot of a call to action banner with a prominent button", "a signup banner asking the visitor to get started"] },
  { key: "form", prompts: ["a screenshot of a form with input fields and a submit button", "a sign up or contact form"] },
  { key: "card", prompts: ["a screenshot of a single user interface card component", "a card with an image, a title and some text"] },
  { key: "footer", prompts: ["a screenshot of a website footer with columns of links", "the bottom footer of a website with copyright text"] },
  { key: "dashboard", prompts: ["a screenshot of an analytics dashboard with charts and tables", "an admin panel interface with a sidebar and data"] },
  { key: "illustration", prompts: ["a digital illustration", "a flat vector illustration"] },
  { key: "photo", prompts: ["a photograph", "a photo of a real scene"] },
  { key: "typography", prompts: ["a typography specimen with large letterforms", "a layout dominated by big bold text"] },
  { key: "icon", prompts: ["an icon", "a set of user interface icons"] },
]

/** Styles CLIP decides. Dark/light are separate: see LUMINANCE_LABELS. */
export const STYLE_LABELS: Label[] = [
  { key: "minimal", prompts: ["a minimal website design with lots of white space"] },
  { key: "gradient", prompts: ["a design with smooth colorful gradients"] },
  { key: "brutalist", prompts: ["a brutalist web design with raw bold typography and harsh borders"] },
  { key: "playful", prompts: ["a playful design with rounded shapes and illustrations"] },
  { key: "corporate", prompts: ["a corporate professional business website design"] },
  { key: "colorful", prompts: ["a vibrant colorful design with bright colors"] },
  { key: "glassmorphism", prompts: ["a frosted glass translucent interface with blurred backgrounds"] },
  { key: "retro", prompts: ["a retro vintage inspired design"] },
]

/** Only used when there is no palette or DNA to measure luminance from. */
export const LUMINANCE_LABELS: Label<"dark" | "light">[] = [
  { key: "dark", prompts: ["a dark mode user interface with a black background"] },
  { key: "light", prompts: ["a light user interface with a white background"] },
]

export const TAG_LABELS: Label[] = [
  { key: "landing page", prompts: ["a screenshot of a website landing page"] },
  { key: "web app", prompts: ["a screenshot of a web application interface"] },
  { key: "mobile app", prompts: ["a screenshot of a mobile phone app interface"] },
  { key: "saas", prompts: ["a screenshot of a software product marketing website"] },
  { key: "ecommerce", prompts: ["a screenshot of an online store product page"] },
  { key: "checkout", prompts: ["a screenshot of a checkout or payment page"] },
  { key: "login", prompts: ["a screenshot of a login or sign up screen"] },
  { key: "onboarding", prompts: ["a screenshot of an app onboarding screen"] },
  { key: "blog", prompts: ["a screenshot of a blog article page"] },
  { key: "documentation", prompts: ["a screenshot of technical documentation with a sidebar"] },
  { key: "portfolio", prompts: ["a screenshot of a personal portfolio website"] },
  { key: "settings", prompts: ["a settings page with toggles and options"] },
  { key: "data table", prompts: ["a data table with rows and columns"] },
  { key: "chart", prompts: ["a chart or data visualization graph"] },
  { key: "modal", prompts: ["a modal dialog over a web page"] },
  { key: "sidebar", prompts: ["an app layout with a sidebar menu"] },
  { key: "search bar", prompts: ["a search bar input field"] },
  { key: "buttons", prompts: ["a close up of user interface buttons"] },
  { key: "card grid", prompts: ["a grid of cards in a user interface"] },
  { key: "headline", prompts: ["a large bold headline"] },
  { key: "hero image", prompts: ["a large banner image across a web page"] },
  { key: "product shot", prompts: ["a product photo on a plain background"] },
  { key: "people", prompts: ["a photo of people"] },
  { key: "3d render", prompts: ["a 3d rendered object or scene"] },
  { key: "logo", prompts: ["a brand logo or wordmark"] },
  { key: "color palette", prompts: ["a color palette with swatches"] },
  { key: "avatars", prompts: ["user avatars or profile pictures"] },
  { key: "map", prompts: ["a map"] },
  { key: "video", prompts: ["a video player"] },
  { key: "calendar", prompts: ["a calendar or date picker"] },
  { key: "code", prompts: ["source code in an editor"] },
  { key: "diagram", prompts: ["a diagram or flowchart"] },
  { key: "pattern", prompts: ["an abstract pattern or texture"] },
  { key: "empty state", prompts: ["an empty state illustration with a short message"] },
  { key: "notification", prompts: ["a notification or toast message"] },
]

/* ─── Tuning ────────────────────────────────────────────────────── */

/** CLIP's learned logit scale: logits = 100 x cosine. */
export const LOGIT_SCALE = 100
/** Top category must beat the runner-up by this much probability, else "other". */
export const CATEGORY_MIN_MARGIN = 0.1
/** Styles (besides dark/light) kept at or above this probability. */
export const STYLE_MIN_PROB = 0.2
export const MAX_STYLES = 4
/** Tags kept at or above this probability, then topped up to MIN_AI_TAGS. */
export const TAG_MIN_PROB = 0.05
export const MIN_AI_TAGS = 5
export const MAX_AI_TAGS = 10
/** CIELAB L* below which a background counts as dark. */
export const DARK_MAX_LIGHTNESS = 50

/* ─── Pure scoring ──────────────────────────────────────────────── */

export function cosine(a: number[], b: number[]): number {
  if (!a.length || a.length !== b.length) return Number.NaN
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    const x = a[i] ?? 0
    const y = b[i] ?? 0
    dot += x * y
    na += x * x
    nb += y * y
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1e-9)
}

export function softmax(logits: number[]): number[] {
  if (logits.length === 0) return []
  const max = Math.max(...logits)
  const exps = logits.map((x) => Math.exp(x - max))
  const sum = exps.reduce((a, b) => a + b, 0)
  return exps.map((e) => e / sum)
}

export type Scored<K extends string = string> = { key: K; prob: number; cos: number }

/** Softmax over one label set, best first. Labels without a vector are skipped. */
export function scoreLabels<K extends string>(
  image: number[],
  labels: Label<K>[],
  vectors: Record<string, number[]>,
  group: string
): Scored<K>[] {
  const withCos = labels.flatMap((l) => {
    const vec = vectors[labelId(group, l.key)]
    const cos = vec ? cosine(image, vec) : Number.NaN
    return Number.isFinite(cos) ? [{ key: l.key, cos }] : []
  })
  const probs = softmax(withCos.map((x) => x.cos * LOGIT_SCALE))
  return withCos.map((x, i) => ({ ...x, prob: probs[i]! })).sort((a, b) => b.prob - a.prob)
}

/** The top category if it clearly beats the runner-up, else "other". */
export function pickCategory(scored: Scored<Exclude<AiCategory, "other">>[]): AiCategory {
  const [best, next] = scored
  if (!best) return "other"
  return best.prob - (next?.prob ?? 0) >= CATEGORY_MIN_MARGIN ? best.key : "other"
}

export type ColorHints = {
  /** Pixel palette (CIELAB), any order. */
  palette?: Array<{ lab: number[]; weight: number }> | null
  /** DNA background colours, heaviest first. */
  backgroundHexes?: string[] | null
}

/**
 * Dark or light from measured colour: the DNA's main background when there
 * is one, else the heaviest palette colour (backgrounds cover the most
 * pixels). Null when there is nothing to measure. Cheaper and more reliable
 * than asking CLIP.
 */
export function luminanceStyle(hints: ColorHints): "dark" | "light" | null {
  let lightness: number | null = null
  const bg = hints.backgroundHexes?.[0]
  if (bg) lightness = hexToLab(bg)?.[0] ?? null
  if (lightness === null && hints.palette?.length) {
    const heaviest = [...hints.palette].sort((a, b) => b.weight - a.weight)[0]!
    lightness = Number.isFinite(heaviest.lab[0]) ? heaviest.lab[0]! : null
  }
  if (lightness === null) return null
  return lightness < DARK_MAX_LIGHTNESS ? "dark" : "light"
}

/** Luminance first, then CLIP's confident styles; 1 to MAX_STYLES in total. */
export function pickStyles(luminance: "dark" | "light", scored: Scored[]): string[] {
  const rest = scored.filter((s) => s.prob >= STYLE_MIN_PROB).map((s) => s.key)
  return [luminance, ...rest].slice(0, MAX_STYLES)
}

/** Confident tags, topped up with the next best to MIN_AI_TAGS; never repeats `exclude`. */
export function pickTags(scored: Scored[], exclude: string[] = []): string[] {
  const candidates = scored.filter((s) => !exclude.includes(s.key))
  const confident = candidates.filter((s) => s.prob >= TAG_MIN_PROB).slice(0, MAX_AI_TAGS)
  const topUp = candidates.slice(confident.length, Math.max(confident.length, MIN_AI_TAGS))
  return [...confident, ...topUp].map((s) => s.key)
}

export type ImageClassification = {
  aiCategory: AiCategory
  aiStyle: string[]
  aiTags: string[]
  /** Top scores per group, for logs and the benchmark. */
  debug: { category: Scored[]; style: Scored[]; tags: Scored[] }
}

/** Classify an image vector against precomputed label vectors. */
export function classifyWithVectors(
  image: number[],
  vectors: Record<string, number[]>,
  hints: ColorHints = {}
): ImageClassification {
  const category = scoreLabels(image, CATEGORY_LABELS, vectors, "category")
  const style = scoreLabels(image, STYLE_LABELS, vectors, "style")
  const tags = scoreLabels(image, TAG_LABELS, vectors, "tag")

  const aiCategory = pickCategory(category)
  const luminance =
    luminanceStyle(hints) ?? scoreLabels(image, LUMINANCE_LABELS, vectors, "luminance")[0]?.key ?? "light"
  const aiStyle = pickStyles(luminance, style)
  const aiTags = pickTags(tags, [aiCategory, ...aiStyle])

  return {
    aiCategory,
    aiStyle,
    aiTags,
    debug: { category: category.slice(0, 3), style: style.slice(0, 3), tags: tags.slice(0, 5) },
  }
}

/* ─── Label vector cache ────────────────────────────────────────── */

const LABEL_GROUPS: Array<[string, Label[]]> = [
  ["category", CATEGORY_LABELS],
  ["style", STYLE_LABELS],
  ["luminance", LUMINANCE_LABELS],
  ["tag", TAG_LABELS],
]

export function labelId(group: string, key: string): string {
  return `${group}:${key}`
}

const CACHE_KEY = "clip_label_vectors_v2"

type LabelCache = { version: string; vectors: Record<string, number[]> }

/** Short stable hash, so any vocabulary edit invalidates the cache. */
function hashString(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}

/** Changes with the model or any prompt, so stale vectors are never reused. */
export const CACHE_VERSION = `${LOCAL_MODEL_ID}|${hashString(JSON.stringify(LABEL_GROUPS))}`

function normalize(v: number[]): number[] {
  const n = Math.sqrt(v.reduce((a, x) => a + x * x, 0)) || 1
  return v.map((x) => x / n)
}

/** Mean of the prompts' unit vectors, renormalised. */
export function averageVectors(vectors: number[][]): number[] | null {
  if (vectors.length === 0) return null
  const units = vectors.map(normalize)
  const sum = units[0]!.map((_, i) => units.reduce((a, u) => a + (u[i] ?? 0), 0))
  return normalize(sum)
}

/** Every label id in the vocabulary, with its prompts. */
const ALL_LABELS = LABEL_GROUPS.flatMap(([group, labels]) =>
  labels.map((label) => ({ id: labelId(group, label.key), label }))
)

let _memo: Record<string, number[]> | null = null

/**
 * Label vectors, cached per label: a label whose prompts failed to embed is
 * simply missing, kept out of scoring for now and retried on the next call,
 * while every label that did embed stays cached (memory and storage).
 */
async function getLabelVectors(): Promise<Record<string, number[]>> {
  if (_memo && ALL_LABELS.every(({ id }) => _memo![id])) return _memo

  if (!_memo) {
    _memo = {}
    try {
      const stored = (await chrome.storage.local.get(CACHE_KEY))?.[CACHE_KEY] as LabelCache | undefined
      if (stored?.version === CACHE_VERSION && stored.vectors) _memo = { ...stored.vectors }
    } catch {
      // storage unavailable; compute in memory
    }
  }
  const vectors = _memo

  let added = 0
  // Sequential on purpose: the offscreen document runs one inference at a time,
  // and a parallel burst just queues up behind itself while holding memory.
  for (const { id, label } of ALL_LABELS) {
    if (vectors[id]) continue
    const embedded: number[][] = []
    try {
      for (const prompt of label.prompts) embedded.push(await embedText(prompt))
    } catch (e) {
      // A label is all or nothing: a partial prompt average would drift.
      console.warn("[auto-tag] failed to embed label", label.key, e)
      continue
    }
    const avg = averageVectors(embedded)
    if (avg) {
      vectors[id] = avg
      added++
    }
  }

  if (added > 0) {
    try {
      await chrome.storage.local.set({
        [CACHE_KEY]: { version: CACHE_VERSION, vectors } satisfies LabelCache,
      })
    } catch {
      // non-fatal: we still have them in memory for this service worker's life
    }
  }
  return vectors
}

/** Zero-shot category, styles and tags for an image vector. */
export async function classifyImage(image: number[], hints: ColorHints = {}): Promise<ImageClassification> {
  return classifyWithVectors(image, await getLabelVectors(), hints)
}
