/**
 * Stage 1 colours (spec 6.5): collect a session's colours, cluster them and
 * give the clusters roles. Pure and deterministic.
 */

import { deltaE2000, hexToLab, kmeansLab, labToHex, type Lab } from "../color";
import { contrastRatio, relativeLuminance } from "./contrast";
import { hexToOklch, hueDistance, oklchToHex } from "./oklch";
import { buildScale } from "./scale";
import type { DesignSystemTokens } from "./types";

export type ColorUsage = "text" | "background" | "border";
/** One colour of one capture; `usage` is known for DNA colours only. */
export type SourceColor = { hex: string; weight: number; usage?: ColorUsage };

export type WeightedColor = { hex: string; lab: Lab; weight: number; usage?: ColorUsage };

export type ColorCluster = {
  /** The heaviest member colour, so tokens are colours the sites really use. */
  hex: string;
  lab: Lab;
  /** CIE LCh chroma and hue of `lab`. */
  chroma: number;
  hue: number;
  /** Share of all collected weight (clusters under MIN_CLUSTER_WEIGHT are dropped, not renormalised). */
  weight: number;
  usage: Record<ColorUsage | "unknown", number>;
  /** The heaviest member colour in each usage, e.g. the border colour of a cluster mostly used as surface. */
  roleHex: Partial<Record<ColorUsage | "unknown", string>>;
};

export const CLUSTER_K = 10;
export const CLUSTER_SEED = 7;
export const MIN_CLUSTER_WEIGHT = 0.02;
export const MIN_PRIMARY_WEIGHT = 0.03;
/** LCh chroma under this is not a brand colour (slate greys and navy text reach ~25). */
export const SATURATED_CHROMA = 30;
export const SECONDARY_HUE_GAP = 30;

/**
 * Every capture's colours, each capture's weights normalised to 1 and scaled
 * by 1/captures so every capture counts the same. Identical colour + usage
 * pairs are summed. Sorted by hex then usage, so the result (and the seeded
 * k-means after it) does not depend on capture order.
 */
export function collectColors(captures: SourceColor[][]): WeightedColor[] {
  const valid = captures
    .map((list) => list.filter((c) => c.weight > 0 && Number.isFinite(c.weight) && hexToLab(c.hex)))
    .filter((list) => list.length > 0);
  const buckets = new Map<string, WeightedColor>();
  for (const list of valid) {
    const total = list.reduce((s, c) => s + c.weight, 0);
    for (const c of list) {
      const lab = hexToLab(c.hex)!;
      const hex = labToHex(lab);
      const key = `${hex}|${c.usage ?? ""}`;
      const w = c.weight / total / valid.length;
      const hit = buckets.get(key);
      if (hit) hit.weight += w;
      else buckets.set(key, { hex, lab, weight: w, ...(c.usage ? { usage: c.usage } : {}) });
    }
  }
  return [...buckets.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, c]) => c);
}

