/**
 * Design DNA: a summary of what a picked element is made of, read from its
 * computed styles (spec 6.1).
 *
 * Only styles and geometry are read. Never form values, input contents,
 * cookies or storage: text nodes are only tested for being non-blank, and
 * their text is never kept.
 *
 * Geometry and font checks are injectable because test DOMs (happy-dom)
 * report zero-sized rects and have no font loading.
 */

import { parseCssColor, rgbToHex } from "../../../../../../packages/backend/convex/lib/color"

type Weighted<T> = T & { weight: number }

export type DesignDNA = {
  version: 1
  colors: Weighted<{ hex: string; usage: "text" | "background" | "border" }>[]
  fonts: Weighted<{
    family: string
    generic: boolean
    size: number
    fontWeight: number
    lineHeight: number | null
    letterSpacing: number | null
  }>[]
  radii: Weighted<{ value: number }>[]
  shadows: Weighted<{ value: string }>[]
  spacing: Weighted<{ value: number }>[]
  source: {
    url: string
    title: string
    viewport: { w: number; h: number }
    dpr: number
    rect: { x: number; y: number; w: number; h: number }
    clipped: boolean
  }
}

export type RectLike = { left: number; top: number; width: number; height: number }

export type DnaOptions = {
  clipped?: boolean
  /**
   * The visible viewport. When given, only the part of the selection inside
   * it counts, so a clipped capture's DNA matches the pixels actually saved.
   */
  viewport?: RectLike
  maxNodes?: number
  getRect?: (el: Element) => RectLike
  getTextRects?: (node: Text) => RectLike[]
  getStyle?: (el: Element) => CSSStyleDeclaration
  /** Whether a (non-generic) family is loaded, e.g. via document.fonts.check. */
  isFontLoaded?: (family: string) => boolean
}

export const DNA_MAX_NODES = 2000
export const DNA_TOP = { colors: 16, fonts: 8, radii: 10, shadows: 10, spacing: 10 } as const

const GENERIC_FAMILIES = new Set([
  "serif",
  "sans-serif",
  "monospace",
  "cursive",
  "fantasy",
  "system-ui",
  "emoji",
  "math",
  "fangsong",
])

export function isGenericFamily(family: string): boolean {
  const f = family.toLowerCase()
  return GENERIC_FAMILIES.has(f) || f.startsWith("ui-")
}

