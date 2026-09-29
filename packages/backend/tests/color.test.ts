import { describe, expect, test } from "vitest";
import {
  deltaE2000,
  deltaE76,
  hexToLab,
  kmeansLab,
  labToHex,
  labToRgb,
  MAX_CAPTURE_COLORS,
  mergeSimilarColors,
  normalizeCaptureColors,
  paletteFromPixels,
  parseCssColor,
  parseHex,
  rgbToHex,
  rgbToLab,
  type Lab,
  type RGB,
  type WeightedLab,
} from "../convex/lib/color";

const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);

describe("parseHex / parseCssColor", () => {
  test.each([
    ["#abc", { r: 170, g: 187, b: 204, a: 1 }],
    ["#ABC", { r: 170, g: 187, b: 204, a: 1 }],
    ["#aabbcc", { r: 170, g: 187, b: 204, a: 1 }],
    ["#aabbccff", { r: 170, g: 187, b: 204, a: 1 }],
  ])("hex %s", (input, expected) => {
    expect(parseHex(input)).toEqual(expected);
    expect(parseCssColor(input)).toEqual(expected);
  });

  test("hex with alpha: #abcd and 8-digit", () => {
    expect(parseHex("#abcd")!.a).toBeCloseTo(0xdd / 255, 6);
    expect(parseHex("#11223380")).toMatchObject({ r: 0x11, g: 0x22, b: 0x33 });
    expect(parseHex("#11223380")!.a).toBeCloseTo(128 / 255, 6);
  });

  test.each(["#ab", "#abcde", "#gggggg", "abc", "#aabbccd"])("invalid hex %s -> null", (s) => {
    expect(parseHex(s)).toBeNull();
    expect(parseCssColor(s)).toBeNull();
  });

  test.each([
    ["rgb(1, 2, 3)", { r: 1, g: 2, b: 3, a: 1 }],
    ["rgba(1, 2, 3, 0.5)", { r: 1, g: 2, b: 3, a: 0.5 }],
    ["rgb(1 2 3)", { r: 1, g: 2, b: 3, a: 1 }],
    ["rgb(1 2 3 / 0.5)", { r: 1, g: 2, b: 3, a: 0.5 }],
    ["rgb(1 2 3 / 50%)", { r: 1, g: 2, b: 3, a: 0.5 }],
    ["rgba(255,255,255,1)", { r: 255, g: 255, b: 255, a: 1 }],
    ["RGB(10, 20, 30)", { r: 10, g: 20, b: 30, a: 1 }],
    ["rgb(100% 0% 0%)", { r: 255, g: 0, b: 0, a: 1 }],
    ["color(srgb 1 0 0)", { r: 255, g: 0, b: 0, a: 1 }],
    ["color(srgb 0.5 0.5 0.5 / 0.5)", { r: 128, g: 128, b: 128, a: 0.5 }],
    ["color(srgb 100% 0% 50%)", { r: 255, g: 0, b: 128, a: 1 }],
  ])("%s", (input, expected) => {
    expect(parseCssColor(input)).toEqual(expected);
  });

  test("oklab / oklch", () => {
    expect(parseCssColor("oklab(1 0 0)")).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseCssColor("oklab(0 0 0)")).toEqual({ r: 0, g: 0, b: 0, a: 1 });
    expect(parseCssColor("oklch(0.5 0 none)")).toMatchObject({ a: 1 });
    // CSS Color 4 reference: sRGB red is oklch(0.628 0.2577 29.23).
    const red = parseCssColor("oklch(0.62796 0.25768 29.2339)")!;
    expect(Math.abs(red.r - 255)).toBeLessThanOrEqual(1);
    expect(red.g).toBeLessThanOrEqual(1);
    expect(red.b).toBeLessThanOrEqual(1);
    const withAlpha = parseCssColor("oklch(62.8% 0.2577 29.23deg / 0.5)")!;
    expect(withAlpha.a).toBe(0.5);
    expect(withAlpha.r).toBeGreaterThan(250);
    // oklab red: (0.62796, 0.22486, 0.12585)
    const okRed = parseCssColor("oklab(0.62796 0.22486 0.12585)")!;
    expect(Math.abs(okRed.r - 255) + okRed.g + okRed.b).toBeLessThanOrEqual(3);
  });

  test.each([
    "transparent",
    "none",
    "",
    "rgba(0, 0, 0, 0)",
    "rgba(0, 0, 0, 0.05)",
    "rgb(0 0 0 / 0.09)",
    "#00000019", // 25/255 < 0.1
    "color(srgb 1 1 1 / 0)",
    "lab(50 0 0)",
    "red",
    "rgb(1, 2)",
    "hsl(0 100% 50%)",
  ])("%s -> null", (s) => {
    expect(parseCssColor(s)).toBeNull();
  });

  test("alpha at or just above the 0.1 floor is kept", () => {
    expect(parseCssColor("rgba(0, 0, 0, 0.1)")).toEqual({ r: 0, g: 0, b: 0, a: 0.1 });
    expect(parseCssColor("#0000001a")).not.toBeNull(); // 26/255
    expect(parseCssColor("rgba(0,0,0,0.05)", 0.01)).not.toBeNull();
  });
});

