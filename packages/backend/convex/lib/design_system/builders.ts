/**
 * Token scales derived from one or two numbers. Shared by the generator and
 * the dashboard editor, which rebuilds them when the user changes the ratio,
 * base size, spacing base or radius. Pure.
 */

import { TYPE_STEPS, type TypeStep } from "./types";

export const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

const round4 = (n: number) => Math.round(n * 10000) / 10000;

/** `n` rem, up to four decimals (so any whole px / 16 is exact), e.g. "1.25rem"; zero is "0rem". */
export function rem(n: number): string {
  return `${round4(n) || 0}rem`;
}

/** Exponent of each type step relative to base. */
export const TYPE_STEP_EXPONENT: Record<TypeStep, number> = {
  xs: -2,
  sm: -1,
  base: 0,
  lg: 1,
  xl: 2,
  "2xl": 3,
  "3xl": 4,
  "4xl": 5,
  "5xl": 6,
};

/** Steps below base shrink by at most this ratio… */
export const TYPE_DOWN_RATIO_MAX = 1.2;
/** …and never below this (px), so xs stays readable. */
export const TYPE_MIN_PX = 12;
/** 5xl never exceeds this (px, = 6rem); larger scales are spread up to it. */
export const TYPE_MAX_PX = 96;

/**
 * xs…5xl in rem (16px = 1rem), with the notes the editor and generator show.
 *
 * Below base each step divides by min(ratio, 1.2), floored at 12px. Above
 * base each step multiplies by `ratio`; when 5xl would pass 96px (6rem),
 * the steps above base are spread geometrically between base and 96px.
 */
export function buildTypeScale(baseSize: number, ratio: number): { scale: Record<TypeStep, string>; notes: string[] } {
  const notes: string[] = [];
  const top = TYPE_STEP_EXPONENT["5xl"];
  const capped = baseSize * ratio ** top > TYPE_MAX_PX && baseSize < TYPE_MAX_PX;
  const up = capped ? (TYPE_MAX_PX / baseSize) ** (1 / top) : ratio;
  const down = Math.min(ratio, TYPE_DOWN_RATIO_MAX);
  let floored = false;
  const scale = {} as Record<TypeStep, string>;
  for (const step of TYPE_STEPS) {
    const k = TYPE_STEP_EXPONENT[step];
    let px = k >= 0 ? baseSize * up ** k : baseSize / down ** -k;
    if (k < 0 && px < TYPE_MIN_PX) {
      px = Math.min(TYPE_MIN_PX, baseSize);
      floored = true;
    }
    scale[step] = rem(px / 16);
  }
  if (floored) notes.push(`Small type steps floored at ${TYPE_MIN_PX}px`);
  if (capped) {
    notes.push(`5xl capped at ${TYPE_MAX_PX}px (6rem); steps above base spread by ${Math.round(up * 1000) / 1000} instead of ${ratio}`);
  }
  return { scale, notes };
}

/** buildTypeScale without the notes. */
export function typeScale(baseSize: number, ratio: number): Record<TypeStep, string> {
  return buildTypeScale(baseSize, ratio).scale;
}

export const SPACING_KEYS = ["0", "1", "2", "3", "4", "6", "8", "12", "16", "24"] as const;

/** Key k is k × base px: base 4 gives 0, 4, 8, … 96px; base 8 doubles each. */
export function spacingScale(base: 4 | 8): Record<string, string> {
  return Object.fromEntries(SPACING_KEYS.map((k) => [k, rem((Number(k) * base) / 16)]));
}

/** sm = md/2, lg = md×2 (rem), full = "9999px". */
export function radiusScale(mdPx: number): { sm: string; md: string; lg: string; full: string } {
  return { sm: rem(mdPx / 32), md: rem(mdPx / 16), lg: rem(mdPx / 8), full: "9999px" };
}
