import { v } from "convex/values";

/**
 * Stored shape of lib/design_system/types DesignSystemTokens. Scales are
 * records here; their exact keys and every string's format are enforced by
 * lib/design_system/validate validateTokens before anything is written.
 */
export const designTokensValidator = v.object({
  version: v.literal(1),
  mode: v.union(v.literal("light"), v.literal("dark")),
  colors: v.object({
    background: v.string(),
    surface: v.string(),
    border: v.string(),
    text: v.string(),
    textMuted: v.string(),
    primary: v.record(v.string(), v.string()),
    secondary: v.optional(v.record(v.string(), v.string())),
  }),
  typography: v.object({
    fontHeading: v.string(),
    fontBody: v.string(),
    ratio: v.float64(),
    baseSize: v.float64(),
    scale: v.record(v.string(), v.string()),
    headingWeight: v.float64(),
    bodyWeight: v.float64(),
    headingLineHeight: v.float64(),
    bodyLineHeight: v.float64(),
  }),
  spacing: v.object({ base: v.union(v.literal(4), v.literal(8)), scale: v.record(v.string(), v.string()) }),
  radius: v.object({ sm: v.string(), md: v.string(), lg: v.string(), full: v.string() }),
  shadow: v.object({ sm: v.optional(v.string()), md: v.optional(v.string()), lg: v.optional(v.string()) }),
});

export const contrastCheckValidator = v.object({
  pair: v.union(
    v.literal("text/background"),
    v.literal("textMuted/background"),
    v.literal("text/surface"),
    v.literal("textMuted/surface"),
    v.literal("primary/background")
  ),
  foreground: v.string(),
  background: v.string(),
  ratio: v.float64(),
  required: v.float64(),
  passes: v.boolean(),
});
