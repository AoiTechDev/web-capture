/**
 * Design system exports (spec 6.5): CSS custom properties, a Tailwind v4
 * `@theme` block and W3C Design Tokens JSON (`$value` / `$type`).
 *
 * Pure TS with relative imports only, so the chrome-extension vitest suite can
 * test it. Every value is checked against a strict shape before it is written:
 * the tokens can be edited in the browser, and an export must never carry a
 * value that breaks out of its declaration. Font names are always written as
 * escaped CSS strings (see fonts.ts).
 */
import { parseCssColor, rgbToHex } from "../../../../../packages/backend/convex/lib/color";
import {
  SHADE_STEPS,
  TYPE_STEPS,
  type ColorScale,
  type DesignSystemTokens,
} from "../../../../../packages/backend/convex/lib/design_system/types";
import { isHexColor, isValidShadow } from "../../../../../packages/backend/convex/lib/design_system/validate";
import { familyName, fontStack } from "./fonts";

/** Lengths the exports write: 0, or a number in rem, px or em. */
const LENGTH_RE = /^(?:0|\d+(?:\.\d+)?(?:rem|px|em))$/;

export function safeHex(v: unknown): string | null {
  return isHexColor(v) ? v.toLowerCase() : null;
}

export function safeLength(v: unknown): string | null {
  return typeof v === "string" && LENGTH_RE.test(v.trim()) ? v.trim() : null;
}

/** A box-shadow the backend's validator accepts (no `;{}<>"'\`, comments, url() or var()). */
export function safeShadow(v: unknown): string | null {
  return isValidShadow(v) && v.length > 0 ? v : null;
}

function safeNumber(v: unknown, min: number, max: number): number | null {
  return typeof v === "number" && Number.isFinite(v) && v >= min && v <= max ? v : null;
}

/** `textMuted` -> `text-muted` */
function kebab(s: string): string {
  return s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}

const BASE_COLORS = ["background", "surface", "border", "text", "textMuted"] as const;
const SHADOW_STEPS = ["sm", "md", "lg"] as const;
const RADIUS_STEPS = ["sm", "md", "lg", "full"] as const;

/**
 * Spacing steps in numeric order. validateTokens only admits the integer
 * SPACING_KEYS, so any other key is dropped rather than escaped.
 */
function spacingEntries(tokens: DesignSystemTokens): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const [k, v] of Object.entries(tokens.spacing.scale ?? {})) {
    const value = safeLength(v);
    if (/^[0-9]+$/.test(k) && value) out.push([k, value]);
  }
  return out.sort((a, b) => Number(a[0]) - Number(b[0]));
}

type Decl = [name: string, value: string];
type Section = { comment: string; notes?: string[]; decls: Decl[] };

function scaleDecls(prefix: string, scale: ColorScale | undefined): Decl[] {
  if (!scale) return [];
  const out: Decl[] = [];
  for (const step of SHADE_STEPS) {
    const hex = safeHex(scale[step]);
    if (hex) out.push([`${prefix}-${step}`, hex]);
  }
  return out;
}

/**
 * Tailwind v4 turns `--font-weight-<name>` into the `font-<name>` utility, the
 * same name `--font-<name>` gives the family utility. So in @theme the weights
 * carry a `-weight` suffix: `font-heading` sets the family and
 * `font-heading-weight` the weight. The plain CSS export has no utilities and
 * keeps `--font-weight-heading`.
 */
export const TAILWIND_WEIGHT_SUFFIX = "-weight";

