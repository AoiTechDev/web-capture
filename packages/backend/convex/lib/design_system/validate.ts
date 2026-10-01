/**
 * Strict validation of design system tokens from the outside (the editor's
 * save, and anything a future AI editor returns). Pure.
 *
 * Tokens end up verbatim in exported CSS, so every string has a narrow
 * format: colours are #rrggbb, sizes are rem, font names and shadows use an
 * allow-listed character set with no `;`, `{`, `}`, quotes or comments, so a
 * value can never close the declaration or rule it is written into, and a
 * shadow may only call colour functions (SHADOW_FUNCTIONS). Unknown
 * keys are rejected and the result is rebuilt from the known ones only.
 */

import { SHADE_STEPS, TYPE_STEPS, type ColorScale, type DesignSystemTokens } from "./types";
import { SPACING_KEYS } from "./builders";

export const MAX_FONT_NAME = 64;
export const MAX_SHADOW = 500;

const HEX = /^#[0-9a-f]{6}$/i;
const REM = /^(?:0|[0-9]{1,3}(?:\.[0-9]{1,4})?)rem$/;
/** Letters, digits, space, hyphen, underscore, dot, ampersand, plus. */
const FONT_NAME = /^[\p{L}\p{N} _.&+-]+$/u;
/** Lengths, numbers, colour functions (incl. `/ alpha`), `inset`, commas. */
const SHADOW = /^[a-z0-9 #(),.%+\-/]+$/i;
/** The only functions a shadow may call: colours. */
export const SHADOW_FUNCTIONS: ReadonlySet<string> = new Set([
  "rgb",
  "rgba",
  "hsl",
  "hsla",
  "oklch",
  "oklab",
  "lab",
  "lch",
  "color",
  "color-mix",
]);
/** Every `name(` in a value; an empty name is a bare parenthesis. */
const FUNCTION_CALL = /([a-z-]*)\s*\(/gi;

class TokenError extends Error {
  constructor(path: string, problem: string) {
    super(`Invalid design system tokens: ${path} ${problem}`);
  }
}

type Obj = Record<string, unknown>;

function object(value: unknown, path: string, keys: readonly string[], optional: readonly string[] = []): Obj {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TokenError(path, "must be an object");
  const o = value as Obj;
  for (const k of Object.keys(o)) {
    if (!keys.includes(k) && !optional.includes(k)) throw new TokenError(`${path}.${k}`, "is not a known key");
  }
  for (const k of keys) if (o[k] === undefined) throw new TokenError(`${path}.${k}`, "is missing");
  return o;
}

/** `#rrggbb`, either case. */
export function isHexColor(value: unknown): value is string {
  return typeof value === "string" && HEX.test(value);
}

function hex(value: unknown, path: string): string {
  if (!isHexColor(value)) throw new TokenError(path, "must be a #rrggbb colour");
  return value.toLowerCase();
}

function remValue(value: unknown, path: string, max = 100): string {
  if (typeof value !== "string" || !REM.test(value) || parseFloat(value) > max) {
    throw new TokenError(path, `must be a rem length up to ${max}rem, e.g. "1.25rem"`);
  }
  return value;
}

function num(value: unknown, path: string, min: number, max: number, integer = false): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
    throw new TokenError(path, `must be ${integer ? "an integer" : "a number"} from ${min} to ${max}`);
  }
  return value;
}

export function isValidFontName(value: unknown): value is string {
  return typeof value === "string" && value.length <= MAX_FONT_NAME && value.trim() === value && FONT_NAME.test(value);
}

function fontName(value: unknown, path: string): string {
  if (!isValidFontName(value)) {
    throw new TokenError(path, `must be a family name of up to ${MAX_FONT_NAME} letters, digits, spaces or - _ . & +`);
  }
  return value;
}

export function isValidShadow(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= MAX_SHADOW &&
    value.trim() === value &&
    SHADOW.test(value) &&
    // `/` only as an alpha separator, never a comment.
    !value.includes("/*") &&
    [...value.matchAll(FUNCTION_CALL)].every((m) => SHADOW_FUNCTIONS.has(m[1]!.toLowerCase()))
  );
}