describe("sRGB <-> LAB (D65)", () => {
  const close = (lab: Lab, want: Lab, tol = 0.05) =>
    lab.forEach((v, i) => expect(Math.abs(v - want[i]!), `${lab} vs ${want}`).toBeLessThan(tol));

  test("reference points", () => {
    close(rgbToLab([0, 0, 0]), [0, 0, 0]);
    close(rgbToLab([255, 255, 255]), [100, 0, 0], 0.01);
    close(rgbToLab([255, 0, 0]), [53.24, 80.09, 67.2]);
    close(rgbToLab([0, 255, 0]), [87.73, -86.18, 83.18]);
    close(rgbToLab([0, 0, 255]), [32.3, 79.19, -107.86]);
    close(rgbToLab([128, 128, 128]), [53.59, 0, 0]);
  });

  test("round trips exactly for primaries, greys and a sample grid", () => {
    const samples: RGB[] = [
      [0, 0, 0], [255, 255, 255], [255, 0, 0], [0, 255, 0], [0, 0, 255],
      [255, 255, 0], [0, 255, 255], [255, 0, 255], [1, 1, 1], [254, 254, 254],
    ];
    for (let r = 0; r <= 255; r += 51)
      for (let g = 0; g <= 255; g += 51) for (let b = 0; b <= 255; b += 51) samples.push([r, g, b]);
    for (const rgb of samples) expect(labToRgb(rgbToLab(rgb))).toEqual(rgb);
  });

  test("hex helpers", () => {
    expect(rgbToHex([255, 0, 128])).toBe("#ff0080");
    expect(rgbToHex([300, -5, 12.6])).toBe("#ff000d");
    expect(labToHex(hexToLab("#3b82f6")!)).toBe("#3b82f6");
    expect(hexToLab("nope")).toBeNull();
    expect(labToRgb([150, 200, -200]).every((c) => c >= 0 && c <= 255)).toBe(true);
  });
});

