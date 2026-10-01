/**
 * The design system editor's pure helpers (apps/web/src/lib/design-system):
 * the Google Fonts URL builder, font stacks, token edits (scale regeneration,
 * type/spacing/radius rebuilds) and the preview's CSS variables.
 */
import { describe, expect, test } from "vitest"

import { contrastRatio } from "../../../packages/backend/convex/lib/design_system/contrast"
import { hexToOklch } from "../../../packages/backend/convex/lib/design_system/oklch"
import { SHADE_STEPS, TYPE_STEPS } from "../../../packages/backend/convex/lib/design_system/types"
import { validateTokens } from "../../../packages/backend/convex/lib/design_system/validate"
import {
  normalizeHex,
  parseRem,
  removeSecondary,
  setBaseColor,
  setRadiusMd,
  setScale500,
  setSpacingBase,
  setTypeScale,
  stableStringify,
  tokensEqual,
} from "../../web/src/lib/design-system/edit"
import { convexErrorMessage } from "../../web/src/lib/design-system/errors"
import {
  fontStack,
  googleFontsUrl,
  isValidFontFamily,
  normalizeWeights,
} from "../../web/src/lib/design-system/fonts"
import { onColor, previewVars } from "../../web/src/lib/design-system/preview"
import { makeTokens } from "./design-system-fixtures"

describe("googleFontsUrl", () => {
  test("builds a css2 URL with display=swap", () => {
    expect(googleFontsUrl("Inter", [700, 400, 400])).toBe(
      "https://fonts.googleapis.com/css2?family=Inter:wght@400;700&display=swap"
    )
    expect(googleFontsUrl("Space Grotesk")).toBe("https://fonts.googleapis.com/css2?family=Space+Grotesk&display=swap")
    expect(googleFontsUrl("Source Serif 4", [450, 600, 1000, 0, Number.NaN])).toBe(
      "https://fonts.googleapis.com/css2?family=Source+Serif+4:wght@600&display=swap"
    )
  })

  test.each([
    "",
    " Inter",
    "Inter ",
    "Open  Sans",
    "Inter;",
    "Inter&family=Evil",
    "Inter:wght@900",
    "Inter#x",
    "../../evil",
    "Inter%20Sans",
    "Ro<b>to",
    'Ro"to',
    "Inter\nSans",
    "Über Sans",
    "a".repeat(61),
  ])("rejects %j", (name) => {
    expect(isValidFontFamily(name)).toBe(false)
    expect(googleFontsUrl(name)).toBeNull()
  })

  test("rejects non-strings and system faces", () => {
    for (const v of [null, undefined, 42, {}, ["Inter"]]) expect(isValidFontFamily(v)).toBe(false)
    expect(googleFontsUrl("Arial")).toBeNull()
    expect(googleFontsUrl("Helvetica Neue")).toBeNull()
    expect(googleFontsUrl("system ui")).toBeNull()
  })

  test("accepts 60 characters, not 61", () => {
    expect(isValidFontFamily("a".repeat(60))).toBe(true)
    expect(isValidFontFamily("a".repeat(61))).toBe(false)
  })

  test("normalizeWeights keeps whole hundreds 100-900", () => {
    expect(normalizeWeights([900, 100, 150, 1000, 400.5, 400])).toEqual([100, 400, 900])
  })

  test("fontStack quotes the family and falls back for an empty one", () => {
    expect(fontStack("  Inter  ")).toBe('"Inter", system-ui, sans-serif')
    expect(fontStack("")).toBe("system-ui, sans-serif")
  })
})

describe("colour scale (buildScale via setScale500)", () => {
  const samples = ["#6d28d9", "#3b82f6", "#ef4444", "#16a34a", "#eab308", "#0891b2", "#db2777", "#64748b", "#ff0000", "#00ff00", "#0000ff", "#808080"]

  test.each(samples)("%s: lightness falls strictly from 50 to 950 and 500 is the input", (hex) => {
    const t = setScale500(makeTokens(), "primary", hex)
    const scale = t.colors.primary
    expect(scale["500"]).toBe(hex)
    const ls = SHADE_STEPS.map((s) => hexToOklch(scale[s])!.l)
    for (let i = 1; i < ls.length; i++) expect(ls[i], `${SHADE_STEPS[i - 1]} -> ${SHADE_STEPS[i]}`).toBeLessThan(ls[i - 1])
  })

  test.each(["#fafafa", "#111111", "#ffffff", "#000000", "#ffff00"])("%s: lightness never rises", (hex) => {
    const ls = SHADE_STEPS.map((s) => hexToOklch(setScale500(makeTokens(), "primary", hex).colors.primary[s])!.l)
    for (let i = 1; i < ls.length; i++) expect(ls[i]).toBeLessThanOrEqual(ls[i - 1] + 1e-9)
  })

  test("a malformed colour leaves the tokens alone; 3-digit hex is expanded", () => {
    const t = makeTokens()
    expect(setScale500(t, "primary", "nope")).toBe(t)
    expect(setScale500(t, "secondary", "#F0A").colors.secondary!["500"]).toBe("#ff00aa")
  })

  test("removeSecondary drops the scale", () => {
    expect(removeSecondary(makeTokens()).colors.secondary).toBeUndefined()
  })
})

