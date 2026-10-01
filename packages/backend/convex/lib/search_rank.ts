/**
 * Pure ranking helpers for capture search: keyword scoring and Reciprocal Rank
 * Fusion. No Convex imports, so they are unit-testable on their own.
 */
import { truncateUtf8 } from "./capture_text";

export type RankedHit = { id: string; score: number };

export type SourceName = "image" | "text" | "keyword";

export type SourceInfo = { rank: number; score: number };

export type FusedHit = {
  id: string;
  /** Sum of 1 / (k + rank) over every list the capture appears in. */
  fused: number;
  sources: Partial<Record<SourceName, SourceInfo>>;
};

const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "of", "for", "to", "in", "on", "with", "by", "at", "is", "it",
  // URL noise: present on almost every capture, so it never discriminates.
  "http", "https", "www",
]);

/**
 * Lowercase word tokens: split on anything that is not a letter or digit
 * ("page.example" -> page, example), stopwords and duplicates dropped. Used
 * for queries, stored `searchText` and keyword scoring alike, so all three
 * agree on what a word is whatever the search engine's own tokenizer does.
 */
export function tokenize(text: string): string[] {
  const terms = text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 0 && !STOPWORDS.has(t));
  return Array.from(new Set(terms));
}

/** Fields a keyword hit may come from, and how much a match in each counts. */
export const KEYWORD_FIELD_WEIGHTS = {
  title: 3,
  tags: 3,
  aiCategory: 3,
  aiTags: 2,
  aiStyle: 2,
  domain: 2,
  alt: 1,
  url: 1,
  content: 1,
} as const;

type KeywordField = keyof typeof KEYWORD_FIELD_WEIGHTS;

export type KeywordDoc = {
  title?: string | null;
  alt?: string | null;
  domain?: string | null;
  url?: string | null;
  tags?: string[] | null;
  aiTags?: string[] | null;
  aiStyle?: string[] | null;
  aiCategory?: string | null;
  /** text / code body */
  content?: string | null;
  /** link text */
  text?: string | null;
  href?: string | null;
};

/** Body text is capped: the start of a long selection says what it is about. */
const MAX_CONTENT_CHARS = 2000;
/** Stored searchText cap in UTF-8 bytes, well inside Convex's search field limits. */
const MAX_SEARCH_TEXT_BYTES = 8 * 1024;

function fieldText(doc: KeywordDoc, field: KeywordField): string {
  switch (field) {
    case "tags":
    case "aiTags":
    case "aiStyle":
      return (doc[field] ?? []).join(" ");
    case "content":
      return [doc.content, doc.text, doc.href]
        .filter(Boolean)
        .map((x) => String(x).slice(0, MAX_CONTENT_CHARS))
        .join(" ");
    default:
      return String(doc[field] ?? "");
  }
}

const FIELDS = Object.keys(KEYWORD_FIELD_WEIGHTS) as KeywordField[];

/**
 * The capture's words for the `search_text` full-text index: title, alt,
 * domain, url, user tags, AI category/styles/tags and text content, already
 * tokenized and space-joined. Recompute it whenever any of those change.
 */
export function buildSearchText(doc: KeywordDoc): string {
  const words = tokenize(FIELDS.map((f) => fieldText(doc, f)).join(" ")).join(" ");
  const cut = truncateUtf8(words, MAX_SEARCH_TEXT_BYTES);
  if (cut === words) return words;
  return cut.slice(0, Math.max(0, cut.lastIndexOf(" ")));
}

/** Whether `term` matches a word of the field: whole word or word prefix, never mid-word. */
function matchesWord(words: string[], term: string): boolean {
  return words.some((w) => w.startsWith(term));
}

/**
 * Score a capture against query terms. Terms match whole words or word
 * prefixes ("form" matches "forms", not "platform"). Every term must match
 * some field (so "dark pricing" does not return every dark capture); each
 * term adds the weight of the best field it matched. Returns 0 for no match.
 */
export function keywordScore(doc: KeywordDoc, terms: string[]): number {
  if (terms.length === 0) return 0;
  const fieldWords = FIELDS.map((f) => [f, tokenize(fieldText(doc, f))] as const);
  let total = 0;
  for (const term of terms) {
    let best = 0;
    for (const [field, words] of fieldWords) {
      if (matchesWord(words, term)) best = Math.max(best, KEYWORD_FIELD_WEIGHTS[field]);
    }
    if (best === 0) return 0;
    total += best;
  }
  return total;
}

/**
 * Reciprocal Rank Fusion. Each list must already be sorted best first; only
 * ranks matter, so lists scored on incomparable scales (cosines from two
 * embedding spaces, keyword weights) combine without calibration.
 */
export function rrfFuse(
  lists: Partial<Record<SourceName, RankedHit[]>>,
  k: number
): FusedHit[] {
  const byId = new Map<string, FusedHit>();
  for (const [name, hits] of Object.entries(lists) as Array<[SourceName, RankedHit[] | undefined]>) {
    (hits ?? []).forEach((hit, i) => {
      const rank = i + 1;
      const entry = byId.get(hit.id) ?? { id: hit.id, fused: 0, sources: {} };
      // A list should not name the same capture twice; keep its best rank.
      if (entry.sources[name]) return;
      entry.sources[name] = { rank, score: hit.score };
      entry.fused += 1 / (k + rank);
      byId.set(hit.id, entry);
    });
  }
  return Array.from(byId.values()).sort(
    (a, b) =>
      b.fused - a.fused ||
      // Ties (same ranks in different lists) go to the capture found by more sources.
      Object.keys(b.sources).length - Object.keys(a.sources).length
  );
}

/** Cosine similarity; -1 for vectors of different or zero length. */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (!a.length || !b.length || a.length !== b.length) return -1;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb) || 1e-9;
  return dot / denom;
}

type Scorable = KeywordDoc & { _id: string; _creationTime: number };

/** Keyword hits among `docs`: every term must match; best first, ties newest first. */
export function rankByKeyword(docs: Scorable[], terms: string[]): RankedHit[] {
  if (terms.length === 0) return [];
  return docs
    .map((d) => ({ id: d._id, score: keywordScore(d, terms), t: d._creationTime }))
    .filter((h) => h.score > 0)
    .sort((a, b) => b.score - a.score || b.t - a.t)
    .map(({ id, score }) => ({ id, score }));
}

/**
 * Exact nearest neighbours over `docs`, as a vector index would return
 * them: cosine of `query` with each doc's `vectorOf` vector, at or above
 * `floor`, best first. Docs without a vector of the query's size are skipped.
 */
export function rankByCosine<D extends { _id: string }>(
  docs: D[],
  vectorOf: (d: D) => unknown,
  query: number[],
  floor: number
): RankedHit[] {
  const out: RankedHit[] = [];
  for (const d of docs) {
    const v = vectorOf(d);
    if (!Array.isArray(v) || v.length !== query.length) continue;
    const score = cosineSimilarity(query, v as number[]);
    if (score >= floor) out.push({ id: d._id, score });
  }
  return out.sort((a, b) => b.score - a.score);
}
