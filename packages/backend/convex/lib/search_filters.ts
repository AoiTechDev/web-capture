/**
 * Validation of the filters `searchCaptures` and `browseCaptures` share, the
 * colour filter's maths, and the opaque page cursors. Pure: no Convex
 * imports, so it is unit-testable on its own.
 */
import { deltaE2000, type Lab } from "./color";

export const FILTER_LIMITS = {
  /** Results per page when the caller does not say. */
  defaultLimit: 30,
  maxLimit: 100,
  /** Raw `kinds` / `aiCategories` entries accepted (before de-duplication). */
  maxListEntries: 32,
  /** ΔE2000. Spec 6.4 said 15 in CIE76; ΔE2000 runs smaller for the same pair. */
  defaultColorTolerance: 10,
  minColorTolerance: 1,
  maxColorTolerance: 50,
  /** A colour must cover more than this share of a capture to count. */
  minColorWeight: 0.05,
  /** Deepest offset a search cursor may ask for; fused lists are far shorter. */
  maxSearchOffset: 10_000,
  maxCursorChars: 200,
} as const;

/** Filters as a client sends them. */
export type RawFilters<S extends string = string> = {
  sessionId?: S;
  kinds?: string[];
  aiCategories?: string[];
  color?: string;
  colorTolerance?: number;
  dateFrom?: number;
  dateTo?: number;
};

/** Filters after validation. Absent means "no filter"; every present one must hold (AND). */
export type SearchFilters<S extends string = string> = {
  sessionId?: S;
  kinds?: string[];
  aiCategories?: string[];
  /** "#rrggbb", lowercase. */
  color?: string;
  /** ΔE2000, clamped to [minColorTolerance, maxColorTolerance]. */
  colorTolerance: number;
  /** Inclusive bounds on the capture's creation time (`_creationTime`, ms). */
  dateFrom?: number;
  dateTo?: number;
};

const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

function uniqueList(list: string[] | undefined, what: string): string[] | undefined {
  if (list === undefined) return undefined;
  if (list.length > FILTER_LIMITS.maxListEntries) {
    throw new Error(`${what} has more than ${FILTER_LIMITS.maxListEntries} entries`);
  }
  const out = Array.from(new Set(list));
  return out.length ? out : undefined;
}

function dateBound(x: number | undefined, what: string): number | undefined {
  if (x === undefined) return undefined;
  if (!Number.isFinite(x) || x < 0) throw new Error(`${what} must be a non-negative time in ms`);
  return x;
}

/** "#abc" or "#aabbcc" (any case) to "#aabbcc"; throws on anything else. */
export function normalizeHex(input: string): string {
  const m = input.trim().match(HEX_RE);
  if (!m) throw new Error("color must be a hex colour like #1a2b3c");
  const h = m[1]!.toLowerCase();
  return `#${h.length === 3 ? h.split("").map((c) => c + c).join("") : h}`;
}

/**
 * Check and normalise filters. Throws on malformed input (bad hex, non-finite
 * numbers, dateFrom after dateTo, oversized lists); clamps the tolerance.
 * Empty lists mean no filter, as they always have for `kinds`.
 */
export function normalizeFilters<S extends string>(raw: RawFilters<S>): SearchFilters<S> {
  const kinds = uniqueList(raw.kinds, "kinds");
  const categories = uniqueList(raw.aiCategories, "aiCategories");
  const dateFrom = dateBound(raw.dateFrom, "dateFrom");
  const dateTo = dateBound(raw.dateTo, "dateTo");
  if (dateFrom !== undefined && dateTo !== undefined && dateFrom > dateTo) {
    throw new Error("dateFrom must not be after dateTo");
  }
  let colorTolerance: number = FILTER_LIMITS.defaultColorTolerance;
  if (raw.colorTolerance !== undefined) {
    if (!Number.isFinite(raw.colorTolerance)) throw new Error("colorTolerance must be a finite number");
    colorTolerance = Math.min(
      FILTER_LIMITS.maxColorTolerance,
      Math.max(FILTER_LIMITS.minColorTolerance, raw.colorTolerance)
    );
  }
  return {
    ...(raw.sessionId !== undefined ? { sessionId: raw.sessionId } : {}),
    ...(kinds ? { kinds } : {}),
    ...(categories ? { aiCategories: categories } : {}),
    ...(raw.color !== undefined ? { color: normalizeHex(raw.color) } : {}),
    colorTolerance,
    ...(dateFrom !== undefined ? { dateFrom } : {}),
    ...(dateTo !== undefined ? { dateTo } : {}),
  };
}

/** Page size, clamped to 1..maxLimit (fractions rounded down). */
export function clampLimit(limit: number | undefined): number {
  if (limit === undefined) return FILTER_LIMITS.defaultLimit;
  if (!Number.isFinite(limit)) throw new Error("limit must be a finite number");
  return Math.max(1, Math.min(FILTER_LIMITS.maxLimit, Math.floor(limit)));
}

/* ---------- colour ---------- */

/**
 * Largest CIEDE2000 lightness weight S_L over L-bar in [0, 100]: 1.747 at
 * L-bar = 0 or 100, rounded up.
 */
const MAX_SL = 1.75;
/** Refinement steps of each side of the L band; the third barely moves it. */
const BAND_STEPS = 3;
/** Floating-point slack, so rounding in deltaE2000 can never put a match outside the band. */
const BAND_SLACK = 1e-9;

