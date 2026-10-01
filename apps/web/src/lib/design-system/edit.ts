/**
 * Pure token edits for the design system editor. Each returns a new tokens
 * object and rebuilds whatever is derived from the edited value (a colour's
 * 50-950 scale, the type scale, the spacing scale, radius sm/lg).
 *
 * Relative imports only, so the chrome-extension vitest suite can test it.
 */
import {
  buildTypeScale,
  clamp,
  radiusScale,
  spacingScale,
} from "../../../../../packages/backend/convex/lib/design_system/builders";
import { hexToOklch, oklchToHex } from "../../../../../packages/backend/convex/lib/design_system/oklch";
import { buildScale, normalizeHex as normalizeHashedHex } from "../../../../../packages/backend/convex/lib/design_system/scale";
import type { DesignSystemTokens } from "../../../../../packages/backend/convex/lib/design_system/types";

export type BaseColorKey = "background" | "surface" | "border" | "text" | "textMuted";
export type ScaleColorKey = "primary" | "secondary";

/**
 * The backend's normalizeHex (lowercase `#rrggbb` from `#rgb` / `#rrggbb`),
 * also accepting the `#` left off, as people type it into the hex field.
 */
export function normalizeHex(input: string): string | null {
  const s = input.trim();
  return normalizeHashedHex(s.startsWith("#") ? s : `#${s}`);
}

/** "1.25rem" -> 1.25, "8px" -> 0.5; null when it isn't a length. */
export function parseRem(v: string | undefined): number | null {
  if (!v) return null;
  const m = /^(-?\d*\.?\d+)(rem|px)?$/.exec(v.trim());
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  return m[2] === "px" ? n / 16 : n;
}

export function setBaseColor(t: DesignSystemTokens, key: BaseColorKey, hex: string): DesignSystemTokens {
  const h = normalizeHex(hex);
  if (!h) return t;
  return { ...t, colors: { ...t.colors, [key]: h } };
}

/** Sets a 500 shade and regenerates the 50-950 scale around it. */
export function setScale500(t: DesignSystemTokens, key: ScaleColorKey, hex: string): DesignSystemTokens {
  const h = normalizeHex(hex);
  if (!h) return t;
  return { ...t, colors: { ...t.colors, [key]: buildScale(h) } };
}

/** How far "Add a secondary colour" turns primary's hue: near-complementary. */
export const SECONDARY_HUE_SHIFT = 150;

/** primary-500 with its OKLCH hue rotated by SECONDARY_HUE_SHIFT (lightness and chroma kept). */
export function seedSecondaryHex(primary500: string): string | null {
  const hex = normalizeHex(primary500);
  const o = hex ? hexToOklch(hex) : null;
  if (!o) return null;
  return oklchToHex({ ...o, h: (o.h + SECONDARY_HUE_SHIFT) % 360 });
}

/** Adds a secondary scale seeded from primary (seedSecondaryHex). */
export function addSecondary(t: DesignSystemTokens): DesignSystemTokens {
  const seed = seedSecondaryHex(t.colors.primary["500"]);
  return seed ? setScale500(t, "secondary", seed) : t;
}

export function removeSecondary(t: DesignSystemTokens): DesignSystemTokens {
  const colors = { ...t.colors };
  delete colors.secondary;
  return { ...t, colors };
}

/** The base sizes validateTokens accepts (px). */
export const BASE_SIZE_MIN = 12;
export const BASE_SIZE_MAX = 32;

/** Notes the type scale builder gives for these settings (floored small steps, capped 5xl). */
export function typeScaleNotes(t: DesignSystemTokens): string[] {
  return buildTypeScale(t.typography.baseSize, t.typography.ratio).notes;
}

export function setTypeScale(t: DesignSystemTokens, patch: { ratio?: number; baseSize?: number }): DesignSystemTokens {
  const ratio = patch.ratio ?? t.typography.ratio;
  const baseSize = clamp(patch.baseSize ?? t.typography.baseSize, BASE_SIZE_MIN, BASE_SIZE_MAX);
  if (!Number.isFinite(ratio) || ratio <= 1 || !Number.isFinite(baseSize)) return t;
  return {
    ...t,
    typography: { ...t.typography, ratio, baseSize, scale: buildTypeScale(baseSize, ratio).scale },
  };
}

type TypographyPatch = Partial<
  Pick<
    DesignSystemTokens["typography"],
    "fontHeading" | "fontBody" | "headingWeight" | "bodyWeight" | "headingLineHeight" | "bodyLineHeight"
  >
>;

export function setTypography(t: DesignSystemTokens, patch: TypographyPatch): DesignSystemTokens {
  return { ...t, typography: { ...t.typography, ...patch } };
}

export function setSpacingBase(t: DesignSystemTokens, base: 4 | 8): DesignSystemTokens {
  return { ...t, spacing: { base, scale: spacingScale(base) } };
}

export const RADIUS_MD_MAX_PX = 64;

/** md in px; sm = md / 2 and lg = md * 2 follow it (all stored in rem). */
export function setRadiusMd(t: DesignSystemTokens, mdPx: number): DesignSystemTokens {
  if (!Number.isFinite(mdPx) || mdPx < 0) return t;
  return { ...t, radius: radiusScale(Math.min(mdPx, RADIUS_MD_MAX_PX)) };
}

/** The standard steps plus `current` when it is none of them, sorted; a select can't show a value it lacks. */
export function withCurrent(
  standard: readonly number[],
  current: number
): Array<{ value: number; label: string }> {
  const values: number[] = [...standard];
  if (Number.isFinite(current) && !values.includes(current)) values.push(current);
  return values.sort((a, b) => a - b).map((v) => ({ value: v, label: String(v) }));
}

/** Stable JSON (sorted keys) so equal tokens compare equal regardless of key order. */
export function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  if (v && typeof v === "object") {
    const entries = Object.entries(v as Record<string, unknown>)
      .filter(([, x]) => x !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, x]) => `${JSON.stringify(k)}:${stableStringify(x)}`).join(",")}}`;
  }
  return JSON.stringify(v);
}

export function tokensEqual(a: DesignSystemTokens, b: DesignSystemTokens): boolean {
  return stableStringify(a) === stableStringify(b);
}
