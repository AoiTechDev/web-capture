/**
 * Design system generator: type scale fitting, font picking, spacing,
 * radius, shadows, the shared scale builders and the template description.
 */
import { describe, expect, test } from "vitest";
import { buildTypeScale, clamp, radiusScale, rem, spacingScale, typeScale } from "../convex/lib/design_system/builders";
import { describeTokens, hueName } from "../convex/lib/design_system/describe";
import { deriveRadius, deriveShadows, deriveSpacing, shadowBlur } from "../convex/lib/design_system/metrics";
import { TYPE_RATIOS, type DesignSystemTokens } from "../convex/lib/design_system/types";
import { cleanFamily, deriveTypography, fitRatio, weightedMedian, type SourceFont } from "../convex/lib/design_system/typography";

const font = (family: string, size: number, weight = 1, fontWeight = 400, lineHeight: number | null = null, generic = false): SourceFont => ({
  family,
  generic,
  size,
  fontWeight,
  lineHeight,
  weight,
});

describe("fitRatio", () => {
  test.each([...TYPE_RATIOS])("sizes generated from %s recover it, exact or rounded to whole px", (ratio) => {
    const exponents = [-2, -1, 0, 1, 2, 3, 4, 5, 6];
    const exact = exponents.map((k) => ({ value: 16 * ratio ** k, weight: 1 }));
    expect(fitRatio(exact)).toEqual({ ratio, error: expect.closeTo(0, 9) });
    // Whole pixels, weighted like a page: lots of body text, a few headings.
    const rounded = exponents.map((k) => ({ value: Math.round(16 * ratio ** k), weight: k === 0 ? 5 : 1 }));
    expect(fitRatio(rounded)!.ratio).toBe(ratio);
  });

  test("a display size beyond 5xl counts against small ratios", () => {
    const sizes = [16, 24, 36, 54, 81].map((value) => ({ value, weight: 1 }));
    expect(fitRatio(sizes)!.ratio).toBe(1.5);
  });

  test("null without sizes", () => {
    expect(fitRatio([])).toBeNull();
    expect(fitRatio([{ value: 0, weight: 1 }])).toBeNull();
  });
});

describe("deriveTypography", () => {
  test("heading from ≥ 24px, body from 14–18px, generics skipped, each capture equal", () => {
    const { typography, notes } = deriveTypography([
      [font("Playfair Display", 40, 1, 700, 48), font("sans-serif", 16, 5, 400, null, true), font("Lato", 16, 2, 400, 24)],
      [font("Playfair Display", 32, 1, 800, 40), font("Lato", 14, 1, 400, 21)],
    ]);
    expect(typography.fontHeading).toBe("Playfair Display");
    expect(typography.fontBody).toBe("Lato");
    expect(typography.baseSize).toBe(16);
    expect(TYPE_RATIOS).toContain(typography.ratio);
    expect(typography.scale.base).toBe("1rem");
    // The second capture's heading is a larger share of it, so it carries more weight.
    expect(typography.headingLineHeight).toBe(1.25);
    expect(typography.headingWeight).toBe(800);
    expect(typography.bodyLineHeight).toBe(1.5);
    expect(typography.bodyWeight).toBe(400);
    // Only the scale's own notes (the xs floor, for ratios over 1.125).
    expect(notes).toEqual(buildTypeScale(16, typography.ratio).notes);
  });

  test("weights and line heights are weighted medians, line height unitless", () => {
    const { typography } = deriveTypography([
      [font("Inter", 16, 6, 400, 24), font("Inter", 16, 3, 500, 28), font("Inter", 16, 1, 600, 16), font("Inter", 32, 1, 700, 40)],
    ]);
    expect(typography.bodyWeight).toBe(400);
    expect(typography.bodyLineHeight).toBe(1.5);
    expect(typography.headingLineHeight).toBe(1.25);
  });

  test("family names are matched case-insensitively and cleaned", () => {
    const { typography } = deriveTypography([[font('"inter"', 16, 1), font("Inter", 18, 2), font("Inter", 30, 1)]]);
    expect(typography.fontBody).toBe("Inter");
    expect(typography.fontHeading).toBe("Inter");
  });

  test("no headings: the body font is used, with a note", () => {
    const { typography, notes } = deriveTypography([[font("Roboto", 16)]]);
    expect(typography.fontHeading).toBe("Roboto");
    expect(notes.join("\n")).toMatch(/headings use the body font/);
  });

  test("no named fonts (palette-only sessions): Inter, defaults and notes", () => {
    const { typography, notes } = deriveTypography([[], []]);
    expect(typography).toMatchObject({
      fontHeading: "Inter",
      fontBody: "Inter",
      ratio: 1.25,
      headingWeight: 700,
      bodyWeight: 400,
      headingLineHeight: 1.2,
      bodyLineHeight: 1.5,
    });
    expect(notes).toContain("No named fonts captured; using Inter");
  });

  test("cleanFamily keeps the first family and strips anything exportable", () => {
    expect(cleanFamily('"Plus Jakarta Sans", sans-serif')).toBe("Plus Jakarta Sans");
    expect(cleanFamily('Evil"; } body { color: red')).toBe("Evil");
    expect(cleanFamily("Inter</style><script>")).toBe("Inter");
    expect(cleanFamily("Font\\Name (Web)!")).toBe("FontName Web");
    expect(cleanFamily('";{}')).toBeNull();
    expect(cleanFamily("x".repeat(100))).toHaveLength(64);
  });

  test("weightedMedian", () => {
    expect(weightedMedian([{ value: 1, weight: 1 }, { value: 9, weight: 3 }])).toBe(9);
    expect(weightedMedian([{ value: 1, weight: 1 }, { value: 2, weight: 1 }, { value: 3, weight: 1 }])).toBe(2);
    expect(weightedMedian([])).toBeNull();
  });
});

