/**
 * Finding "the image under the cursor" for the image picker, even when a
 * transparent overlay, a hover card or a link wrapper sits on top of it
 * (Pinterest-style grids). `elementsFromPoint` returns the whole stack at a
 * point, so the picker looks through it instead of trusting `event.target`.
 */

export type ImageHit = {
  /** The element to highlight. */
  element: HTMLElement
  /** Best guess at the original file. */
  src: string
  /** What the page itself shows; tried in order if `src` can't be downloaded. */
  fallbackSrcs: string[]
  alt?: string
}

/** Smaller than this is an icon or a tracking pixel, not inspiration. */
const MIN_SIZE = 24

const PINIMG_SIZE_SEGMENT = /\/\d+x\d*(?:_[A-Za-z0-9]+)?\//

/** The largest URL in a `srcset`, by its w or x descriptor. */
export function largestSrcsetUrl(srcset: string): string | null {
  let best: { url: string; score: number } | null = null
  for (const part of srcset.split(",")) {
    const [url, descriptor] = part.trim().split(/\s+/)
    if (!url) continue
    const n = descriptor ? parseFloat(descriptor) : 1
    const score = descriptor?.endsWith("x") ? n * 1000 : n
    if (!best || score > best.score) best = { url, score }
  }
  return best?.url ?? null
}

/** Pinterest serves resized copies; the same path under /originals/ is the file. */
export function originalUrl(src: string): string {
  try {
    const u = new URL(src)
    if (u.hostname.endsWith("pinimg.com") && PINIMG_SIZE_SEGMENT.test(u.pathname)) {
      u.pathname = u.pathname.replace(PINIMG_SIZE_SEGMENT, "/originals/")
      return u.href
    }
  } catch {}
  return src
}

function absolute(url: string, base: string): string | null {
  try {
    const u = new URL(url, base)
    // blob: URLs belong to the page and can't be fetched by the extension.
    return u.protocol === "http:" || u.protocol === "https:" || u.protocol === "data:" ? u.href : null
  } catch {
    return null
  }
}

function imageSources(img: HTMLImageElement): { src: string; fallbackSrcs: string[] } | null {
  const base = img.ownerDocument.baseURI
  const shown = absolute(img.currentSrc || img.src, base)

  const srcsets = [img.srcset]
  const picture = img.parentElement
  if (picture instanceof HTMLPictureElement) {
    for (const source of Array.from(picture.querySelectorAll("source"))) srcsets.push(source.srcset)
  }
  const largest = srcsets
    .map((s) => (s ? largestSrcsetUrl(s) : null))
    .map((u) => (u ? absolute(u, base) : null))
    .find((u): u is string => !!u)

  // currentSrc is only what fits the rendered size, so the largest candidate
  // outranks it; the displayed file is the last resort.
  const ordered = [largest && originalUrl(largest), shown && originalUrl(shown), largest, shown]
  const unique = [...new Set(ordered.filter((u): u is string => !!u))]
  if (unique.length === 0) return null
  return { src: unique[0], fallbackSrcs: unique.slice(1) }
}

function backgroundUrl(el: HTMLElement): string | null {
  // <html> and <body> backgrounds are page chrome, not a picked image.
  if (el === el.ownerDocument.documentElement || el === el.ownerDocument.body) return null
  const bg = getComputedStyle(el).backgroundImage
  const match = bg && /url\((["']?)(.*?)\1\)/.exec(bg)
  return match ? absolute(match[2], el.ownerDocument.baseURI) : null
}

function tooSmall(el: Element, minSize: number): boolean {
  if (minSize <= 0) return false
  const r = el.getBoundingClientRect()
  return r.width < minSize || r.height < minSize
}

/**
 * The topmost image in a stack of elements (as returned by
 * `elementsFromPoint`, topmost first): an `<img>`, else an element with a CSS
 * background image. Everything above it - overlays, links - is skipped.
 */
export function pickImageFromStack(stack: Element[], { minSize = 0 } = {}): ImageHit | null {
  for (const el of stack) {
    if (!(el instanceof HTMLElement) || tooSmall(el, minSize)) continue
    if (el instanceof HTMLImageElement) {
      const sources = imageSources(el)
      if (sources) return { element: el, ...sources, alt: el.alt || undefined }
    } else {
      const bg = backgroundUrl(el)
      if (bg) return { element: el, src: bg, fallbackSrcs: [] }
    }
  }
  return null
}

/**
 * The image under a viewport point. `elementsFromPoint` skips elements with
 * `pointer-events: none`, which some sites put on the <img> itself, so fall
 * back to any image whose box contains the point (the last one in document
 * order paints on top).
 */
export function findImageAtPoint(x: number, y: number): ImageHit | null {
  const fromStack = pickImageFromStack(document.elementsFromPoint(x, y), { minSize: MIN_SIZE })
  if (fromStack) return fromStack

  const covering = Array.from(document.images).filter((img) => {
    const r = img.getBoundingClientRect()
    return r.width >= MIN_SIZE && r.height >= MIN_SIZE && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom
  })
  return pickImageFromStack(covering.reverse())
}
