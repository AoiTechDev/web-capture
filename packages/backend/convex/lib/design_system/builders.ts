/**
 * Token scales derived from one or two numbers. Shared by the generator and
 * the dashboard editor, which rebuilds them when the user changes the ratio,
 * base size, spacing base or radius. Pure.
 */

import { TYPE_STEPS, type TypeStep } from "./types";

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** `n` rem, up to three decimals, e.g. "1.25rem"; zero is "0rem". */
export function rem(n: number): string {
  return `${round3(n) || 0}rem`;
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

/** xs…5xl: baseSize × ratio^exponent, in rem (16px = 1rem). */
export function typeScale(baseSize: number, ratio: number): Record<TypeStep, string> {
  const scale = {} as Record<TypeStep, string>;
  for (const step of TYPE_STEPS) scale[step] = rem((baseSize * ratio ** TYPE_STEP_EXPONENT[step]) / 16);
  return scale;
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
