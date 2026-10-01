/**
 * Design system generator: WCAG contrast checks and corrections, and strict
 * token validation (the save path, and what keeps exports injection-free).
 */
import { describe, expect, test } from "vitest";
import { radiusScale, spacingScale, typeScale } from "../convex/lib/design_system/builders";
import { rgbToHex, seededRandom } from "../convex/lib/color";
import { adjustLightness, checkContrast, contrastRatio, fixContrast } from "../convex/lib/design_system/contrast";
import { hexToOklch, hueDistance } from "../convex/lib/design_system/oklch";
import { buildScale } from "../convex/lib/design_system/scale";
import type { DesignSystemTokens } from "../convex/lib/design_system/types";
import { validateTokens } from "../convex/lib/design_system/validate";

function sampleTokens(colors: Partial<Record<"background" | "surface" | "border" | "text" | "textMuted" | "primary", string>> = {}): DesignSystemTokens {
  return {
    version: 1,
    mode: "light",
    colors: {
      background: colors.background ?? "#ffffff",
      surface: colors.surface ?? "#f1f5f9",
      border: colors.border ?? "#e2e8f0",
      text: colors.text ?? "#0f172a",
      textMuted: colors.textMuted ?? "#64748b",
      primary: buildScale(colors.primary ?? "#6d28d9"),
    },
    typography: {
      fontHeading: "Inter",
      fontBody: "Inter",
      ratio: 1.25,
      baseSize: 16,
      scale: typeScale(16, 1.25),
      headingWeight: 700,
      bodyWeight: 400,
      headingLineHeight: 1.2,
      bodyLineHeight: 1.5,
    },
    spacing: { base: 4, scale: spacingScale(4) },
    radius: radiusScale(8),
    shadow: { sm: "rgba(0, 0, 0, 0.05) 0px 1px 2px 0px" },
  };
}

const lightnessOnly = (before: string, after: string) => {
  const a = hexToOklch(before)!;
  const b = hexToOklch(after)!;
  expect(b.l).not.toBeCloseTo(a.l, 3);
  // 8-bit rounding moves hue a little on low-chroma colours; hue is otherwise held.
  if (a.c > 0.02) expect(hueDistance(a.h, b.h)).toBeLessThan(a.c > 0.08 ? 2 : 6);
};

describe("contrastRatio / checkContrast", () => {
  test("WCAG reference ratios", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 6);
    expect(contrastRatio("#ffffff", "#000000")).toBeCloseTo(21, 6);
    expect(contrastRatio("#777777", "#777777")).toBe(1);
    expect(contrastRatio("#767676", "#ffffff")).toBeCloseTo(4.54, 2);
    expect(contrastRatio("nope", "#ffffff")).toBe(1);
  });

  test("the four pairs, ratios floored so the display never rounds up to a pass", () => {
    const checks = checkContrast(sampleTokens({ textMuted: "#777777" }));
    expect(checks.map((c) => [c.pair, c.required])).toEqual([
      ["text/background", 4.5],
      ["textMuted/background", 4.5],
      ["text/surface", 4.5],
      ["primary/background", 3],
    ]);
    const muted = checks[1]!;
    expect(muted).toMatchObject({ foreground: "#777777", background: "#ffffff", passes: false });
    expect(muted.ratio).toBe(4.47);
    for (const c of checks) expect(c.passes).toBe(contrastRatio(c.foreground, c.background) >= c.required);
  });
});

