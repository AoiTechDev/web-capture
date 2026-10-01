"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { Palette, RefreshCw } from "lucide-react";
import { api } from "../../../../../packages/backend/convex/_generated/api";
import type { Id } from "../../../../../packages/backend/convex/_generated/dataModel";
import { useArmedConfirm } from "@/hooks/useArmedConfirm";
import { convexErrorMessage } from "@/lib/design-system/errors";

export function designSystemHref(sessionId: string): string {
  return `/dashboard/sessions/${encodeURIComponent(sessionId)}/design-system`;
}

/** "Needs 5 captures with Design DNA or colours, you have 3" */
export function eligibilityHint(count: number, need: number): string {
  return `Needs ${need} captures with Design DNA or colours, you have ${count}`;
}

/**
 * The session page's design system entry point: Generate when there is none
 * (disabled with a hint until the session has enough captures), otherwise
 * Open plus Regenerate, which asks again before replacing an edited system.
 */
export default function GenerateDesignSystem({
  sessionId,
  showOpen = true,
}: {
  sessionId: Id<"sessions">;
  /** The editor hides its own "Open" link. */
  showOpen?: boolean;
}) {
  const router = useRouter();
  const eligibility = useQuery(api.design_systems.eligibility, { sessionId });
  const existing = useQuery(api.design_systems.getForSession, { sessionId });
  const generate = useMutation(api.design_systems.generate);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { armed, arm, disarm } = useArmedConfirm(undefined, busy);

  const loading = eligibility === undefined || existing === undefined;
  const eligible = eligibility?.eligible ?? false;

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await generate({ sessionId });
      if (!res.ok) {
        setError(eligibilityHint(res.count, res.need));
        return;
      }
      if (!existing) router.push(designSystemHref(sessionId));
    } catch (e) {
      setError(convexErrorMessage(e, "Generation failed."));
    } finally {
      setBusy(false);
      disarm();
    }
  };

  if (loading) {
    return (
      <button type="button" className="btn-secondary" disabled aria-busy="true">
        <Palette size={14} aria-hidden /> Design system…
      </button>
    );
  }

  const hintId = `ds-hint-${sessionId}`;
  const hint = !eligible && eligibility ? eligibilityHint(eligibility.count, eligibility.need) : null;

  if (!existing) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="btn-primary disabled:cursor-not-allowed disabled:opacity-50"
          disabled={!eligible || busy}
          aria-describedby={hint ? hintId : undefined}
          onClick={run}
        >
          <Palette size={14} aria-hidden />
          {busy ? "Generating…" : "Generate design system"}
        </button>
        {hint && (
          <span id={hintId} className="text-[12px] text-[var(--text-muted)]">
            {hint}
          </span>
        )}
        {error && (
          <span role="alert" className="text-[12px] text-[var(--danger)]">
            {error}
          </span>
        )}
      </div>
    );
  }

  const regenLabel = busy ? "Regenerating…" : armed ? "Replace your edits? Click again" : "Regenerate";

  return (
    <div className="flex flex-wrap items-center gap-2">
      {showOpen && (
        <Link href={designSystemHref(sessionId)} className="btn-primary">
          <Palette size={14} aria-hidden /> Open design system
        </Link>
      )}
      <button
        type="button"
        className={`btn-secondary disabled:cursor-not-allowed disabled:opacity-50 ${
          armed ? "!border-[var(--warning)] !text-[var(--warning)]" : ""
        }`}
        disabled={!eligible || busy}
        aria-describedby={hint ? hintId : undefined}
        title={existing.edited ? "Replaces your saved edits with a fresh generation" : undefined}
        onClick={(e) => {
          if (existing.edited && !armed) {
            // Safari doesn't focus a clicked button; blur/Escape need focus to disarm.
            e.currentTarget.focus();
            arm();
            return;
          }
          void run();
        }}
        onMouseDown={(e) => e.preventDefault()}
        onBlur={() => {
          if (!busy) disarm();
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape" && armed) disarm();
        }}
      >
        <RefreshCw size={14} aria-hidden className={busy ? "animate-spin" : undefined} />
        {regenLabel}
      </button>
      {hint && (
        <span id={hintId} className="text-[12px] text-[var(--text-muted)]">
          {hint}
        </span>
      )}
      {error && (
        <span role="alert" className="text-[12px] text-[var(--danger)]">
          {error}
        </span>
      )}
    </div>
  );
}