describe("deltaE2000: Sharma, Wu & Dalal (2005) test data", () => {
  // [L1, a1, b1, L2, a2, b2, ΔE00]
  const PAIRS: [number, number, number, number, number, number, number][] = [
    [50.0, 2.6772, -79.7751, 50.0, 0.0, -82.7485, 2.0425],
    [50.0, 3.1571, -77.2803, 50.0, 0.0, -82.7485, 2.8615],
    [50.0, 2.8361, -74.02, 50.0, 0.0, -82.7485, 3.4412],
    [50.0, -1.3802, -84.2814, 50.0, 0.0, -82.7485, 1.0],
    [50.0, 0.0, 0.0, 50.0, -1.0, 2.0, 2.3669],
    [50.0, 2.49, -0.001, 50.0, -2.49, 0.0009, 7.1792],
    [50.0, 2.49, -0.001, 50.0, -2.49, 0.0011, 7.2195],
    [50.0, -0.001, 2.49, 50.0, 0.0009, -2.49, 4.8045],
    [50.0, -0.001, 2.49, 50.0, 0.0011, -2.49, 4.7461],
    [50.0, 2.5, 0.0, 50.0, 0.0, -2.5, 4.3065],
    [50.0, 2.5, 0.0, 73.0, 25.0, -18.0, 27.1492],
    [50.0, 2.5, 0.0, 61.0, -5.0, 29.0, 22.8977],
    [50.0, 2.5, 0.0, 56.0, -27.0, -3.0, 31.903],
    [50.0, 2.5, 0.0, 58.0, 24.0, 15.0, 19.4535],
    [50.0, 2.5, 0.0, 50.0, 3.1736, 0.5854, 1.0],
    [60.2574, -34.0099, 36.2677, 60.4626, -34.1751, 39.4387, 1.2644],
    [63.0109, -31.0961, -5.8663, 62.8187, -29.7946, -4.0864, 1.263],
    [61.2901, 3.7196, -5.3901, 61.4292, 2.248, -4.962, 1.8731],
    [35.0831, -44.1164, 3.7933, 35.0232, -40.0716, 1.5901, 1.8645],
    [22.7233, 20.0904, -46.694, 23.0331, 14.973, -42.5619, 2.0373],
    [36.4612, 47.858, 18.3852, 36.2715, 50.5065, 21.2231, 1.4146],
    [90.8027, -2.0831, 1.441, 91.1528, -1.6435, 0.0447, 1.4441],
    [90.9257, -0.5406, -0.9208, 88.6381, -0.8985, -0.7239, 1.5381],
    [6.7747, -0.2908, -2.4247, 5.8714, -0.0985, -2.2286, 0.6377],
    [2.0776, 0.0795, -1.135, 0.9033, -0.0636, -0.5514, 0.9082],
  ];

  test.each(PAIRS)("(%f,%f,%f) vs (%f,%f,%f) = %f", (L1, a1, b1, L2, a2, b2, want) => {
    const p: Lab = [L1, a1, b1];
    const q: Lab = [L2, a2, b2];
    expect(Math.abs(deltaE2000(p, q) - want)).toBeLessThanOrEqual(1e-4);
    // Symmetric.
    expect(Math.abs(deltaE2000(q, p) - want)).toBeLessThanOrEqual(1e-4);
  });

  test("identical colours are 0, including achromatic", () => {
    expect(deltaE2000([50, 0, 0], [50, 0, 0])).toBe(0);
    expect(deltaE2000([40, 20, -30], [40, 20, -30])).toBe(0);
  });
});

describe("deltaE76", () => {
  test("Euclidean distance in LAB", () => {
    expect(deltaE76([0, 0, 0], [3, 4, 0])).toBe(5);
    expect(deltaE76([50, 10, -10], [50, 10, -10])).toBe(0);
    expect(deltaE76([0, 0, 0], [100, 0, 0])).toBe(100);
    expect(deltaE76([1, 2, 3], [4, 6, 3])).toBe(deltaE76([4, 6, 3], [1, 2, 3]));
  });
});