/** The sections both CSS flavours share; `flavor` picks the variable names. */
function sections(tokens: DesignSystemTokens, flavor: "css" | "tailwind"): Section[] {
  const tw = flavor === "tailwind";
  const t = tokens.typography;
  const colors: Decl[] = [];
  for (const key of BASE_COLORS) {
    const hex = safeHex(tokens.colors[key]);
    if (hex) colors.push([`--color-${kebab(key)}`, hex]);
  }
  colors.push(...scaleDecls("--color-primary", tokens.colors.primary));
  colors.push(...scaleDecls("--color-secondary", tokens.colors.secondary));

  const typography: Decl[] = [
    ["--font-heading", fontStack(t.fontHeading)],
    ["--font-body", fontStack(t.fontBody)],
  ];
  const weight = (role: string) => `--font-weight-${role}${tw ? TAILWIND_WEIGHT_SUFFIX : ""}`;
  const hw = safeNumber(t.headingWeight, 1, 1000);
  const bw = safeNumber(t.bodyWeight, 1, 1000);
  if (hw !== null) typography.push([weight("heading"), String(hw)]);
  if (bw !== null) typography.push([weight("body"), String(bw)]);
  // Tailwind v4 keeps line heights under --leading-*.
  const lh = tw ? "--leading" : "--line-height";
  const hlh = safeNumber(t.headingLineHeight, 0, 10);
  const blh = safeNumber(t.bodyLineHeight, 0, 10);
  if (hlh !== null) typography.push([`${lh}-heading`, String(hlh)]);
  if (blh !== null) typography.push([`${lh}-body`, String(blh)]);
  for (const step of TYPE_STEPS) {
    const size = safeLength(t.scale?.[step]);
    if (size) typography.push([`--text-${step}`, size]);
  }

  const spacing: Decl[] = [];
  const spacingNotes: string[] = [];
  const entries = spacingEntries(tokens);
  if (tw) {
    // Tailwind v4 derives every spacing utility from one --spacing unit
    // (p-4 = 4 x --spacing); explicit --spacing-* values pin our steps.
    const one = entries.find(([k]) => k === "1")?.[1] ?? `${tokens.spacing.base === 8 ? 0.5 : 0.25}rem`;
    spacing.push(["--spacing", one]);
    if (tokens.spacing.base === 8) {
      spacingNotes.push(
        "8px base: --spacing is 0.5rem, which doubles every numeric sizing utility",
        "(p-4, gap-2, w-16, h-8, ...) compared with Tailwind's default 0.25rem."
      );
    }
  }
  const spacePrefix = tw ? "--spacing" : "--space";
  for (const [k, v] of entries) spacing.push([`${spacePrefix}-${k}`, v]);

  const radius: Decl[] = [];
  for (const step of RADIUS_STEPS) {
    const v = safeLength(tokens.radius[step]);
    if (v) radius.push([`--radius-${step}`, v]);
  }

  const shadow: Decl[] = [];
  for (const step of SHADOW_STEPS) {
    const v = safeShadow(tokens.shadow?.[step]);
    if (v) shadow.push([`--shadow-${step}`, v]);
  }

  const typographyNotes =
    tw && (hw !== null || bw !== null)
      ? ["Weights end in -weight so font-heading (family) and font-heading-weight don't collide."]
      : undefined;

  const all: Section[] = [
    { comment: "Colours", decls: colors },
    { comment: "Typography", notes: typographyNotes, decls: typography },
    { comment: "Spacing", notes: spacingNotes.length ? spacingNotes : undefined, decls: spacing },
    { comment: "Radius", decls: radius },
    { comment: "Shadows", decls: shadow },
  ];
  return all.filter((s) => s.decls.length > 0);
}

function headerComment(tokens: DesignSystemTokens): string {
  const t = tokens.typography;
  const mode = tokens.mode === "dark" ? "dark" : "light";
  const ratio = safeNumber(t.ratio, 1, 3) ?? "?";
  const base = safeNumber(t.baseSize, 1, 100) ?? "?";
  const space = tokens.spacing.base === 8 ? 8 : 4;
  return `/* Design system (${mode}) - type ratio ${ratio}, base ${base}px, spacing base ${space}px */`;
}

function block(selector: string, body: Section[], extra: string[] = []): string {
  const lines: string[] = [`${selector} {`, ...extra.map((l) => `  ${l}`)];
  body.forEach((s, i) => {
    if (i > 0 || extra.length > 0) lines.push("");
    lines.push(`  /* ${s.comment} */`);
    // Notes are fixed strings from this module, never token values.
    for (const note of s.notes ?? []) lines.push(`  /* ${note} */`);
    for (const [n, v] of s.decls) lines.push(`  ${n}: ${v};`);
  });
  lines.push("}");
  return lines.join("\n");
}

