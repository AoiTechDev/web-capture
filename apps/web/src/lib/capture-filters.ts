/**
 * The dashboard's filter state and its URL form, so a refresh or a shared
 * link shows the same view. Pure: no React or Next imports, and only
 * relative imports, so the extension's vitest suite can test it.
 *
 * Reading is forgiving: anything malformed in the URL is dropped (or, for a
 * number, clamped) rather than shown as an error, since the URL is input
 * anyone can edit. Writing is canonical: fixed key order, defaults omitted,
 * so an unfiltered dashboard has no query string at all.
 */

/** Type chips, each standing for one or more stored kinds. */
export const TYPE_KEYS = ["image", "screenshot", "link", "text"] as const;
export type TypeKey = (typeof TYPE_KEYS)[number];

export const TYPE_LABELS: Record<TypeKey, string> = {
  image: "Images",
  screenshot: "Screenshots",
  link: "Links",
  text: "Text",
};

export type CaptureKind = "image" | "text" | "link" | "code" | "screenshot" | "element" | "viewport";

/** Picked-element and viewport shots are filed under Screenshots. "code" has no chip. */
export const KINDS_FOR_TYPE: Record<TypeKey, readonly CaptureKind[]> = {
  image: ["image"],
  screenshot: ["screenshot", "element", "viewport"],
  link: ["link"],
  text: ["text"],
};

/** The model's categories (schema `aiCategoryValidator`), in display order. */
export const AI_CATEGORIES = [
  "hero",
  "navigation",
  "pricing",
  "features",
  "testimonials",
  "cta",
  "form",
  "card",
  "footer",
  "dashboard",
  "illustration",
  "photo",
  "typography",
  "icon",
  "other",
] as const;
export type AiCategory = (typeof AI_CATEGORIES)[number];

export const DATE_PRESETS = ["7d", "30d"] as const;
export type DatePreset = (typeof DATE_PRESETS)[number];

/** ΔE2000, as the backend clamps it (lib/search_filters FILTER_LIMITS). */
export const COLOR_TOLERANCE = { default: 10, min: 1, max: 50 } as const;

/** Characters of the query kept; the backend reads no more than this. */
export const MAX_QUERY_CHARS = 500;

export type CaptureFilters = {
  /** Search text; blank browses. */
  q: string;
  /** A session id; checked against the caller's sessions before use. */
  session: string | null;
  /** Empty means every type. */
  types: TypeKey[];
  /** Empty means every category. */
  categories: AiCategory[];
  /** "#rrggbb", lowercase. */
  color: string | null;
  /** ΔE2000, meaningful only with `color`. */
  tolerance: number;
  /** A relative range; when set, `from` and `to` are null. */
  date: DatePreset | null;
  /** Inclusive local days, "YYYY-MM-DD". */
  from: string | null;
  to: string | null;
};

export const EMPTY_FILTERS: CaptureFilters = {
  q: "",
  session: null,
  types: [],
  categories: [],
  color: null,
  tolerance: COLOR_TOLERANCE.default,
  date: null,
  from: null,
  to: null,
};

/** What `URLSearchParams` (and Next's `ReadonlyURLSearchParams`) offer. */
export type ParamsLike = { get(name: string): string | null };

const HEX_RE = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;
const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
/** Convex document ids are lowercase base32; this only rules out garbage. */
const SESSION_ID_RE = /^[a-z0-9]{16,64}$/;

/** "#abc", "abc", "#AABBCC" or "aabbcc" to "#aabbcc"; null for anything else. */
export function normalizeHexColor(input: string | null | undefined): string | null {
  const m = input?.trim().match(HEX_RE);
  if (!m) return null;
  const h = m[1]!.toLowerCase();
  return `#${h.length === 3 ? h.split("").map((c) => c + c).join("") : h}`;
}

/** A real calendar day as "YYYY-MM-DD", or null ("2026-02-30" is not one). */
export function parseDay(input: string | null | undefined): string | null {
  const m = input?.trim().match(DAY_RE);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 1970 || y > 9999) return null;
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null;
  return m[0];
}

export function clampTolerance(x: number): number {
  return Math.min(COLOR_TOLERANCE.max, Math.max(COLOR_TOLERANCE.min, Math.round(x)));
}

