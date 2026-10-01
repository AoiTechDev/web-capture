"use client";

import { AlertTriangle } from "lucide-react";

/**
 * Shown when the design system was regenerated (another tab or device) while
 * this editor had unsaved edits: drop them for the new generation, or keep
 * them and save them over it.
 */
export default function RegeneratedBanner({
  busy,
  onDiscard,
  onKeep,
}: {
  busy: boolean;
  onDiscard: () => void;
  onKeep: () => void;
}) {
  return (
    <div
      role="alert"
      className="mx-4 mt-4 flex flex-wrap items-center gap-3 rounded-[var(--radius)] border border-[var(--warning)] bg-[var(--surface)] px-4 py-3 sm:mx-6"
    >
      <AlertTriangle size={16} className="flex-none text-[var(--warning)]" aria-hidden />
      <div className="min-w-0 flex-1 basis-[240px] text-[13px]">
        <p className="font-medium text-[var(--text)]">Regenerated elsewhere</p>
        <p className="text-[var(--text-muted)]">
          This design system was regenerated after you started editing. Keep your edits to save them over the new
          generation, or discard them to see it.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn-secondary disabled:opacity-50" onClick={onDiscard} disabled={busy}>
          Discard my edits
        </button>
        <button type="button" className="btn-primary disabled:opacity-50" onClick={onKeep} disabled={busy}>
          {busy ? "Saving…" : "Keep mine"}
        </button>
      </div>
    </div>
  );
}
