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
import {
  SHADE_STEPS,
  TYPE_STEPS,
  type ColorScale,
  type DesignSystemTokens,
} from "../../../../../packages/backend/convex/lib/design_system/types";
import { isValidShadow } from "../../../../../packages/backend/convex/lib/design_system/validate";
import { cleanFamilyName, fontStack } from "./fonts";

const HEX_RE = /^#[0-9a-f]{6}$/i;
const LENGTH_RE = /^(?:0|\d+(?:\.\d+)?(?:rem|px|em))$/;

export function safeHex(v: unknown): string | null {
  return typeof v === "string" && HEX_RE.test(v) ? v.toLowerCase() : null;
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

/** Custom-property suffixes may only be plain identifier characters. */
function safeKey(k: string): string | null {
  const key = k.replace(/\./g, "_");
  return /^[A-Za-z0-9_-]+$/.test(key) ? key : null;
}

/** `textMuted` -> `text-muted` */
function kebab(s: string): string {
  return s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}

const BASE_COLORS = ["background", "surface", "border", "text", "textMuted"] as const;
const SHADOW_STEPS = ["sm", "md", "lg"] as const;
const RADIUS_STEPS = ["sm", "md", "lg", "full"] as const;

/** Spacing keys in numeric order ("0", "1", "2", "3", "4", "6", ...). */
function spacingEntries(tokens: DesignSystemTokens): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const [k, v] of Object.entries(tokens.spacing.scale ?? {})) {
    const key = safeKey(k);
    const value = safeLength(v);
    if (key && value) out.push([key, value]);
  }
  return out.sort((a, b) => Number(a[0].replace("_", ".")) - Number(b[0].replace("_", ".")));
}

type Decl = [name: string, value: string];
type Section = { comment: string; decls: Decl[] };

function scaleDecls(prefix: string, scale: ColorScale | undefined): Decl[] {
  if (!scale) return [];
  const out: Decl[] = [];
  for (const step of SHADE_STEPS) {
    const hex = safeHex(scale[step]);
    if (hex) out.push([`${prefix}-${step}`, hex]);
  }
  return out;
}

