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
import { ConvexError } from "convex/values"

import { REGENERATED_ELSEWHERE } from "../../../packages/backend/convex/lib/design_system/types"
import {
  draftAfterSave,
  isDirty,
  isRegenConflict,
  isRegeneratedElsewhere,
  shownTokens,
} from "../../web/src/lib/design-system/draft"
import {
  GOOGLE_FONTS_OPT_IN_KEY,
  readGoogleFontsOptIn,
  writeGoogleFontsOptIn,
} from "../../web/src/lib/design-system/font-consent"
import {
  addSecondary,
  BASE_SIZE_MAX,
  BASE_SIZE_MIN,
  normalizeHex,
  parseRem,
  removeSecondary,
  SECONDARY_HUE_SHIFT,
  seedSecondaryHex,
  setBaseColor,
  setRadiusMd,
  setScale500,
  setSpacingBase,
  setTypeScale,
  stableStringify,
  tokensEqual,
  typeScaleNotes,
  withCurrent,
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

  test("a new secondary is seeded from primary's hue turned ~150 degrees", () => {
    for (const hex of ["#6d28d9", "#3b82f6", "#ef4444", "#16a34a"]) {
      const seed = seedSecondaryHex(hex)!
      const a = hexToOklch(hex)!
      const b = hexToOklch(seed)!
      const turn = (((b.h - a.h) % 360) + 360) % 360
      // Gamut clamping keeps the hue; 8-bit rounding moves it a little.
      expect(Math.abs(turn - SECONDARY_HUE_SHIFT)).toBeLessThan(4)
      expect(Math.abs(b.l - a.l)).toBeLessThan(0.02)
    }
    const t = addSecondary(removeSecondary(makeTokens()))
    expect(t.colors.secondary!["500"]).toBe(seedSecondaryHex(t.colors.primary["500"]))
    expect(t.colors.secondary!["500"]).not.toBe(t.colors.primary["700"])
    expect(seedSecondaryHex("nope")).toBeNull()
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
    // Alpha forms are not colours here (the backend's normalizeHex rejects them).
    expect(normalizeHex("#abcd")).toBeNull()
    expect(normalizeHex("#aabbccdd")).toBeNull()
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
    // 18 x 1.5^6 would pass 96px, so 5xl is capped at 6rem; small steps divide by 1.2.
    expect(t.typography.scale["5xl"]).toBe("6rem")
    expect(t.typography.scale.sm).toBe("0.9375rem")
    for (let i = 1; i < TYPE_STEPS.length; i++) {
      expect(parseRem(t.typography.scale[TYPE_STEPS[i]])!).toBeGreaterThan(parseRem(t.typography.scale[TYPE_STEPS[i - 1]])!)
    }
    expect(typeScaleNotes(t).some((n) => n.startsWith("5xl capped at 96px"))).toBe(true)
    expect(typeScaleNotes(setTypeScale(makeTokens(), { ratio: 1.125, baseSize: 16 }))).toEqual([])
    expect(typeScaleNotes(makeTokens())).toEqual(["Small type steps floored at 12px"])
    // Base size is clamped to what validateTokens accepts.
    expect([BASE_SIZE_MIN, BASE_SIZE_MAX]).toEqual([12, 32])
    expect(setTypeScale(makeTokens(), { baseSize: 400 }).typography.baseSize).toBe(32)
    expect(setTypeScale(makeTokens(), { baseSize: 8 }).typography.baseSize).toBe(12)
    expect(() => validateTokens(setTypeScale(makeTokens(), { baseSize: 8 }))).not.toThrow()
  })

  test("withCurrent keeps an off-step current value selectable", () => {
    const weights = [100, 200, 300, 400, 500, 600, 700, 800, 900]
    expect(withCurrent(weights, 650).map((o) => o.value)).toEqual([100, 200, 300, 400, 500, 600, 650, 700, 800, 900])
    expect(withCurrent(weights, 700)).toHaveLength(9)
    expect(withCurrent([1.125, 1.2, 1.25, 1.333, 1.5], 1.414).map((o) => o.label)).toContain("1.414")
    expect(withCurrent(weights, Number.NaN)).toHaveLength(9)
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

describe("draft bookkeeping", () => {
  const stored = makeTokens()
  const edited = setBaseColor(stored, "text", "#000000")

  test("shows the stored tokens until there is a draft", () => {
    expect(shownTokens(null, stored)).toBe(stored)
    expect(shownTokens(edited, stored)).toBe(edited)
    expect(shownTokens(null, undefined)).toBeUndefined()
  })

  test("dirty compares with the last save until the row catches up", () => {
    expect(isDirty(null, stored, null)).toBe(false)
    expect(isDirty(edited, stored, null)).toBe(true)
    expect(isDirty(edited, stored, edited)).toBe(false)
    expect(isDirty(stored, stored, null)).toBe(false)
  })

  test("edits made during a save are kept", () => {
    const later = setBaseColor(edited, "background", "#fefefe")
    expect(draftAfterSave(edited, edited, edited)).toBe(edited)
    expect(draftAfterSave(later, edited, edited)).toBe(later)
    const cleaned = { ...edited }
    expect(draftAfterSave(edited, edited, cleaned)).toBe(cleaned)
    expect(draftAfterSave(null, edited, cleaned)).toBe(cleaned)
  })

  test("a regeneration under unsaved edits is a conflict", () => {
    const base = { dirty: true, baseGeneratedAt: 100, rowGeneratedAt: 100, serverRefused: false }
    expect(isRegenConflict(base)).toBe(false)
    expect(isRegenConflict({ ...base, rowGeneratedAt: 101 })).toBe(true)
    expect(isRegenConflict({ ...base, rowGeneratedAt: 101, dirty: false })).toBe(false)
    expect(isRegenConflict({ ...base, serverRefused: true })).toBe(true)
    expect(isRegenConflict({ ...base, baseGeneratedAt: null, rowGeneratedAt: 101 })).toBe(false)
  })

  test("recognises save's Regenerated elsewhere error", () => {
    expect(isRegeneratedElsewhere(new ConvexError(REGENERATED_ELSEWHERE))).toBe(true)
    expect(isRegeneratedElsewhere(new ConvexError("something else"))).toBe(false)
    expect(isRegeneratedElsewhere(new Error(REGENERATED_ELSEWHERE))).toBe(false)
    expect(isRegeneratedElsewhere(null)).toBe(false)
    expect(isRegeneratedElsewhere("Regenerated elsewhere")).toBe(false)
  })
})

describe("Google Fonts opt-in", () => {
  function memoryStorage() {
    const m = new Map<string, string>()
    return {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
      removeItem: (k: string) => void m.delete(k),
      map: m,
    }
  }
  const throwing = {
    getItem: (): string | null => {
      throw new Error("SecurityError")
    },
    setItem: () => {
      throw new Error("QuotaExceededError")
    },
    removeItem: () => {
      throw new Error("SecurityError")
    },
  }

  test("off by default, remembered when turned on, forgotten when turned off", () => {
    const s = memoryStorage()
    expect(readGoogleFontsOptIn(s)).toBe(false)
    expect(writeGoogleFontsOptIn(true, s)).toBe(true)
    expect(s.map.get(GOOGLE_FONTS_OPT_IN_KEY)).toBe("1")
    expect(readGoogleFontsOptIn(s)).toBe(true)
    expect(writeGoogleFontsOptIn(false, s)).toBe(true)
    expect(readGoogleFontsOptIn(s)).toBe(false)
  })

  test("blocked or missing storage reads as off and never throws", () => {
    expect(readGoogleFontsOptIn(throwing)).toBe(false)
    expect(writeGoogleFontsOptIn(true, throwing)).toBe(false)
    expect(readGoogleFontsOptIn(null)).toBe(false)
    expect(writeGoogleFontsOptIn(true, null)).toBe(false)
  })

  test("uses window.localStorage by default", () => {
    window.localStorage.removeItem(GOOGLE_FONTS_OPT_IN_KEY)
    expect(readGoogleFontsOptIn()).toBe(false)
    writeGoogleFontsOptIn(true)
    expect(readGoogleFontsOptIn()).toBe(true)
    writeGoogleFontsOptIn(false)
  })
})
