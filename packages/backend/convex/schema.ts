import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * Where a capture is in the enrichment pipeline. New captures start as
 * `pending`; captures that predate the pipeline are backfilled to `skipped` so
 * they are never processed (and never billed) retroactively.
 */
export const captureStatusValidator = v.union(
  v.literal("pending"),
  v.literal("processing"),
  v.literal("ready"),
  v.literal("failed"),
  v.literal("skipped")
);

const weight = { weight: v.float64() };

/** One colour found in an element's computed styles. Spec 6.1 `DesignDNA`. */
export const dnaColorValidator = v.object({
  hex: v.string(),
  usage: v.union(v.literal("text"), v.literal("background"), v.literal("border")),
  ...weight,
});

export const dnaFontValidator = v.object({
  family: v.string(),
  generic: v.boolean(),
  /** px */
  size: v.float64(),
  fontWeight: v.float64(),
  /** px, null when `normal` */
  lineHeight: v.union(v.float64(), v.null()),
  /** px, null when `normal` */
  letterSpacing: v.union(v.float64(), v.null()),
  ...weight,
});

/**
 * Design DNA of a picked element: what its computed styles say, weighted by
 * the area each value covers. Mirrors the `DesignDNA` type in spec 6.1.
 */
export const designDnaValidator = v.object({
  version: v.literal(1),
  colors: v.array(dnaColorValidator),
  fonts: v.array(dnaFontValidator),
  radii: v.array(v.object({ value: v.float64(), ...weight })),
  shadows: v.array(v.object({ value: v.string(), ...weight })),
  spacing: v.array(v.object({ value: v.float64(), ...weight })),
  source: v.object({
    url: v.string(),
    title: v.string(),
    viewport: v.object({ w: v.float64(), h: v.float64() }),
    dpr: v.float64(),
    rect: v.object({ x: v.float64(), y: v.float64(), w: v.float64(), h: v.float64() }),
    clipped: v.boolean(),
  }),
});

/** A colour from the pixels themselves. Spec 6.2 `PaletteColor`. */
export const paletteColorValidator = v.object({
  hex: v.string(),
  lab: v.array(v.float64()),
  ...weight,
});

/** Derived from the stored image; only on kinds that hold one. */
const imageDerivedFields = {
  /** Pixel palette, heaviest first (max 6). */
  palette: v.optional(v.array(paletteColorValidator)),
  /** WebP thumbnail, max 768px wide, for grids. */
  thumbStorageId: v.optional(v.id("_storage")),
};

/** Fields every capture kind carries, whatever it holds. */
const commonCaptureFields = {
  status: v.optional(captureStatusValidator),
  /** Last enrichment error, when `status` is `failed`. */
  error: v.optional(v.string()),
};

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
    ...imageDerivedFields,
    ...commonCaptureFields,
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
    ...commonCaptureFields,
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
    ...commonCaptureFields,
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
    ...commonCaptureFields,
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
    ...imageDerivedFields,
    ...commonCaptureFields,
  }),
  // A screenshot of one picked element, cropped to its bounding rect.
  v.object({
    kind: v.literal("element"),
    storageId: v.id("_storage"),
    width: v.number(),
    height: v.number(),
    tagName: v.optional(v.string()),
    /** True when the element extended past the viewport and was cropped to its visible part. */
    clipped: v.optional(v.boolean()),
    alt: v.optional(v.string()),
    caption: v.optional(v.string()),
    imageEmbedding: v.optional(v.array(v.float64())),
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
    ...imageDerivedFields,
    /** Computed-style summary taken when the element was picked. */
    designDna: v.optional(designDnaValidator),
    ...commonCaptureFields,
  }),
  // A screenshot of the visible viewport.
  v.object({
    kind: v.literal("viewport"),
    storageId: v.id("_storage"),
    width: v.number(),
    height: v.number(),
    clipped: v.optional(v.boolean()),
    alt: v.optional(v.string()),
    caption: v.optional(v.string()),
    imageEmbedding: v.optional(v.array(v.float64())),
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
    ...imageDerivedFields,
    ...commonCaptureFields,
  })
);

export default defineSchema({
  captures: defineTable(captureValidator)
    .index("by_category_and_kind", ["category", "kind"])
    .index("by_user", ["userId"]) 
    .index("by_user_category_and_kind", ["userId", "category", "kind"])
    .index("by_user_and_kind", ["userId", "kind"])
    .index("by_user_session", ["userId", "sessionId"])
    // Lets a save refuse a storage object another capture already points at.
    .index("by_storageId", ["storageId"])
    // Same guard for thumbnails.
    .index("by_thumbStorageId", ["thumbStorageId"])
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
   * A capture session, started and finished explicitly by the user.
   *
   * While one is running every capture joins it; with none running captures
   * stay unfiled. Sessions are never created or ended automatically. They
   * record *why* something was saved, which is the one thing an embedding of
   * the pixels can never recover.
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
     * Set when the user explicitly finishes the session. An ended session is
     * never rejoined; later captures stay unfiled until the user starts a new
     * one.
     */
    endedAt: v.optional(v.float64()),
    itemCount: v.float64(),
    /** Aggregates kept on the session so listing it needs no capture reads. */
    domains: v.optional(v.array(v.string())),
    tags: v.optional(v.array(v.string())),
  })
    .index("by_user_lastCaptureAt", ["userId", "lastCaptureAt"])
    .index("by_user_startedAt", ["userId", "startedAt"]),
  /**
   * A capture's colours, normalised from its DNA and pixel palette (merged at
   * ΔE2000 < 5, max 12, weights summing to 1). Kept as rows so a colour filter
   * can scan colours rather than every capture.
   */
  captureColors: defineTable({
    captureId: v.id("captures"),
    userId: v.string(),
    hex: v.string(),
    /** CIELAB (D65) */
    l: v.float64(),
    a: v.float64(),
    b: v.float64(),
    /** 0..1, share of the capture */
    weight: v.float64(),
  })
    .index("by_capture", ["captureId"])
    .index("by_user", ["userId"]),
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