/** Comma-separated values from `allowed`, de-duplicated, in `allowed`'s order. */
function parseList<T extends string>(raw: string | null, allowed: readonly T[]): T[] {
  if (!raw) return [];
  const given = new Set(raw.split(",").map((s) => s.trim().toLowerCase()));
  return allowed.filter((v) => given.has(v));
}

function isOneOf<T extends string>(x: string | null, allowed: readonly T[]): x is T {
  return x !== null && (allowed as readonly string[]).includes(x);
}

/**
 * Filters from the URL. Unknown keys are ignored; malformed values are
 * dropped (a bad tolerance falls back to the default, an out-of-range one is
 * clamped); a reversed date range is put the right way round.
 */
export function parseFilterParams(params: ParamsLike): CaptureFilters {
  const q = (params.get("q") ?? "").slice(0, MAX_QUERY_CHARS);
  const sessionRaw = params.get("session")?.trim() ?? "";
  const session = SESSION_ID_RE.test(sessionRaw) ? sessionRaw : null;
  const color = normalizeHexColor(params.get("color"));

  const tolRaw = params.get("tol");
  const tolNum = tolRaw !== null && tolRaw.trim() !== "" ? Number(tolRaw) : NaN;
  const tolerance = Number.isFinite(tolNum) ? clampTolerance(tolNum) : COLOR_TOLERANCE.default;

  const dateRaw = params.get("date");
  const date = isOneOf(dateRaw, DATE_PRESETS) ? dateRaw : null;
  let from = date ? null : parseDay(params.get("from"));
  let to = date ? null : parseDay(params.get("to"));
  if (from && to && from > to) [from, to] = [to, from];

  return {
    q,
    session,
    types: parseList(params.get("type"), TYPE_KEYS),
    categories: parseList(params.get("cat"), AI_CATEGORIES),
    color,
    tolerance,
    date,
    from,
    to,
  };
}

/**
 * The URL query string for `f`, without the leading "?"; "" for no filters.
 * The colour goes without its "#" so it needs no escaping.
 */
export function serializeFilterParams(f: CaptureFilters): string {
  const p = new URLSearchParams();
  const q = f.q.trim() ? f.q.slice(0, MAX_QUERY_CHARS) : "";
  if (q) p.set("q", q);
  if (f.session && SESSION_ID_RE.test(f.session)) p.set("session", f.session);
  const types = TYPE_KEYS.filter((t) => f.types.includes(t));
  if (types.length) p.set("type", types.join(","));
  const cats = AI_CATEGORIES.filter((c) => f.categories.includes(c));
  if (cats.length) p.set("cat", cats.join(","));
  const color = normalizeHexColor(f.color);
  if (color) {
    p.set("color", color.slice(1));
    const tol = clampTolerance(f.tolerance);
    if (tol !== COLOR_TOLERANCE.default) p.set("tol", String(tol));
  }
  if (f.date && isOneOf(f.date, DATE_PRESETS)) {
    p.set("date", f.date);
  } else {
    let from = parseDay(f.from);
    let to = parseDay(f.to);
    if (from && to && from > to) [from, to] = [to, from];
    if (from) p.set("from", from);
    if (to) p.set("to", to);
  }
  return p.toString();
}

/** Filter groups in use (session, type, category, colour, date); the query is not a filter. */
export function countActiveFilters(f: CaptureFilters): number {
  return (
    (f.session ? 1 : 0) +
    (f.types.length ? 1 : 0) +
    (f.categories.length ? 1 : 0) +
    (f.color ? 1 : 0) +
    (f.date || f.from || f.to ? 1 : 0)
  );
}

/** Every filter off; the query stays. */
export function clearFilters(f: CaptureFilters): CaptureFilters {
  return { ...EMPTY_FILTERS, q: f.q };
}

/** `values` with `v` added, or removed when already there. */
export function toggle<T>(values: readonly T[], v: T): T[] {
  return values.includes(v) ? values.filter((x) => x !== v) : [...values, v];
}

/**
 * A query string (with "?", or "" when empty) that keeps `search`'s filters
 * and sets the colour filter to `hex`: what a swatch click navigates to.
 */
export function withColorFilter(search: string, hex: string): string {
  const current = parseFilterParams(new URLSearchParams(search));
  const color = normalizeHexColor(hex);
  const qs = serializeFilterParams({ ...current, color: color ?? current.color });
  return qs ? `?${qs}` : "";
}
