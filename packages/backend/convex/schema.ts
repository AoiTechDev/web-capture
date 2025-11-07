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
    url: v.string(),
    timestamp: v.float64(),
    width: v.number(),
    height: v.number(),
    category: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    title: v.optional(v.string()),
    note: v.optional(v.string()),
    userId: v.optional(v.string()),
  }),
  v.object({
    kind: v.literal("text"),
    content: v.string(),
    url: v.string(),
    timestamp: v.float64(),
    category: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    title: v.optional(v.string()),
    note: v.optional(v.string()),
    userId: v.optional(v.string()),
  }),
  v.object({
    kind: v.literal("link"),
    href: v.string(),
    text: v.optional(v.string()),
    url: v.string(),
    timestamp: v.float64(),
    category: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    title: v.optional(v.string()),
    note: v.optional(v.string()),
    userId: v.optional(v.string()),
  }),
  v.object({
    kind: v.literal("code"),
    content: v.string(),
    url: v.string(),
    timestamp: v.float64(),
    category: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    title: v.optional(v.string()),
    note: v.optional(v.string()),
    userId: v.optional(v.string()),
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
    category: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    title: v.optional(v.string()),
    note: v.optional(v.string()),
    userId: v.optional(v.string()),
  })
);

export default defineSchema({
  captures: defineTable(captureValidator)
    .index("by_category_and_kind", ["category", "kind"])
    .index("by_user", ["userId"]) 
    .index("by_user_category_and_kind", ["userId", "category", "kind"]),
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