function scale(value: unknown, path: string): ColorScale {
  const o = object(value, path, SHADE_STEPS);
  return Object.fromEntries(SHADE_STEPS.map((s) => [s, hex(o[s], `${path}.${s}`)])) as ColorScale;
}

/** The tokens, rebuilt from known keys only; throws an Error naming the first bad field. */
export function validateTokens(input: unknown): DesignSystemTokens {
  const t = object(input, "tokens", ["version", "mode", "colors", "typography", "spacing", "radius", "shadow"]);
  if (t.version !== 1) throw new TokenError("tokens.version", "must be 1");
  if (t.mode !== "light" && t.mode !== "dark") throw new TokenError("tokens.mode", 'must be "light" or "dark"');

  const c = object(t.colors, "colors", ["background", "surface", "border", "text", "textMuted", "primary"], ["secondary"]);
  const colors: DesignSystemTokens["colors"] = {
    background: hex(c.background, "colors.background"),
    surface: hex(c.surface, "colors.surface"),
    border: hex(c.border, "colors.border"),
    text: hex(c.text, "colors.text"),
    textMuted: hex(c.textMuted, "colors.textMuted"),
    primary: scale(c.primary, "colors.primary"),
  };
  if (c.secondary !== undefined) colors.secondary = scale(c.secondary, "colors.secondary");

  const ty = object(t.typography, "typography", [
    "fontHeading",
    "fontBody",
    "ratio",
    "baseSize",
    "scale",
    "headingWeight",
    "bodyWeight",
    "headingLineHeight",
    "bodyLineHeight",
  ]);
  const typeScale = object(ty.scale, "typography.scale", TYPE_STEPS);
  const typography: DesignSystemTokens["typography"] = {
    fontHeading: fontName(ty.fontHeading, "typography.fontHeading"),
    fontBody: fontName(ty.fontBody, "typography.fontBody"),
    ratio: num(ty.ratio, "typography.ratio", 1, 2),
    baseSize: num(ty.baseSize, "typography.baseSize", 12, 32),
    scale: Object.fromEntries(
      TYPE_STEPS.map((s) => [s, remValue(typeScale[s], `typography.scale.${s}`, 20)])
    ) as DesignSystemTokens["typography"]["scale"],
    headingWeight: num(ty.headingWeight, "typography.headingWeight", 1, 1000, true),
    bodyWeight: num(ty.bodyWeight, "typography.bodyWeight", 1, 1000, true),
    headingLineHeight: num(ty.headingLineHeight, "typography.headingLineHeight", 0.5, 3),
    bodyLineHeight: num(ty.bodyLineHeight, "typography.bodyLineHeight", 0.5, 3),
  };

  const sp = object(t.spacing, "spacing", ["base", "scale"]);
  if (sp.base !== 4 && sp.base !== 8) throw new TokenError("spacing.base", "must be 4 or 8");
  const spScale = object(sp.scale, "spacing.scale", SPACING_KEYS);
  const spacing: DesignSystemTokens["spacing"] = {
    base: sp.base,
    scale: Object.fromEntries(SPACING_KEYS.map((k) => [k, remValue(spScale[k], `spacing.scale.${k}`, 50)])),
  };

  const r = object(t.radius, "radius", ["sm", "md", "lg", "full"]);
  if (r.full !== "9999px") throw new TokenError("radius.full", 'must be "9999px"');
  const radius = {
    sm: remValue(r.sm, "radius.sm", 10),
    md: remValue(r.md, "radius.md", 10),
    lg: remValue(r.lg, "radius.lg", 20),
    full: "9999px",
  };

  const sh = object(t.shadow, "shadow", [], ["sm", "md", "lg"]);
  const shadow: DesignSystemTokens["shadow"] = {};
  for (const k of ["sm", "md", "lg"] as const) {
    if (sh[k] === undefined) continue;
    if (!isValidShadow(sh[k])) {
      throw new TokenError(`shadow.${k}`, `must be a box-shadow of up to ${MAX_SHADOW} characters without ; { } quotes or comments, calling only colour functions`);
    }
    shadow[k] = sh[k];
  }

  return { version: 1, mode: t.mode, colors, typography, spacing, radius, shadow };
}
