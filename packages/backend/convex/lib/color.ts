/**
 * Colour maths shared by the extension and the backend.
 *
 * Pure TypeScript with no Convex imports, so the extension can import it by
 * relative path and the server can run the same code when it normalises a
 * capture's colours. Everything here is deterministic: the k-means uses a
 * seeded PRNG, so the same pixels always give the same palette.
 */

export type RGB = [number, number, number];
export type Lab = [number, number, number];
export type RGBA = { r: number; g: number; b: number; a: number };

export type PaletteColor = { hex: string; lab: Lab; weight: number };
export type NormalizedColor = { hex: string; l: number; a: number; b: number; weight: number };

/** Colours more transparent than this are treated as absent. */
export const MIN_ALPHA = 0.1;

/* ---------- parsing ---------- */

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** "#abc", "#abcd", "#aabbcc" or "#aabbccdd" to channels (alpha 0..1). */
export function parseHex(input: string): RGBA | null {
  const m = input.trim().match(/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i);
  if (!m) return null;
  let h = m[1]!;
  if (h.length <= 4) h = h.split("").map((c) => c + c).join("");
  const n = (i: number) => parseInt(h.slice(i, i + 2), 16);
  return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) / 255 : 1 };
}

/** One colour-function argument: a number, a percentage of `pctOf`, or "none" (0). */
function parseComponent(raw: string, pctOf: number): number | null {
  if (raw === "none") return 0;
  const pct = raw.endsWith("%");
  const n = parseFloat(pct ? raw.slice(0, -1) : raw);
  if (!Number.isFinite(n)) return null;
  return pct ? (n / 100) * pctOf : n;
}

function parseAlpha(raw: string | undefined): number | null {
  if (raw === undefined) return 1;
  const a = parseComponent(raw, 1);
  return a === null ? null : clamp(a, 0, 1);
}

/** Split "rgb(1 2 3 / 0.5)" or "rgba(1, 2, 3, 0.5)" into name, channels and alpha. */
function splitFunction(input: string): { name: string; args: string[]; alpha?: string } | null {
  const m = input.trim().toLowerCase().match(/^([a-z-]+)\((.*)\)$/);
  if (!m) return null;
  const [main, alpha] = m[2]!.split("/").map((s) => s.trim());
  const args = main!.includes(",")
    ? main!.split(",").map((s) => s.trim())
    : main!.split(/\s+/).filter(Boolean);
  // Legacy comma syntax carries alpha as a fourth argument.
  if (alpha === undefined && args.length === 4) return { name: m[1]!, args: args.slice(0, 3), alpha: args[3] };
  return { name: m[1]!, args, alpha };
}

/** OKLab to 0..255 sRGB (CSS Color 4 matrices). */
function oklabToRgb(L: number, a: number, b: number): RGB {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin: RGB = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return lin.map((c) => clamp(Math.round(linearToSrgb(c) * 255), 0, 255)) as RGB;
}

/**
 * Parse a CSS colour as `getComputedStyle` reports it: hex, `rgb()`/`rgba()` in
 * comma or space syntax, `color(srgb ...)`, `oklab()` and `oklch()`.
 *
 * Returns null for `transparent`, anything with alpha below `minAlpha`, and
 * forms it does not understand (e.g. `lab()`, named colours other than
 * transparent). Computed styles are already resolved, so named colours only
 * show up in hand-written input.
 */
export function parseCssColor(input: string, minAlpha = MIN_ALPHA): RGBA | null {
  const s = input.trim().toLowerCase();
  if (!s || s === "transparent" || s === "none") return null;

  const rgba = s.startsWith("#")
    ? parseHex(s)
    : s.startsWith("color(")
      ? parseColorSrgb(s)
      : parseColorFunction(s);
  if (!rgba || rgba.a < minAlpha) return null;
  return rgba;
}