/** The sections both CSS flavours share; `flavor` picks the variable names. */
function sections(tokens: DesignSystemTokens, flavor: "css" | "tailwind"): Section[] {
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
  const hw = safeNumber(t.headingWeight, 1, 1000);
  const bw = safeNumber(t.bodyWeight, 1, 1000);
  if (hw !== null) typography.push(["--font-weight-heading", String(hw)]);
  if (bw !== null) typography.push(["--font-weight-body", String(bw)]);
  // Tailwind v4 keeps line heights under --leading-*.
  const lh = flavor === "tailwind" ? "--leading" : "--line-height";
  const hlh = safeNumber(t.headingLineHeight, 0, 10);
  const blh = safeNumber(t.bodyLineHeight, 0, 10);
  if (hlh !== null) typography.push([`${lh}-heading`, String(hlh)]);
  if (blh !== null) typography.push([`${lh}-body`, String(blh)]);
  for (const step of TYPE_STEPS) {
    const size = safeLength(t.scale?.[step]);
    if (size) typography.push([`--text-${step}`, size]);
  }

  const spacing: Decl[] = [];
  const entries = spacingEntries(tokens);
  if (flavor === "tailwind") {
    // Tailwind v4 derives every spacing utility from one --spacing unit
    // (p-4 = 4 x --spacing); explicit --spacing-* values pin our steps.
    const one = entries.find(([k]) => k === "1")?.[1] ?? `${tokens.spacing.base === 8 ? 0.5 : 0.25}rem`;
    spacing.push(["--spacing", one]);
  }
  const spacePrefix = flavor === "tailwind" ? "--spacing" : "--space";
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

  return [
    { comment: "Colours", decls: colors },
    { comment: "Typography", decls: typography },
    { comment: "Spacing", decls: spacing },
    { comment: "Radius", decls: radius },
    { comment: "Shadows", decls: shadow },
  ].filter((s) => s.decls.length > 0);
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
// W3C Design Tokens (DTCG draft format: hex colours, dimension strings)
// ---------------------------------------------------------------------------

type Token = { $value: unknown; $type?: string; $description?: string };
type Group = { [key: string]: Token | Group | unknown };

function tok($value: unknown, $type: string): Token {
  return { $value, $type };
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

function hex2(n: number): string {
  return Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, "0");
}

/** `#rgb`, `#rrggbb(aa)` or `rgb()/rgba()` with numbers -> DTCG hex (8 digits with alpha). */
export function cssColorToHex(c: string): string | null {
  const s = c.trim().toLowerCase();
  if (/^#[0-9a-f]{6}([0-9a-f]{2})?$/.test(s)) return s;
  if (/^#[0-9a-f]{3}$/.test(s)) return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`;
  const m = /^rgba?\(([^)]*)\)$/.exec(s);
  if (!m) return null;
  const parts = m[1].split(/[\s,/]+/).filter(Boolean);
  if (parts.length < 3 || parts.length > 4) return null;
  const rgb = parts.slice(0, 3).map(Number);
  if (rgb.some((n) => !Number.isFinite(n))) return null;
  let a = 1;
  if (parts[3] !== undefined) {
    a = parts[3].endsWith("%") ? Number(parts[3].slice(0, -1)) / 100 : Number(parts[3]);
    if (!Number.isFinite(a)) return null;
  }
  const base = `#${rgb.map(hex2).join("")}`;
  return a >= 1 ? base : `${base}${hex2(a * 255)}`;
}

/** One CSS box-shadow -> DTCG shadow value(s), or null if it can't be read. */
export function parseShadow(css: string): Record<string, unknown> | Array<Record<string, unknown>> | null {
  const layers = splitTop(css, /,/);
  const parsed: Array<Record<string, unknown>> = [];
  for (const layer of layers) {
    const parts = splitTop(layer, /\s/);
    let inset = false;
    let color: string | null = null;
    const lengths: string[] = [];
    for (const p of parts) {
      if (p === "inset") inset = true;
      else if (/^-?(?:0|\d*\.?\d+(?:px|rem|em))$/.test(p)) lengths.push(p === "0" || p === "-0" ? "0px" : p);
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
    heading: tok(cleanFamilyName(t.fontHeading), "fontFamily"),
    body: tok(cleanFamilyName(t.fontBody), "fontFamily"),
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
  for (const step of TYPE_STEPS) {
    const size = safeLength(t.scale?.[step]);
    if (size) fontSize[step] = tok(size === "0" ? "0px" : size, "dimension");
  }

  const spacing: Group = {};
  for (const [k, v] of spacingEntries(tokens)) spacing[k] = tok(v === "0" ? "0px" : v, "dimension");

  const radius: Group = {};
  for (const step of RADIUS_STEPS) {
    const v = safeLength(tokens.radius[step]);
    if (v) radius[step] = tok(v === "0" ? "0px" : v, "dimension");
  }

  const shadow: Group = {};
  for (const step of SHADOW_STEPS) {
    const css = safeShadow(tokens.shadow?.[step]);
    if (!css) continue;
    const value = parseShadow(css);
    // A shadow we can't decompose keeps its CSS text, untyped, rather than vanish.
    shadow[step] = value ? tok(value, "shadow") : { $value: css, $description: "CSS box-shadow" };
  }

  const out: Group = {
    $description: "Design system generated by Web Capture",
    $extensions: {
      "com.webcapture.designSystem": {
        version: 1,
        mode: tokens.mode === "dark" ? "dark" : "light",
        typeRatio: safeNumber(t.ratio, 1, 3),
        baseSize: safeNumber(t.baseSize, 1, 100),
        spacingBase: tokens.spacing.base === 8 ? 8 : 4,
      },
    },
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
