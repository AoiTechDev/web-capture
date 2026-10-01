/**
 * Design system generator, colours: hex ↔ LAB ↔ OKLCH, OKLCH scales, the
 * weighted k-means over a session's colours and role assignment.
 */
import { describe, expect, test } from "vitest";
import { hexToLab, labToHex, rgbToHex, seededRandom } from "../convex/lib/color";
import {
  assignRoles,
  clusterColors,
  collectColors,
  type SourceColor,
} from "../convex/lib/design_system/colors";
import { clampToGamut, hexToOklch, hueDistance, inSrgbGamut, oklchToHex } from "../convex/lib/design_system/oklch";
import { buildScale } from "../convex/lib/design_system/scale";
import { SHADE_STEPS } from "../convex/lib/design_system/types";

function randomHexes(n: number, seed = 42): string[] {
  const rand = seededRandom(seed);
  return Array.from({ length: n }, () => rgbToHex([rand() * 255, rand() * 255, rand() * 255]));
}

const roles = (captures: SourceColor[][]) => assignRoles(clusterColors(collectColors(captures)));

describe("hex ↔ LAB ↔ OKLCH", () => {
  test("OKLCH of reference colours matches CSS Color 4", () => {
    const white = hexToOklch("#ffffff")!;
    expect(white.l).toBeCloseTo(1, 3);
    expect(white.c).toBeLessThan(1e-4);
    expect(hexToOklch("#000000")!.l).toBeCloseTo(0, 6);
    const red = hexToOklch("#ff0000")!;
    expect(red.l).toBeCloseTo(0.628, 3);
    expect(red.c).toBeCloseTo(0.2577, 3);
    expect(red.h).toBeCloseTo(29.23, 1);
    const blue = hexToOklch("#0000ff")!;
    expect(blue.h).toBeCloseTo(264.05, 1);
    expect(hexToOklch("nope")).toBeNull();
  });

  test("hex → OKLCH → hex and hex → LAB → hex round-trip exactly", () => {
    for (const hex of [...randomHexes(500), "#000000", "#ffffff", "#ff0000", "#00ff00", "#0000ff"]) {
      expect(oklchToHex(hexToOklch(hex)!)).toBe(hex);
      expect(labToHex(hexToLab(hex)!)).toBe(hex);
    }
  });

  test("hex → LAB → hex → OKLCH → hex chains without drift", () => {
    for (const hex of randomHexes(200, 7)) {
      const viaLab = labToHex(hexToLab(hex)!);
      expect(oklchToHex(hexToOklch(viaLab)!)).toBe(hex);
    }
  });

  test("out-of-gamut colours are clamped by chroma only", () => {
    const wild = { l: 0.7, c: 0.4, h: 150 };
    expect(inSrgbGamut(wild)).toBe(false);
    const clamped = clampToGamut(wild);
    expect(inSrgbGamut(clamped)).toBe(true);
    expect(clamped.l).toBe(0.7);
    expect(clamped.h).toBe(150);
    expect(clamped.c).toBeLessThan(0.4);
    expect(clamped.c).toBeGreaterThan(0.1);
    expect(oklchToHex(wild)).toMatch(/^#[0-9a-f]{6}$/);
  });

  test("hueDistance wraps around 360°", () => {
    expect(hueDistance(350, 10)).toBe(20);
    expect(hueDistance(10, 350)).toBe(20);
    expect(hueDistance(0, 180)).toBe(180);
  });
});

describe("buildScale", () => {
  test.each(["#635bff", "#10b981", "#e11d48", "#facc15", "#0a2540", "#f1f5f9", "#808080"])(
    "%s: 500 is the input, lightness falls 50→950, hue holds",
    (hex) => {
      const scale = buildScale(hex);
      expect(scale["500"]).toBe(hex);
      expect(Object.keys(scale)).toEqual([...SHADE_STEPS]);
      const steps = SHADE_STEPS.map((s) => hexToOklch(scale[s])!);
      for (let i = 1; i < steps.length; i++) expect(steps[i]!.l).toBeLessThan(steps[i - 1]!.l);
      const base = hexToOklch(hex)!;
      if (base.c > 0.05) {
        for (const s of steps) if (s.c > 0.03) expect(hueDistance(s.h, base.h)).toBeLessThan(6);
        // Chroma eases off at the ends.
        expect(steps[0]!.c).toBeLessThan(base.c);
        expect(steps[10]!.c).toBeLessThan(base.c);
      }
    }
  );

  test("uppercase input is lowercased; garbage throws", () => {
    expect(buildScale("#635BFF")["500"]).toBe("#635bff");
    expect(() => buildScale("red")).toThrow();
  });
});

describe("collectColors / clusterColors", () => {
  test("every capture counts the same, whatever its raw weights", () => {
    const pts = collectColors([[{ hex: "#ff0000", weight: 10 }], [{ hex: "#0000ff", weight: 1 }]]);
    expect(pts.map((p) => [p.hex, p.weight])).toEqual([
      ["#0000ff", 0.5],
      ["#ff0000", 0.5],
    ]);
  });

  test("drops malformed and weightless colours, and captures left empty", () => {
    const pts = collectColors([[{ hex: "bogus", weight: 1 }, { hex: "#00ff00", weight: 0 }], [{ hex: "#123456", weight: 2 }]]);
    expect(pts).toEqual([{ hex: "#123456", lab: hexToLab("#123456"), weight: 1 }]);
  });

  test("k-means is deterministic and independent of capture order", () => {
    const captures: SourceColor[][] = randomHexes(60, 3).map((hex, i) => [
      { hex, weight: 1 + (i % 4), usage: "background" },
      { hex: randomHexes(1, i + 100)[0]!, weight: 1, usage: "text" },
    ]);
    const a = clusterColors(collectColors(captures));
    const b = clusterColors(collectColors(captures));
    const c = clusterColors(collectColors([...captures].reverse()));
    expect(a).toEqual(b);
    expect(c).toEqual(a);
    expect(a.length).toBeLessThanOrEqual(10);
  });

  test("weights follow the input and clusters under 2% are dropped", () => {
    const reds = ["#e11d48", "#e3204a", "#df1b46"].map((hex) => ({ hex, weight: 70 / 3 }));
    const blues = ["#2563eb", "#2665ed"].map((hex) => ({ hex, weight: 29 / 2 }));
    const clusters = clusterColors(collectColors([[...reds, ...blues, { hex: "#00ff00", weight: 1 }]]), 3);
    expect(clusters).toHaveLength(2);
    expect(clusters[0]!.weight).toBeCloseTo(0.7, 5);
    expect(clusters[1]!.weight).toBeCloseTo(0.29, 5);
    // Representatives are real member colours.
    expect(["#e11d48", "#e3204a", "#df1b46"]).toContain(clusters[0]!.hex);
  });

  test("usage is tallied per cluster, with the heaviest member per usage", () => {
    const [c] = clusterColors(
      collectColors([[
        { hex: "#e5e7eb", weight: 3, usage: "border" },
        { hex: "#e4e6ea", weight: 5, usage: "background" },
      ]]),
      1
    );
    expect(c!.usage.background).toBeCloseTo(5 / 8);
    expect(c!.usage.border).toBeCloseTo(3 / 8);
    expect(c!.roleHex).toEqual({ background: "#e4e6ea", border: "#e5e7eb" });
  });
});

describe("assignRoles", () => {
  const lightSite: SourceColor[] = [
    { hex: "#ffffff", usage: "background", weight: 50 },
    { hex: "#f1f5f9", usage: "background", weight: 15 },
    { hex: "#0f172a", usage: "text", weight: 12 },
    { hex: "#64748b", usage: "text", weight: 8 },
    { hex: "#7c3aed", usage: "background", weight: 6 },
    { hex: "#14b8a6", usage: "background", weight: 4 },
    { hex: "#cbd5e1", usage: "border", weight: 5 },
  ];

  test("a light site gets every role from its own colours", () => {
    const r = roles([lightSite]);
    expect(r.mode).toBe("light");
    expect(r.colors).toMatchObject({
      background: "#ffffff",
      surface: "#f1f5f9",
      text: "#0f172a",
      textMuted: "#64748b",
      border: "#cbd5e1",
    });
    expect(r.colors.primary["500"]).toBe("#7c3aed");
    expect(r.colors.secondary?.["500"]).toBe("#14b8a6");
    expect(r.notes).toEqual([]);
  });

  test("a dark background (L < 30) makes a dark theme; the darkest strong background wins", () => {
    const r = roles([[
      { hex: "#18181b", usage: "background", weight: 40 },
      { hex: "#09090b", usage: "background", weight: 30 },
      { hex: "#fafafa", usage: "text", weight: 15 },
      { hex: "#a1a1aa", usage: "text", weight: 8 },
      { hex: "#f97316", usage: "background", weight: 7 },
    ]]);
    expect(r.mode).toBe("dark");
    expect(r.colors.background).toBe("#09090b");
    expect(r.colors.surface).toBe("#18181b");
    expect(r.colors.text).toBe("#fafafa");
    expect(r.colors.primary["500"]).toBe("#f97316");
  });

  test("no second hue more than 30° away: no secondary, with a note", () => {
    const r = roles([lightSite.filter((c) => c.hex !== "#14b8a6").concat({ hex: "#6d28d9", usage: "text", weight: 4 })]);
    expect(r.colors.secondary).toBeUndefined();
    expect(r.notes).toContain("No secondary colour: no second saturated hue more than 30° from primary");
  });

  test("a CSS colour beats a more saturated photo colour for primary", () => {
    const r = roles([lightSite.filter((c) => c.hex !== "#14b8a6"), [{ hex: "#facc15", weight: 0.3 }, { hex: "#f5f5f4", weight: 0.7 }]]);
    expect(r.colors.primary["500"]).toBe("#7c3aed");
  });

  test("palette-only greys: roles are derived, and the notes say so", () => {
    const r = roles([[{ hex: "#fafafa", weight: 0.7 }, { hex: "#222222", weight: 0.3 }]]);
    expect(r.mode).toBe("light");
    expect(r.colors.background).toBe("#fafafa");
    expect(r.colors.text).toBe("#222222");
    expect(r.notes.join("\n")).toMatch(/derived one from the background/);
    expect(r.notes.join("\n")).toMatch(/primary is a neutral/);
    for (const hex of [r.colors.surface, r.colors.border, r.colors.textMuted, r.colors.primary["500"]]) {
      expect(hex).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  test("no colours at all still gives a complete, light palette", () => {
    const r = roles([]);
    expect(r.mode).toBe("light");
    expect(r.colors.background).toBe("#ffffff");
    expect(r.notes.length).toBeGreaterThan(3);
  });
});
