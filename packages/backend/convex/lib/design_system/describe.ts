/**
 * A one-line description of a design system, from a fixed template, e.g.
 * "Dark theme · violet primary with a teal accent · Inter headings, Inter
 * body · 8px grid · rounded corners (8px)". Pure.
 */

import { hexToOklch } from "./oklch";
import type { DesignSystemTokens } from "./types";

/** OKLCH chroma under this is described as neutral rather than by hue. */
const NEUTRAL_CHROMA = 0.04;

/** Upper bound (exclusive, OKLCH degrees) of each hue name; pink wraps past 360. */
const HUES: [number, string][] = [
  [12, "pink"],
  [40, "red"],
  [65, "orange"],
  [100, "yellow"],
  [135, "lime"],
  [170, "green"],
  [200, "teal"],
  [230, "cyan"],
  [270, "blue"],
  [285, "indigo"],
  [300, "violet"],
  [315, "purple"],
  [340, "magenta"],
  [360, "pink"],
];

/** Plain-English name of a colour's hue, or "neutral" for greys. */
export function hueName(hex: string): string {
  const o = hexToOklch(hex);
  if (!o || o.c < NEUTRAL_CHROMA) return "neutral";
  return HUES.find(([max]) => o.h < max)?.[1] ?? "pink";
}

const remToPx = (rem: string) => Math.round(parseFloat(rem) * 16 * 10) / 10;

export function describeTokens(tokens: DesignSystemTokens): string {
  const { colors, typography, spacing, radius } = tokens;
  const theme = tokens.mode === "dark" ? "Dark theme" : "Light theme";
  const primary = `${hueName(colors.primary["500"])} primary`;
  const palette = colors.secondary ? `${primary} with a ${hueName(colors.secondary["500"])} accent` : primary;
  const fonts = `${typography.fontHeading} headings, ${typography.fontBody} body`;
  const md = remToPx(radius.md);
  const corners = md > 0 ? `rounded corners (${md}px)` : "square corners";
  return [theme, palette, fonts, `${spacing.base}px grid`, corners].join(" · ");
}
