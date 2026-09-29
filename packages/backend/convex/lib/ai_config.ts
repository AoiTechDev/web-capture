/**
 * The local model and everything that depends on it, in one place.
 *
 * Switching models: change LOCAL_MODEL_ID and LOCAL_EMBEDDING_DIM here. The
 * schema's vector indexes, the backend's dimension checks, the extension's
 * offscreen model and its label-vector cache all read these, so nothing else
 * needs editing (a dimension change still needs a schema push, and existing
 * vectors of the old size must be re-embedded).
 */

/** Transformers.js model the extension (and later the dashboard) runs locally. */
export const LOCAL_MODEL_ID = "Xenova/clip-vit-base-patch32";

/** Projection size of LOCAL_MODEL_ID; both vector indexes use it. */
export const LOCAL_EMBEDDING_DIM = 512;

/**
 * Caption phrasing for queries matched against image captures. CLIP was
 * trained on captions, so "a screenshot of a website showing pricing" lands
 * nearer a pricing screenshot than the bare word does. `{query}` is replaced.
 */
export const IMAGE_QUERY_TEMPLATE = "a screenshot of a website showing {query}";

/** The text to embed for an image-space query. Text captures take the raw query. */
export function imageQueryText(query: string): string {
  return IMAGE_QUERY_TEMPLATE.replace("{query}", query.trim());
}

/**
 * Search tuning. Floors only drop the hopeless: ranking (and fusion with the
 * other lists) decides the order, so they sit well below a typical match.
 */
export const SEARCH_TUNING = {
  /** Cosine floor for query -> image-capture hits (CLIP text/image cosines run ~0.15-0.35). */
  imageMinScore: 0.18,
  /** Cosine floor for query -> text-capture hits (CLIP text/text cosines run much higher). */
  textMinScore: 0.6,
  /** Candidates fetched from each vector index. */
  vectorCandidates: 64,
  /** Reciprocal Rank Fusion constant: 1 / (k + rank). 60 is the usual default. */
  rrfK: 60,
} as const;

/** Enrichment attempts before a capture is marked `failed` (1 try + 1 automatic retry). */
export const AI_MAX_ATTEMPTS = 2;

/** A capture left `processing` longer than this is assumed abandoned (worker died). */
export const AI_STALE_PROCESSING_MS = 5 * 60 * 1000;
