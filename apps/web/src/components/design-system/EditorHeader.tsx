"use client";

import Link from "next/link";
import { ArrowLeft, RotateCcw, Save } from "lucide-react";

export type EditorHeaderProps = {
  sessionHref: string;
  sessionName: string;
  description: string;
  notes: string[];
  sourceCount: number;
  sourceDomains: string[];
  generatedAt: number;
  edited: boolean;
  dirty: boolean;
  saving: boolean;
  /** Regenerated elsewhere while dirty: Save waits for the banner's choice. */
  conflict: boolean;
  /** Whether the draft differs from what the generator produced. */
  canReset: boolean;
  saveError: string | null;
  savedAt: number | null;
  onSave: () => void;
  onReset: () => void;
};

export default function EditorHeader(p: EditorHeaderProps) {
  const domains = p.sourceDomains.slice(0, 6);
  const more = p.sourceDomains.length - domains.length;

  return (
    <header className="border-b border-[var(--border)] px-4 py-5 sm:px-6">
      <Link
        href={p.sessionHref}
        className="mb-3 inline-flex items-center gap-1.5 text-[13px] text-[var(--text-muted)] transition-colors hover:text-[var(--text)]"
      >
        <ArrowLeft size={14} aria-hidden /> {p.sessionName}
      </Link>

      <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
        <div className="min-w-0 flex-1 basis-[320px]">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-[24px] font-semibold text-[var(--text)]">Design system</h1>
            {p.edited && <span className="chip">Edited</span>}
            {p.dirty && (
              <span className="chip !text-[var(--warning)]" role="status">
                Unsaved changes
              </span>
            )}
          </div>
          {p.description && (
            <p className="mt-1.5 max-w-[70ch] text-[13px] leading-5 text-[var(--text-muted)]">{p.description}</p>
          )}
          <p className="mt-1.5 text-[12px] text-[var(--text-subtle)]">
            Built from {p.sourceCount} capture{p.sourceCount === 1 ? "" : "s"}
            {domains.length > 0 && ` on ${domains.join(", ")}${more > 0 ? ` and ${more} more` : ""}`} ·{" "}
            generated {new Date(p.generatedAt).toLocaleString()}
          </p>
          {p.notes.length > 0 && (
            <details className="mt-2 text-[12px] text-[var(--text-muted)]">
              <summary className="cursor-pointer select-none text-[var(--text-muted)] hover:text-[var(--text)]">
                Generator notes ({p.notes.length})
              </summary>
              <ul className="mt-1.5 list-disc space-y-1 pl-5">
                {p.notes.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            </details>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="btn-secondary disabled:cursor-not-allowed disabled:opacity-50"
            onClick={p.onReset}
            disabled={!p.canReset || p.saving}
            title="Put the editor back to the generated tokens. Nothing is saved until you click Save."
          >
            <RotateCcw size={14} aria-hidden /> Reset to generated
          </button>
          <button
            type="button"
            className="btn-primary disabled:cursor-not-allowed disabled:opacity-50"
            onClick={p.onSave}
            disabled={!p.dirty || p.saving || p.conflict}
          >
            <Save size={14} aria-hidden /> {p.saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>

      <div role="status" aria-live="polite" className="text-[12px]">
        {p.saveError ? (
          <p className="mt-2 text-[var(--danger)]">{p.saveError}</p>
        ) : p.savedAt && !p.dirty ? (
          <p className="mt-2 text-[var(--text-subtle)]">Saved.</p>
        ) : null}
      </div>
    </header>
  );
}
