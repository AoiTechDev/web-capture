/**
 * Font family handling for the design system editor, preview and exports.
 *
 * Pure TS with no imports, so the chrome-extension vitest suite can test it.
 */

/** Characters that may stand unescaped inside a quoted CSS string. */
const CSS_STRING_SAFE = /^[A-Za-z0-9 _.-]$/;

/**
 * Quote `value` as a CSS string. Anything outside a small safe set is written
 * as a CSS hex escape (`\22 ` for a double quote), so no input can close the
 * string, start a comment, end a declaration or a `<style>` element.
 */
export function cssString(value: string): string {
  let out = '"';
  for (const ch of value) {
    if (CSS_STRING_SAFE.test(ch)) {
      out += ch;
    } else {
      const cp = ch.codePointAt(0) ?? 0xfffd;
      // NUL is not allowed even escaped; CSS maps it to U+FFFD anyway.
      out += `\\${(cp === 0 ? 0xfffd : cp).toString(16)} `;
    }
  }
  return `${out}"`;
}

/** Collapse whitespace and trim, the form family names are stored in. */
export function cleanFamilyName(name: string): string {
  return name.replace(/\s+/g, " ").trim();
}

/** Generic fallbacks appended after the chosen family. */
export const FONT_FALLBACK = "system-ui, sans-serif";

/** `"Inter", system-ui, sans-serif`, or just the fallback for an empty name. */
export function fontStack(family: string): string {
  const name = cleanFamilyName(family);
  return name ? `${cssString(name)}, ${FONT_FALLBACK}` : FONT_FALLBACK;
}

/** A handful of common Google Fonts offered as suggestions in the editor. */
export const FONT_SUGGESTIONS = [
  "Inter",
  "Roboto",
  "Open Sans",
  "Lato",
  "Montserrat",
  "Poppins",
  "DM Sans",
  "Space Grotesk",
  "IBM Plex Sans",
  "Source Serif 4",
  "Playfair Display",
  "Merriweather",
  "JetBrains Mono",
] as const;

/** Family names Google Fonts accepts here: letters, digits and single spaces. */
const FAMILY_RE = /^[A-Za-z0-9]+(?: [A-Za-z0-9]+)*$/;
export const MAX_FAMILY_LENGTH = 60;

export function isValidFontFamily(name: unknown): name is string {
  return typeof name === "string" && name.length > 0 && name.length <= MAX_FAMILY_LENGTH && FAMILY_RE.test(name);
}

/** Installed system faces that Google Fonts doesn't serve; never requested. */
const SYSTEM_FAMILIES = new Set(
  [
    "arial",
    "helvetica",
    "helvetica neue",
    "times",
    "times new roman",
    "georgia",
    "verdana",
    "tahoma",
    "trebuchet ms",
    "courier",
    "courier new",
    "segoe ui",
    "sf pro",
    "sf pro text",
    "sf pro display",
    "system ui",
    "sans serif",
    "serif",
    "monospace",
  ].map((s) => s.toLowerCase())
);

export function isSystemFamily(name: string): boolean {
  return SYSTEM_FAMILIES.has(cleanFamilyName(name).toLowerCase());
}

/** Whole-hundred weights 100-900, deduplicated and sorted. */
export function normalizeWeights(weights: readonly number[]): number[] {
  const ok = weights.filter((w) => Number.isInteger(w) && w >= 100 && w <= 900 && w % 100 === 0);
  return [...new Set(ok)].sort((a, b) => a - b);
}

/**
 * Google Fonts css2 URL for one family, or null when the name fails the strict
 * check (or is a system face). With `weights`, requests just those weights;
 * the caller retries without them if the family lacks one (css2 rejects the
 * whole request then).
 */
export function googleFontsUrl(family: string, weights: readonly number[] = []): string | null {
  if (!isValidFontFamily(family) || isSystemFamily(family)) return null;
  const w = normalizeWeights(weights);
  const axis = w.length > 0 ? `:wght@${w.join(";")}` : "";
  return `https://fonts.googleapis.com/css2?family=${family.replace(/ /g, "+")}${axis}&display=swap`;
}
