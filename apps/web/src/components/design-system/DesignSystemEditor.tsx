"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../../packages/backend/convex/_generated/api";
import type { Id } from "../../../../../packages/backend/convex/_generated/dataModel";
import { checkContrast } from "../../../../../packages/backend/convex/lib/design_system/contrast";
import { describeTokens } from "../../../../../packages/backend/convex/lib/design_system/describe";
import type { DesignSystemTokens } from "../../../../../packages/backend/convex/lib/design_system/types";
import { validateTokens } from "../../../../../packages/backend/convex/lib/design_system/validate";
import { useGoogleFontsOptIn } from "@/hooks/useGoogleFontsOptIn";
import { useCachedQuery } from "@/hooks/useStableQuery";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";
import { draftAfterSave, isDirty, isRegenConflict, isRegeneratedElsewhere, shownTokens } from "@/lib/design-system/draft";
import { setTypography, tokensEqual } from "@/lib/design-system/edit";
import { convexErrorMessage } from "@/lib/design-system/errors";
import { familyName } from "@/lib/design-system/fonts";
import EditorHeader from "./EditorHeader";
import ExportPanel from "./ExportPanel";
import GenerateDesignSystem from "./GenerateDesignSystem";
import Preview from "./Preview";
import RegeneratedBanner from "./RegeneratedBanner";
import TokenEditor from "./TokenEditor";

/** Clean the font names as the backend does and check the draft with its validator before saving. */
export function prepareForSave(t: DesignSystemTokens): DesignSystemTokens {
  const trimmed = setTypography(t, {
    fontHeading: familyName(t.typography.fontHeading) || t.typography.fontHeading.trim(),
    fontBody: familyName(t.typography.fontBody) || t.typography.fontBody.trim(),
  });
  return validateTokens(trimmed);
}