describe("token edits", () => {
  test("normalizeHex", () => {
    expect(normalizeHex("ABC")).toBe("#aabbcc")
    expect(normalizeHex(" #1D4ED8 ")).toBe("#1d4ed8")
    expect(normalizeHex("#12345")).toBeNull()
    expect(normalizeHex("red")).toBeNull()
  })

  test("setBaseColor writes lowercase hex and ignores garbage", () => {
    const t = makeTokens()
    expect(setBaseColor(t, "text", "#ABCDEF").colors.text).toBe("#abcdef")
    expect(setBaseColor(t, "text", "x; }")).toBe(t)
  })

  test("setTypeScale rebuilds the scale from ratio and base size", () => {
    const t = setTypeScale(makeTokens(), { ratio: 1.5, baseSize: 18 })
    expect(t.typography.ratio).toBe(1.5)
    expect(t.typography.scale.base).toBe("1.125rem")
    expect(t.typography.scale.lg).toBe("1.688rem")
    expect(t.typography.scale.xs).toBe("0.5rem")
    for (let i = 1; i < TYPE_STEPS.length; i++) {
      expect(parseRem(t.typography.scale[TYPE_STEPS[i]])!).toBeGreaterThan(parseRem(t.typography.scale[TYPE_STEPS[i - 1]])!)
    }
    // Base size is clamped to the editor's range.
    expect(setTypeScale(makeTokens(), { baseSize: 400 }).typography.baseSize).toBe(24)
  })

  test("setSpacingBase doubles the scale for 8px", () => {
    const t = setSpacingBase(makeTokens(), 8)
    expect(t.spacing.base).toBe(8)
    expect(t.spacing.scale["4"]).toBe("2rem")
    expect(t.spacing.scale["0"]).toBe("0rem")
  })

  test("setRadiusMd derives sm and lg", () => {
    const t = setRadiusMd(makeTokens(), 12)
    expect(t.radius).toEqual({ sm: "0.375rem", md: "0.75rem", lg: "1.5rem", full: "9999px" })
    expect(setRadiusMd(makeTokens(), -1)).toEqual(makeTokens())
  })

  test("edited tokens still pass the backend validator", () => {
    let t = makeTokens()
    t = setScale500(t, "primary", "#123456")
    t = setTypeScale(t, { ratio: 1.333, baseSize: 15 })
    t = setSpacingBase(t, 8)
    t = setRadiusMd(t, 6)
    expect(() => validateTokens(t)).not.toThrow()
  })

  test("tokensEqual ignores key order", () => {
    const a = makeTokens()
    const b = JSON.parse(JSON.stringify(a))
    b.colors = { ...Object.fromEntries(Object.entries(b.colors).reverse()) }
    expect(stableStringify(a)).toBe(stableStringify(b))
    expect(tokensEqual(a, b)).toBe(true)
    expect(tokensEqual(a, setBaseColor(a, "text", "#000000"))).toBe(false)
  })

  test("parseRem", () => {
    expect(parseRem("1.25rem")).toBe(1.25)
    expect(parseRem("8px")).toBe(0.5)
    expect(parseRem("big")).toBeNull()
    expect(parseRem(undefined)).toBeNull()
  })

  test("convexErrorMessage keeps the server's reason", () => {
    const e = new Error("[CONVEX M(design_systems:save)] [Request ID: x] Server Error\nUncaught Error: Invalid design system tokens: colors.text must be a #rrggbb colour\n    at handler")
    expect(convexErrorMessage(e, "fallback")).toBe("Invalid design system tokens: colors.text must be a #rrggbb colour")
    expect(convexErrorMessage(new Error(""), "fallback")).toBe("fallback")
  })
})

describe("preview variables", () => {
  test("every token reaches a --ds-* variable", () => {
    const t = makeTokens()
    const v = previewVars(t)
    expect(v["--ds-background"]).toBe("#ffffff")
    expect(v["--ds-text-muted"]).toBe("#475569")
    for (const s of SHADE_STEPS) {
      expect(v[`--ds-primary-${s}`]).toBe(t.colors.primary[s])
      expect(v[`--ds-secondary-${s}`]).toBe(t.colors.secondary![s])
    }
    for (const s of TYPE_STEPS) expect(v[`--ds-text-${s}`]).toBe(t.typography.scale[s])
    for (const [k, val] of Object.entries(t.spacing.scale)) expect(v[`--ds-space-${k}`]).toBe(val)
    expect(v["--ds-font-heading"]).toBe('"Space Grotesk", system-ui, sans-serif')
    expect(v["--ds-radius-md"]).toBe("0.5rem")
    expect(v["--ds-shadow-md"]).toBe(t.shadow.md)
  })

  test("hostile values are left out", () => {
    const t = makeTokens({ fontHeading: 'x"; color: red' })
    t.colors.text = "red; background: url(x)"
    t.shadow = { md: "0 0 1px url(x)" }
    const v = previewVars(t)
    expect(v["--ds-text"]).toBeUndefined()
    expect(v["--ds-shadow-md"]).toBeUndefined()
    expect(v["--ds-font-heading"]).not.toContain('"; ')
  })

  test("onColor picks the more readable of white and the 950 shade", () => {
    expect(onColor("#fde047", "#422006")).toBe("#422006")
    expect(onColor("#1d4ed8", "#172554")).toBe("#ffffff")
    expect(contrastRatio(onColor("#6d28d9", "#2e1065"), "#6d28d9")).toBeGreaterThan(4.5)
  })
})
