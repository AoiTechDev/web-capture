/**
 * WCAG 2 contrast for design system tokens. Pure: the dashboard editor imports
 * `contrastRatio` and `checkContrast` for live warnings, and the generator
 * runs `fixContrast` after stage 1.
 *
 * Corrections move lightness in OKLCH only. Hue is kept; chroma only drops
 * where the new lightness would otherwise leave sRGB.
 */

import { parseHex } from "../color";
import { hexToOklch, oklchToHex } from "./oklch";
import { buildScale } from "./scale";
import type { ContrastCheck, DesignSystemTokens } from "./types";

/** WCAG relative luminance of a `#rgb`/`#rrggbb` colour; null when malformed. */
export function relativeLuminance(hex: string): number | null {
  const c = parseHex(hex);
  if (!c) return null;
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
}

/** WCAG contrast ratio, 1..21 (order of the two colours does not matter); 1 when either is malformed. */
export function contrastRatio(fgHex: string, bgHex: string): number {
  const a = relativeLuminance(fgHex);
  const b = relativeLuminance(bgHex);
  if (a === null || b === null) return 1;
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** Text pairs need 4.5:1 (AA body text); primary on background 3:1 (AA large text, UI). */
export const TEXT_CONTRAST = 4.5;
export const PRIMARY_CONTRAST = 3;
/** Muted text closer than this to text is noted as indistinguishable from it. */
export const MUTED_DISTINCT = 1.3;

type Pair = ContrastCheck["pair"];

function pairsOf(tokens: DesignSystemTokens): { pair: Pair; fg: string; bg: string; required: number }[] {
  const c = tokens.colors;
  return [
    { pair: "text/background", fg: c.text, bg: c.background, required: TEXT_CONTRAST },
    { pair: "textMuted/background", fg: c.textMuted, bg: c.background, required: TEXT_CONTRAST },
    { pair: "text/surface", fg: c.text, bg: c.surface, required: TEXT_CONTRAST },
    { pair: "textMuted/surface", fg: c.textMuted, bg: c.surface, required: TEXT_CONTRAST },
    { pair: "primary/background", fg: c.primary["500"], bg: c.background, required: PRIMARY_CONTRAST },
  ];
}

/**
 * The five checked pairs. `ratio` is floored to two decimals, so a ratio
 * shown as 4.5 always passes and 4.49 never does.
 */
export function checkContrast(tokens: DesignSystemTokens): ContrastCheck[] {
  return pairsOf(tokens).map(({ pair, fg, bg, required }) => {
    const raw = contrastRatio(fg, bg);
    return {
      pair,
      foreground: fg,
      background: bg,
      ratio: Math.floor(raw * 100) / 100,
      required,
      passes: raw >= required,
    };
  });
}

/**
 * `hex` with its OKLCH lightness moved the least distance that gives
 * `required` contrast against `against`, or null when even black or white
 * would not. Prefers the direction the colour already sits in.
 */
export function adjustLightness(hex: string, against: string, required: number): string | null {
  const start = hexToOklch(hex);
  const bgY = relativeLuminance(against);
  const fgY = relativeLuminance(hex);
  if (!start || bgY === null || fgY === null) return null;
  if (contrastRatio(hex, against) >= required) return hex;

  const lighterFirst = fgY >= bgY;
  for (const lighter of [lighterFirst, !lighterFirst]) {
    const end = lighter ? 1 : 0;
    const at = (l: number) => oklchToHex({ ...start, l });
    if (contrastRatio(at(end), against) < required) continue;
    // Contrast grows as lightness moves away from the background: binary
    // search for the smallest move, always keeping `hi` on a passing hex.
    let lo = start.l;
    let hi = end;
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2;
      if (contrastRatio(at(mid), against) >= required) hi = mid;
      else lo = mid;
    }
    return at(hi);
  }
  return null;
}

const fmt = (ratio: number) => (Math.floor(ratio * 10) / 10).toFixed(1);

/**
 * Tokens with every failing pair corrected by lightness, plus a note for each
 * change. The input is not modified.
 *
 * Text and textMuted are fixed against the background first (textMuted only
 * as far as it must, so it stays muted). Black or white reaches at least
 * 4.58:1 (√21) on any background, so that fix always exists and the
 * background is never moved. Against the surface they are only moved when
 * that keeps them passing on the background; otherwise (a surface on their
 * far side) the surface is moved towards the background's lightness.
 * primary-500 is moved and its scale rebuilt around it, so the hue holds.
 */
export function fixContrast(tokens: DesignSystemTokens): { tokens: DesignSystemTokens; notes: string[] } {
  const out: DesignSystemTokens = structuredClone(tokens);
  const c = out.colors;
  const notes: string[] = [];

  const fix = (role: "text" | "textMuted", on: "background" | "surface") => {
    const before = contrastRatio(c[role], c[on]);
    if (before >= TEXT_CONTRAST) return;
    const fixed = adjustLightness(c[role], c[on], TEXT_CONTRAST);
    if (!fixed) return;
    if (on === "surface" && contrastRatio(fixed, c.background) < TEXT_CONTRAST) return;
    c[role] = fixed;
    const where = on === "surface" ? " on surface" : "";
    notes.push(`Raised ${role} contrast${where} from ${fmt(before)}:1 to ${fmt(contrastRatio(fixed, c[on]))}:1`);
  };

  fix("text", "background");
  fix("textMuted", "background");
  fix("text", "surface");
  fix("textMuted", "surface");
  const surfaceOk = (hex: string) =>
    contrastRatio(c.text, hex) >= TEXT_CONTRAST && contrastRatio(c.textMuted, hex) >= TEXT_CONTRAST;
  if (!surfaceOk(c.surface)) {
    // Both colours already clear the background, so a surface at its
    // lightness clears them too: move the least distance towards it.
    const before = c.surface;
    const s = hexToOklch(c.surface)!;
    const bgL = hexToOklch(c.background)!.l;
    const at = (t: number) => oklchToHex({ ...s, l: s.l + (bgL - s.l) * t });
    let moved = c.background;
    if (surfaceOk(at(1))) {
      let lo = 0;
      let hi = 1;
      for (let i = 0; i < 30; i++) {
        const mid = (lo + hi) / 2;
        if (surfaceOk(at(mid))) hi = mid;
        else lo = mid;
      }
      moved = at(hi);
    }
    c.surface = moved;
    notes.push(`Moved surface ${before} to ${moved} so text and muted text both reach 4.5:1 on it`);
  }
  const mutedVsText = contrastRatio(c.textMuted, c.text);
  if (mutedVsText < MUTED_DISTINCT) {
    notes.push(`textMuted is barely distinguishable from text (${fmt(mutedVsText)}:1)`);
  }

  const primaryBefore = contrastRatio(c.primary["500"], c.background);
  if (primaryBefore < PRIMARY_CONTRAST) {
    const fixed = adjustLightness(c.primary["500"], c.background, PRIMARY_CONTRAST);
    if (fixed) {
      c.primary = buildScale(fixed);
      notes.push(
        `Moved primary-500 lightness for contrast from ${fmt(primaryBefore)}:1 to ${fmt(contrastRatio(fixed, c.background))}:1 and rebuilt its scale`
      );
    }
  }
  return { tokens: out, notes };
}