describe("fixContrast", () => {
  test("passing tokens are returned unchanged, with no notes", () => {
    const tokens = sampleTokens();
    expect(fixContrast(tokens)).toEqual({ tokens, notes: [] });
  });

  test("raises textMuted just to 4.5:1 by lightness, keeping hue", () => {
    const tokens = sampleTokens({ textMuted: "#94a3b8" });
    const { tokens: fixed, notes } = fixContrast(tokens);
    expect(checkContrast(fixed).every((c) => c.passes)).toBe(true);
    const ratio = contrastRatio(fixed.colors.textMuted, "#ffffff");
    expect(ratio).toBeGreaterThanOrEqual(4.5);
    expect(ratio).toBeLessThan(4.7);
    lightnessOnly("#94a3b8", fixed.colors.textMuted);
    expect(notes).toEqual(["Raised textMuted contrast from 2.5:1 to 4.5:1"]);
    // The input is untouched.
    expect(tokens.colors.textMuted).toBe("#94a3b8");
  });

  test("fixes text against background and surface; dark themes go lighter", () => {
    const tokens = { ...sampleTokens({ background: "#0b0f19", surface: "#1e293b", text: "#475569", textMuted: "#334155", primary: "#4338ca" }), mode: "dark" as const };
    const { tokens: fixed, notes } = fixContrast(tokens);
    expect(checkContrast(fixed).every((c) => c.passes)).toBe(true);
    expect(hexToOklch(fixed.colors.text)!.l).toBeGreaterThan(hexToOklch("#475569")!.l);
    lightnessOnly("#475569", fixed.colors.text);
    lightnessOnly("#334155", fixed.colors.textMuted);
    expect(fixed.colors.background).toBe("#0b0f19");
    expect(notes.some((n) => n.startsWith("Raised text contrast"))).toBe(true);
    expect(notes.some((n) => n.startsWith("Moved primary-500 lightness"))).toBe(true);
  });

  test("a failing primary is moved and its scale rebuilt around the same hue", () => {
    const { tokens: fixed } = fixContrast(sampleTokens({ primary: "#facc15" }));
    expect(contrastRatio(fixed.colors.primary["500"], "#ffffff")).toBeGreaterThanOrEqual(3);
    lightnessOnly("#facc15", fixed.colors.primary["500"]);
    expect(fixed.colors.primary).toEqual(buildScale(fixed.colors.primary["500"]));
  });

  test("random colours always end up passing, background untouched", () => {
    const rand = seededRandom(11);
    const hex = () => rgbToHex([rand() * 255, rand() * 255, rand() * 255]);
    for (let i = 0; i < 200; i++) {
      const background = hex();
      const tokens = sampleTokens({ background, surface: hex(), text: hex(), textMuted: hex(), primary: hex() });
      const { tokens: fixed } = fixContrast(tokens);
      expect(checkContrast(fixed).filter((c) => !c.passes)).toEqual([]);
      expect(fixed.colors.background).toBe(background);
    }
  });

  test("a surface on the far side of the text is moved, not the background", () => {
    const { tokens: fixed, notes } = fixContrast(sampleTokens({ background: "#ffffff", surface: "#111111", text: "#222222" }));
    expect(checkContrast(fixed).every((c) => c.passes)).toBe(true);
    expect(fixed.colors.background).toBe("#ffffff");
    expect(notes.some((n) => n.startsWith("Moved surface lightness"))).toBe(true);
  });

  test("adjustLightness prefers the colour's own side and returns null when nothing works", () => {
    expect(adjustLightness("#ffffff", "#ffffff", 4.5)).toMatch(/^#[0-9a-f]{6}$/);
    expect(hexToOklch(adjustLightness("#dddddd", "#000000", 18)!)!.l).toBeGreaterThan(hexToOklch("#dddddd")!.l);
    expect(adjustLightness("#777777", "#777777", 21)).toBeNull();
  });
});

describe("validateTokens", () => {
  test("accepts generated tokens and returns a clean copy (hex lowercased)", () => {
    const tokens = sampleTokens();
    expect(validateTokens(tokens)).toEqual(tokens);
    const upper = structuredClone(tokens);
    upper.colors.text = "#0F172A";
    expect(validateTokens(upper).colors.text).toBe("#0f172a");
    const withSecondary = { ...tokens, colors: { ...tokens.colors, secondary: buildScale("#14b8a6") } };
    expect(validateTokens(withSecondary).colors.secondary).toEqual(buildScale("#14b8a6"));
    expect(validateTokens({ ...tokens, shadow: {} }).shadow).toEqual({});
  });

  const mutate = (fn: (t: any) => void) => {
    const t: any = structuredClone(sampleTokens());
    fn(t);
    return t;
  };

  test.each<[string, (t: any) => void]>([
    ["unknown top-level key", (t) => (t.extra = 1)],
    ["unknown nested key", (t) => (t.colors.accent = "#ffffff")],
    ["missing key", (t) => delete t.colors.surface],
    ["__proto__ key", (t) => Object.defineProperty(t.colors, "__proto__", { value: {}, enumerable: true })],
    ["short hex", (t) => (t.colors.text = "#fff")],
    ["named colour", (t) => (t.colors.text = "red")],
    ["hex breaking out of a declaration", (t) => (t.colors.background = "#ffffff;}body{")],
    ["bad scale step", (t) => (t.colors.primary["500"] = "rgb(0,0,0)")],
    ["extra scale step", (t) => (t.colors.primary["1000"] = "#000000")],
    ["px instead of rem", (t) => (t.typography.scale.base = "16px")],
    ["rem with injection", (t) => (t.spacing.scale["4"] = "1rem;color:red")],
    ["huge rem", (t) => (t.radius.md = "500rem")],
    ["radius full", (t) => (t.radius.full = "50%")],
    ["ratio out of range", (t) => (t.typography.ratio = 3)],
    ["NaN base size", (t) => (t.typography.baseSize = NaN)],
    ["fractional weight", (t) => (t.typography.bodyWeight = 450.5)],
    ["string weight", (t) => (t.typography.bodyWeight = "400")],
    ["spacing base 6", (t) => (t.spacing.base = 6)],
    ["mode", (t) => (t.mode = "sepia")],
    ["version", (t) => (t.version = 2)],
    ["font with quote", (t) => (t.typography.fontBody = 'Inter", serif; } body { x')],
    ["font with semicolon", (t) => (t.typography.fontHeading = "Inter;")],
    ["font with braces", (t) => (t.typography.fontHeading = "Inter}")],
    ["font closing a style tag", (t) => (t.typography.fontHeading = "</style><script>alert(1)</script>")],
    ["font with newline", (t) => (t.typography.fontHeading = "Inter\n}")],
    ["font with a stack", (t) => (t.typography.fontHeading = "Inter, sans-serif")],
    ["font too long", (t) => (t.typography.fontHeading = "A".repeat(65))],
    ["empty font", (t) => (t.typography.fontHeading = "")],
    ["shadow with semicolon", (t) => (t.shadow.sm = "0 1px 2px #000; color: red")],
    ["shadow with brace", (t) => (t.shadow.md = "0 1px 2px #000 } body {")],
    ["shadow with url()", (t) => (t.shadow.md = "0 1px 2px url(https://evil.example/x)")],
    ["shadow with a comment", (t) => (t.shadow.md = "0 1px 2px #000 /* x */")],
    ["shadow with quotes", (t) => (t.shadow.md = '0 1px 2px "x"')],
    ["shadow too long", (t) => (t.shadow.lg = "0 1px 2px #000, ".repeat(40) + "0 0 0 #000")],
    ["shadow not a string", (t) => (t.shadow.sm = 5)],
    ["unknown shadow key", (t) => (t.shadow.xl = "0 1px 2px #000")],
  ])("rejects %s", (_name, fn) => {
    expect(() => validateTokens(mutate(fn))).toThrow(/^Invalid design system tokens: /);
  });

  test("rejects non-objects", () => {
    for (const bad of [null, undefined, "tokens", 5, [], JSON.parse('{"__proto__": {"polluted": true}}')]) {
      expect(() => validateTokens(bad)).toThrow(/Invalid design system tokens/);
    }
    expect(({} as any).polluted).toBeUndefined();
  });
});