describe("kmeansLab", () => {
  const points: WeightedLab[] = [];
  for (let i = 0; i < 60; i++) {
    const base: Lab = i % 3 === 0 ? [30, 40, 20] : i % 3 === 1 ? [70, -30, 50] : [50, 10, -60];
    points.push({ lab: [base[0] + (i % 5), base[1] - (i % 7), base[2] + (i % 4)], weight: 1 + (i % 3) });
  }

  test("same seed -> identical output", () => {
    const a = kmeansLab(points, 4, { seed: 42 });
    const b = kmeansLab(points, 4, { seed: 42 });
    expect(a).toEqual(b);
  });

  test("weights sum to 1, at most k clusters, heaviest first", () => {
    for (const seed of [1, 7, 99]) {
      const out = kmeansLab(points, 5, { seed });
      expect(out.length).toBeGreaterThan(0);
      expect(out.length).toBeLessThanOrEqual(5);
      expect(sum(out.map((c) => c.weight))).toBeCloseTo(1, 10);
      for (let i = 1; i < out.length; i++) expect(out[i - 1]!.weight).toBeGreaterThanOrEqual(out[i]!.weight);
    }
  });

  test("finds three well-separated groups", () => {
    const out = kmeansLab(points, 3, { seed: 3 });
    expect(out).toHaveLength(3);
    // Group weights: i%3==0 -> weight 1, ==1 -> 2, ==2 -> 3; 20 points each.
    expect(out.map((c) => c.weight)).toEqual([
      expect.closeTo(0.5, 6),
      expect.closeTo(1 / 3, 6),
      expect.closeTo(1 / 6, 6),
    ]);
  });

  test("tiny inputs: fewer clusters than k", () => {
    expect(kmeansLab([], 3)).toEqual([]);
    expect(kmeansLab(points, 0)).toEqual([]);
    const two = kmeansLab(
      [
        { lab: [10, 0, 0], weight: 1 },
        { lab: [90, 0, 0], weight: 3 },
      ],
      6
    );
    expect(two).toHaveLength(2);
    expect(two[0]).toEqual({ lab: [90, 0, 0], weight: 0.75 });
    const same = kmeansLab(
      [
        { lab: [50, 5, 5], weight: 1 },
        { lab: [50, 5, 5], weight: 1 },
      ],
      4
    );
    expect(same).toEqual([{ lab: [50, 5, 5], weight: 1 }]);
    expect(kmeansLab([{ lab: [1, 1, 1], weight: 0 }], 2)).toEqual([]);
  });
});

describe("paletteFromPixels", () => {
  const pixels = (list: [number, number, number, number, number][]) => {
    const out: number[] = [];
    for (const [r, g, b, a, n] of list) for (let i = 0; i < n; i++) out.push(r, g, b, a);
    return new Uint8ClampedArray(out);
  };

  test("two flat colours, weights by pixel count, transparent pixels dropped", () => {
    const data = pixels([
      [255, 0, 0, 255, 30],
      [0, 0, 255, 255, 10],
      [0, 255, 0, 10, 100], // below alpha floor
    ]);
    const pal = paletteFromPixels(data, { k: 6, seed: 1 });
    expect(pal.map((p) => p.hex)).toEqual(["#ff0000", "#0000ff"]);
    expect(pal.map((p) => p.weight)).toEqual([0.75, 0.25]);
    expect(pal[0]!.lab).toHaveLength(3);
  });

  test("deterministic for a seed; at most k colours", () => {
    const list: [number, number, number, number, number][] = [];
    for (let i = 0; i < 40; i++) list.push([(i * 37) % 256, (i * 91) % 256, (i * 53) % 256, 255, 1 + (i % 4)]);
    const data = pixels(list);
    const a = paletteFromPixels(data, { k: 6, seed: 0x5eed });
    expect(a).toEqual(paletteFromPixels(data, { k: 6, seed: 0x5eed }));
    expect(a.length).toBeLessThanOrEqual(6);
    expect(sum(a.map((p) => p.weight))).toBeCloseTo(1, 3);
  });

  test("fully transparent image -> empty palette", () => {
    expect(paletteFromPixels(pixels([[1, 2, 3, 0, 20]]))).toEqual([]);
  });
});

