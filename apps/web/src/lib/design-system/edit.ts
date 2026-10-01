/**
 * Pure token edits for the design system editor. Each returns a new tokens
 * object and rebuilds whatever is derived from the edited value (a colour's
 * 50-950 scale, the type scale, the spacing scale, radius sm/lg).
 *
 * Relative imports only, so the chrome-extension vitest suite can test it.
 */
import {
  radiusScale,
  spacingScale,
  typeScale,
} from "../../../../../packages/backend/convex/lib/design_system/builders";
import { buildScale } from "../../../../../packages/backend/convex/lib/design_system/scale";
import type { DesignSystemTokens } from "../../../../../packages/backend/convex/lib/design_system/types";

export type BaseColorKey = "background" | "surface" | "border" | "text" | "textMuted";
export type ScaleColorKey = "primary" | "secondary";

/** `#abc` / `abc` / `#aabbcc` -> lowercase `#aabbcc`, or null. */
export function normalizeHex(input: string): string | null {
  const s = input.trim().replace(/^#/, "").toLowerCase();
  if (/^[0-9a-f]{6}$/.test(s)) return `#${s}`;
  if (/^[0-9a-f]{3}$/.test(s)) return `#${s[0]}${s[0]}${s[1]}${s[1]}${s[2]}${s[2]}`;
  return null;
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

export function removeSecondary(t: DesignSystemTokens): DesignSystemTokens {
  const colors = { ...t.colors };
  delete colors.secondary;
  return { ...t, colors };
}

export const BASE_SIZE_MIN = 10;
export const BASE_SIZE_MAX = 24;

export function setTypeScale(t: DesignSystemTokens, patch: { ratio?: number; baseSize?: number }): DesignSystemTokens {
  const ratio = patch.ratio ?? t.typography.ratio;
  const baseSize = clamp(patch.baseSize ?? t.typography.baseSize, BASE_SIZE_MIN, BASE_SIZE_MAX);
  if (!Number.isFinite(ratio) || ratio <= 1 || !Number.isFinite(baseSize)) return t;
  return {
    ...t,
    typography: { ...t.typography, ratio, baseSize, scale: typeScale(baseSize, ratio) },
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

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
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