/** Split a font-family stack, dropping quotes. */
export function parseFontStack(stack: string): string[] {
  return stack
    .split(",")
    .map((f) => f.trim().replace(/^["']|["']$/g, "").trim())
    .filter(Boolean)
}

function defaultFontLoaded(family: string): boolean {
  try {
    return document.fonts.check(`16px "${family.replace(/["\\]/g, "\\$&")}"`)
  } catch {
    return false
  }
}

/**
 * The family actually rendering: the first in the stack that is loaded.
 * Generic families always count as available. With nothing loaded, the last
 * entry is what the browser falls back to.
 */
export function pickFontFamily(
  stack: string,
  isLoaded: (family: string) => boolean = defaultFontLoaded
): { family: string; generic: boolean } | null {
  const families = parseFontStack(stack)
  for (const family of families) {
    if (isGenericFamily(family)) return { family, generic: true }
    if (isLoaded(family)) return { family, generic: false }
  }
  const last = families[families.length - 1]
  return last ? { family: last, generic: isGenericFamily(last) } : null
}

/** "12px" → 12; "normal", "auto", percentages and other units → null. */
export function parsePx(value: string | null | undefined): number | null {
  if (!value) return null
  const m = value.trim().match(/^(-?[\d.]+)px$/)
  if (!m) return null
  const n = parseFloat(m[1]!)
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null
}

/** Area of `r` inside `clip`, in px². */
/** Overlap of two rects (zero-sized when they don't meet). */
export function intersect(a: RectLike, b: RectLike): RectLike {
  const left = Math.max(a.left, b.left)
  const top = Math.max(a.top, b.top)
  const right = Math.min(a.left + a.width, b.left + b.width)
  const bottom = Math.min(a.top + a.height, b.top + b.height)
  return { left, top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) }
}

export function visibleArea(r: RectLike, clip: RectLike): number {
  const w = Math.min(r.left + r.width, clip.left + clip.width) - Math.max(r.left, clip.left)
  const h = Math.min(r.top + r.height, clip.top + clip.height) - Math.max(r.top, clip.top)
  return w > 0 && h > 0 ? w * h : 0
}

/** Sums weights per key; `top()` normalises over everything, then keeps the heaviest. */
class Tally<T> {
  private map = new Map<string, Weighted<T>>()

  add(key: string, value: T, weight: number) {
    if (!(weight > 0)) return
    const hit = this.map.get(key)
    if (hit) hit.weight += weight
    else this.map.set(key, { ...value, weight })
  }

  top(n: number): Weighted<T>[] {
    const all = [...this.map.values()]
    const total = all.reduce((s, x) => s + x.weight, 0)
    if (total <= 0) return []
    return all
      .map((x) => ({ ...x, weight: Math.round((x.weight / total) * 10000) / 10000 }))
      .sort((a, b) => b.weight - a.weight)
      .slice(0, n)
  }
}

const SIDES = ["top", "right", "bottom", "left"] as const
const CORNERS = ["top-left", "top-right", "bottom-right", "bottom-left"] as const

function defaultTextRects(node: Text): RectLike[] {
  const range = document.createRange()
  range.selectNodeContents(node)
  return Array.from(range.getClientRects())
}

/** Hex of a computed colour, or null when absent or nearly transparent. */
function colorHex(value: string): string | null {
  const c = parseCssColor(value, 0.1)
  return c ? rgbToHex([c.r, c.g, c.b]) : null
}

/** Longer values are almost always machine-generated stacks; not worth keeping. */
const MAX_SHADOW_LENGTH = 500
const COLOR_TOKEN = /(?:rgba?|oklch|oklab|color)\([^)]*\)|#[0-9a-f]{3,8}\b/gi

/**
 * A box-shadow that draws something. Frameworks often leave fully transparent
 * shadows (`rgba(0, 0, 0, 0) 0px 0px 0px 0px`) on elements, which are noise.
 */
export function isVisibleShadow(value: string | null | undefined): value is string {
  if (!value || value === "none" || value.length > MAX_SHADOW_LENGTH) return false
  const colors = value.match(COLOR_TOKEN)
  return !colors || colors.some((c) => parseCssColor(c, 0.1) !== null)
}

/**
 * Walk `root` and its descendants (up to `maxNodes` elements) and summarise
 * their colours, type, radii, shadows and spacing, each weighted by the area
 * it covers inside the selection.
 */
export function collectDesignDna(root: Element, options: DnaOptions = {}): DesignDNA {
  const getRect = options.getRect ?? ((el: Element) => el.getBoundingClientRect())
  const getTextRects = options.getTextRects ?? defaultTextRects
  const getStyle = options.getStyle ?? ((el: Element) => getComputedStyle(el))
  const isFontLoaded = options.isFontLoaded ?? defaultFontLoaded
  const maxNodes = options.maxNodes ?? DNA_MAX_NODES

  const rootRect = getRect(root)
  const clip = options.viewport ? intersect(rootRect, options.viewport) : rootRect
  const colors = new Tally<{ hex: string; usage: "text" | "background" | "border" }>()
  const fonts = new Tally<Omit<DesignDNA["fonts"][number], "weight">>()
  const radii = new Tally<{ value: number }>()
  const shadows = new Tally<{ value: string }>()
  const spacing = new Tally<{ value: number }>()

  const stack: Element[] = [root]
  // The budget counts elements that contribute; ones outside the visible clip
  // still have to be walked (their children can overflow into view) but must
  // not use it up. `walked` is the hard stop for pathological DOMs.
  let visited = 0
  let walked = 0
  const maxWalked = maxNodes * 10
  while (stack.length && visited < maxNodes && walked < maxWalked) {
    const el = stack.pop()!
    walked++
    const style = getStyle(el)

    // Nothing inside these can show either.
    if (style.display === "none") continue
    if (parseFloat(style.opacity) < 0.05) continue
    // Push children in reverse so the walk runs in document order.
    for (let i = el.children.length - 1; i >= 0; i--) stack.push(el.children[i]!)

    // A hidden, empty or out-of-selection element contributes nothing itself,
    // but its children may still be visible (visibility can be overridden and
    // overflow can spill out of a zero-sized box).
    if (style.visibility === "hidden" || style.visibility === "collapse") continue
    const rect = getRect(el)
    if (rect.width <= 0 || rect.height <= 0) continue
    const area = visibleArea(rect, clip)
    if (area <= 0) continue
    visited++

    const bg = colorHex(style.backgroundColor)
    if (bg) colors.add(`background|${bg}`, { hex: bg, usage: "background" }, area)

    for (const side of SIDES) {
      const width = parsePx(style.getPropertyValue(`border-${side}-width`)) ?? 0
      const lineStyle = style.getPropertyValue(`border-${side}-style`)
      if (width <= 0 || lineStyle === "none" || lineStyle === "hidden") continue
      const hex = colorHex(style.getPropertyValue(`border-${side}-color`))
      // Weighted by the stroke's own area: a 1px border is not as present as
      // the box it surrounds.
      const length = side === "top" || side === "bottom" ? rect.width : rect.height
      if (hex) colors.add(`border|${hex}`, { hex, usage: "border" }, length * width)
    }

    const cornerValues = new Set<number>()
    for (const corner of CORNERS) {
      const v = parsePx(style.getPropertyValue(`border-${corner}-radius`).split(" ")[0])
      if (v && v > 0) cornerValues.add(v)
    }
    cornerValues.forEach((value) => radii.add(String(value), { value }, area))

    const shadow = style.boxShadow
    if (isVisibleShadow(shadow)) shadows.add(shadow, { value: shadow }, area)

    const spaceValues = new Set<number>()
    for (const prop of [
      ...SIDES.map((s) => `padding-${s}`),
      "row-gap",
      "column-gap",
    ]) {
      const v = parsePx(style.getPropertyValue(prop))
      if (v && v > 0) spaceValues.add(v)
    }
    spaceValues.forEach((value) => spacing.add(String(value), { value }, area))

    // Type and text colour only where the element itself holds text.
    let textArea = 0
    for (const node of Array.from(el.childNodes)) {
      if (node.nodeType !== Node.TEXT_NODE || !/\S/.test(node.nodeValue ?? "")) continue
      for (const r of getTextRects(node as Text)) textArea += visibleArea(r, clip)
    }
    if (textArea <= 0) continue

    const fg = colorHex(style.color)
    if (fg) colors.add(`text|${fg}`, { hex: fg, usage: "text" }, textArea)

    const picked = pickFontFamily(style.fontFamily, isFontLoaded)
    const size = parsePx(style.fontSize)
    if (picked && size) {
      const font = {
        family: picked.family,
        generic: picked.generic,
        size,
        fontWeight: parseInt(style.fontWeight, 10) || 400,
        lineHeight: parsePx(style.lineHeight),
        letterSpacing: parsePx(style.letterSpacing),
      }
      const key = [font.family, font.size, font.fontWeight, font.lineHeight, font.letterSpacing].join("|")
      fonts.add(key, font, textArea)
    }
  }

  return {
    version: 1,
    colors: colors.top(DNA_TOP.colors),
    fonts: fonts.top(DNA_TOP.fonts),
    radii: radii.top(DNA_TOP.radii),
    shadows: shadows.top(DNA_TOP.shadows),
    spacing: spacing.top(DNA_TOP.spacing),
    source: {
      url: location.href,
      title: document.title,
      viewport: { w: window.innerWidth, h: window.innerHeight },
      dpr: window.devicePixelRatio || 1,
      rect: {
        x: Math.round(clip.left),
        y: Math.round(clip.top),
        w: Math.round(clip.width),
        h: Math.round(clip.height),
      },
      clipped: !!options.clipped,
    },
  }
}
