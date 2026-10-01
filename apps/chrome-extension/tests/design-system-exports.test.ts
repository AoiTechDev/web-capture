/**
 * Design system exports (apps/web/src/lib/design-system/exports.ts): CSS
 * custom properties, Tailwind v4 @theme and W3C Design Tokens JSON. The CSS is
 * parsed with postcss (a devDependency of this package), the JSON with
 * JSON.parse.
 */
import postcss, { type AtRule, type Declaration, type Root, type Rule } from "postcss"
import { describe, expect, test } from "vitest"

import { SHADE_STEPS, TYPE_STEPS } from "../../../packages/backend/convex/lib/design_system/types"
import {
  cssColorToHex,
  DTCG_EXTENSION,
  dtcgDimension,
  parseShadow,
  toCssVariables,
  toDesignTokens,
  toDesignTokensJson,
  toTailwindTheme,
} from "../../web/src/lib/design-system/exports"
import { cssString, familyName } from "../../web/src/lib/design-system/fonts"
import { makeTokens } from "./design-system-fixtures"

const NUL = String.fromCharCode(0)
const REPLACEMENT = String.fromCharCode(0xfffd)

function decls(root: Root): Map<string, string> {
  const out = new Map<string, string>()
  root.walkDecls((d: Declaration) => {
    expect(out.has(d.prop), `duplicate ${d.prop}`).toBe(false)
    out.set(d.prop, d.value)
  })
  return out
}

type Leaf = { $value: unknown; $type?: string }