/** CIEDE2000's lightness weight S_L at mean lightness `lbar`; grows with |lbar - 50|. */
export function lightnessWeight(lbar: number): number {
  const d2 = (lbar - 50) ** 2;
  return 1 + (0.015 * d2) / Math.sqrt(20 + d2);
}

/**
 * The L range a colour within `tolerance` (ΔE2000) of a target with
 * lightness `targetL` can lie in, for the by_user_significant_l index range.
 *
 * Why it never drops a match. ΔE² = (ΔL/S_L)² + Q, where Q = x² + y² +
 * R_T·x·y with x = ΔC/S_C, y = ΔH/S_H and |R_T| <= 2, so Q >= (|x|-|y|)² >= 0.
 * Hence a match (ΔE < tol) at distance d = |L - targetL| has
 *   d < tol · S_L(L-bar),  L-bar = targetL ± d/2 (the pair's mean lightness).   (1)
 * Take one side, say L above the target. B0 = tol · MAX_SL bounds d, as
 * S_L <= MAX_SL. If every match has d <= B, then by (1) every match has
 *   d < tol · max{ S_L(x) : x in [targetL, targetL + B/2] }  =: B'.
 * S_L depends only on |x - 50| and grows with it, so that maximum is at one
 * of the two ends: B' = tol · max(S_L(targetL), S_L(targetL + B/2)). So B'
 * is again a bound, and B' <= B (the interval only shrinks). Iterating keeps
 * a valid bound that tightens towards the true one. Taking S_L at the band's
 * mid-point alone would not be safe: moving towards L = 50, S_L falls along
 * the way, and its value there would undercut matches close to the target.
 * The other side is the same with targetL - B/2. Intervals reaching past
 * 0 or 100 only overstate S_L, so the bound holds there too.
 *
 * At L = 50 and tolerance 10 this is ±10.6 rather than ±17.5.
 */
export function lightnessRange(targetL: number, tolerance: number): [number, number] {
  const side = (dir: 1 | -1) => {
    let band = tolerance * MAX_SL;
    for (let i = 0; i < BAND_STEPS; i++) {
      const sl = Math.max(lightnessWeight(targetL), lightnessWeight(targetL + (dir * band) / 2));
      band = Math.min(band, tolerance * sl);
    }
    return band * (1 + BAND_SLACK) + BAND_SLACK;
  };
  return [targetL - side(-1), targetL + side(1)];
}

/**
 * Whether a captureColors row with this weight can ever match a colour
 * filter; stored on the row as `significant`, so the filter's index range
 * skips the rest.
 */
export function isSignificantColor(weight: number): boolean {
  return weight > FILTER_LIMITS.minColorWeight;
}

/** Whether one captureColors row satisfies the colour filter. */
export function colorRowMatches(
  target: Lab,
  row: { l: number; a: number; b: number; weight: number },
  tolerance: number
): boolean {
  return isSignificantColor(row.weight) && deltaE2000(target, [row.l, row.a, row.b]) < tolerance;
}

/* ---------- cursors ---------- */

/**
 * Browse position: the last capture examined, newest first. `t` alone would
 * do if creation times never tied; `id` settles ties.
 */
export type BrowseCursor = { t: number; id: string };

const ID_RE = /^[A-Za-z0-9_;]{1,64}$/;
/** A non-negative integer with no sign, exponent or leading zeros. */
const INT_RE = /^(0|[1-9][0-9]{0,15})$/;
/** A creation time as String(number) writes one: integer part and optional decimals. */
const TIME_RE = /^(0|[1-9][0-9]{0,15})(\.[0-9]{1,12})?$/;

function checkCursor(cursor: string): string[] {
  if (cursor.length > FILTER_LIMITS.maxCursorChars) throw new Error("Invalid cursor");
  return cursor.split("|");
}

export function encodeBrowseCursor(c: BrowseCursor): string {
  return `b|${c.t}|${c.id}`;
}

export function decodeBrowseCursor(cursor: string): BrowseCursor {
  const [tag, t, id, ...rest] = checkCursor(cursor);
  if (tag !== "b" || rest.length || !TIME_RE.test(t ?? "") || !ID_RE.test(id ?? "")) {
    throw new Error("Invalid cursor");
  }
  return { t: Number(t), id: id! };
}

/** How a search ranked its first page; later pages keep it. */
export type SearchMode = "exact" | "index";

/**
 * Search position: an offset into the fused, ranked list, plus what keeps
 * that offset meaning the same thing on later pages. `snapshot` is the
 * newest creation time the first page could see: later pages ignore
 * captures created after it, so new captures cannot shift the list under
 * the offset. `mode` is the ranking the first page used.
 */
export type SearchCursor = { offset: number; snapshot: number; mode: SearchMode };

export function isSearchCursor(cursor: string): boolean {
  return cursor.startsWith("s|");
}

export function encodeSearchCursor(c: SearchCursor): string {
  return `s|${c.offset}|${c.snapshot}|${c.mode}`;
}

export function decodeSearchCursor(cursor: string): SearchCursor {
  const [tag, n, t, mode, ...rest] = checkCursor(cursor);
  if (
    tag !== "s" ||
    rest.length ||
    !INT_RE.test(n ?? "") ||
    Number(n) > FILTER_LIMITS.maxSearchOffset ||
    !TIME_RE.test(t ?? "") ||
    (mode !== "exact" && mode !== "index")
  ) {
    throw new Error("Invalid cursor");
  }
  return { offset: Number(n), snapshot: Number(t), mode };
}
