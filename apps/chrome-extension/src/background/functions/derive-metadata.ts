/**
 * Metadata derived from things a capture already carries.
 *
 * None of this needs a model or a network call - it is all inference from the
 * source URL and the image dimensions, both of which are stored already. Cheap
 * signals, but high precision: a capture from dribbble.com really is design
 * inspiration, and a 9:16 image really is a phone screenshot.
 */

/* ─── Source priors ─────────────────────────────────────────────── */

const SOURCE_TAGS: Record<string, string[]> = {
  "dribbble.com": ["inspiration", "ui design"],
  "behance.net": ["inspiration", "case study"],
  "awwwards.com": ["inspiration", "web design"],
  "mobbin.com": ["inspiration", "mobile app"],
  "godly.website": ["inspiration", "web design"],
  "land-book.com": ["inspiration", "landing page"],
  "savee.it": ["inspiration"],
  "are.na": ["inspiration"],
  "pinterest.com": ["inspiration"],
  "figma.com": ["design file"],
  "codepen.io": ["code", "front end"],
  "github.com": ["code", "repository"],
  "stackoverflow.com": ["code", "reference"],
  "medium.com": ["article"],
  "substack.com": ["article"],
  "youtube.com": ["video"],
  "x.com": ["social"],
  "twitter.com": ["social"],
  "linkedin.com": ["social"],
  "instagram.com": ["social"],
  "facebook.com": ["social"],
}

/** Strip `www.` and match the registrable-ish suffix, so `eu.dribbble.com` still hits. */
function tagsForHost(host: string): string[] {
  const clean = host.replace(/^www\./, "").toLowerCase()
  for (const [domain, tags] of Object.entries(SOURCE_TAGS)) {
    if (clean === domain || clean.endsWith(`.${domain}`)) return tags
  }
  return []
}

/* ─── Shape priors ──────────────────────────────────────────────── */

function tagsForShape(width?: number | null, height?: number | null): string[] {
  if (!width || !height || width <= 0 || height <= 0) return []
  const ratio = width / height

  // Small square-ish images are icons/avatars rather than layouts worth filing
  // under a device type.
  if (width <= 128 && height <= 128) return ["icon"]

  if (ratio < 0.7) return ["mobile", "portrait"]
  if (ratio > 2.2) return ["banner", "wide"]
  if (ratio > 1.4) return ["desktop", "landscape"]
  return ["square"]
}

/* ─── Public API ────────────────────────────────────────────────── */

export type DerivedMetadata = {
  tags: string[]
  domain: string | null
}

export function deriveMetadata(input: {
  url?: string | null
  width?: number | null
  height?: number | null
}): DerivedMetadata {
  let domain: string | null = null
  let sourceTags: string[] = []

  try {
    if (input.url) {
      const host = new URL(input.url).host
      domain = host.replace(/^www\./, "")
      sourceTags = tagsForHost(host)
    }
  } catch {
    // capture URLs are sometimes "unknown" or a data: URL; no domain to derive
  }

  const tags = Array.from(
    new Set([...sourceTags, ...tagsForShape(input.width, input.height)])
  )

  return { tags, domain }
}

/** Merge tag sources, preserving order and dropping empties/dupes case-insensitively. */
export function mergeTags(...groups: (string[] | undefined | null)[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const group of groups) {
    for (const raw of group ?? []) {
      const tag = String(raw ?? "").trim()
      if (!tag) continue
      const key = tag.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      out.push(tag)
    }
  }
  return out
}
