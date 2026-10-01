/**
 * Stage 1 spacing, radius and shadows (spec 6.5). Pure and deterministic.
 */

import { radiusScale, spacingScale } from "./builders";
import { weightedMedian } from "./typography";
import type { DesignSystemTokens } from "./types";
import { isValidShadow } from "./validate";

export type WeightedValue<T> = { value: T; weight: number };

/** Each capture's weights normalised to 1 and scaled by 1/captures. */
function perCapture<T>(captures: WeightedValue<T>[][], keep: (v: T) => boolean): WeightedValue<T>[] {
  const valid = captures
    .map((list) => list.filter((x) => x.weight > 0 && Number.isFinite(x.weight) && keep(x.value)))
    .filter((list) => list.length > 0);
  return valid.flatMap((list) => {
    const total = list.reduce((s, x) => s + x.weight, 0);
    return list.map((x) => ({ value: x.value, weight: x.weight / total / valid.length }));
  });
}

/** Spacing past this (px) is layout, not rhythm. */
const MAX_SPACING = 256;

/** Base 8 when more than half the (non-zero) spacing weight sits on multiples of 8, else 4. */
export function deriveSpacing(captures: WeightedValue<number>[][]): { spacing: DesignSystemTokens["spacing"]; notes: string[] } {
  const values = perCapture(captures, (v) => Number.isFinite(v) && v > 0 && v <= MAX_SPACING);
  const total = values.reduce((s, x) => s + x.weight, 0);
  if (total <= 0) return { spacing: { base: 4, scale: spacingScale(4) }, notes: ["No spacing captured; using a 4px base"] };
  const onEight = values.filter((x) => Math.abs(x.value - 8 * Math.round(x.value / 8)) < 0.5).reduce((s, x) => s + x.weight, 0);
  const base = onEight / total > 0.5 ? 8 : 4;
  return { spacing: { base, scale: spacingScale(base) }, notes: [] };
}

/** Radii at or past this (px) are pills / circles: they are `full`, not `md`. */
const PILL_RADIUS = 100;
export const DEFAULT_RADIUS = 8;

/** md = weighted median radius (px, rounded), sm = md/2, lg = md×2. */
export function deriveRadius(captures: WeightedValue<number>[][]): { radius: DesignSystemTokens["radius"]; notes: string[] } {
  const values = perCapture(captures, (v) => Number.isFinite(v) && v >= 0 && v < PILL_RADIUS);
  const median = weightedMedian(values);
  if (median === null) {
    return { radius: radiusScale(DEFAULT_RADIUS), notes: [`No corner radii captured; using ${DEFAULT_RADIUS}px`] };
  }
  return { radius: radiusScale(Math.round(median)), notes: [] };
}

const INNERMOST_CALL = /[a-z-]+\([^()]*\)/gi;
const HEX_COLOR = /#[0-9a-f]{3,8}\b/gi;

/** Largest blur radius (px) among a box-shadow's layers; the third length of each. */
export function shadowBlur(value: string): number {
  // Drop colours, innermost calls first so nested ones (color-mix) go too.
  let rest = value.replace(HEX_COLOR, " ");
  for (let prev = ""; prev !== rest; ) [prev, rest] = [rest, rest.replace(INNERMOST_CALL, " ")];
  const layers = rest.split(",");
  let blur = 0;
  for (const layer of layers) {
    const lengths = layer.match(/-?\d*\.?\d+(?=px\b|\s|$)/g) ?? [];
    const b = parseFloat(lengths[2] ?? "0");
    if (Number.isFinite(b)) blur = Math.max(blur, b);
  }
  return blur;
}

/**
 * The 1–3 heaviest shadows, by ascending blur: one is `md`; two are `sm`
 * and `md`; three are `sm`, `md` and `lg`. Shadows that would not pass
 * validateTokens are skipped.
 */
export function deriveShadows(captures: WeightedValue<string>[][]): { shadow: DesignSystemTokens["shadow"]; notes: string[] } {
  const notes: string[] = [];
  const all = perCapture(captures, (v) => typeof v === "string" && v.trim() !== "" && v.trim() !== "none");
  const totals = new Map<string, number>();
  let skipped = 0;
  for (const x of all) {
    const value = x.value.trim().replace(/\s+/g, " ");
    if (!isValidShadow(value)) {
      skipped++;
      continue;
    }
    totals.set(value, (totals.get(value) ?? 0) + x.weight);
  }
  if (skipped) notes.push(`Skipped ${skipped} shadow value${skipped === 1 ? "" : "s"} with unsupported syntax`);
  const top = [...totals]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, 3)
    .map(([value]) => value)
    .sort((a, b) => shadowBlur(a) - shadowBlur(b) || (a < b ? -1 : 1));
  if (!top.length) {
    notes.push("No shadows captured; shadow tokens left empty");
    return { shadow: {}, notes };
  }
  const keys = top.length === 1 ? (["md"] as const) : top.length === 2 ? (["sm", "md"] as const) : (["sm", "md", "lg"] as const);
  const shadow: DesignSystemTokens["shadow"] = {};
  keys.forEach((k, i) => (shadow[k] = top[i]!));
  return { shadow, notes };
}