/** `:root { --color-background: ...; --font-heading: "Inter", ...; ... }` */
export function toCssVariables(tokens: DesignSystemTokens): string {
  const scheme = tokens.mode === "dark" ? "dark" : "light";
  return `${headerComment(tokens)}\n${block(":root", sections(tokens, "css"), [`color-scheme: ${scheme};`])}\n`;
}

/** Tailwind v4: `@import "tailwindcss"; @theme { ... }` */
export function toTailwindTheme(tokens: DesignSystemTokens): string {
  return `@import "tailwindcss";\n\n${headerComment(tokens)}\n${block("@theme", sections(tokens, "tailwind"))}\n`;
}

// ---------------------------------------------------------------------------
// W3C Design Tokens, draft format (hex colours, "1rem" dimension strings), the
// form Style Dictionary and Tokens Studio read. Stated in $extensions.
// ---------------------------------------------------------------------------

/** Vendor key for this app's $extensions. */
export const DTCG_EXTENSION = "app.moodbase";
export const DTCG_FORMAT = "dtcg-draft";

type Token = { $value: unknown; $type: string };
type Group = { [key: string]: Token | Group | unknown };

function tok($value: unknown, $type: string): Token {
  return { $value, $type };
}

/**
 * A DTCG draft dimension (px or rem only), or null. `em` depends on the
 * element's font size, so it can't be converted and is skipped.
 */
export function dtcgDimension(v: string): string | null {
  if (v === "0" || v === "-0") return "0px";
  return /^-?\d*\.?\d+(?:px|rem)$/.test(v) ? v : null;
}

