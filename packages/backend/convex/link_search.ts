import { query } from "./_generated/server"
import { v } from "convex/values"

export const searchLinks = query({
  args: { q: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, { q, limit }) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) return { results: [] as const }
    
    const take = Math.max(1, Math.min(100, limit ?? 30))
    const lc = q.toLowerCase()

    
    const linkCaptures = await ctx.db
      .query("captures")
      .withIndex("by_user_and_kind", (q2) => 
        q2.eq("userId", identity.subject).eq("kind", "link")
      )
      .collect()

    
    const previewIds = linkCaptures
      .map((c: any) => c.linkPreviewId)
      .filter((id): id is any => id !== undefined)

    
    const previews = await Promise.all(
      previewIds.map((id) => ctx.db.get(id))
    )
    const previewMap = new Map(
      previews
        .filter((p): p is any => p !== null && (p as any).domain !== undefined)
        .map((p: any) => [p._id, p])
    )

    console.log('[searchLinks] Query:', lc, 'Link captures found:', linkCaptures.length)

    
    const terms = lc.split(/\s+/).filter(Boolean)
    console.log('[searchLinks] Search terms:', terms)
    
    const scored = linkCaptures
      .map((capture: any) => {
        const preview: any = capture.linkPreviewId ? previewMap.get(capture.linkPreviewId) : null
        
        let score = 0
        
        for (const term of terms) {
          
          if (capture.href?.toLowerCase().includes(term)) score += 10
          
          
          if (preview?.description?.toLowerCase().includes(term)) score += 8
          
          
          if (preview?.title?.toLowerCase().includes(term)) score += 7
          if (capture.title?.toLowerCase().includes(term)) score += 7
          
          
          if (preview?.keywords?.some((k: string) => k.toLowerCase().includes(term))) score += 6
          
          
          if (preview?.domain?.toLowerCase().includes(term)) score += 5
        }

        return { capture, preview, score }
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, take)

    console.log('[searchLinks] Scored results:', scored.length)

    
    const results = scored.map(({ capture, preview }) => ({
      id: capture._id,
      kind: "link" as const,
      title: preview?.title || capture.title || capture.text || "Untitled",
      description: preview?.description || "",
      url: capture.href,
      href: capture.href,
      pageUrl: capture.url,
      domain: preview?.domain || "",
      faviconUrl: preview?.faviconUrl,
      imageUrl: preview?.imageUrl,
      contentType: preview?.contentType,
      tags: capture.tags || [],
      category: capture.category || "unsorted",
      timestamp: capture.timestamp,
    }))

    console.log('[searchLinks] Results:', results)

    return { results } as const
  },
})


