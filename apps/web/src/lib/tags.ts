/**
 * User tags as the detail view edits them, normalised the way the backend
 * stores them (captures.ts `normalizeUserTags`), so the chip the user sees
 * before the save is the one that comes back. Pure, for the vitest suite.
 */

export const MAX_USER_TAGS = 20;
export const MAX_TAG_LENGTH = 40;

/** Trimmed, lowercased, inner whitespace collapsed, cut to MAX_TAG_LENGTH; "" when nothing is left. */
export function normalizeTag(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, " ").slice(0, MAX_TAG_LENGTH).trim();
}

/**
 * `tags` plus whatever `input` holds (commas separate several), de-duplicated
 * and capped at MAX_USER_TAGS. Returns `tags` itself when nothing changes.
 */
export function addTags(tags: readonly string[], input: string): readonly string[] {
  const next = [...tags];
  for (const part of input.split(",")) {
    const tag = normalizeTag(part);
    if (tag && !next.includes(tag) && next.length < MAX_USER_TAGS) next.push(tag);
  }
  return next.length === tags.length ? tags : next;
}

export function removeTag(tags: readonly string[], tag: string): string[] {
  return tags.filter((t) => t !== tag);
}