describe("normalizeCaptureColors", () => {
  test("nothing in -> nothing out", () => {
    expect(normalizeCaptureColors(undefined, undefined)).toEqual([]);
    expect(normalizeCaptureColors([], [])).toEqual([]);
  });

  test("merges colours closer than ΔE2000 5, keeps farther ones", () => {
    const out = normalizeCaptureColors(
      [
        { hex: "#ff0000", weight: 0.5 },
        { hex: "#fe0202", weight: 0.3 },
        { hex: "#0000ff", weight: 0.2 },
      ],
      undefined
    );
    expect(out).toHaveLength(2);
    expect(out[0]!.weight).toBeCloseTo(0.8, 10);
    expect(out[1]).toMatchObject({ hex: "#0000ff" });
    expect(out[1]!.weight).toBeCloseTo(0.2, 10);
    expect(deltaE2000(hexToLab("#ff0000")!, hexToLab("#fe0202")!)).toBeLessThan(5);
  });

  test("weights renormalised to 1 and heaviest first", () => {
    const out = normalizeCaptureColors(
      [
        { hex: "#000000", weight: 2 },
        { hex: "#ffffff", weight: 6 },
        { hex: "#ff0000", weight: 2 },
      ],
      undefined
    );
    expect(out.map((c) => c.hex)).toEqual(["#ffffff", expect.any(String), expect.any(String)]);
    expect(out[0]!.weight).toBeCloseTo(0.6, 10);
    expect(sum(out.map((c) => c.weight))).toBeCloseTo(1, 10);
    for (let i = 1; i < out.length; i++) expect(out[i - 1]!.weight).toBeGreaterThanOrEqual(out[i]!.weight);
    // LAB is rounded to 2 decimals.
    expect(out[0]).toMatchObject({ l: 100, a: expect.closeTo(0, 2), b: expect.closeTo(0, 2) });
  });

  test("at most 12 colours, still summing to 1", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      hex: labToHex([20 + (i % 5) * 15, -60 + i * 6, i % 2 ? 40 : -40]),
      weight: 1,
    }));
    const out = normalizeCaptureColors(many, undefined);
    expect(out.length).toBe(MAX_CAPTURE_COLORS);
    expect(sum(out.map((c) => c.weight))).toBeCloseTo(1, 10);
  });

  test("DNA and palette each count for half", () => {
    const dna = Array.from({ length: 4 }, (_, i) => ({ hex: ["#ff0000", "#00ff00", "#ffff00", "#ff00ff"][i]!, weight: 10 }));
    const palette = [{ hex: "#0000ff", lab: rgbToLab([0, 0, 255]), weight: 0.001 }];
    const out = normalizeCaptureColors(dna, palette);
    expect(out[0]).toMatchObject({ hex: "#0000ff" });
    expect(out[0]!.weight).toBeCloseTo(0.5, 10);
    for (const c of out.slice(1)) expect(c.weight).toBeCloseTo(0.125, 10);
  });

  test("hex is authoritative over a client LAB; zero weights ignored", () => {
    const out = normalizeCaptureColors(undefined, [
      { hex: "#000000", lab: [100, 0, 0], weight: 0.5 }, // contradicting lab ignored -> black
      { hex: "#ff0000", lab: [1, 2], weight: 0.5 }, // bad lab, hex used
      { hex: "#00ff00", lab: [50, 0, 0], weight: 0 },
    ]);
    expect(out.map((c) => c.hex).sort()).toEqual(["#000000", "#ff0000"]);
  });

  test("LAB is only a fallback when the hex is unusable", () => {
    const out = normalizeCaptureColors(undefined, [{ hex: "not-a-hex", lab: [100, 0, 0], weight: 1 }]);
    expect(out.map((c) => c.hex)).toEqual(["#ffffff"]);
  });

  test("mergeSimilarColors averages LAB by weight", () => {
    const merged = mergeSimilarColors([
      { lab: [50, 0, 0], weight: 3 },
      { lab: [51, 0, 0], weight: 1 },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.weight).toBe(4);
    expect(merged[0]!.lab[0]).toBeCloseTo(50.25, 10);
  });
});
