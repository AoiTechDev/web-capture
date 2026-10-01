"use client";

import { useState } from "react";
import { Trash } from "lucide-react";
import { useArmedConfirm } from "@/hooks/useArmedConfirm";

const BASE =
  "flex h-7 w-7 items-center justify-center rounded-md border backdrop-blur-sm transition-colors disabled:opacity-60";
const IDLE =
  "border-[var(--border-strong)] bg-[var(--bg)]/90 text-[var(--text-muted)] hover:border-[var(--danger)] hover:text-[var(--danger)]";
/** Filled, so it reads differently from the red hover of the idle button. */
const ARMED = "border-[var(--danger)] bg-[var(--danger)] text-white";

/**
 * A card's trash button behind a second click (useArmedConfirm): the first
 * click fills it red and asks again, a second click within a few seconds
 * deletes, and moving focus away, Escape or the timeout disarm it.
 */
export default function ConfirmDeleteButton({ onDelete }: { onDelete: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const { armed, arm, disarm } = useArmedConfirm(undefined, busy);
  const label = busy ? "Deleting…" : armed ? "Click again to delete" : "Delete";

  return (
    <button
      type="button"
      className={`${BASE} ${armed || busy ? ARMED : IDLE}`}
      title={label}
      aria-label={label}
      disabled={busy}
      onClick={async (e) => {
        e.stopPropagation();
        if (!armed) {
          // Safari does not focus a clicked button; without focus, blur and
          // Escape could not disarm it.
          e.currentTarget.focus();
          arm();
          return;
        }
        setBusy(true);
        try {
          await onDelete();
        } catch {
          // `onDelete` reports its own failure; the button goes back to its first state.
        } finally {
          setBusy(false);
          disarm();
        }
      }}
      // Keep focus on a mouse press, so a browser that blurs on mousedown
      // (Safari) cannot disarm the button before the second click lands.
      onMouseDown={(e) => e.preventDefault()}
      onBlur={() => {
        if (!busy) disarm();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape" && armed) {
          e.stopPropagation();
          disarm();
        }
      }}
    >
      <Trash className="h-3.5 w-3.5" />
    </button>
  );
}
