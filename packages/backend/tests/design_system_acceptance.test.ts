/**
 * Phase 5 acceptance (spec 9): on three prepared sessions the generator
 * returns a coherent, readable system: the right mode, a primary in the
 * expected hue range, every contrast pair passing, a sensible type scale and
 * the sites' own fonts.
 */
import { describe, expect, test } from "vitest";
import { api } from "../convex/_generated/api";
import { checkContrast, contrastRatio } from "../convex/lib/design_system/contrast";
import { generateDesignSystem, sourceFromCapture } from "../convex/lib/design_system/generate";
import { hexToOklch, hueDistance } from "../convex/lib/design_system/oklch";
import { TYPE_RATIOS } from "../convex/lib/design_system/types";
import { validateTokens } from "../convex/lib/design_system/validate";
import {
  COLORFUL_SHOP,
  DARK_DASHBOARD,
  LIGHT_SAAS,
  designDna,
  palette,
  seedFixtureSession,
  type FixtureSession,
} from "./design_system_fixtures";
import { makeT, userA } from "./fixtures";

type Expectation = {
  fixture: FixtureSession;
  mode: "light" | "dark";
  /** OKLCH hue of primary-500 and how far it may stray. */
  primaryHue: [number, number];
  secondaryHue?: [number, number];
  fonts: [heading: string, body: string];
  ratio: (r: number) => boolean;
  spacingBase: 4 | 8;
  radiusMd: string;
};

const CASES: Expectation[] = [
  {
    fixture: LIGHT_SAAS,
    mode: "light",
    primaryHue: [278, 15], // #635bff, indigo/violet
    secondaryHue: [215, 20], // #00d4ff, cyan
    fonts: ["Plus Jakarta Sans", "Inter"],
    // Display headings up to 56px want a large ratio.
    ratio: (r) => r >= 1.25,
    spacingBase: 8,
    radiusMd: "0.5rem",
  },
  {
    fixture: DARK_DASHBOARD,
    mode: "dark",
    primaryHue: [163, 15], // #10b981, emerald
    fonts: ["Geist", "Geist"],
    // A dense app: 12–30px wants a small ratio.
    ratio: (r) => r <= 1.2,
    spacingBase: 4,
    radiusMd: "0.375rem",
  },
  {
    fixture: COLORFUL_SHOP,
    mode: "light",
    primaryHue: [16, 15], // #e11d48, rose — not the photos' yellow
    secondaryHue: [237, 20], // #0ea5e9, sky
    fonts: ["Playfair Display", "DM Sans"],
    ratio: (r) => r >= 1.25,
    spacingBase: 8,
    radiusMd: "0.75rem",
  },
];

function pureRun(fixture: FixtureSession) {
  return generateDesignSystem(
    fixture.captures.map(
      (c) => sourceFromCapture(c.kind === "element" ? { designDna: designDna(c.url, c.dna) } : { palette: palette(c.palette) })!
    )
  );
}

