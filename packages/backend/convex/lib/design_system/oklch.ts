/**
 * OKLab / OKLCH conversions for the design system generator (Björn Ottosson's
 * matrices, as CSS Color 4 uses them). Pure: no Convex imports, so the
 * dashboard can import it by relative path.
 *
 * `l` is 0..1, `c` is chroma (0 to about 0.37 inside sRGB), `h` is degrees.
 */

import { parseHex, rgbToHex, type RGB } from "../color";

export type Oklab = { l: number; a: number; b: number };
export type Oklch = { l: number; c: number; h: number };

const srgbToLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const linearToSrgb = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.max(c, 0) ** (1 / 2.4) - 0.055);

/** 0..255 sRGB to OKLab. */
export function rgbToOklab([r, g, b]: RGB): Oklab {
  const R = srgbToLinear(r / 255);
  const G = srgbToLinear(g / 255);
  const B = srgbToLinear(b / 255);
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return {
    l: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
}

/** OKLab to linear sRGB, unclamped (out-of-gamut channels fall outside 0..1). */
function oklabToLinear({ l: L, a, b }: Oklab): RGB {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

export function oklabToOklch({ l, a, b }: Oklab): Oklch {
  const h = (Math.atan2(b, a) * 180) / Math.PI;
  return { l, c: Math.hypot(a, b), h: h < 0 ? h + 360 : h };
}

export function oklchToOklab({ l, c, h }: Oklch): Oklab {
  const rad = (h * Math.PI) / 180;
  return { l, a: c * Math.cos(rad), b: c * Math.sin(rad) };
}

export function hexToOklch(hex: string): Oklch | null {
  const c = parseHex(hex);
  return c ? oklabToOklch(rgbToOklab([c.r, c.g, c.b])) : null;
}

/** Tolerance for "inside sRGB": rounding to 8 bits hides anything smaller. */
const GAMUT_EPS = 0.0005;

export function inSrgbGamut(color: Oklch): boolean {
  return oklabToLinear(oklchToOklab(color)).every((c) => c >= -GAMUT_EPS && c <= 1 + GAMUT_EPS);
}

/**
 * The same lightness and hue with chroma reduced (binary search) until the
 * colour fits sRGB. Lightness is clamped to 0..1 first.
 */
export function clampToGamut(color: Oklch): Oklch {
  const l = Math.min(1, Math.max(0, color.l));
  const c = Math.max(0, color.c);
  if (inSrgbGamut({ l, c, h: color.h })) return { l, c, h: color.h };
  let lo = 0;
  let hi = c;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (inSrgbGamut({ l, c: mid, h: color.h })) lo = mid;
    else hi = mid;
  }
  return { l, c: lo, h: color.h };
}

/** OKLCH to lowercase `#rrggbb`, gamut-clamped by chroma. */
export function oklchToHex(color: Oklch): string {
  const lin = oklabToLinear(oklchToOklab(clampToGamut(color)));
  return rgbToHex(lin.map((c) => Math.round(Math.min(1, Math.max(0, linearToSrgb(c))) * 255)) as RGB);
}

/** Smallest angle between two hues, 0..180. */
export function hueDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}