/** Split on commas / whitespace that sit outside parentheses. */
function splitTop(s: string, sep: RegExp): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    if (ch === ")") depth = Math.max(0, depth - 1);
    if (depth === 0 && sep.test(ch)) {
      if (cur.trim()) out.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** A CSS colour as DTCG draft hex (`#rrggbbaa` when translucent), via the backend's parser. */
export function cssColorToHex(c: string): string | null {
  const rgba = parseCssColor(c, 0);
  if (!rgba) return null;
  const hex = rgbToHex([rgba.r, rgba.g, rgba.b]);
  if (rgba.a >= 1) return hex;
  return `${hex}${Math.round(rgba.a * 255).toString(16).padStart(2, "0")}`;
}

/** One CSS box-shadow -> DTCG shadow value(s), or null if it can't be read. */
export function parseShadow(css: string): Record<string, unknown> | Array<Record<string, unknown>> | null {
  const parsed: Array<Record<string, unknown>> = [];
  for (const layer of splitTop(css, /,/)) {
    let inset = false;
    let color: string | null = null;
    const lengths: string[] = [];
    for (const p of splitTop(layer, /\s/)) {
      const dim = dtcgDimension(p);
      if (p === "inset") inset = true;
      else if (dim) lengths.push(dim);
      else if (color === null) {
        color = cssColorToHex(p);
        if (color === null) return null;
      } else return null;
    }
    if (lengths.length < 2 || lengths.length > 4) return null;
    const value: Record<string, unknown> = {
      color: color ?? "#000000",
      offsetX: lengths[0],
      offsetY: lengths[1],
      blur: lengths[2] ?? "0px",
      spread: lengths[3] ?? "0px",
    };
    if (inset) value.inset = true;
    parsed.push(value);
  }
  if (parsed.length === 0) return null;
  return parsed.length === 1 ? parsed[0] : parsed;
}

function scaleGroup(scale: ColorScale | undefined): Group | null {
  if (!scale) return null;
  const g: Group = {};
  for (const step of SHADE_STEPS) {
    const hex = safeHex(scale[step]);
    if (hex) g[step] = tok(hex, "color");
  }
  return Object.keys(g).length > 0 ? g : null;
}

/** The tokens as a W3C Design Tokens object (see toDesignTokensJson). */
export function toDesignTokens(tokens: DesignSystemTokens): Group {
  const t = tokens.typography;
  const skipped: string[] = [];

  /** A dimension token, or a note in $extensions when it can't be one. */
  const dimension = (group: Group, key: string, path: string, raw: unknown) => {
    const v = safeLength(raw);
    if (!v) return;
    const dim = dtcgDimension(v);
    if (dim) group[key] = tok(dim, "dimension");
    else skipped.push(`${path}: ${v} is not a px or rem dimension`);
  };

  const color: Group = {};
  for (const key of BASE_COLORS) {
    const hex = safeHex(tokens.colors[key]);
    if (hex) color[key] = tok(hex, "color");
  }
  const primary = scaleGroup(tokens.colors.primary);
  const secondary = scaleGroup(tokens.colors.secondary);
  if (primary) color.primary = primary;
  if (secondary) color.secondary = secondary;

  const font: Group = {
    heading: tok(familyName(t.fontHeading), "fontFamily"),
    body: tok(familyName(t.fontBody), "fontFamily"),
  };
  const fontWeight: Group = {};
  const hw = safeNumber(t.headingWeight, 1, 1000);
  const bw = safeNumber(t.bodyWeight, 1, 1000);
  if (hw !== null) fontWeight.heading = tok(hw, "fontWeight");
  if (bw !== null) fontWeight.body = tok(bw, "fontWeight");
  const lineHeight: Group = {};
  const hlh = safeNumber(t.headingLineHeight, 0, 10);
  const blh = safeNumber(t.bodyLineHeight, 0, 10);
  if (hlh !== null) lineHeight.heading = tok(hlh, "number");
  if (blh !== null) lineHeight.body = tok(blh, "number");
  const fontSize: Group = {};
  for (const step of TYPE_STEPS) dimension(fontSize, step, `fontSize.${step}`, t.scale?.[step]);

  const spacing: Group = {};
  for (const [k, v] of spacingEntries(tokens)) dimension(spacing, k, `spacing.${k}`, v);

  const radius: Group = {};
  for (const step of RADIUS_STEPS) dimension(radius, step, `radius.${step}`, tokens.radius[step]);

  const shadow: Group = {};
  for (const step of SHADOW_STEPS) {
    const css = safeShadow(tokens.shadow?.[step]);
    if (!css) continue;
    const value = parseShadow(css);
    if (value) shadow[step] = tok(value, "shadow");
    else skipped.push(`shadow.${step}: could not be converted to a DTCG shadow (${css})`);
  }

  const meta: Record<string, unknown> = {
    format: DTCG_FORMAT,
    version: 1,
    mode: tokens.mode === "dark" ? "dark" : "light",
    typeRatio: safeNumber(t.ratio, 1, 3),
    baseSize: safeNumber(t.baseSize, 1, 100),
    spacingBase: tokens.spacing.base === 8 ? 8 : 4,
  };
  if (skipped.length) meta.skipped = skipped;

  const out: Group = {
    $description: "Design system tokens (W3C Design Tokens, draft format)",
    $extensions: { [DTCG_EXTENSION]: meta },
    color,
    font,
  };
  if (Object.keys(fontWeight).length) out.fontWeight = fontWeight;
  if (Object.keys(lineHeight).length) out.lineHeight = lineHeight;
  if (Object.keys(fontSize).length) out.fontSize = fontSize;
  if (Object.keys(spacing).length) out.spacing = spacing;
  if (Object.keys(radius).length) out.radius = radius;
  if (Object.keys(shadow).length) out.shadow = shadow;
  return out;
}

export function toDesignTokensJson(tokens: DesignSystemTokens): string {
  return `${JSON.stringify(toDesignTokens(tokens), null, 2)}\n`;
}

export type ExportFormat = "css" | "tailwind" | "json";

export const EXPORT_FORMATS: ReadonlyArray<{
  id: ExportFormat;
  label: string;
  filename: string;
  mime: string;
  build: (t: DesignSystemTokens) => string;
}> = [
  { id: "css", label: "CSS variables", filename: "design-system.css", mime: "text/css", build: toCssVariables },
  { id: "tailwind", label: "Tailwind v4", filename: "design-system.tailwind.css", mime: "text/css", build: toTailwindTheme },
  { id: "json", label: "Design Tokens JSON", filename: "design-tokens.json", mime: "application/json", build: toDesignTokensJson },
];
