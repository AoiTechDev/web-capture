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
import { useCachedQuery } from "@/hooks/useStableQuery";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";
import { setTypography, tokensEqual } from "@/lib/design-system/edit";
import { convexErrorMessage } from "@/lib/design-system/errors";
import EditorHeader from "./EditorHeader";
import ExportPanel from "./ExportPanel";
import GenerateDesignSystem from "./GenerateDesignSystem";
import Preview from "./Preview";
import TokenEditor from "./TokenEditor";

/** Trim the font names and check the draft with the backend's validator before saving. */
export function prepareForSave(t: DesignSystemTokens): DesignSystemTokens {
  const trimmed = setTypography(t, {
    fontHeading: t.typography.fontHeading.replace(/\s+/g, " ").trim(),
    fontBody: t.typography.fontBody.replace(/\s+/g, " ").trim(),
  });
  return validateTokens(trimmed);
}

export default function DesignSystemEditor({ sessionId }: { sessionId: Id<"sessions"> }) {
  const row = useQuery(api.design_systems.getForSession, { sessionId });
  const { data: session } = useCachedQuery(api.sessions.getSession, { id: sessionId });
  const save = useMutation(api.design_systems.save);

  const [draft, setDraft] = useState<DesignSystemTokens | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  // Follow the stored tokens (first load, a save, a regenerate in another tab)
  // unless the user has edits in progress against the previous version.
  const baseRef = useRef<DesignSystemTokens | null>(null);
  const draftRef = useRef<DesignSystemTokens | null>(null);
  draftRef.current = draft;
  const stored = row?.tokens;
  useEffect(() => {
    if (!stored) return;
    const base = baseRef.current;
    const current = draftRef.current;
    if (!current || !base || tokensEqual(current, base)) setDraft(stored);
    baseRef.current = stored;
  }, [stored]);

  const dirty = !!draft && !!stored && !tokensEqual(draft, stored);
  useUnsavedChangesGuard(dirty);

  const contrast = useMemo(() => (draft ? checkContrast(draft) : []), [draft]);
  const generated = row?.generatedTokens;
  // The stored description is a template over the saved tokens; follow the draft live.
  const description = useMemo(() => {
    if (!draft) return "";
    try {
      return describeTokens(draft);
    } catch {
      return "";
    }
  }, [draft]);

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

  if (row === null || !draft) {
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

  const onSave = async () => {
    setSaveError(null);
    let tokens: DesignSystemTokens;
    try {
      tokens = prepareForSave(draft);
    } catch (e) {
      setSaveError(convexErrorMessage(e, "Saving failed."));
      return;
    }
    setSaving(true);
    try {
      await save({ designSystemId: row._id, tokens });
      // Adopt the cleaned tokens now so the editor doesn't flash "unsaved"
      // before the query delivers the saved row; as long as nothing is edited
      // meanwhile, the stored row then replaces the draft (see the effect).
      baseRef.current = tokens;
      setDraft(tokens);
      setSavedAt(Date.now());
    } catch (e) {
      setSaveError(convexErrorMessage(e, "Saving failed."));
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
        canReset={!!generated && !tokensEqual(draft, generated)}
        saveError={saveError}
        savedAt={savedAt}
        onSave={onSave}
        onReset={() => {
          if (generated) setDraft(generated);
          setSaveError(null);
        }}
      />

      <div className="grid min-w-0 gap-6 p-4 sm:p-6 lg:grid-cols-[minmax(300px,380px)_minmax(0,1fr)]">
        <aside
          aria-label="Tokens"
          className="surface-card min-w-0 self-start lg:sticky lg:top-6 lg:max-h-[calc(100vh-3rem)] lg:overflow-y-auto"
        >
          <TokenEditor tokens={draft} contrast={contrast} onChange={setDraft} />
        </aside>

        <div className="min-w-0 space-y-6">
          <Preview tokens={draft} />
          <ExportPanel tokens={draft} />
        </div>
      </div>
    </main>
  );
}