const lch = (lab: Lab) => {
  const h = (Math.atan2(lab[2], lab[1]) * 180) / Math.PI;
  return { chroma: Math.hypot(lab[1], lab[2]), hue: h < 0 ? h + 360 : h };
};
const dist2 = (p: Lab, q: Lab) => (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2;

/**
 * Weighted k-means in LAB (k = 10, seeded) over the distinct colours, then
 * every colour assigned to its nearest centre to tally usage. Clusters under
 * 2% of the weight are dropped. Heaviest first.
 */
export function clusterColors(colors: WeightedColor[], k = CLUSTER_K): ColorCluster[] {
  const byHex = new Map<string, { lab: Lab; weight: number }>();
  for (const c of colors) {
    const hit = byHex.get(c.hex);
    if (hit) hit.weight += c.weight;
    else byHex.set(c.hex, { lab: c.lab, weight: c.weight });
  }
  const centres = kmeansLab([...byHex.values()], k, { seed: CLUSTER_SEED, maxIter: 50 }).map((c) => c.lab);
  if (!centres.length) return [];

  const total = colors.reduce((s, c) => s + c.weight, 0) || 1;
  const groups = centres.map(() => ({
    weight: 0,
    usage: { text: 0, background: 0, border: 0, unknown: 0 },
    members: new Map<string, number>(),
    byUsage: new Map<string, number>(),
  }));
  for (const c of colors) {
    let best = 0;
    centres.forEach((centre, j) => {
      if (dist2(c.lab, centre) < dist2(c.lab, centres[best]!)) best = j;
    });
    const g = groups[best]!;
    const w = c.weight / total;
    g.weight += w;
    g.usage[c.usage ?? "unknown"] += w;
    g.members.set(c.hex, (g.members.get(c.hex) ?? 0) + w);
    const key = `${c.usage ?? "unknown"}|${c.hex}`;
    g.byUsage.set(key, (g.byUsage.get(key) ?? 0) + w);
  }
  const heaviest = (m: Map<string, number>) => [...m].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]?.[0];
  return groups
    .filter((g) => g.weight >= MIN_CLUSTER_WEIGHT)
    .map((g) => {
      const hex = heaviest(g.members)!;
      const lab = hexToLab(hex)!;
      const roleHex: ColorCluster["roleHex"] = {};
      for (const usage of ["text", "background", "border", "unknown"] as const) {
        const top = heaviest(new Map([...g.byUsage].filter(([k]) => k.startsWith(`${usage}|`))));
        if (top) roleHex[usage] = top.slice(usage.length + 1);
      }
      return { hex, lab, ...lch(lab), weight: g.weight, usage: g.usage, roleHex };
    })
    .sort((a, b) => b.weight - a.weight || (a.hex < b.hex ? -1 : 1));
}

export type ColorRoles = {
  mode: DesignSystemTokens["mode"];
  colors: DesignSystemTokens["colors"];
  notes: string[];
};

/** Shift a colour's OKLCH lightness, keeping hue and chroma (gamut-clamped). */
function shiftLightness(hex: string, delta: number): string {
  const o = hexToOklch(hex)!;
  return oklchToHex({ ...o, l: Math.min(1, Math.max(0, o.l + delta)) });
}

/** Mix two colours in OKLab, `t` of the way from `a` to `b`. */
function mixOklab(a: string, b: string, t: number): string {
  const p = hexToOklch(a)!;
  const q = hexToOklch(b)!;
  const pa = { l: p.l, x: p.c * Math.cos((p.h * Math.PI) / 180), y: p.c * Math.sin((p.h * Math.PI) / 180) };
  const qa = { l: q.l, x: q.c * Math.cos((q.h * Math.PI) / 180), y: q.c * Math.sin((q.h * Math.PI) / 180) };
  const x = pa.x + (qa.x - pa.x) * t;
  const y = pa.y + (qa.y - pa.y) * t;
  const h = (Math.atan2(y, x) * 180) / Math.PI;
  return oklchToHex({ l: pa.l + (qa.l - pa.l) * t, c: Math.hypot(x, y), h: h < 0 ? h + 360 : h });
}

/** Move `from` in lightness by `step`s until it is `minDelta` ΔE2000 from `away` (default: itself). */
function derivedNear(from: string, step: number, minDelta: number, away = from): string {
  const base = hexToLab(away)!;
  let hex = from;
  for (let i = 1; i <= 25 && deltaE2000(hexToLab(hex)!, base) < minDelta; i++) hex = shiftLightness(from, step * i);
  return hex;
}

/** A cluster's colour in a role: its heaviest member used that way, else its representative. */
const roleColor = (c: ColorCluster, usage: ColorUsage) => c.roleHex[usage] ?? c.hex;

/** How much a cluster looks like a page background: tagged usage, or untagged pixels at half credit. */
const backgroundScore = (c: ColorCluster) => c.usage.background + 0.5 * c.usage.unknown;

/** Mostly from DNA (computed styles) rather than pixel palettes. */
const isCssColor = (c: ColorCluster) => c.usage.unknown < c.weight / 2;

/**
 * Roles from the spec heuristics. Every role always gets a colour: missing
 * ones are derived and say so in `notes`.
 */
