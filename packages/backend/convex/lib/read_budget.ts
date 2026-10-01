import { utf8Length } from "./capture_text";

/**
 * How many bytes of captures one query may read, and an estimate of what a
 * document costs. Pure: no Convex imports.
 *
 * Convex limits one query or mutation to 16 MiB read, 32,000 documents
 * scanned and 4,096 index ranges, with documents of at most 1 MiB. Browse
 * and search scan up to a few hundred captures, and a capture may be large
 * (up to ~80 KiB at the lib/capture_text caps, up to 1 MiB if stored before
 * them), so the scans are bounded in estimated bytes as well as in count.
 *
 * Worst case for one browse or search query:
 *   colour rows (search_scope MAX_COLOR_ROWS + 1)  15,001 x 256 B  =  3.7 MiB
 *   captures, up to CAPTURE_READ_BUDGET                               6.0 MiB
 *     + the two captures read past it (the one that
 *       crosses it, and browse's one-capture lookahead)
 *       at Convex's 1 MiB document maximum                            2.0 MiB
 *     + the newest capture (search's snapshot bound)                  1.0 MiB
 *   per-capture colour checks, only when the colour rows
 *     were cut off: <= 612 captures x 12 rows x 256 B                 1.8 MiB
 *   sessions and storage rows for <= 100 results                    < 0.2 MiB
 *   total                                                          < 14.7 MiB  (limit 16)
 * Documents: 15,001 + 612 + 612 x 12 + ~200 = ~23,200 (limit 32,000).
 * Index ranges: 2 colour ranges + <= 612 per-capture checks + a few (limit 4,096).
 * (612 = 100 keyword + 2 x 256 vector candidates, search's widest read;
 * browse examines at most 500.)
 *
 * At the lib/capture_text caps a capture is under ~80 KiB, so 6 MiB is at
 * least ~75 of the heaviest captures and usually the full 500: a typical
 * capture is a few KiB (6 KiB of it the 768-d vector).
 */
export const CAPTURE_READ_BUDGET = 6 * 1024 * 1024;

/**
 * Upper estimate of a value's stored size: strings as UTF-8 plus a small
 * header, numbers 9 bytes, field names counted. Deliberately generous so
 * the budget errs on the side of reading less.
 */
export function estimateBytes(value: unknown): number {
  if (value === null || value === undefined || typeof value === "boolean") return 1;
  if (typeof value === "number" || typeof value === "bigint") return 9;
  if (typeof value === "string") return utf8Length(value) + 2;
  if (value instanceof ArrayBuffer) return value.byteLength + 4;
  if (Array.isArray(value)) {
    let n = 2;
    for (const x of value) n += estimateBytes(x);
    return n;
  }
  let n = 2;
  for (const [k, x] of Object.entries(value as Record<string, unknown>)) n += k.length + 2 + estimateBytes(x);
  return n;
}

/** Bytes of captures read so far in one query, against CAPTURE_READ_BUDGET. */
export type ReadBudget = {
  /** Count a document just read. */
  charge(doc: unknown): void;
  /** Whether no further capture should be read (the last one may have crossed the line). */
  readonly exhausted: boolean;
  readonly used: number;
};

export function createReadBudget(limit = CAPTURE_READ_BUDGET): ReadBudget {
  let used = 0;
  return {
    charge(doc) {
      used += estimateBytes(doc);
    },
    get exhausted() {
      return used >= limit;
    },
    get used() {
      return used;
    },
  };
}
