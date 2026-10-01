/**
 * 50–950 colour scales in OKLCH (spec 6.5 stage 1, step 4). Pure.
 *
 * The hue stays fixed, lightness ramps from near-white to near-black with
 * step 500 pinned to the given colour, and chroma eases off towards both ends
 * so the palest and darkest steps do not look neon. Every step is clamped
 * into sRGB by reducing chroma.
 */

import { SHADE_STEPS, type ColorScale, type ShadeStep } from "./types";
import { hexToOklch, oklchToHex } from "./oklch";

/**
 * Where each step sits between the lightest step (0) and 500 (1), or
 * between 500 (0) and the darkest step (1).
 */
const UPPER: Partial<Record<ShadeStep, number>> = { "50": 0, "100": 0.09, "200": 0.25, "300": 0.45, "400": 0.7 };
const LOWER: Partial<Record<ShadeStep, number>> = { "600": 0.17, "700": 0.36, "800": 0.55, "900": 0.75, "950": 1 };

/** Share of 500's chroma each step keeps. */
const CHROMA: Record<ShadeStep, number> = {
  "50": 0.15,
  "100": 0.3,
  "200": 0.55,
  "300": 0.75,
  "400": 0.9,
  "500": 1,
  "600": 0.95,
  "700": 0.85,
  "800": 0.72,
  "900": 0.6,
  "950": 0.48,
};

const LIGHTEST = 0.975;
const DARKEST = 0.22;

/** Lowercase `#rrggbb`, or null when `hex` is not a colour. */
function normalizeHex(hex: string): string | null {
  const o = hexToOklch(hex);
  return o ? oklchToHex(o) : null;
}

/**
 * A full scale whose 500 is `hex500` exactly (lowercased). Throws on a
 * malformed colour.
 */
export function buildScale(hex500: string): ColorScale {
  const base = hexToOklch(hex500);
  const exact = normalizeHex(hex500);
  if (!base || !exact) throw new Error(`Not a colour: ${hex500}`);
  // The ends must stay beyond 500 so the ramp is monotonic for any base.
  const top = Math.min(1, Math.max(LIGHTEST, base.l + 0.01));
  const bottom = Math.max(0, Math.min(DARKEST, base.l - 0.01));

  const scale = {} as ColorScale;
  for (const step of SHADE_STEPS) {
    if (step === "500") {
      // Re-encoding a hex through OKLCH can move a channel by one; keep the input.
      scale[step] = /^#[0-9a-f]{6}$/i.test(hex500.trim()) ? hex500.trim().toLowerCase() : exact;
      continue;
    }
    const up = UPPER[step];
    const l = up !== undefined ? top + (base.l - top) * up : base.l + (bottom - base.l) * LOWER[step]!;
    scale[step] = oklchToHex({ l, c: base.c * CHROMA[step], h: base.h });
  }
  return scale;
}