export default function DesignSystemEditor({ sessionId }: { sessionId: Id<"sessions"> }) {
  const row = useQuery(api.design_systems.getForSession, { sessionId });
  const { data: session } = useCachedQuery(api.sessions.getSession, { id: sessionId });
  const save = useMutation(api.design_systems.save);
  const [googleFonts, setGoogleFonts] = useGoogleFontsOptIn();

  // null = showing the stored tokens; set from the first edit (see draft.ts).
  const [draft, setDraft] = useState<DesignSystemTokens | null>(null);
  // The generation the draft's edits started from (save's expectedGeneratedAt).
  const [baseGeneratedAt, setBaseGeneratedAt] = useState<number | null>(null);
  const [lastSaved, setLastSaved] = useState<DesignSystemTokens | null>(null);
  const [serverRefused, setServerRefused] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;

  const stored = row?.tokens;
  const tokens = shownTokens(draft, stored);
  const dirty = isDirty(draft, stored, lastSaved);
  const conflict = isRegenConflict({
    dirty,
    baseGeneratedAt,
    rowGeneratedAt: row?.generatedAt,
    serverRefused,
  });

  // Once the stored row catches up with a save, drop the bridge, and drop a
  // draft that no longer differs, so the editor follows the row again.
  useEffect(() => {
    if (!stored) return;
    if (lastSaved && tokensEqual(stored, lastSaved)) setLastSaved(null);
    const current = draftRef.current;
    if (current && tokensEqual(current, stored) && !lastSaved) {
      setDraft(null);
      setBaseGeneratedAt(null);
    }
  }, [stored, lastSaved]);

  useUnsavedChangesGuard(dirty);

  const contrast = useMemo(() => (tokens ? checkContrast(tokens) : []), [tokens]);
  // The stored description is a template over the saved tokens; follow the draft live.
  const description = useMemo(() => {
    if (!tokens) return "";
    try {
      return describeTokens(tokens);
    } catch {
      return "";
    }
  }, [tokens]);

  if (row === undefined) {
    return (
      <main className="flex-1 overflow-y-auto p-6" aria-busy="true">
        <div className="h-3 w-24 animate-pulse rounded bg-[var(--surface)]" />
        <div className="mt-3 h-6 w-56 animate-pulse rounded bg-[var(--surface)]" />
        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(300px,380px)_1fr]">
          <div className="h-[480px] animate-pulse rounded-[var(--radius)] bg-[var(--surface)]" />
          <div className="h-[480px] animate-pulse rounded-[var(--radius)] bg-[var(--surface)]" />
        </div>
      </main>
    );
  }

  const sessionHref = `/dashboard/sessions/${encodeURIComponent(sessionId)}`;
  const sessionName = (session as { displayName?: string } | null | undefined)?.displayName ?? "Session";

  if (row === null || !tokens) {
    return (
      <main className="flex-1 overflow-y-auto p-6">
        <Link href={sessionHref} className="text-[13px] text-[var(--text-muted)] hover:text-[var(--text)]">
          ← {sessionName}
        </Link>
        <h1 className="mt-3 text-[24px] font-semibold text-[var(--text)]">Design system</h1>
        <p className="mt-2 text-[13px] text-[var(--text-muted)]">This session has no design system yet.</p>
        <div className="mt-4">
          <GenerateDesignSystem sessionId={sessionId} showOpen={false} />
        </div>
      </main>
    );
  }

  const edit = (next: DesignSystemTokens) => {
    if (draft === null) setBaseGeneratedAt(row.generatedAt);
    setDraft(next);
  };

  /** Save the draft against `expectedGeneratedAt` (the draft's base, or the new generation for "Keep mine"). */
  const saveDraft = async (expectedGeneratedAt: number) => {
    if (!draft) return;
    setSaveError(null);
    let cleaned: DesignSystemTokens;
    try {
      cleaned = prepareForSave(draft);
    } catch (e) {
      setSaveError(convexErrorMessage(e, "Saving failed."));
      return;
    }
    const submitted = draft;
    setSaving(true);
    try {
      await save({ designSystemId: row._id, tokens: cleaned, expectedGeneratedAt });
      setLastSaved(cleaned);
      setBaseGeneratedAt(expectedGeneratedAt);
      setServerRefused(false);
      // Edits made while the save was in flight stay in the draft.
      setDraft(draftAfterSave(draftRef.current, submitted, cleaned));
      setSavedAt(Date.now());
    } catch (e) {
      if (isRegeneratedElsewhere(e)) setServerRefused(true);
      else setSaveError(convexErrorMessage(e, "Saving failed."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="flex min-w-0 flex-1 flex-col overflow-y-auto">
      <EditorHeader
        sessionHref={sessionHref}
        sessionName={sessionName}
        description={dirty ? description || row.description : row.description}
        notes={row.notes}
        sourceCount={row.sourceCount}
        sourceDomains={row.sourceDomains}
        generatedAt={row.generatedAt}
        edited={row.edited}
        dirty={dirty}
        saving={saving}
        conflict={conflict}
        canReset={!tokensEqual(tokens, row.generatedTokens)}
        saveError={saveError}
        savedAt={savedAt}
        onSave={() => void saveDraft(baseGeneratedAt ?? row.generatedAt)}
        onReset={() => {
          edit(row.generatedTokens);
          setSaveError(null);
        }}
      />

      {conflict && (
        <RegeneratedBanner
          busy={saving}
          onDiscard={() => {
            setDraft(null);
            setBaseGeneratedAt(null);
            setLastSaved(null);
            setServerRefused(false);
            setSaveError(null);
          }}
          onKeep={() => void saveDraft(row.generatedAt)}
        />
      )}

      <div className="grid min-w-0 gap-6 p-4 sm:p-6 lg:grid-cols-[minmax(300px,380px)_minmax(0,1fr)]">
        <aside
          aria-label="Tokens"
          className="surface-card min-w-0 self-start lg:sticky lg:top-6 lg:max-h-[calc(100vh-3rem)] lg:overflow-y-auto"
        >
          <TokenEditor
            tokens={tokens}
            contrast={contrast}
            onChange={edit}
            googleFonts={googleFonts}
            onGoogleFontsChange={setGoogleFonts}
          />
        </aside>

        <div className="min-w-0 space-y-6">
          <Preview tokens={tokens} googleFonts={googleFonts} />
          <ExportPanel tokens={tokens} />
        </div>
      </div>
    </main>
  );
}
