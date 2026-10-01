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
  /** Legacy single category, folded into `aiCategories`. */
  aiCategory?: string;
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
  const listed = uniqueList(raw.aiCategories, "aiCategories") ?? [];
  // The legacy single category widens the list (OR within categories).
  const merged = raw.aiCategory !== undefined ? Array.from(new Set([...listed, raw.aiCategory])) : listed;
  const categories = merged.length ? merged : undefined;
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

/**
 * How far a colour's L may be from the target's and still lie within
 * `tolerance` (ΔE2000). ΔE² = (ΔL/S_L)² + Q, where Q = x² + y² + R_T·x·y
 * with x = ΔC/S_C, y = ΔH/S_H and |R_T| <= 2·sin 60° < 2, so Q >= (|x|-|y|)²
 * >= 0. Hence ΔE >= |ΔL|/S_L and |ΔL| <= tolerance · MAX_SL: an index range
 * on L that wide drops no match.
 */
export function lightnessBand(tolerance: number): number {
  return tolerance * MAX_SL;
}

/** Whether one captureColors row satisfies the colour filter. */
export function colorRowMatches(
  target: Lab,
  row: { l: number; a: number; b: number; weight: number },
  tolerance: number
): boolean {
  return row.weight > FILTER_LIMITS.minColorWeight && deltaE2000(target, [row.l, row.a, row.b]) < tolerance;
}

/* ---------- cursors ---------- */

/**
 * Browse position: the last capture examined, newest first. `t` alone would
 * do if creation times never tied; `id` settles ties.
 */
export type BrowseCursor = { t: number; id: string };

const ID_RE = /^[A-Za-z0-9_;]{1,64}$/;

function checkCursor(cursor: string): string[] {
  if (cursor.length > FILTER_LIMITS.maxCursorChars) throw new Error("Invalid cursor");
  return cursor.split("|");
}

export function encodeBrowseCursor(c: BrowseCursor): string {
  return `b|${c.t}|${c.id}`;
}

export function decodeBrowseCursor(cursor: string): BrowseCursor {
  const [tag, t, id, ...rest] = checkCursor(cursor);
  const time = Number(t);
  if (tag !== "b" || rest.length || !t || !Number.isFinite(time) || time < 0 || !ID_RE.test(id ?? "")) {
    throw new Error("Invalid cursor");
  }
  return { t: time, id: id! };
}

/** Search position: an offset into the fused, ranked list. */
export function encodeSearchCursor(offset: number): string {
  return `s|${offset}`;
}

export function decodeSearchCursor(cursor: string): number {
  const [tag, n, ...rest] = checkCursor(cursor);
  const offset = Number(n);
  if (
    tag !== "s" ||
    rest.length ||
    !n ||
    !Number.isInteger(offset) ||
    offset < 0 ||
    offset > FILTER_LIMITS.maxSearchOffset
  ) {
    throw new Error("Invalid cursor");
  }
  return offset;
}
