// convex/schema.ts
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const captureValidator = v.union(
  v.object({
    kind: v.literal("image"),
    src: v.string(),
    alt: v.optional(v.string()),
    // optional Convex storage reference if you upload the file
    storageId: v.optional(v.id("_storage")),
    url: v.string(),
    timestamp: v.float64(),
    width: v.number(),
    height: v.number(),
  }),
  v.object({
    kind: v.literal("text"),
    content: v.string(),
    url: v.string(),
    timestamp: v.float64(),
  }),
  v.object({
    kind: v.literal("link"),
    href: v.string(),
    text: v.optional(v.string()),
    url: v.string(),
    timestamp: v.float64(),
  }),
  v.object({
    kind: v.literal("code"),
    content: v.string(),
    url: v.string(),
    timestamp: v.float64(),
  }),
  v.object({
    kind: v.literal("element"),
    tagName: v.string(),
    content: v.optional(v.string()),
    url: v.string(),
    timestamp: v.float64(),
  })
);

export default defineSchema({
  captures: defineTable(captureValidator).index("by_kind", ["kind"]),
});