export function assignRoles(clusters: ColorCluster[]): ColorRoles {
  const notes: string[] = [];
  const used = new Set<ColorCluster>();
  const free = () => clusters.filter((c) => !used.has(c));

  // Background: a very light or very dark cluster, whichever side carries
  // more background weight; L > 85 (< 15 for dark themes), relaxed to > 70 (< 30).
  const darkScore = clusters.filter((c) => c.lab[0] < 30).reduce((s, c) => s + backgroundScore(c), 0);
  const lightScore = clusters.filter((c) => c.lab[0] > 70).reduce((s, c) => s + backgroundScore(c), 0);
  const dark = darkScore > lightScore;
  // Among the strong candidates (at least half the best score) the most
  // extreme wins: cards captured on a page often outweigh the page itself,
  // but the page is the lighter (darker, in dark themes) of the two.
  const pickBackground = (test: (l: number) => boolean) => {
    const candidates = clusters.filter((c) => test(c.lab[0]));
    const best = Math.max(0, ...candidates.map(backgroundScore));
    return candidates
      .filter((c) => backgroundScore(c) >= best / 2)
      .sort((a, b) => (dark ? a.lab[0] - b.lab[0] : b.lab[0] - a.lab[0]) || b.weight - a.weight)[0];
  };
  const bgCluster = dark
    ? (pickBackground((l) => l < 15) ?? pickBackground((l) => l < 30))
    : (pickBackground((l) => l > 85) ?? pickBackground((l) => l > 70));
  let background: string;
  if (bgCluster) {
    background = roleColor(bgCluster, "background");
    used.add(bgCluster);
  } else {
    background = "#ffffff";
    notes.push("No very light or very dark colour to use as background; used white");
  }
  const bgLab = hexToLab(background)!;
  const mode = bgLab[0] < 30 ? "dark" : "light";
  const isDark = mode === "dark";

  // Surface: the closest background-like cluster 3–12 ΔE2000 from the
  // background, on its side. One closer than 3 is moved out to 3.5.
  const surfaceCandidates = free()
    .filter((c) => backgroundScore(c) > 0 && c.chroma < 20 && (isDark ? c.lab[0] < 50 : c.lab[0] > 50))
    .map((c) => {
      const hex = c.roleHex.background ?? c.roleHex.unknown ?? c.hex;
      return { c, hex, d: deltaE2000(hexToLab(hex)!, bgLab) };
    });
  const surfacePick = surfaceCandidates
    .filter(({ d }) => d >= 3 && d <= 12)
    .sort((a, b) => a.d - b.d || b.c.weight - a.c.weight)[0];
  const tooClose = surfaceCandidates.filter(({ hex, d }) => d < 3 && hex !== background).sort((a, b) => b.c.weight - a.c.weight)[0];
  let surface: string;
  const awayFromBackground = isDark ? 0.006 : -0.004;
  if (surfacePick) {
    surface = surfacePick.hex;
    used.add(surfacePick.c);
  } else if (tooClose) {
    surface = derivedNear(tooClose.hex, awayFromBackground, 3.5, background);
    used.add(tooClose.c);
    notes.push(`Surface ${tooClose.hex} was under 3 ΔE from the background; moved its lightness to ${surface}`);
  } else {
    surface = derivedNear(background, awayFromBackground, 3.5);
    notes.push("No surface colour 3–12 ΔE from the background; derived one from the background");
  }

  // Text: the highest contrast against the background among clusters used as
  // text (at least a quarter of the heaviest text use), or any greyish one.
  const textUse = Math.max(0, ...free().map((c) => c.usage.text));
  const textCandidates =
    textUse > 0
      ? free().filter((c) => c.usage.text >= textUse * 0.25)
      : free().filter((c) => c.chroma < 30 && contrastRatio(c.hex, background) >= 4.5);
  const textCluster = textCandidates.sort(
    (a, b) =>
      contrastRatio(roleColor(b, "text"), background) - contrastRatio(roleColor(a, "text"), background) || b.weight - a.weight
  )[0];
  let text: string;
  if (textCluster) {
    text = roleColor(textCluster, "text");
    used.add(textCluster);
  } else {
    const bg = hexToOklch(background)!;
    text = oklchToHex({ l: isDark ? 0.95 : 0.2, c: Math.min(bg.c, 0.02), h: bg.h });
    notes.push("No text colour captured; derived one from the background");
  }

  // textMuted: a greyish cluster between text and background in luminance.
  const yText = relativeLuminance(text)!;
  const yBg = relativeLuminance(background)!;
  const between = (y: number) => y > Math.min(yText, yBg) && y < Math.max(yText, yBg);
  const mutedCluster = free()
    .filter(
      (c) =>
        c.chroma < 30 &&
        between(relativeLuminance(roleColor(c, "text"))!) &&
        contrastRatio(roleColor(c, "text"), background) >= 2.5 &&
        contrastRatio(roleColor(c, "text"), text) >= 1.4
    )
    .sort((a, b) => b.usage.text - a.usage.text || b.weight - a.weight)[0];
  let textMuted: string;
  if (mutedCluster) {
    textMuted = roleColor(mutedCluster, "text");
    used.add(mutedCluster);
  } else {
    textMuted = mixOklab(text, background, 0.4);
    notes.push("No muted text colour captured; mixed one from text and background");
  }

  // Primary: the most saturated cluster with at least 3% weight. Colours the
  // CSS uses come first: a photo's yellow in a pixel palette is not a brand colour.
  const saturated = (min: number, test: (c: ColorCluster) => boolean = () => true) => {
    const all = free().filter((c) => c.weight >= min && c.chroma >= SATURATED_CHROMA && test(c));
    const css = all.filter(isCssColor);
    return (css.length ? css : all).sort((a, b) => b.chroma - a.chroma || b.weight - a.weight)[0];
  };
  let primaryCluster = saturated(MIN_PRIMARY_WEIGHT);
  if (!primaryCluster) {
    primaryCluster = saturated(MIN_CLUSTER_WEIGHT);
    if (primaryCluster) notes.push("No saturated colour reaches 3% weight; primary comes from a smaller one");
  }
  let primary: string;
  if (primaryCluster) {
    primary = primaryCluster.hex;
    used.add(primaryCluster);
  } else {
    const t = hexToOklch(text)!;
    primary = oklchToHex({ l: isDark ? 0.75 : 0.45, c: t.c, h: t.h });
    notes.push("No saturated colour captured; primary is a neutral derived from the text colour");
  }

  // Secondary (optional): the most saturated remaining cluster whose hue is
  // more than 30° from primary's.
  const primaryHue = primaryCluster?.hue;
  const secondaryCluster =
    primaryHue === undefined
      ? undefined
      : saturated(MIN_CLUSTER_WEIGHT, (c) => hueDistance(c.hue, primaryHue) > SECONDARY_HUE_GAP);
  if (secondaryCluster) used.add(secondaryCluster);
  else notes.push(`No secondary colour: no second saturated hue more than ${SECONDARY_HUE_GAP}° from primary`);

  // Border: the colour most used as a border (not the background, surface or
  // text colour), otherwise derived from the background.
  const borderPick = clusters
    .filter((c) => c.roleHex.border !== undefined)
    .map((c) => ({ c, hex: c.roleHex.border! }))
    .filter(({ hex }) => hex !== background && hex !== surface && hex !== text && deltaE2000(hexToLab(hex)!, bgLab) >= 3)
    .sort((a, b) => b.c.usage.border - a.c.usage.border || b.c.weight - a.c.weight)[0];
  let border: string;
  if (borderPick) border = borderPick.hex;
  else {
    border = derivedNear(background, isDark ? 0.01 : -0.008, 8);
    notes.push("No border colour captured; derived one from the background");
  }

  return {
    mode,
    colors: {
      background,
      surface,
      border,
      text,
      textMuted,
      primary: buildScale(primary),
      ...(secondaryCluster ? { secondary: buildScale(secondaryCluster.hex) } : {}),
    },
    notes,
  };
}