/** `color(srgb r g b [/ a])` with channels in 0..1 or percentages. */
function parseColorSrgb(s: string): RGBA | null {
  const m = s.match(/^color\(\s*srgb\s+([^)]*)\)$/);
  if (!m) return null;
  const [main, alphaRaw] = m[1]!.split("/").map((x) => x.trim());
  const ch = main!.split(/\s+/).map((x) => parseComponent(x, 1));
  const alpha = parseAlpha(alphaRaw);
  if (ch.length !== 3 || ch.some((c) => c === null) || alpha === null) return null;
  const [r, g, b] = ch.map((c) => clamp(Math.round(c! * 255), 0, 255));
  return { r: r!, g: g!, b: b!, a: alpha };
}

/** `rgb()`, `rgba()`, `oklab()` and `oklch()`. */
function parseColorFunction(s: string): RGBA | null {
  const fn = splitFunction(s);
  if (!fn || fn.args.length !== 3) return null;
  const alpha = parseAlpha(fn.alpha);
  if (alpha === null) return null;

  if (fn.name === "rgb" || fn.name === "rgba") {
    const ch = fn.args.map((x) => parseComponent(x, 255));
    if (ch.some((c) => c === null)) return null;
    const [r, g, b] = ch.map((c) => clamp(Math.round(c!), 0, 255));
    return { r: r!, g: g!, b: b!, a: alpha };
  }
  if (fn.name !== "oklab" && fn.name !== "oklch") return null;

  const L = parseComponent(fn.args[0]!, 1);
  if (L === null) return null;
  let a: number | null;
  let b: number | null;
  if (fn.name === "oklab") {
    a = parseComponent(fn.args[1]!, 0.4);
    b = parseComponent(fn.args[2]!, 0.4);
  } else {
    const c = parseComponent(fn.args[1]!, 0.4);
    const h = fn.args[2] === "none" ? 0 : parseFloat(fn.args[2]!.replace(/deg$/, ""));
    if (c === null || !Number.isFinite(h)) return null;
    a = c * Math.cos((h * Math.PI) / 180);
    b = c * Math.sin((h * Math.PI) / 180);
  }
  if (a === null || b === null) return null;
  const [r, g, bl] = oklabToRgb(L, a, b);
  return { r, g, b: bl, a: alpha };
}

/* ---------- conversions ---------- */

