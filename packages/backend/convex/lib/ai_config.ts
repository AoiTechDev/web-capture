/**
 * The local model and everything that depends on it, in one place.
 *
 * Switching models: change LOCAL_MODEL_ID and LOCAL_EMBEDDING_DIM here. The
 * schema's vector indexes, the backend's dimension checks, the extension's
 * offscreen model and its label-vector cache all read these, so nothing else
 * needs editing (a dimension change still needs a schema push, and existing
 * vectors of the old size must be re-embedded). The score calibration below
 * (floors, match bands, logit scale) is per model and must be re-measured.
 */

/**
 * Transformers.js (@huggingface/transformers) model the extension runs
 * locally. SigLIP2 base, 384 px: on a benchmark of 100 website screenshots it
 * beat CLIP B/32 on text->image MRR (EN .82 vs .47, PL .59 vs .08).
 */
export const LOCAL_MODEL_ID = "onnx-community/siglip2-base-patch16-384-ONNX";

/** Pooled output size of LOCAL_MODEL_ID; both vector indexes use it. */
export const LOCAL_EMBEDDING_DIM = 768;

/**
 * ONNX weights per tower. Vision must not be q8 (retrieval quality collapses
 * on this model); q4 was as good as fp16 in the benchmark at a third of the size.
 */
export const LOCAL_VISION_DTYPE = "q4";
export const LOCAL_TEXT_DTYPE = "q8";
/** SigLIP was trained on fixed-length text: always pad to this many tokens. */
export const LOCAL_TEXT_MAX_TOKENS = 64;

/**
 * SigLIP2 base/16-384's learned logit scale and bias, read from the original
 * weights (google/siglip2-base-patch16-384: logit_scale 4.7260 -> exp = 112.85,
 * logit_bias -16.77). The ONNX towers do not include them. P(match) =
 * sigmoid(SCALE x cosine + BIAS); within one label set the bias cancels, so
 * zero-shot ranking only needs SCALE.
 */
export const SIGLIP_LOGIT_SCALE = 112.846;
export const SIGLIP_LOGIT_BIAS = -16.772;

/**
 * Phrasing for queries matched against image captures. SigLIP2 does best on
 * the raw query (a "screenshot of a website showing ..." caption did not help
 * in English and hurt in Polish), so this is the identity. `{query}` is replaced.
 */
export const IMAGE_QUERY_TEMPLATE = "{query}";

/** The text to embed for a query. With SigLIP2 one vector serves both indexes. */
export function imageQueryText(query: string): string {
  return IMAGE_QUERY_TEMPLATE.replace("{query}", query.trim());
}

/** Longest query (characters) the extension embeds for the dashboard. */
export const EMBED_QUERY_MAX_CHARS = 200;

/**
 * Search tuning. Floors only drop the hopeless: ranking (and fusion with the
 * other lists) decides the order, so they sit well below a typical match.
 * Measured on the benchmark (SigLIP2-384, text q8, vision q4):
 *  - query -> screenshot cosines: correct pairs median 0.16 (EN) / 0.11 (PL),
 *    5th percentile 0.11 / 0.08; unrelated pairs median 0.08, rarely below 0.03.
 *  - query -> text cosines: SigLIP's text space is crowded, correct median 0.82,
 *    unrelated 0.79, junk queries 0.70-0.84. Only near-orthogonal text is dropped.
 */
export const SEARCH_TUNING = {
  /**
   * Cosine floor for query -> image-capture hits. Weak but real matches reach
   * down to ~0.05, so the floor sits below that (CLIP's was 0.18, which would
   * drop nearly every SigLIP2 match); only near-orthogonal hits are cut.
   */
  imageMinScore: 0.03,
  /** Cosine floor for query -> text-capture hits (CLIP's was 0.6). Below every junk query measured. */
  textMinScore: 0.7,
  /*
   * The floors alone admit nearly every capture (an unrelated screenshot
   * scores ~0.08, unrelated text ~0.79), so a junk query fills the grid and
   * "No matches" never shows. A hit found ONLY by a vector search (no keyword
   * match) must therefore also reach its space's display band (matchScore
   * above 0) and come within a margin of the best cosine in its space for
   * this query: SigLIP2's absolute cosines shift with the query, but a real
   * match stands out from the rest of the library by more than the noise
   * between unrelated captures. Keyword-matched hits keep only the floors.
   */
  /**
   * Image space: correct pairs (median 0.16) sit ~0.08 above unrelated ones
   * (median 0.08), so 0.06 keeps matches near the top and cuts the
   * unrelated bulk under a real match.
   */
  imageRelativeMargin: 0.06,
  /**
   * Text space: crowded (correct median 0.82, unrelated 0.79), so the margin
   * cuts little on its own; it mostly keeps a strong match (>= 0.88) from
   * dragging in everything above the band's low end.
   */
  textRelativeMargin: 0.06,
  /** Candidates fetched from each vector index. */
  vectorCandidates: 64,
  /** Reciprocal Rank Fusion constant: 1 / (k + rank). 60 is the usual default. */
  rrfK: 60,
} as const;

/**
 * Cosine bands mapped linearly onto a 0-1 "match" for display: at or below
 * the first value is 0, at or above the second is 1. Raw cosines are not
 * comparable across the two spaces (image hits ~0.1-0.2, text hits ~0.8), and
 * SigLIP's own sigmoid is too harsh for short queries (a correct Polish match
 * scores ~1%), so the bands come from the benchmark: a typical correct English
 * match shows ~75%, a typical unrelated screenshot ~20%.
 */
export const MATCH_DISPLAY_BANDS = {
  image: [0.05, 0.2],
  text: [0.75, 0.95],
} as const;

function band(cosine: number, [lo, hi]: readonly [number, number]): number {
  return Math.min(1, Math.max(0, (cosine - lo) / (hi - lo)));
}

/** Display match (0-1) from a hit's per-space cosines; null when neither is present. */
export function matchScore(sources: { image?: { score: number }; text?: { score: number } }): number | null {
  const scores: number[] = [];
  if (typeof sources.image?.score === "number") scores.push(band(sources.image.score, MATCH_DISPLAY_BANDS.image));
  if (typeof sources.text?.score === "number") scores.push(band(sources.text.score, MATCH_DISPLAY_BANDS.text));
  return scores.length ? Number(Math.max(...scores).toFixed(4)) : null;
}

/** Enrichment attempts before a capture is marked `failed` (1 try + 1 automatic retry). */
export const AI_MAX_ATTEMPTS = 2;

/** A capture left `processing` longer than this is assumed abandoned (worker died). */
export const AI_STALE_PROCESSING_MS = 5 * 60 * 1000;