describe("design system acceptance: three prepared sessions", () => {
  test.each(CASES)("$fixture.name", async (e) => {
    const t = makeT();
    const sessionId = await seedFixtureSession(t, userA.subject, e.fixture);
    const asA = t.withIdentity(userA);
    expect(await asA.query(api.design_systems.eligibility, { sessionId })).toMatchObject({ eligible: true });
    expect((await asA.mutation(api.design_systems.generate, { sessionId })).ok).toBe(true);
    const row = (await asA.query(api.design_systems.getForSession, { sessionId }))!;
    const { tokens } = row;

    // Valid, and the same as the pure generator gives (deterministic).
    expect(validateTokens(tokens)).toEqual(tokens);
    const pure = pureRun(e.fixture);
    expect(pure.tokens).toEqual(tokens);
    expect(pureRun(e.fixture)).toEqual(pure);
    expect(row.description).toBe(pure.description);
    expect(row.notes).toEqual(pure.notes);
    expect(row.sourceCount).toBe(e.fixture.captures.length);
    expect(row.sourceDomains).toEqual([e.fixture.domain]);

    // Colours.
    expect(tokens.mode).toBe(e.mode);
    const bgL = hexToOklch(tokens.colors.background)!.l;
    expect(e.mode === "dark" ? bgL < 0.3 : bgL > 0.9).toBe(true);
    const primary = hexToOklch(tokens.colors.primary["500"])!;
    expect(primary.c).toBeGreaterThan(0.1);
    expect(hueDistance(primary.h, e.primaryHue[0])).toBeLessThan(e.primaryHue[1]);
    if (e.secondaryHue) {
      const secondary = hexToOklch(tokens.colors.secondary!["500"])!;
      expect(hueDistance(secondary.h, e.secondaryHue[0])).toBeLessThan(e.secondaryHue[1]);
    } else {
      expect(tokens.colors.secondary).toBeUndefined();
    }
    const distinct = new Set([tokens.colors.background, tokens.colors.surface, tokens.colors.border, tokens.colors.text, tokens.colors.textMuted]);
    expect(distinct.size).toBe(5);
    // Muted text sits between text and background.
    const mutedToBg = contrastRatio(tokens.colors.textMuted, tokens.colors.background);
    expect(mutedToBg).toBeLessThan(contrastRatio(tokens.colors.text, tokens.colors.background));

    // Every contrast pair passes.
    expect(row.contrast).toEqual(checkContrast(tokens));
    expect(row.contrast.filter((c) => !c.passes)).toEqual([]);

    // Typography, spacing, radius.
    expect([tokens.typography.fontHeading, tokens.typography.fontBody]).toEqual(e.fonts);
    expect(tokens.typography.baseSize).toBe(16);
    expect(TYPE_RATIOS).toContain(tokens.typography.ratio);
    expect(e.ratio(tokens.typography.ratio)).toBe(true);
    const steps = Object.values(tokens.typography.scale).map((r) => parseFloat(r) * 16);
    expect(Math.min(...steps)).toBeGreaterThanOrEqual(12);
    expect(Math.max(...steps)).toBeLessThanOrEqual(96);
    expect(tokens.typography.headingWeight).toBeGreaterThanOrEqual(600);
    expect(tokens.typography.bodyWeight).toBeLessThanOrEqual(500);
    expect(tokens.typography.bodyLineHeight).toBeGreaterThanOrEqual(1.3);
    expect(tokens.typography.bodyLineHeight).toBeLessThanOrEqual(1.7);
    expect(tokens.typography.headingLineHeight).toBeLessThan(tokens.typography.bodyLineHeight);
    expect(tokens.spacing.base).toBe(e.spacingBase);
    expect(tokens.radius.md).toBe(e.radiusMd);
    expect(Object.keys(tokens.shadow).length).toBeGreaterThan(0);
  });

  test("the dark dashboard's low-contrast muted text is corrected, and said so", () => {
    const { notes, tokens } = pureRun(DARK_DASHBOARD);
    expect(notes).toContain("Raised textMuted contrast from 4.0:1 to 4.5:1");
    expect(tokens.colors.textMuted).not.toBe("#6b7389");
    expect(hueDistance(hexToOklch(tokens.colors.textMuted)!.h, hexToOklch("#6b7389")!.h)).toBeLessThan(5);
  });

  test("descriptions", () => {
    expect(pureRun(LIGHT_SAAS).description).toBe(
      "Light theme · indigo primary with a cyan accent · Plus Jakarta Sans headings, Inter body · 8px grid · rounded corners (8px)"
    );
    expect(pureRun(DARK_DASHBOARD).description).toBe("Dark theme · green primary · Geist headings, Geist body · 4px grid · rounded corners (6px)");
    expect(pureRun(COLORFUL_SHOP).description).toBe(
      "Light theme · red primary with a blue accent · Playfair Display headings, DM Sans body · 8px grid · rounded corners (12px)"
    );
  });

  test("a palette-only session still gives a complete, valid, passing system with fallbacks noted", () => {
    const shots = [
      [["#f8fafc", 0.6], ["#0f172a", 0.2], ["#2563eb", 0.2]],
      [["#ffffff", 0.7], ["#334155", 0.3]],
      [["#f1f5f9", 0.5], ["#1e293b", 0.3], ["#f59e0b", 0.2]],
      [["#ffffff", 0.8], ["#2563eb", 0.2]],
      [["#e2e8f0", 0.5], ["#0f172a", 0.5]],
    ] as [string, number][][];
    const result = generateDesignSystem(shots.map((p) => sourceFromCapture({ palette: palette(p) })!));
    expect(validateTokens(result.tokens)).toEqual(result.tokens);
    expect(result.contrast.every((c) => c.passes)).toBe(true);
    expect(result.tokens.mode).toBe("light");
    expect(hueDistance(hexToOklch(result.tokens.colors.primary["500"])!.h, hexToOklch("#2563eb")!.h)).toBeLessThan(10);
    expect(result.tokens.typography.fontHeading).toBe("Inter");
    expect(result.notes).toEqual(
      expect.arrayContaining([
        "No named fonts captured; using Inter",
        "No spacing captured; using a 4px base",
        "No corner radii captured; using 8px",
        "No shadows captured; shadow tokens left empty",
      ])
    );
  });

  test("sourceFromCapture: DNA colours, else palette, else captureColors; null without any", () => {
    const dna = designDna("https://x.example", { colors: [["#ffffff", "background", 1]], fonts: [] });
    expect(sourceFromCapture({ designDna: dna, palette: palette([["#000000", 1]]) })!.colors).toEqual([
      { hex: "#ffffff", weight: 1, usage: "background" },
    ]);
    const empty = designDna("https://x.example", { colors: [], fonts: [] });
    expect(sourceFromCapture({ designDna: empty, palette: palette([["#000000", 1]]) })!.colors).toEqual([{ hex: "#000000", weight: 1 }]);
    expect(sourceFromCapture({ designDna: empty }, [{ hex: "#123456", weight: 1 }])!.colors).toEqual([{ hex: "#123456", weight: 1 }]);
    expect(sourceFromCapture({}, [])).toBeNull();
  });
});