export function rgbToHex([r, g, b]: RGB): string {
  const h = (n: number) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function linearToSrgb(c: number): number {
  const v = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.max(c, 0) ** (1 / 2.4) - 0.055;
  return clamp(v, 0, 1);
}

// D65 reference white.
const XN = 0.95047;
const YN = 1.0;
const ZN = 1.08883;
const EPS = 216 / 24389;
const KAPPA = 24389 / 27;

/** 0..255 sRGB to CIELAB (D65). */
export function rgbToLab([r, g, b]: RGB): Lab {
  const R = srgbToLinear(r / 255);
  const G = srgbToLinear(g / 255);
  const B = srgbToLinear(b / 255);
  const x = (0.4124564 * R + 0.3575761 * G + 0.1804375 * B) / XN;
  const y = (0.2126729 * R + 0.7151522 * G + 0.072175 * B) / YN;
  const z = (0.0193339 * R + 0.119192 * G + 0.9503041 * B) / ZN;
  const f = (t: number) => (t > EPS ? Math.cbrt(t) : (KAPPA * t + 16) / 116);
  const fx = f(x);
  const fy = f(y);
  const fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** CIELAB (D65) to 0..255 sRGB, clamped to the gamut. */
export function labToRgb([L, a, b]: Lab): RGB {
  const fy = (L + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - b / 200;
  const inv = (t: number) => (t ** 3 > EPS ? t ** 3 : (116 * t - 16) / KAPPA);
  const x = inv(fx) * XN;
  const y = (L > KAPPA * EPS ? fy ** 3 : L / KAPPA) * YN;
  const z = inv(fz) * ZN;
  const R = 3.2404542 * x - 1.5371385 * y - 0.4985314 * z;
  const G = -0.969266 * x + 1.8760108 * y + 0.041556 * z;
  const B = 0.0556434 * x - 0.2040259 * y + 1.0572252 * z;
  return [R, G, B].map((c) => Math.round(linearToSrgb(c) * 255)) as RGB;
}

export function hexToLab(hex: string): Lab | null {
  const c = parseHex(hex);
  return c ? rgbToLab([c.r, c.g, c.b]) : null;
}

export function labToHex(lab: Lab): string {
  return rgbToHex(labToRgb(lab));
}

/* ---------- distances ---------- */

/** CIE76: plain Euclidean distance in LAB. */
export function deltaE76(p: Lab, q: Lab): number {
  return Math.sqrt((p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2);
}

/** CIEDE2000 (Sharma, Wu & Dalal 2005), with kL = kC = kH = 1. */
export function deltaE2000([L1, a1, b1]: Lab, [L2, a2, b2]: Lab): number {
  const rad = Math.PI / 180;
  const C1 = Math.hypot(a1, b1);
  const C2 = Math.hypot(a2, b2);
  const Cbar7 = ((C1 + C2) / 2) ** 7;
  const G = 0.5 * (1 - Math.sqrt(Cbar7 / (Cbar7 + 25 ** 7)));
  const a1p = (1 + G) * a1;
  const a2p = (1 + G) * a2;
  const C1p = Math.hypot(a1p, b1);
  const C2p = Math.hypot(a2p, b2);
  const hue = (b: number, a: number) => {
    if (a === 0 && b === 0) return 0;
    const h = Math.atan2(b, a) / rad;
    return h < 0 ? h + 360 : h;
  };
  const h1p = hue(b1, a1p);
  const h2p = hue(b2, a2p);

  const dLp = L2 - L1;
  const dCp = C2p - C1p;
  let dhp = 0;
  if (C1p * C2p !== 0) {
    dhp = h2p - h1p;
    if (dhp > 180) dhp -= 360;
    else if (dhp < -180) dhp += 360;
  }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp * rad) / 2);

  const Lbp = (L1 + L2) / 2;
  const Cbp = (C1p + C2p) / 2;
  let hbp = h1p + h2p;
  if (C1p * C2p !== 0) {
    if (Math.abs(h1p - h2p) > 180) hbp = h1p + h2p < 360 ? hbp + 360 : hbp - 360;
    hbp /= 2;
  }
  const T =
    1 -
    0.17 * Math.cos((hbp - 30) * rad) +
    0.24 * Math.cos(2 * hbp * rad) +
    0.32 * Math.cos((3 * hbp + 6) * rad) -
    0.2 * Math.cos((4 * hbp - 63) * rad);
  const dTheta = 30 * Math.exp(-(((hbp - 275) / 25) ** 2));
  const Cbp7 = Cbp ** 7;
  const Rc = 2 * Math.sqrt(Cbp7 / (Cbp7 + 25 ** 7));
  const Sl = 1 + (0.015 * (Lbp - 50) ** 2) / Math.sqrt(20 + (Lbp - 50) ** 2);
  const Sc = 1 + 0.045 * Cbp;
  const Sh = 1 + 0.015 * Cbp * T;
  const Rt = -Math.sin(2 * dTheta * rad) * Rc;

  return Math.sqrt(
    (dLp / Sl) ** 2 + (dCp / Sc) ** 2 + (dHp / Sh) ** 2 + Rt * (dCp / Sc) * (dHp / Sh)
  );
}

/* ---------- k-means ---------- */

/** mulberry32: tiny seeded PRNG returning floats in [0, 1). */
export function seededRandom(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type WeightedLab = { lab: Lab; weight: number };

const dist2 = (p: Lab, q: Lab) => (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2;

/** k-means++ seeding: each next centre drawn proportionally to weight × D². */
function initCentroids(points: WeightedLab[], k: number, rand: () => number): Lab[] {
  const total = points.reduce((s, p) => s + p.weight, 0);
  let r = rand() * total;
  let first = points[points.length - 1]!;
  for (const p of points) {
    r -= p.weight;
    if (r <= 0) {
      first = p;
      break;
    }
  }
  const centroids: Lab[] = [[...first.lab] as Lab];
  const d2 = points.map((p) => dist2(p.lab, first.lab));

  while (centroids.length < k) {
    const scores = points.map((p, i) => p.weight * d2[i]!);
    const sum = scores.reduce((s, x) => s + x, 0);
    if (sum <= 0) break; // every point already coincides with a centre
    let pick = rand() * sum;
    let idx = scores.length - 1;
    for (let i = 0; i < scores.length; i++) {
      pick -= scores[i]!;
      if (pick <= 0) {
        idx = i;
        break;
      }
    }
    const c = [...points[idx]!.lab] as Lab;
    centroids.push(c);
    points.forEach((p, i) => (d2[i] = Math.min(d2[i]!, dist2(p.lab, c))));
  }
  return centroids;
}

/**
 * Weighted k-means in LAB. Returns up to `k` clusters, heaviest first, with
 * weights normalised to sum 1. Deterministic for a given `seed`.
 */
export function kmeansLab(
  points: WeightedLab[],
  k: number,
  { seed = 1, maxIter = 20 }: { seed?: number; maxIter?: number } = {}
): WeightedLab[] {
  const pts = points.filter((p) => p.weight > 0);
  if (!pts.length || k < 1) return [];
  const centroids = initCentroids(pts, k, seededRandom(seed));
  const assign = new Array<number>(pts.length).fill(-1);

  for (let iter = 0; iter < maxIter; iter++) {
    let changed = false;
    pts.forEach((p, i) => {
      let best = 0;
      let bestD = Infinity;
      centroids.forEach((c, j) => {
        const d = dist2(p.lab, c);
        if (d < bestD) {
          bestD = d;
          best = j;
        }
      });
      if (assign[i] !== best) {
        assign[i] = best;
        changed = true;
      }
    });
    if (!changed && iter > 0) break;

    const sums = centroids.map(() => ({ l: 0, a: 0, b: 0, w: 0 }));
    pts.forEach((p, i) => {
      const s = sums[assign[i]!]!;
      s.l += p.lab[0] * p.weight;
      s.a += p.lab[1] * p.weight;
      s.b += p.lab[2] * p.weight;
      s.w += p.weight;
    });
    sums.forEach((s, j) => {
      if (s.w > 0) centroids[j] = [s.l / s.w, s.a / s.w, s.b / s.w];
    });
  }

  const weights = centroids.map(() => 0);
  pts.forEach((p, i) => (weights[assign[i]!]! += p.weight));
  const total = weights.reduce((s, w) => s + w, 0) || 1;
  return centroids
    .map((lab, j) => ({ lab, weight: weights[j]! / total }))
    .filter((c) => c.weight > 0)
    .sort((a, b) => b.weight - a.weight);
}

/* ---------- palettes ---------- */

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Palette from raw RGBA pixels (e.g. `ImageData.data` of a downscaled image).
 * Pixels with alpha below `minAlpha` (0..255) are dropped; identical colours
 * are bucketed first so k-means runs over distinct colours, not pixels.
 */
export function paletteFromPixels(
  data: ArrayLike<number>,
  { k = 6, seed = 1, minAlpha = 128 }: { k?: number; seed?: number; minAlpha?: number } = {}
): PaletteColor[] {
  const buckets = new Map<number, number>();
  for (let i = 0; i + 3 < data.length; i += 4) {
    if (data[i + 3]! < minAlpha) continue;
    const key = (data[i]! << 16) | (data[i + 1]! << 8) | data[i + 2]!;
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }
  const points: WeightedLab[] = [...buckets].map(([key, count]) => ({
    lab: rgbToLab([(key >> 16) & 255, (key >> 8) & 255, key & 255]),
    weight: count,
  }));
  return kmeansLab(points, k, { seed }).map((c) => {
    const rgb = labToRgb(c.lab);
    return {
      hex: rgbToHex(rgb),
      lab: c.lab.map(round2) as Lab,
      weight: Math.round(c.weight * 10000) / 10000,
    };
  });
}

/* ---------- normalisation for captureColors ---------- */

/** Colours closer than this (ΔE2000) are the same colour for filtering. */
export const MERGE_DELTA_E = 5;
export const MAX_CAPTURE_COLORS = 12;

/** Rescale weights so they sum to 1; an all-zero list is returned unchanged. */
export function normalizeWeights<T extends { weight: number }>(items: T[]): T[] {
  const total = items.reduce((s, x) => s + Math.max(0, x.weight), 0);
  if (total <= 0) return items;
  return items.map((x) => ({ ...x, weight: Math.max(0, x.weight) / total }));
}

/**
 * Greedy merge: heaviest first, each colour joins the first cluster within
 * `threshold` ΔE2000, summing weights and averaging LAB by weight.
 */
export function mergeSimilarColors(colors: WeightedLab[], threshold = MERGE_DELTA_E): WeightedLab[] {
  const clusters: WeightedLab[] = [];
  for (const c of [...colors].sort((a, b) => b.weight - a.weight)) {
    if (!(c.weight > 0)) continue;
    const near = clusters.find((k) => deltaE2000(k.lab, c.lab) < threshold);
    if (!near) {
      clusters.push({ lab: [...c.lab] as Lab, weight: c.weight });
      continue;
    }
    const w = near.weight + c.weight;
    near.lab = near.lab.map((v, i) => (v * near.weight + c.lab[i]! * c.weight) / w) as Lab;
    near.weight = w;
  }
  return clusters.sort((a, b) => b.weight - a.weight);
}

/**
 * The colours a capture is filtered by: DNA colours (what the CSS says) and
 * the pixel palette (what is on screen) combined, near-duplicates merged,
 * weights summing to 1, at most 12.
 *
 * Each source is normalised on its own first and, when both exist, counts for
 * half, so a 16-colour DNA cannot drown out a 6-colour palette.
 */
export function normalizeCaptureColors(
  dnaColors: ReadonlyArray<{ hex: string; weight: number }> | undefined,
  palette: ReadonlyArray<{ hex: string; lab?: Lab | number[]; weight: number }> | undefined
): NormalizedColor[] {
  // The hex is authoritative: a client-supplied LAB could disagree with it (or
  // be out of range), and the hex is what the user sees. LAB is only a fallback.
  const toLab = (c: { hex: string; lab?: Lab | number[] }): Lab | null =>
    hexToLab(c.hex) ??
    (c.lab && c.lab.length === 3 && c.lab.every(Number.isFinite) ? (c.lab as Lab) : null);

  const sources = [dnaColors ?? [], palette ?? []]
    .map((list) =>
      normalizeWeights(
        list.flatMap((c) => {
          const lab = toLab(c);
          return lab && c.weight > 0 ? [{ lab, weight: c.weight }] : [];
        })
      )
    )
    .filter((list) => list.length > 0);

  const share = 1 / (sources.length || 1);
  const all = sources.flatMap((list) => list.map((c) => ({ ...c, weight: c.weight * share })));
  const kept = normalizeWeights(mergeSimilarColors(all).slice(0, MAX_CAPTURE_COLORS));
  return kept.map(({ lab, weight }) => ({
    hex: labToHex(lab),
    l: round2(lab[0]),
    a: round2(lab[1]),
    b: round2(lab[2]),
    weight,
  }));
}
