import { action, internalMutation, mutation, query } from "./_generated/server"
import { v } from "convex/values"
import { api, internal } from "./_generated/api"
import type { Id } from "./_generated/dataModel"
import { fetchTextLimited } from "./helpers"

function normalizeUrl(raw: string): string {
  try {
    const u = new URL(raw)
    u.hash = ""
    u.hostname = u.hostname.toLowerCase()
    const params = new URLSearchParams(u.search)
    const toRemove = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "fbclid", "gclid", "igsh", "mc_cid", "mc_eid"]
    toRemove.forEach((k) => params.delete(k))
    const sorted = new URLSearchParams()
    Array.from(params.keys())
      .sort()
      .forEach((k) => {
        const vals = params.getAll(k)
        for (const v of vals) sorted.append(k, v)
      })
    u.search = sorted.toString() ? `?${sorted.toString()}` : ""
    return u.toString()
  } catch {
    return raw
  }
}

function detectContentType(url: string, html: string, ogType?: string): string {
  let type = ogType || "website"
  const urlLower = url.toLowerCase()
  
  if (urlLower.includes("facebook.com/events/") || urlLower.includes("fb.com/events/")) {
    return "event"
  }
  
  if (urlLower.includes("youtube.com/watch") || urlLower.includes("youtu.be/")) {
    return "video"
  }
  
  if (
    urlLower.includes("/product/") ||
    urlLower.includes("/products/") ||
    urlLower.includes("/item/") ||
    urlLower.includes("/dp/") ||
    urlLower.match(/amazon\.[a-z.]+\/[^/]+\/dp\//)
  ) {
    return "product"
  }
  
  if (urlLower.match(/github\.com\/[^/]+\/[^/]+\/?$/)) {
    return "repository"
  }
  
  if (urlLower.includes("twitter.com/") && urlLower.includes("/status/")) {
    return "social"
  }
  if (urlLower.includes("x.com/") && urlLower.includes("/status/")) {
    return "social"
  }
  
  if (urlLower.includes("linkedin.com/posts/") || urlLower.includes("linkedin.com/pulse/")) {
    return "social"
  }
  
  if (urlLower.includes("reddit.com/r/") && urlLower.includes("/comments/")) {
    return "social"
  }
  
  if (
    urlLower.includes("/docs/") ||
    urlLower.includes("/documentation/") ||
    urlLower.includes("/api/") ||
    urlLower.includes("/reference/")
  ) {
    return "documentation"
  }
  
  if (
    urlLower.includes("/blog/") ||
    urlLower.includes("/post/") ||
    urlLower.includes("/article/")
  ) {
    return "article"
  }
  
  if (type === "website" || type === "article") {
    const htmlLower = html.toLowerCase()
    
    if (
      htmlLower.includes("<video") ||
      htmlLower.includes("youtube.com/embed") ||
      htmlLower.includes("vimeo.com/video")
    ) {
      return "video"
    }
    
    if (
      htmlLower.includes('"add to cart"') ||
      htmlLower.includes('"add to bag"') ||
      htmlLower.includes('class="price"') ||
      htmlLower.includes('itemprop="price"')
    ) {
      return "product"
    }
    
    if (htmlLower.includes('"@type":"event"') || htmlLower.includes("schema.org/event")) {
      return "event"
    }
  }
  
  return type
}

function decodeText(text: string | undefined): string | undefined {
  if (!text) return text
  
  let decoded = text
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
  
  try {
    if (decoded.includes('%')) {
      decoded = decodeURIComponent(decoded)
    }
  } catch {}
  
  return decoded
}

function extractMeta(html: string): {
  title?: string
  description?: string
  imageUrl?: string
  siteName?: string
  faviconUrl?: string
  contentType?: string
  lang?: string
  author?: string
  publishedDate?: string
  keywords?: string[]
} {
  const pick = (re: RegExp) => {
    const m = html.match(re)
    return m?.[1]?.trim()
  }
  const pickAll = (re: RegExp): string[] => {
    const matches: string[] = []
    let match
    while ((match = re.exec(html)) !== null) {
      matches.push(match[1].trim())
    }
    return matches
  }
  
  const title =
    pick(/<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i) ||
    pick(/<meta\s+name=["']twitter:title["']\s+content=["']([^"']+)["']/i) ||
    pick(/<title[^>]*>([^<]+)<\/title>/i)
  const description =
    pick(/<meta\s+property=["']og:description["']\s+content=["']([^"']+)["']/i) ||
    pick(/<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i) ||
    pick(/<meta\s+name=["']twitter:description["']\s+content=["']([^"']+)["']/i)
  const imageUrl =
    pick(/<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i) ||
    pick(/<meta\s+name=["']twitter:image["']\s+content=["']([^"']+)["']/i)
  const siteName = pick(/<meta\s+property=["']og:site_name["']\s+content=["']([^"']+)["']/i)
  const contentType = pick(/<meta\s+property=["']og:type["']\s+content=["']([^"']+)["']/i)
  const htmlLang = pick(/<html[^>]*\slang=["']([^"']+)["'][^>]*>/i)
  const favicon =
    pick(/<link[^>]+rel=["'][^"']*icon[^"']*["'][^>]+href=["']([^"']+)["'][^>]*>/i) ||
    pick(/<link[^>]+href=["']([^"']+)["'][^>]*rel=["'][^"']*icon[^"']*["'][^>]*>/i)

  const author =
    pick(/<meta\s+name=["']author["']\s+content=["']([^"']+)["']/i) ||
    pick(/<meta\s+property=["']article:author["']\s+content=["']([^"']+)["']/i) ||
    pick(/<meta\s+name=["']twitter:creator["']\s+content=["']([^"']+)["']/i)
  const publishedDate =
    pick(/<meta\s+property=["']article:published_time["']\s+content=["']([^"']+)["']/i) ||
    pick(/<meta\s+name=["']date["']\s+content=["']([^"']+)["']/i)

  const keywordsRaw = pick(/<meta\s+name=["']keywords["']\s+content=["']([^"']+)["']/i)
  const keywords = keywordsRaw
    ? keywordsRaw
        .split(/,|;/)
        .map((k) => k.trim())
        .filter(Boolean)
    : undefined

  return {
    title: decodeText(title),
    description: decodeText(description),
    imageUrl,
    siteName: decodeText(siteName),
    faviconUrl: favicon,
    contentType,
    lang: htmlLang,
    author: decodeText(author),
    publishedDate,
    keywords: keywords?.map(k => decodeText(k)).filter((k): k is string => k !== undefined),
  }
}

/**
 * The handler's return type is annotated explicitly because it calls back into
 * `api`, which includes this module - without it TypeScript cannot infer the
 * type without consulting itself, and every local in the body degrades to an
 * implicit `any` (TS7022/TS7023). That failed `next build`, which typechecks
 * the whole workspace.
 */
export const enrichLinkPreviewForCapture = action({
  args: { captureId: v.id("captures") },
  handler: async (
    ctx,
    { captureId }
  ): Promise<{ previewId: Id<"link_previews">; canonicalUrl: string } | null> => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) throw new Error("Unauthorized")
    const capture = await ctx.runQuery(api.captures.getCaptureById as any, { id: captureId })
    if (!capture) throw new Error("Capture not found")
    if (capture.userId !== identity.subject) throw new Error("Forbidden")
    if (capture.kind !== "link") return null

    const originalUrl = String(capture.href || capture.url)
    let finalUrl = originalUrl
    let status: number | undefined
    let html = ""
    try {
      // Bounded fetch: http(s) only, no private/loopback hosts on any redirect
      // hop, 8s timeout, first 1 MB of the body.
      const resp = await fetchTextLimited(originalUrl)
      status = resp.status
      finalUrl = resp.finalUrl
      html = resp.body
    } catch {}

    const canonicalUrl = normalizeUrl(finalUrl)
    const u = new URL(canonicalUrl)
    const domain = u.hostname

    const meta = html ? extractMeta(html) : {}
    const now = Date.now()

    const contentType = detectContentType(canonicalUrl, html, meta.contentType)

    const resolveUrl = (raw?: string) => {
      if (!raw) return undefined
      try {
        return new URL(raw, canonicalUrl).toString()
      } catch {
        return raw
      }
    }
    const faviconUrl =
      resolveUrl(meta.faviconUrl) || new URL("/favicon.ico", canonicalUrl).toString()
    const imageUrl = resolveUrl(meta.imageUrl)

    const existing = await ctx.runQuery((api as any).links.getByUserAndCanonicalUrl, {
      canonicalUrl,
    })
    let previewId: Id<"link_previews">
    if (existing?._id) {
      await ctx.runMutation((internal as any).links.patchPreview, {
        id: existing._id,
        userId: identity.subject,
        patch: {
          originalUrl,
          siteName: meta.siteName,
          faviconUrl,
          title: meta.title,
          description: meta.description,
          imageUrl,
          contentType,
          lang: meta.lang,
          status,
          lastCheckedAt: now,
          updatedAt: now,
          author: meta.author,
          publishedDate: meta.publishedDate,
          keywords: meta.keywords,
        },
      })
      previewId = existing._id
    } else {
      previewId = await ctx.runMutation((api as any).links.insertPreview, {
        canonicalUrl,
        originalUrl,
        domain,
        siteName: meta.siteName,
        faviconUrl,
        title: meta.title,
        description: meta.description,
        imageUrl,
        contentType,
        lang: meta.lang,
        status,
        lastCheckedAt: now,
        createdAt: now,
        updatedAt: now,
        author: meta.author,
        publishedDate: meta.publishedDate,
        keywords: meta.keywords,
      })
    }

    await ctx.runMutation((internal as any).links.attachPreviewToCapture, {
      captureId,
      previewId,
      userId: identity.subject,
    })

    return { previewId, canonicalUrl }
  },
})

export const getByUserAndCanonicalUrl = query({
  args: { canonicalUrl: v.string() },
  handler: async (ctx, { canonicalUrl }) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) return null
    return await ctx.db
      .query("link_previews")
      .withIndex("by_user_and_canonicalUrl", (q) =>
        q.eq("userId", identity.subject).eq("canonicalUrl", canonicalUrl)
      )
      .unique()
  },
})

export const insertPreview = mutation({
  args: {
    canonicalUrl: v.string(),
    originalUrl: v.string(),
    domain: v.string(),
    siteName: v.optional(v.string()),
    faviconUrl: v.optional(v.string()),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    imageUrl: v.optional(v.string()),
    contentType: v.optional(v.string()),
    lang: v.optional(v.string()),
    status: v.optional(v.number()),
    lastCheckedAt: v.optional(v.float64()),
    createdAt: v.float64(),
    updatedAt: v.float64(),
    author: v.optional(v.string()),
    publishedDate: v.optional(v.string()),
    keywords: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) throw new Error("Unauthorized")
    return await ctx.db.insert("link_previews", {
      ...args,
      userId: identity.subject,
    })
  },
})

/**
 * Refresh a preview's fetched metadata. Internal: only the enrichment action
 * writes previews, and the patch is limited to metadata fields so it can never
 * move a preview to another user or rewrite its identity.
 */
export const patchPreview = internalMutation({
  args: {
    id: v.id("link_previews"),
    userId: v.string(),
    patch: v.object({
      originalUrl: v.optional(v.string()),
      siteName: v.optional(v.string()),
      faviconUrl: v.optional(v.string()),
      title: v.optional(v.string()),
      description: v.optional(v.string()),
      imageUrl: v.optional(v.string()),
      contentType: v.optional(v.string()),
      lang: v.optional(v.string()),
      status: v.optional(v.number()),
      lastCheckedAt: v.optional(v.float64()),
      updatedAt: v.optional(v.float64()),
      author: v.optional(v.string()),
      publishedDate: v.optional(v.string()),
      keywords: v.optional(v.array(v.string())),
    }),
  },
  handler: async (ctx, { id, userId, patch }) => {
    const doc = await ctx.db.get(id)
    if (!doc || doc.userId !== userId) throw new Error("Forbidden")
    await ctx.db.patch(id, patch)
  },
})

/** Internal: called by the enrichment action once the preview is stored. */
export const attachPreviewToCapture = internalMutation({
  args: {
    captureId: v.id("captures"),
    previewId: v.id("link_previews"),
    userId: v.string(),
  },
  handler: async (ctx, { captureId, previewId, userId }) => {
    const cap = await ctx.db.get(captureId)
    if (!cap || cap.userId !== userId || cap.kind !== "link") throw new Error("Forbidden")
    const preview = await ctx.db.get(previewId)
    if (!preview || preview.userId !== userId) throw new Error("Forbidden")
    await ctx.db.patch(captureId, { linkPreviewId: previewId })
  },
})


