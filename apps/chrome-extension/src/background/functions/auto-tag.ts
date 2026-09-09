/**
 * Zero-shot auto-tagging with CLIP.
 *
 * CLIP embeds text and images into one shared space, so an image can be
 * classified against arbitrary labels with no training and no API call: embed
 * each label once, then cosine the image vector against them.
 *
 * The label vectors are computed on first use and cached in chrome.storage.local,
 * so the cost is one text-encoder pass per label, once per browser profile.
 */

// Static import: an MV3 service worker can only importScripts() during initial
// evaluation, so a lazy import inside a message handler throws NetworkError.
import { embedText } from "./local-embeddings"

/* ─── Label vocabulary ──────────────────────────────────────────── */

/**
 * Prompts are phrased as full sentences ("a screenshot of ...") because CLIP
 * was trained on captions, not bare nouns, and scores noticeably better on
 * natural phrasing. `tag` is what gets stored; `prompt` is what gets embedded.
 */
export type Label = { tag: string; prompt: string; group: LabelGroup }

export type LabelGroup = "page-type" | "component" | "style" | "medium"

export const LABELS: Label[] = [
  // ── page types ──
  { tag: "landing page", prompt: "a screenshot of a website landing page", group: "page-type" },
  { tag: "pricing", prompt: "a screenshot of a pricing page with plan tiers", group: "page-type" },
  { tag: "dashboard", prompt: "a screenshot of an analytics dashboard interface", group: "page-type" },
  { tag: "onboarding", prompt: "a screenshot of a mobile app onboarding screen", group: "page-type" },
  { tag: "checkout", prompt: "a screenshot of a checkout or payment page", group: "page-type" },
  { tag: "login", prompt: "a screenshot of a login or sign up screen", group: "page-type" },
  { tag: "portfolio", prompt: "a screenshot of a personal portfolio website", group: "page-type" },
  { tag: "blog", prompt: "a screenshot of a blog article page", group: "page-type" },
  { tag: "ecommerce", prompt: "a screenshot of an online store product page", group: "page-type" },
  { tag: "documentation", prompt: "a screenshot of technical documentation with a sidebar", group: "page-type" },

  // ── components ──
  { tag: "hero section", prompt: "a website hero section with a large headline", group: "component" },
  { tag: "navigation", prompt: "a website navigation bar or menu", group: "component" },
  { tag: "form", prompt: "a user interface form with input fields", group: "component" },
  { tag: "table", prompt: "a data table with rows and columns", group: "component" },
  { tag: "chart", prompt: "a chart or data visualization graph", group: "component" },
  { tag: "card layout", prompt: "a grid of cards in a user interface", group: "component" },
  { tag: "modal", prompt: "a modal dialog overlay on a webpage", group: "component" },
  { tag: "footer", prompt: "a website footer with links and columns", group: "component" },
  { tag: "testimonial", prompt: "a customer testimonial or review section", group: "component" },
  { tag: "button", prompt: "a close up of user interface buttons", group: "component" },

  // ── visual style ──
  { tag: "dark mode", prompt: "a dark mode user interface with a black background", group: "style" },
  { tag: "light mode", prompt: "a light user interface with a white background", group: "style" },
  { tag: "minimal", prompt: "a minimal design with lots of white space", group: "style" },
  { tag: "brutalist", prompt: "a brutalist web design with raw bold typography", group: "style" },
  { tag: "colorful", prompt: "a vibrant colorful design with bright colors", group: "style" },
  { tag: "gradient", prompt: "a design using smooth color gradients", group: "style" },
  { tag: "glassmorphism", prompt: "a frosted glass translucent interface effect", group: "style" },
  { tag: "retro", prompt: "a retro vintage inspired design", group: "style" },
  { tag: "editorial", prompt: "an editorial magazine style layout", group: "style" },
  { tag: "playful", prompt: "a playful design with rounded shapes and illustrations", group: "style" },

  // ── medium ──
  { tag: "typography", prompt: "a typography specimen showing letterforms", group: "medium" },
  { tag: "color palette", prompt: "a color palette with swatches", group: "medium" },
  { tag: "illustration", prompt: "a digital illustration or drawing", group: "medium" },
  { tag: "3d render", prompt: "a 3d rendered object or scene", group: "medium" },
  { tag: "photography", prompt: "a photograph of a real scene", group: "medium" },
  { tag: "logo", prompt: "a brand logo or wordmark", group: "medium" },
  { tag: "icon set", prompt: "a set of user interface icons", group: "medium" },
  { tag: "mobile app", prompt: "a mobile phone app user interface", group: "medium" },
  { tag: "diagram", prompt: "a diagram or flowchart", group: "medium" },
  { tag: "code", prompt: "a screenshot of source code in an editor", group: "medium" },
]

