/**
 * Stage 1 typography (spec 6.5): font families, the type scale's ratio, and
 * weights and line heights. Pure and deterministic.
 */

import { TYPE_STEP_EXPONENT, buildTypeScale, clamp } from "./builders";
import { TYPE_RATIOS, type DesignSystemTokens } from "./types";
import { MAX_FONT_NAME, isValidFontName } from "./validate";

/** One font entry of one capture's DNA. */
export type SourceFont = {
  family: string;
  generic: boolean;
  /** px */
  size: number;
  fontWeight: number;
  /** px, null when `normal` */
  lineHeight: number | null;
  weight: number;
};

export const BASE_SIZE = 16;
export const FALLBACK_FONT = "Inter";
export const HEADING_MIN_SIZE = 24;
export const BODY_SIZES = [14, 18] as const;

type Entry = SourceFont & { family: string };

/**
 * A family name safe to store and export: the first name of a stack, cut
 * at any `;`, `{`, `}`, `<` or `>`, unquoted, with anything else outside
 * the allowed characters dropped. Null when
 * nothing usable is left.
 */
export function cleanFamily(raw: string): string | null {
  // A stack or anything that would end a CSS value cuts the name short.
  const first = raw.split(/[,;{}<>]/)[0] ?? "";
  const name = first
    .replace(/["'\\]/g, "")
    .replace(/[^\p{L}\p{N} _.&+-]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_FONT_NAME)
    .trim();
  return isValidFontName(name) ? name : null;
}

/** The value where the cumulative weight first reaches half. */
export function weightedMedian(items: { value: number; weight: number }[]): number | null {
  const sorted = items.filter((x) => x.weight > 0 && Number.isFinite(x.value)).sort((a, b) => a.value - b.value);
  const total = sorted.reduce((s, x) => s + x.weight, 0);
  if (total <= 0) return null;
  let acc = 0;
  for (const x of sorted) {
    acc += x.weight;
    if (acc >= total / 2) return x.value;
  }
  return sorted[sorted.length - 1]!.value;
}

/** Heaviest family among `entries` (case-insensitive; the heaviest spelling wins). */
function topFamily(entries: Entry[]): string | null {
  const byKey = new Map<string, { total: number; spellings: Map<string, number> }>();
  for (const e of entries) {
    const key = e.family.toLowerCase();
    const hit = byKey.get(key) ?? { total: 0, spellings: new Map<string, number>() };
    hit.total += e.weight;
    hit.spellings.set(e.family, (hit.spellings.get(e.family) ?? 0) + e.weight);
    byKey.set(key, hit);
  }
  const best = [...byKey.entries()].sort((a, b) => b[1].total - a[1].total || (a[0] < b[0] ? -1 : 1))[0];
  if (!best) return null;
  return [...best[1].spellings].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]![0];
}

const MIN_EXPONENT = Math.min(...Object.values(TYPE_STEP_EXPONENT));
const MAX_EXPONENT = Math.max(...Object.values(TYPE_STEP_EXPONENT));

/**
 * The ratio from TYPE_RATIOS whose xs…5xl scale (base 16px) the sizes sit
 * closest to. A size's error is its distance to the nearest step, measured
 * in steps of that ratio (log distance / log ratio) so a finer ratio does not
 * win just by having more steps; sizes beyond xs or 5xl count their distance
 * to that end, capped at one step. Ties go to the earlier ratio. Null
 * without sizes.
 */
export function fitRatio(sizes: { value: number; weight: number }[], base = BASE_SIZE): { ratio: number; error: number } | null {
  const valid = sizes.filter((s) => s.value > 0 && s.weight > 0 && Number.isFinite(s.value));
  const total = valid.reduce((s, x) => s + x.weight, 0);
  if (total <= 0) return null;
  let best: { ratio: number; error: number } | null = null;
  for (const ratio of TYPE_RATIOS) {
    let err = 0;
    for (const s of valid) {
      const steps = Math.log(s.value / base) / Math.log(ratio);
      const nearest = Math.min(MAX_EXPONENT, Math.max(MIN_EXPONENT, Math.round(steps)));
      err += s.weight * Math.min(1, Math.abs(steps - nearest));
    }
    const error = err / total;
    if (!best || error < best.error - 1e-9) best = { ratio, error };
  }
  return best;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function deriveTypography(captures: SourceFont[][]): { typography: DesignSystemTokens["typography"]; notes: string[] } {
  const notes: string[] = [];
  const valid = captures
    .map((list) => list.filter((f) => f.weight > 0 && f.size > 0 && Number.isFinite(f.size) && Number.isFinite(f.weight)))
    .filter((list) => list.length > 0);
  // Every capture counts the same.
  const all: Entry[] = valid.flatMap((list) => {
    const total = list.reduce((s, f) => s + f.weight, 0);
    return list.map((f) => ({ ...f, weight: f.weight / total / valid.length }));
  });
  const named = all.flatMap((e) => {
    const family = e.generic ? null : cleanFamily(e.family);
    return family ? [{ ...e, family }] : [];
  });
  const isHeading = (e: Entry) => e.size >= HEADING_MIN_SIZE;
  const isBody = (e: Entry) => e.size >= BODY_SIZES[0] && e.size <= BODY_SIZES[1];

  let fontHeading = topFamily(named.filter(isHeading));
  let fontBody = topFamily(named.filter(isBody));
  if (!fontHeading && !fontBody) {
    const any = topFamily(named);
    fontHeading = fontBody = any ?? FALLBACK_FONT;
    notes.push(any ? "No named fonts at heading or body sizes; used the most common one for both" : `No named fonts captured; using ${FALLBACK_FONT}`);
  } else if (!fontHeading) {
    fontHeading = fontBody;
    notes.push(`No named font at ${HEADING_MIN_SIZE}px or more; headings use the body font`);
  } else if (!fontBody) {
    fontBody = fontHeading;
    notes.push(`No named font at ${BODY_SIZES[0]}–${BODY_SIZES[1]}px; body text uses the heading font`);
  }

  const fit = fitRatio(all.map((e) => ({ value: e.size, weight: e.weight })));
  const ratio = fit?.ratio ?? 1.25;
  if (!fit) notes.push("No font sizes captured; type scale ratio defaults to 1.25");

  // Weights and line heights come from the chosen family at that size, or any family when it has none.
  const pick = (test: (e: Entry) => boolean, family: string) => {
    const own = named.filter((e) => test(e) && e.family.toLowerCase() === family.toLowerCase());
    return own.length ? own : all.filter(test);
  };
  const headings = pick(isHeading, fontHeading!);
  const body = pick(isBody, fontBody!);
  const weightOf = (list: Entry[], fallback: number) =>
    clamp(Math.round(weightedMedian(list.map((e) => ({ value: e.fontWeight, weight: e.weight }))) ?? fallback), 1, 1000);
  const lineHeightOf = (list: Entry[], fallback: number) => {
    const m = weightedMedian(
      list.filter((e) => e.lineHeight !== null && e.lineHeight > 0).map((e) => ({ value: e.lineHeight! / e.size, weight: e.weight }))
    );
    return round2(clamp(m ?? fallback, 0.9, 2.5));
  };
  if (!headings.length) notes.push("No heading sizes captured; heading weight and line height use defaults");
  const scale = buildTypeScale(BASE_SIZE, ratio);
  notes.push(...scale.notes);

  return {
    typography: {
      fontHeading: fontHeading!,
      fontBody: fontBody!,
      ratio,
      baseSize: BASE_SIZE,
      scale: scale.scale,
      headingWeight: weightOf(headings, 700),
      bodyWeight: weightOf(body, 400),
      headingLineHeight: lineHeightOf(headings, 1.2),
      bodyLineHeight: lineHeightOf(body, 1.5),
    },
    notes,
  };
}