describe("spacing, radius, shadows", () => {
  test("base 8 when most weight sits on multiples of 8, else 4", () => {
    expect(deriveSpacing([[{ value: 8, weight: 1 }, { value: 16, weight: 1 }, { value: 12, weight: 1 }]]).spacing.base).toBe(8);
    expect(deriveSpacing([[{ value: 4, weight: 2 }, { value: 12, weight: 1 }, { value: 16, weight: 1 }]]).spacing.base).toBe(4);
    const none = deriveSpacing([]);
    expect(none.spacing.base).toBe(4);
    expect(none.notes).toEqual(["No spacing captured; using a 4px base"]);
  });

  test("radius md is the weighted median; pills are ignored", () => {
    const { radius } = deriveRadius([[{ value: 6, weight: 1 }, { value: 12, weight: 3 }, { value: 9999, weight: 10 }]]);
    expect(radius).toEqual({ sm: "0.375rem", md: "0.75rem", lg: "1.5rem", full: "9999px" });
    expect(deriveRadius([]).notes).toEqual(["No corner radii captured; using 8px"]);
  });

  test("shadows: the heaviest three, small to large by blur; unsafe values skipped", () => {
    const sm = "rgba(0, 0, 0, 0.05) 0px 1px 2px 0px";
    const md = "rgba(0, 0, 0, 0.1) 0px 4px 6px -1px";
    const lg = "rgba(0, 0, 0, 0.1) 0px 10px 15px -3px, rgba(0, 0, 0, 0.1) 0px 4px 6px -4px";
    const { shadow, notes } = deriveShadows([
      [{ value: lg, weight: 3 }, { value: sm, weight: 2 }, { value: md, weight: 4 }, { value: "0 0 1px red", weight: 0.1 }],
      [{ value: "0 0 4px url(x)", weight: 9 }],
    ]);
    expect(shadow).toEqual({ sm, md, lg });
    expect(notes).toEqual(["Skipped 1 shadow value with unsupported syntax"]);
    expect(deriveShadows([[{ value: md, weight: 1 }]]).shadow).toEqual({ md });
    expect(deriveShadows([]).shadow).toEqual({});
  });

  test("shadowBlur reads the largest blur across layers", () => {
    expect(shadowBlur("rgba(0, 0, 0, 0.1) 0px 1px 3px 0px")).toBe(3);
    expect(shadowBlur("0 10px 15px -3px #0000001a, 0 4px 6px -4px rgb(0 0 0 / 0.1)")).toBe(15);
    expect(shadowBlur("inset 0 1px rgba(255,255,255,0.1)")).toBe(0);
    expect(shadowBlur("0 2px 8px color-mix(in srgb, rgb(0 0 0) 20%, transparent)")).toBe(8);
  });
});