/* ─── Label vector cache ────────────────────────────────────────── */

const CACHE_KEY = "clip_label_vectors_v1"

type LabelCache = { version: string; vectors: Record<string, number[]> }

/**
 * Bump alongside LABELS so an edited vocabulary invalidates stale vectors
 * instead of silently scoring against the old prompts.
 */
const CACHE_VERSION = `v1:${LABELS.length}`

let _memo: Record<string, number[]> | null = null

async function getLabelVectors(): Promise<Record<string, number[]>> {
  if (_memo) return _memo

  try {
    const stored = (await chrome.storage.local.get(CACHE_KEY))?.[CACHE_KEY] as
      | LabelCache
      | undefined
    if (stored?.version === CACHE_VERSION && stored.vectors) {
      _memo = stored.vectors
      return _memo
    }
  } catch {
    // storage unavailable; fall through and recompute in memory
  }

  const vectors: Record<string, number[]> = {}

  // Sequential on purpose: the offscreen document runs one inference at a time,
  // and a parallel burst of 40 just queues up behind itself while holding memory.
  for (const label of LABELS) {
    try {
      vectors[label.tag] = await embedText(label.prompt)
    } catch (e) {
      console.warn("[auto-tag] failed to embed label", label.tag, e)
    }
  }

  _memo = vectors
  try {
    await chrome.storage.local.set({
      [CACHE_KEY]: { version: CACHE_VERSION, vectors } satisfies LabelCache,
    })
  } catch {
    // non-fatal: we still have them in memory for this service worker's life
  }
  return vectors
}

/* ─── Classification ────────────────────────────────────────────── */

function cosineSimilarity(a: number[], b: number[]): number {
  if (!a.length || !b.length || a.length !== b.length) return -1
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

export type ScoredTag = { tag: string; group: LabelGroup; score: number }

/**
 * Rank the vocabulary against an image vector.
 *
 * Raw CLIP cosines sit in a narrow absolute band (~0.15-0.35) and shift with
 * the prompt wording, so an absolute cutoff is unreliable. Instead we take the
 * best label per group and keep it only if it clears the group's runner-up by a
 * margin, which is a relative judgement and far more stable.
 */
export async function suggestTags(
  imageVector: number[],
  opts: { maxTags?: number; margin?: number } = {}
): Promise<ScoredTag[]> {
  const maxTags = opts.maxTags ?? 4
  const margin = opts.margin ?? 0.01

  const vectors = await getLabelVectors()

  const scored: ScoredTag[] = LABELS.flatMap((label) => {
    const vec = vectors[label.tag]
    if (!vec) return []
    return [{ tag: label.tag, group: label.group, score: cosineSimilarity(vec, imageVector) }]
  }).filter((x) => Number.isFinite(x.score))

  const byGroup = new Map<LabelGroup, ScoredTag[]>()
  for (const s of scored) {
    const list = byGroup.get(s.group) ?? []
    list.push(s)
    byGroup.set(s.group, list)
  }

  const winners: ScoredTag[] = []
  for (const [, list] of byGroup) {
    list.sort((a, b) => b.score - a.score)
    const best = list[0]
    const runnerUp = list[1]
    if (!best) continue
    // A group whose top two labels are indistinguishable is a group CLIP has no
    // real opinion about; emitting either would just be noise.
    if (!runnerUp || best.score - runnerUp.score >= margin) winners.push(best)
  }

  return winners.sort((a, b) => b.score - a.score).slice(0, maxTags)
}
