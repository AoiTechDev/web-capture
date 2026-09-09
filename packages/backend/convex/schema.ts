import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const captureValidator = v.union(
  v.object({
    kind: v.literal("image"),
    src: v.string(),
    alt: v.optional(v.string()),
    storageId: v.optional(v.id("_storage")),
    caption: v.optional(v.string()),
    imageEmbedding: v.optional(v.array(v.float64())),
    localEmbedding: v.optional(v.array(v.float64())),
    url: v.string(),
    timestamp: v.float64(),
    width: v.number(),
    height: v.number(),
    category: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    title: v.optional(v.string()),
    note: v.optional(v.string()),
    userId: v.optional(v.string()),
    domain: v.optional(v.string()),
    sessionId: v.optional(v.id("sessions")),
  }),
  v.object({
    kind: v.literal("text"),
    content: v.string(),
    localEmbedding: v.optional(v.array(v.float64())),
    url: v.string(),
    timestamp: v.float64(),
    category: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    title: v.optional(v.string()),
    note: v.optional(v.string()),
    userId: v.optional(v.string()),
    domain: v.optional(v.string()),
    sessionId: v.optional(v.id("sessions")),
  }),
  v.object({
    kind: v.literal("link"),
    href: v.string(),
    text: v.optional(v.string()),
    localEmbedding: v.optional(v.array(v.float64())),
    url: v.string(),
    timestamp: v.float64(),
    category: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    title: v.optional(v.string()),
    note: v.optional(v.string()),
    linkPreviewId: v.optional(v.id("link_previews")),
    userId: v.optional(v.string()),
    domain: v.optional(v.string()),
    sessionId: v.optional(v.id("sessions")),
  }),
  v.object({
    kind: v.literal("code"),
    content: v.string(),
    localEmbedding: v.optional(v.array(v.float64())),
    url: v.string(),
    timestamp: v.float64(),
    category: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    title: v.optional(v.string()),
    note: v.optional(v.string()),
    userId: v.optional(v.string()),
    domain: v.optional(v.string()),
    sessionId: v.optional(v.id("sessions")),
  }),
  v.object({
    kind: v.literal("screenshot"),
    tagName: v.optional(v.string()),
    content: v.optional(v.string()),
    url: v.string(),
    timestamp: v.float64(),
    storageId: v.optional(v.id("_storage")),
    src: v.optional(v.string()),
    alt: v.optional(v.string()),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
    caption: v.optional(v.string()),
    imageEmbedding: v.optional(v.array(v.float64())),
    localEmbedding: v.optional(v.array(v.float64())),
    category: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    title: v.optional(v.string()),
    note: v.optional(v.string()),
    userId: v.optional(v.string()),
    domain: v.optional(v.string()),
    sessionId: v.optional(v.id("sessions")),
  })
);

export default defineSchema({
  captures: defineTable(captureValidator)
    .index("by_category_and_kind", ["category", "kind"])
    .index("by_user", ["userId"]) 
    .index("by_user_category_and_kind", ["userId", "category", "kind"])
    .index("by_user_and_kind", ["userId", "kind"])
    // CLIP ViT-B/32 projection dimension. Scoping the index by userId keeps
    // one user's vectors out of another's result set at the index level.
    .vectorIndex("by_localEmbedding", {
      vectorField: "localEmbedding",
      dimensions: 512,
      filterFields: ["userId"],
    }),
  link_previews: defineTable({
    userId: v.string(),
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
   
  })
    .index("by_user_and_canonicalUrl", ["userId", "canonicalUrl"])
    .index("by_user_createdAt", ["userId", "createdAt"]),
  /**
   * A browsing burst.
   *
   * Inspiration gathering is bursty: a run of captures minutes apart is almost
   * always about one thing, and a long gap means a new intent. Grouping by that
   * gap costs the user nothing, and it records *why* something was saved, which
   * is the one thing an embedding of the pixels can never recover.
   */
  sessions: defineTable({
    userId: v.string(),
    /** User-chosen name. Absent until someone bothers; autoName covers it. */
    name: v.optional(v.string()),
    /** Derived from the session's own contents, recomputed as it grows. */
    autoName: v.optional(v.string()),
    startedAt: v.float64(),
    lastCaptureAt: v.float64(),
    /**
     * Set when the user explicitly closes the session. An ended session is
     * never rejoined, so the next capture starts a fresh one even if it
     * lands inside the idle window.
     */
    endedAt: v.optional(v.float64()),
    itemCount: v.float64(),
    /** Aggregates kept on the session so listing it needs no capture reads. */
    domains: v.optional(v.array(v.string())),
    tags: v.optional(v.array(v.string())),
  })
    .index("by_user_lastCaptureAt", ["userId", "lastCaptureAt"])
    .index("by_user_startedAt", ["userId", "startedAt"]),
  categories: defineTable({
    name: v.string(),
    createdAt: v.float64(),
    userId: v.string(),
  })
    .index("by_user_and_name", ["userId", "name"]) 
    .index("by_user_createdAt", ["userId", "createdAt"]),
  tags: defineTable({
    name: v.string(),
    userId: v.string(),
    lastUsedAt: v.float64(),
    useCount: v.number(),
  })
    .index("by_user_and_name", ["userId", "name"]) 
    .index("by_user_lastUsedAt", ["userId", "lastUsedAt"]),
});