function leaves(group: unknown, path: string[] = [], out = new Map<string, Leaf>()): Map<string, Leaf> {
  for (const [k, v] of Object.entries(group as Record<string, unknown>)) {
    if (k.startsWith("$")) continue
    if (v && typeof v === "object" && "$value" in v) out.set([...path, k].join("."), v as Leaf)
    else leaves(v, [...path, k], out)
  }
  return out
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>

/** Every token as [css name, tailwind name, json path, value]. */
function expected(t = makeTokens()): Array<[string, string, string, string]> {
  const rows: Array<[string, string, string, string]> = []
  const base = { background: "background", surface: "surface", border: "border", text: "text", textMuted: "text-muted" }
  for (const [k, css] of Object.entries(base)) {
    const v = t.colors[k as keyof typeof base]
    rows.push([`--color-${css}`, `--color-${css}`, `color.${k}`, v])
  }
  for (const s of SHADE_STEPS) {
    rows.push([`--color-primary-${s}`, `--color-primary-${s}`, `color.primary.${s}`, t.colors.primary[s]])
    rows.push([`--color-secondary-${s}`, `--color-secondary-${s}`, `color.secondary.${s}`, t.colors.secondary![s]])
  }
  for (const s of TYPE_STEPS) rows.push([`--text-${s}`, `--text-${s}`, `fontSize.${s}`, t.typography.scale[s]])
  for (const [k, v] of Object.entries(t.spacing.scale)) rows.push([`--space-${k}`, `--spacing-${k}`, `spacing.${k}`, v])
  for (const k of ["sm", "md", "lg", "full"] as const) rows.push([`--radius-${k}`, `--radius-${k}`, `radius.${k}`, t.radius[k]])
  rows.push(["--font-weight-heading", "--font-weight-heading-weight", "fontWeight.heading", "700"])
  rows.push(["--font-weight-body", "--font-weight-body-weight", "fontWeight.body", "400"])
  rows.push(["--line-height-heading", "--leading-heading", "lineHeight.heading", "1.2"])
  rows.push(["--line-height-body", "--leading-body", "lineHeight.body", "1.5"])
  return rows
}

describe("CSS custom properties", () => {
  const css = toCssVariables(makeTokens())
  const root = postcss.parse(css)

  test("parses into a single :root rule of custom properties", () => {
    const rules = root.nodes.filter((n) => n.type === "rule") as Rule[]
    expect(rules).toHaveLength(1)
    expect(rules[0].selector).toBe(":root")
    expect(root.nodes.filter((n) => n.type !== "rule" && n.type !== "comment")).toHaveLength(0)
    for (const [prop] of decls(root)) expect(prop === "color-scheme" || prop.startsWith("--")).toBe(true)
  })

  test("carries every token", () => {
    const d = decls(root)
    for (const [name, , , value] of expected()) expect(d.get(name), name).toBe(value)
    expect(d.get("--font-heading")).toBe('"Space Grotesk", system-ui, sans-serif')
    expect(d.get("--font-body")).toBe('"Inter", system-ui, sans-serif')
    expect(d.get("--shadow-sm")).toBe("0 1px 2px rgba(15, 23, 42, 0.06)")
    expect(d.get("--shadow-md")).toContain("rgb(0 0 0 / 0.1)")
    expect(d.get("--shadow-lg")).toBeDefined()
    expect(d.get("color-scheme")).toBe("light")
  })

  test("matches the spec sample's names and values", () => {
    expect(css).toContain("--color-primary-500: #6d28d9;")
    expect(css).toContain("--text-base: 1rem;")
    expect(css).toContain("--space-4: 1rem;")
    expect(css).toContain("--radius-md: 0.5rem;")
  })
})

describe("Tailwind v4 @theme", () => {
  const css = toTailwindTheme(makeTokens())
  const root = postcss.parse(css)

  test("imports tailwindcss and declares one @theme block", () => {
    const atRules = root.nodes.filter((n) => n.type === "atrule") as AtRule[]
    expect(atRules.map((a) => a.name)).toEqual(["import", "theme"])
    expect(atRules[0].params).toBe('"tailwindcss"')
    expect(root.nodes.filter((n) => n.type === "rule")).toHaveLength(0)
  })

  test("uses only Tailwind v4 theme namespaces", () => {
    const allowed = /^--(?:color|font|font-weight|leading|text|spacing|radius|shadow)(?:-|$)/
    for (const [prop] of decls(root)) expect(prop, prop).toMatch(allowed)
  })

  test("carries every token", () => {
    const d = decls(root)
    for (const [, name, , value] of expected()) expect(d.get(name), name).toBe(value)
    expect(d.get("--spacing")).toBe("0.25rem")
    expect(d.get("--font-heading")).toBe('"Space Grotesk", system-ui, sans-serif')
    for (const s of ["sm", "md", "lg"]) expect(d.get(`--shadow-${s}`)).toBeDefined()
  })

  test("weight and family variables never produce the same utility name", () => {
    // Tailwind v4: --font-<x> -> font-<x> (family), --font-weight-<x> -> font-<x> (weight).
    const d = decls(root)
    const keys = [...d.keys()]
    const families = keys.filter((k) => k.startsWith("--font-") && !k.startsWith("--font-weight-")).map((k) => k.slice(7))
    const weights = keys.filter((k) => k.startsWith("--font-weight-")).map((k) => k.slice(14))
    expect(families).toEqual(["heading", "body"])
    expect(weights).toEqual(["heading-weight", "body-weight"])
    for (const w of weights) expect(families).not.toContain(w)
    expect(css).toContain("font-heading-weight don't collide")
  })

  test("--spacing follows an 8px base, with a comment that it doubles the utilities", () => {
    const t = makeTokens()
    t.spacing = { base: 8, scale: { "0": "0rem", "1": "0.5rem", "4": "2rem" } }
    const out = toTailwindTheme(t)
    const d = decls(postcss.parse(out))
    expect(d.get("--spacing")).toBe("0.5rem")
    expect(d.get("--spacing-4")).toBe("2rem")
    expect(out).toContain("doubles every numeric sizing utility")
    expect(css).not.toContain("doubles every numeric sizing utility")
  })
})

describe("Design Tokens JSON", () => {
  const json = toDesignTokensJson(makeTokens())
  const parsed = JSON.parse(json)
  const all = leaves(parsed)

  test("parses, and every leaf has a $value and a known $type", () => {
    const types = new Set(["color", "fontFamily", "fontWeight", "number", "dimension", "shadow"])
    expect(all.size).toBeGreaterThan(50)
    for (const [path, leaf] of all) expect(types.has(leaf.$type ?? ""), path).toBe(true)
  })

  test("carries every token and states the format", () => {
    for (const [, , path, value] of expected()) {
      const leaf = all.get(path)
      expect(leaf, path).toBeDefined()
      expect(String(leaf!.$value), path).toBe(value)
    }
    expect(all.get("font.heading")).toEqual({ $value: "Space Grotesk", $type: "fontFamily" })
    expect(all.get("font.body")).toEqual({ $value: "Inter", $type: "fontFamily" })
    expect(all.get("color.primary.500")).toEqual({ $value: "#6d28d9", $type: "color" })
    expect(all.get("shadow.sm")).toEqual({
      $type: "shadow",
      $value: { color: "#0f172a0f", offsetX: "0px", offsetY: "1px", blur: "2px", spread: "0px" },
    })
    expect(Array.isArray(all.get("shadow.md")!.$value)).toBe(true)
    expect(all.get("shadow.lg")!.$type).toBe("shadow")
    expect(DTCG_EXTENSION).toBe("app.moodbase")
    expect(parsed.$extensions[DTCG_EXTENSION]).toMatchObject({
      format: "dtcg-draft",
      mode: "light",
      typeRatio: 1.25,
      baseSize: 16,
      spacingBase: 4,
    })
    expect(parsed.$extensions[DTCG_EXTENSION].skipped).toBeUndefined()
  })

  test("zero dimensions get a unit", () => {
    expect(all.get("spacing.0")!.$value).toBe("0rem")
    const t = makeTokens()
    t.spacing.scale["0"] = "0"
    expect(leaves(toDesignTokens(t)).get("spacing.0")!.$value).toBe("0px")
  })
})

describe("shadow and colour parsing", () => {
  test("cssColorToHex", () => {
    expect(cssColorToHex("#ABC")).toBe("#aabbcc")
    expect(cssColorToHex("rgb(255, 0, 0)")).toBe("#ff0000")
    expect(cssColorToHex("rgba(0,0,0,0.5)")).toBe("#00000080")
    expect(cssColorToHex("rgb(0 0 0 / 10%)")).toBe("#0000001a")
    expect(cssColorToHex("oklch(0 0 0 / 0.5)")).toBe("#00000080")
    expect(cssColorToHex("hsl(0 0% 0%)")).toBeNull()
    expect(cssColorToHex("red")).toBeNull()
  })

  test("parseShadow handles inset and rejects what it can't read", () => {
    expect(parseShadow("inset 0 0 0 1px #000")).toEqual({
      color: "#000000",
      offsetX: "0px",
      offsetY: "0px",
      blur: "0px",
      spread: "1px",
      inset: true,
    })
    expect(parseShadow("0 1px red")).toBeNull()
    expect(parseShadow("none")).toBeNull()
    expect(parseShadow("0 0.5em 1em #000")).toBeNull()
  })

  test("a shadow that can't be a DTCG shadow is left out of the JSON with a note, but kept in CSS", () => {
    const t = makeTokens()
    t.shadow = { md: "0 1px 2px hsl(0 0% 0% / 0.1)", lg: "0 0.5em 1em rgba(0,0,0,0.2)" }
    const json = toDesignTokens(t) as Json
    expect(json.shadow).toBeUndefined()
    expect(json.$extensions[DTCG_EXTENSION].skipped).toEqual([
      "shadow.md: could not be converted to a DTCG shadow (0 1px 2px hsl(0 0% 0% / 0.1))",
      "shadow.lg: could not be converted to a DTCG shadow (0 0.5em 1em rgba(0,0,0,0.2))",
    ])
    for (const [, leaf] of leaves(json)) expect(leaf.$type).toBeDefined()
    expect(decls(postcss.parse(toCssVariables(t))).get("--shadow-md")).toBe("0 1px 2px hsl(0 0% 0% / 0.1)")
  })

  test("em dimensions are skipped in JSON with a note; px and rem pass", () => {
    expect(dtcgDimension("1.5rem")).toBe("1.5rem")
    expect(dtcgDimension("12px")).toBe("12px")
    expect(dtcgDimension("0")).toBe("0px")
    expect(dtcgDimension("1em")).toBeNull()
    const t = makeTokens()
    t.radius.md = "0.5em"
    t.typography.scale.xl = "1.5em"
    const json = toDesignTokens(t) as Json
    const all = leaves(json)
    expect(all.has("radius.md")).toBe(false)
    expect(all.has("fontSize.xl")).toBe(false)
    for (const [, leaf] of all) if (leaf.$type === "dimension") expect(String(leaf.$value)).not.toMatch(/\dem$/)
    expect(json.$extensions[DTCG_EXTENSION].skipped).toEqual([
      "fontSize.xl: 1.5em is not a px or rem dimension",
      "radius.md: 0.5em is not a px or rem dimension",
    ])
    // CSS carries em as is.
    expect(decls(postcss.parse(toCssVariables(t))).get("--radius-md")).toBe("0.5em")
  })
})

describe("hostile values cannot break out", () => {
  const evil = [
    'Evil"; } body { color: red } /*',
    "</style><script>alert(1)</script>",
    "Back\\slash",
    "Line\nbreak",
    "Quote'single",
    "*/ :root { --x: 1 }",
    `${NUL}nul`,
    "Ünïcödé 字体",
  ]

  /** Decode a CSS string token (hex escapes and escaped chars). */
  function decodeCssString(token: string): string {
    expect(token.startsWith('"') && token.endsWith('"')).toBe(true)
    const body = token.slice(1, -1)
    return body.replace(/\\([0-9a-f]{1,6}) ?|\\(.)/gi, (_m, hex: string | undefined, ch: string | undefined) =>
      hex ? String.fromCodePoint(parseInt(hex, 16)) : (ch as string)
    )
  }

  test("cssString round-trips and leaves no raw quote, backslash pair, brace, semicolon or angle bracket", () => {
    for (const name of evil) {
      const s = cssString(name)
      const body = s.slice(1, -1)
      expect(body).not.toMatch(/["'{};<>\n*/]/)
      expect(decodeCssString(s)).toBe(name.split(NUL).join(REPLACEMENT))
    }
  })

  test.each(evil)("font %j stays one declaration in every CSS export", (name) => {
    const t = makeTokens({ fontHeading: name, fontBody: name })
    const safe = makeTokens()
    for (const build of [toCssVariables, toTailwindTheme]) {
      const root = postcss.parse(build(t))
      const d = decls(root)
      expect(d.size).toBe(decls(postcss.parse(build(safe))).size)
      expect(root.nodes.filter((n) => n.type === "rule" || n.type === "atrule").length).toBe(
        postcss.parse(build(safe)).nodes.filter((n) => n.type === "rule" || n.type === "atrule").length
      )
      // The name is cleaned as the backend stores it, then escaped.
      const clean = familyName(name)
      const value = d.get("--font-heading")!
      if (!clean) {
        expect(value).toBe("system-ui, sans-serif")
        continue
      }
      expect(value.endsWith(", system-ui, sans-serif")).toBe(true)
      const token = value.slice(0, -", system-ui, sans-serif".length)
      expect(decodeCssString(token)).toBe(clean)
      expect(clean).not.toMatch(/["'\\{};<>\n*/]/)
      expect(clean.includes(NUL)).toBe(false)
    }
    // JSON.stringify escapes for us; it must still parse and carry the cleaned name.
    const parsed = JSON.parse(toDesignTokensJson(t))
    expect(parsed.font.heading.$value).toBe(familyName(name))
  })

  test("familyName matches the backend's cleanFamily", () => {
    expect(familyName('Evil"; } body { color: red } /*')).toBe("Evil")
    expect(familyName("</style><script>alert(1)</script>")).toBe("")
    // cleanFamily drops characters outside its set (a newline included) before collapsing spaces.
    expect(familyName("Line\nbreak")).toBe("Linebreak")
    expect(familyName("  Open   Sans ")).toBe("Open Sans")
    expect(familyName("Ünïcödé 字体")).toBe("Ünïcödé 字体")
    expect(familyName('"Inter", sans-serif')).toBe("Inter")
  })

  test("invalid colours, lengths, shadows and spacing keys are dropped, not written", () => {
    const t = makeTokens()
    t.colors.background = "red; } body { x: y"
    t.typography.scale.base = "1rem; color: red"
    t.radius.md = "url(javascript:alert(1))"
    t.shadow = { sm: "0 0 1px red; } a {", md: "0 0 0 var(--x)", lg: "/* */ 0 1px red" }
    t.spacing.scale["4; x"] = "1rem"
    t.spacing.scale["0.5"] = "0.125rem"
    for (const out of [toCssVariables(t), toTailwindTheme(t)]) {
      const d = decls(postcss.parse(out))
      expect(d.has("--color-background")).toBe(false)
      expect(d.has("--text-base")).toBe(false)
      expect(d.has("--radius-md")).toBe(false)
      expect([...d.keys()].some((k) => k.startsWith("--shadow"))).toBe(false)
      expect([...d.keys()].some((k) => k.includes(";") || k.includes("0_5") || k.includes("0.5"))).toBe(false)
      expect(out).not.toContain("x: y")
      expect(out).not.toContain("color: red")
      expect(out).not.toContain("javascript")
    }
    const all = leaves(toDesignTokens(t))
    expect(all.has("color.background")).toBe(false)
    expect(all.has("fontSize.base")).toBe(false)
    expect(all.has("radius.md")).toBe(false)
    expect([...all.keys()].some((k) => k.startsWith("shadow"))).toBe(false)
    expect([...all.keys()].some((k) => k.startsWith("spacing.0.5") || k.includes(";"))).toBe(false)
  })
})
