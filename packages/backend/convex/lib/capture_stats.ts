/**
 * What one capture adds to its owner's library counters (the `userStats`
 * table), and the change a write makes to them. Pure: no Convex imports.
 *
 * Counted per user: captures by kind, by status ("none" when unset), by kind
 * with the current model's embedding, and with a legacy `imageEmbedding`.
 * Only `kind`, `status`, `localEmbedding`, `textEmbedding` and
 * `imageEmbedding` matter here; a write that changes none of them leaves the
 * counters as they are.
 */
import { LOCAL_EMBEDDING_DIM } from "./ai_config";

/** Capture kinds whose content is a stored image. */
const VISUAL_KINDS = new Set(["image", "screenshot", "element", "viewport"]);

export function isVisualKind(kind: string): boolean {
  return VISUAL_KINDS.has(kind);
}

/**
 * The counting rule: what decides whether a capture counts as embedded.
 * Stored with the counters (userStatsBackfill.rule); when the code's rule
 * differs (LOCAL_EMBEDDING_DIM or VISUAL_KINDS changed), the counters read
 * as incomplete and the next backfill run recounts from scratch.
 */
export const STATS_RULE = `dim=${LOCAL_EMBEDDING_DIM};visual=${[...VISUAL_KINDS].sort().join(",")}`;

/**
 * Whether a capture has the embedding its kind is searched by, from the
 * current model. A vector of another size (512-d, from the earlier CLIP
 * model) is in no index and counts as none.
 */
export function hasEmbedding(d: any): boolean {
  const vec = isVisualKind(d.kind) ? d.localEmbedding : d.textEmbedding;
  return Array.isArray(vec) && vec.length === LOCAL_EMBEDDING_DIM;
}

/** Counters of one user's library, or a change to them (then possibly negative). */
export type CaptureStats = {
  kinds: Record<string, number>;
  statuses: Record<string, number>;
  /** Per kind: captures with the current model's embedding (`hasEmbedding`). */
  embedded: Record<string, number>;
  /** Captures with a non-empty legacy `imageEmbedding`. */
  withImageEmbedding: number;
};

export function emptyStats(): CaptureStats {
  return { kinds: {}, statuses: {}, embedded: {}, withImageEmbedding: 0 };
}

/** What one capture adds to the counters. */
export function captureContribution(d: any): CaptureStats {
  const kind = String(d.kind ?? "unknown");
  return {
    kinds: { [kind]: 1 },
    statuses: { [String(d.status ?? "none")]: 1 },
    embedded: hasEmbedding(d) ? { [kind]: 1 } : {},
    withImageEmbedding: Array.isArray(d.imageEmbedding) && d.imageEmbedding.length > 0 ? 1 : 0,
  };
}

function addCounts(into: Record<string, number>, from: Record<string, number>, sign: 1 | -1) {
  for (const [k, n] of Object.entries(from)) {
    const next = (into[k] ?? 0) + sign * n;
    if (next === 0) delete into[k];
    else into[k] = next;
  }
}

/** `a + sign * b`, keys whose count reaches zero dropped. */
export function addStats(a: CaptureStats, b: CaptureStats, sign: 1 | -1 = 1): CaptureStats {
  const out: CaptureStats = {
    kinds: { ...a.kinds },
    statuses: { ...a.statuses },
    embedded: { ...a.embedded },
    withImageEmbedding: a.withImageEmbedding + sign * b.withImageEmbedding,
  };
  addCounts(out.kinds, b.kinds, sign);
  addCounts(out.statuses, b.statuses, sign);
  addCounts(out.embedded, b.embedded, sign);
  return out;
}

export function isZeroStats(s: CaptureStats): boolean {
  return (
    s.withImageEmbedding === 0 &&
    Object.keys(s.kinds).length === 0 &&
    Object.keys(s.statuses).length === 0 &&
    Object.keys(s.embedded).length === 0
  );
}

/**
 * The change a write makes to the counters: `before` is the document as it
 * was (null for an insert), `after` as it is now (null for a delete). Null
 * when nothing counted changed.
 */
export function statsDelta(before: unknown, after: unknown): CaptureStats | null {
  let delta = emptyStats();
  if (after) delta = addStats(delta, captureContribution(after));
  if (before) delta = addStats(delta, captureContribution(before), -1);
  return isZeroStats(delta) ? null : delta;
}

/**
 * Stored counters plus a change. Counts never go below zero; that would
 * mean a write path skipped the counters, which a restarted backfill
 * (user_stats.backfillUserStats) repairs. `clamped` names each counter that
 * was cut back to zero ("kinds.text", "withImageEmbedding"), for logging.
 */
export function applyStatsDelta(stats: CaptureStats, delta: CaptureStats): { stats: CaptureStats; clamped: string[] } {
  const next = addStats(stats, delta);
  const clamped: string[] = [];
  for (const field of ["kinds", "statuses", "embedded"] as const) {
    for (const [k, n] of Object.entries(next[field])) {
      if (n < 0) {
        delete next[field][k];
        clamped.push(`${field}.${k}`);
      }
    }
  }
  if (next.withImageEmbedding < 0) {
    next.withImageEmbedding = 0;
    clamped.push("withImageEmbedding");
  }
  return { stats: next, clamped };
}

/**
 * Whether a backfill batch stops before the capture created at `nextTime`,
 * having counted `counted` captures, the last created at `lastTime`. It
 * stops once the batch is full or its read budget spent, but never between
 * two captures created at the same time: the batch's position is a creation
 * time ("everything at or before it is counted"), so a tie split across
 * batches would leave one of the pair uncounted while live writes treated
 * it as counted.
 */
export function backfillStopsBefore(
  nextTime: number,
  lastTime: number | null,
  counted: number,
  batchSize: number,
  budgetSpent: boolean
): boolean {
  return (counted >= batchSize || budgetSpent) && lastTime !== null && nextTime !== lastTime;
}

export function sumCounts(r: Record<string, number>): number {
  let n = 0;
  for (const x of Object.values(r)) n += x;
  return n;
}