describe("builders", () => {
  test("rem formats to four decimals, so whole px round-trip exactly", () => {
    expect(rem(0)).toBe("0rem");
    expect(rem(1.25)).toBe("1.25rem");
    expect(rem(1 / 3)).toBe("0.3333rem");
    for (let px = 0; px <= 320; px++) expect(parseFloat(rem(px / 16)) * 16).toBe(px);
    expect(clamp(5, 0, 3)).toBe(3);
    expect(clamp(-1, 0, 3)).toBe(0);
  });

  const px = (scale: Record<string, string>) => Object.values(scale).map((r) => Math.round(parseFloat(r) * 16 * 100) / 100);

  test("type scale: below base shrinks by at most 1.2 and stops at 12px", () => {
    const { scale, notes } = buildTypeScale(16, 1.5);
    expect(scale.sm).toBe("0.8333rem"); // 16 / 1.2, not 16 / 1.5
    expect(scale.xs).toBe("0.75rem"); // 11.1px floored to 12
    expect(notes[0]).toBe("Small type steps floored at 12px");
    expect(buildTypeScale(16, 1.125)).toEqual({ scale: expect.objectContaining({ xs: "0.7901rem", sm: "0.8889rem" }), notes: [] });
  });

  test("type scale: 5xl is capped at 6rem, steps above base spread geometrically", () => {
    const { scale, notes } = buildTypeScale(16, 1.5);
    expect(scale["5xl"]).toBe("6rem");
    const sizes = px(scale);
    const up = (96 / 16) ** (1 / 6);
    for (let k = 0; k <= 6; k++) expect(sizes[2 + k]).toBeCloseTo(16 * up ** k, 1);
    expect(notes[1]).toBe("5xl capped at 96px (6rem); steps above base spread by 1.348 instead of 1.5");
    // 1.333 stays under the cap (89.8px) and keeps its own ratio.
    expect(buildTypeScale(16, 1.333)).toEqual({ scale: expect.objectContaining({ "5xl": "5.6102rem" }), notes: ["Small type steps floored at 12px"] });
  });

  test.each([...TYPE_RATIOS])("type scale %s never shrinks step to step and stays within 12–96px", (ratio) => {
    for (const base of [12, 14, 16, 18, 24]) {
      const sizes = px(buildTypeScale(base, ratio).scale);
      for (let i = 1; i < sizes.length; i++) expect(sizes[i]!).toBeGreaterThanOrEqual(sizes[i - 1]!);
      expect(sizes[2]).toBe(base);
      expect(Math.min(...sizes)).toBeGreaterThanOrEqual(12);
      expect(Math.max(...sizes)).toBeLessThanOrEqual(96);
    }
  });

  test("typeScale, spacingScale and radiusScale", () => {
    expect(typeScale(16, 1.25)).toEqual({
      xs: "0.75rem", sm: "0.8333rem", base: "1rem", lg: "1.25rem", xl: "1.5625rem",
      "2xl": "1.9531rem", "3xl": "2.4414rem", "4xl": "3.0518rem", "5xl": "3.8147rem",
    });
    expect(spacingScale(4)).toEqual({
      "0": "0rem", "1": "0.25rem", "2": "0.5rem", "3": "0.75rem", "4": "1rem",
      "6": "1.5rem", "8": "2rem", "12": "3rem", "16": "4rem", "24": "6rem",
    });
    expect(spacingScale(8)["24"]).toBe("12rem");
    expect(radiusScale(0)).toEqual({ sm: "0rem", md: "0rem", lg: "0rem", full: "9999px" });
  });
});

describe("describeTokens", () => {
  test("hue names", () => {
    expect(hueName("#7c3aed")).toBe("violet");
    expect(hueName("#14b8a6")).toBe("teal");
    expect(hueName("#2563eb")).toBe("blue");
    expect(hueName("#e11d48")).toBe("red");
    expect(hueName("#f97316")).toBe("orange");
    expect(hueName("#22c55e")).toBe("green");
    expect(hueName("#ec4899")).toBe("pink");
    expect(hueName("#6b7280")).toBe("neutral");
  });

  test("the template", () => {
    const tokens = {
      mode: "dark",
      colors: { primary: { "500": "#7c3aed" }, secondary: { "500": "#14b8a6" } },
      typography: { fontHeading: "Inter", fontBody: "Inter" },
      spacing: { base: 8 },
      radius: { md: "0.5rem" },
    } as unknown as DesignSystemTokens;
    expect(describeTokens(tokens)).toBe(
      "Dark theme · violet primary with a teal accent · Inter headings, Inter body · 8px grid · rounded corners (8px)"
    );
    const flat = { ...tokens, mode: "light", colors: { primary: { "500": "#2563eb" } }, radius: { md: "0rem" } } as unknown as DesignSystemTokens;
    expect(describeTokens(flat)).toBe("Light theme · blue primary · Inter headings, Inter body · 8px grid · square corners");
  });
});
