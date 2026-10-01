/**
 * The editor's draft bookkeeping, kept pure so the chrome-extension vitest
 * suite can test it. The draft is null while the editor just shows the stored
 * tokens; it holds the user's tokens from their first edit until they are
 * saved (and the saved row has arrived) or discarded.
 */
import {
  REGENERATED_ELSEWHERE,
  type DesignSystemTokens,
} from "../../../../../packages/backend/convex/lib/design_system/types";
import { tokensEqual } from "./edit";

/** What the editor shows: the draft, or the stored tokens until there is one. */
export function shownTokens(
  draft: DesignSystemTokens | null,
  stored: DesignSystemTokens | undefined
): DesignSystemTokens | undefined {
  return draft ?? stored;
}

/**
 * Unsaved edits: a draft that differs from what was last saved. `lastSaved`
 * bridges the gap between a save resolving and the query delivering it.
 */
export function isDirty(
  draft: DesignSystemTokens | null,
  stored: DesignSystemTokens | undefined,
  lastSaved: DesignSystemTokens | null
): boolean {
  const reference = lastSaved ?? stored;
  return !!draft && !!reference && !tokensEqual(draft, reference);
}

/**
 * The draft after a save resolves. Edits made while the save was in flight
 * are kept; otherwise the draft becomes the cleaned tokens that were saved.
 */
export function draftAfterSave(
  current: DesignSystemTokens | null,
  submitted: DesignSystemTokens,
  saved: DesignSystemTokens
): DesignSystemTokens | null {
  if (!current) return saved;
  return tokensEqual(current, submitted) ? saved : current;
}

/**
 * The row was regenerated (another tab or device) after the draft's edits
 * began: the edits sit on a generation that no longer exists.
 */
export function isRegenConflict(args: {
  dirty: boolean;
  baseGeneratedAt: number | null;
  rowGeneratedAt: number | undefined;
  serverRefused: boolean;
}): boolean {
  if (!args.dirty) return false;
  if (args.serverRefused) return true;
  return args.baseGeneratedAt !== null && args.rowGeneratedAt !== undefined && args.baseGeneratedAt !== args.rowGeneratedAt;
}

/**
 * `save`'s refusal because the row was regenerated since the edits began: a
 * ConvexError whose data is REGENERATED_ELSEWHERE. Matched by shape rather
 * than instanceof, which fails when two copies of the convex package meet.
 */
export function isRegeneratedElsewhere(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const err = e as { name?: unknown; data?: unknown };
  return err.name === "ConvexError" && err.data === REGENERATED_ELSEWHERE;
}
