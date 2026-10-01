/**
 * Bounds on the text a capture stores, and the one tag normalisation every
 * write path uses. Pure: no Convex imports, so it is unit-testable on its own.
 */

/* ---------- text caps ---------- */

/**
 * UTF-8 byte caps per text field, applied on every write. Longer input is
 * cut (at a character boundary), not refused, and the capture is flagged
 * `truncated`.
 *
 * Why: browse and search read hundreds of captures per query, and a Convex
 * query may read 16 MiB in all. At these caps the text fields of one capture
 * total at most ~58 KiB (content 32 KiB, the rest ~26 KiB; a capture holds
 * either `content` or `text`, never both), plus `searchText` (8 KiB,
 * lib/search_rank), a 768-d vector (6 KiB) and on element captures the DNA
 * (~13 KiB). The scans themselves are bounded in bytes as well as in
 * captures (lib/read_budget), so captures stored before these caps existed
 * cannot push a query over the limit either.
 */
export const TEXT_CAPS = {
  /** text / code body (and the optional screenshot body). */
  content: 32 * 1024,
  /** link text */
  text: 4 * 1024,
  title: 1024,
  alt: 2048,
  note: 4096,
  caption: 2048,
  url: 4096,
  src: 4096,
  href: 4096,
  tagName: 64,
  category: 128,
  domain: 256,
} as const;

export type CappedField = keyof typeof TEXT_CAPS;

/** UTF-8 length of a string (a lone surrogate counts 3, as its replacement character). */
export function utf8Length(s: string): number {
  let bytes = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) bytes += 1;
    else if (c < 0x800) bytes += 2;
    else if (c >= 0xd800 && c <= 0xdbff && (s.charCodeAt(i + 1) & 0xfc00) === 0xdc00) {
      bytes += 4;
      i++;
    } else bytes += 3;
  }
  return bytes;
}

/** The longest prefix of `s` whose UTF-8 encoding fits in `maxBytes`; never splits a surrogate pair. */
export function truncateUtf8(s: string, maxBytes: number): string {
  // Every UTF-16 unit encodes to at most 3 bytes.
  if (s.length * 3 <= maxBytes) return s;
  let bytes = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    const pair = c >= 0xd800 && c <= 0xdbff && (s.charCodeAt(i + 1) & 0xfc00) === 0xdc00;
    const n = c < 0x80 ? 1 : c < 0x800 ? 2 : pair ? 4 : 3;
    if (bytes + n > maxBytes) return s.slice(0, i);
    bytes += n;
    if (pair) i++;
  }
  return s;
}

/**
 * `fields` with every capped text field cut to TEXT_CAPS, and whether any
 * was cut. Fields that are absent or not strings are left as they are.
 */
export function capCaptureText<T extends object>(fields: T): { fields: T; truncated: boolean } {
  const out: Record<string, unknown> = { ...(fields as Record<string, unknown>) };
  let truncated = false;
  for (const [key, max] of Object.entries(TEXT_CAPS)) {
    const value = out[key];
    if (typeof value !== "string") continue;
    const cut = truncateUtf8(value, max);
    if (cut !== value) {
      out[key] = cut;
      truncated = true;
    }
  }
  return { fields: out as T, truncated };
}

/* ---------- user tags ---------- */

/** Most user tags one capture keeps, and the longest tag kept (characters). */
export const MAX_USER_TAGS = 20;
export const MAX_TAG_LENGTH = 40;

/** One tag as stored: trimmed, lowercased, inner whitespace collapsed, cut to MAX_TAG_LENGTH; "" when nothing is left. */
export function normalizeTag(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, " ").slice(0, MAX_TAG_LENGTH).trim();
}

/**
 * User tags as stored, on every path that writes them (uploadCapture,
 * saveImageCapture, applyAutoMetadata, setCaptureTags) and as the tag list
 * (recordTagUse) counts them: each normalised with `normalizeTag`, empties
 * and duplicates dropped, at most MAX_USER_TAGS kept in the order given.
 * A longer list, such as a capture saved before the cap with more tags,
 * keeps its first MAX_USER_TAGS distinct tags, deterministically.
 */
export function normalizeUserTags(tags: readonly string[]): string[] {
  const out: string[] = [];
  for (const raw of tags) {
    const tag = normalizeTag(raw);
    if (tag && !out.includes(tag)) out.push(tag);
    if (out.length === MAX_USER_TAGS) break;
  }
  return out;
}
