"use client";

import { useEffect, useId, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import {
  AI_CATEGORIES,
  clampTolerance,
  COLOR_TOLERANCE,
  normalizeHexColor,
  toggle,
  TYPE_KEYS,
  TYPE_LABELS,
  type CaptureFilters,
  type DatePreset,
  type TypeKey,
} from "@/lib/capture-filters";

type SetFilters = (patch: Partial<CaptureFilters>) => void;

export type SessionOption = { id: string; displayName: string; startedAt: number };

/** The picker's list as useSessionOptions pages it. */
export type SessionList = {
  /** Undefined until the first page is in. */
  sessions: readonly SessionOption[] | undefined;
  canLoadMore: boolean;
  loadingMore: boolean;
  loadMore: () => void;
};

/** A toggle chip: a real button, with its state announced by aria-pressed. */
function ToggleChip({
  pressed,
  onClick,
  children,
}: {
  pressed: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={`inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-[12px] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--blue-500)] ${
        pressed
          ? "border-[var(--border-strong)] bg-[var(--surface-hover)] text-[var(--text)]"
          : "border-transparent text-[var(--text-muted)] hover:bg-[var(--surface)] hover:text-[var(--text)]"
      }`}
    >
      {children}
    </button>
  );
}

/**
 * Type chips for the header: "All", or any mix of the types. Counts come from
 * `captures.countsByKind`; Screenshots also counts element and viewport shots.
 */
export function TypeChips({
  selected,
  counts,
  onChange,
}: {
  selected: TypeKey[];
  counts: Record<string, number> | undefined;
  onChange: (types: TypeKey[]) => void;
}) {
  // Undefined while the count query is in flight; an em dash reads better
  // than a flash of "0" that then corrects itself.
  const countFor = (t: TypeKey | "all"): string => {
    if (!counts) return "—";
    if (t === "all") return String((counts.all ?? 0) - (counts.code ?? 0));
    const kinds = t === "screenshot" ? ["screenshot", "element", "viewport"] : [t];
    return String(kinds.reduce((sum, k) => sum + (counts[k] ?? 0), 0));
  };
  return (
    <div role="group" aria-label="Type" className="-mx-1 flex min-w-0 items-center gap-1 overflow-x-auto px-1">
      <ToggleChip pressed={selected.length === 0} onClick={() => onChange([])}>
        All
        <span className="text-[11px] tabular-nums text-[var(--text-subtle)]">{countFor("all")}</span>
      </ToggleChip>
      {TYPE_KEYS.map((t) => (
        <ToggleChip key={t} pressed={selected.includes(t)} onClick={() => onChange(toggle(selected, t))}>
          {TYPE_LABELS[t]}
          <span className="text-[11px] tabular-nums text-[var(--text-subtle)]">{countFor(t)}</span>
        </ToggleChip>
      ))}
    </div>
  );
}

const FIELD_LABEL = "mb-1.5 block text-[11px] font-medium uppercase tracking-[0.06em] text-[var(--text-subtle)]";

const DATE_OPTIONS: Array<{ key: DatePreset | "all" | "custom"; label: string }> = [
  { key: "all", label: "Any time" },
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
  { key: "custom", label: "Custom" },
];

function DateFilter({ filters, setFilters }: { filters: CaptureFilters; setFilters: SetFilters }) {
  const hasRange = !!(filters.from || filters.to);
  const [custom, setCustom] = useState(hasRange);
  const fromId = useId();
  const toId = useId();
  const mode = filters.date ?? (custom || hasRange ? "custom" : "all");

  return (
    <fieldset className="min-w-0">
      <legend className={FIELD_LABEL}>Date</legend>
      <div className="flex flex-wrap items-center gap-1">
        {DATE_OPTIONS.map(({ key, label }) => (
          <ToggleChip
            key={key}
            pressed={mode === key}
            onClick={() => {
              setCustom(key === "custom");
              if (key === "custom") setFilters({ date: null });
              else setFilters({ date: key === "all" ? null : key, from: null, to: null });
            }}
          >
            {label}
          </ToggleChip>
        ))}
      </div>
      {mode === "custom" && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <label htmlFor={fromId} className="text-[12px] text-[var(--text-muted)]">
            From
          </label>
          <input
            id={fromId}
            type="date"
            className="input-field w-auto"
            value={filters.from ?? ""}
            max={filters.to ?? undefined}
            onChange={(e) => setFilters({ date: null, from: e.target.value || null })}
          />
          <label htmlFor={toId} className="text-[12px] text-[var(--text-muted)]">
            to
          </label>
          <input
            id={toId}
            type="date"
            className="input-field w-auto"
            value={filters.to ?? ""}
            min={filters.from ?? undefined}
            onChange={(e) => setFilters({ date: null, to: e.target.value || null })}
          />
        </div>
      )}
    </fieldset>
  );
}

/**
 * Colour picker and ΔE tolerance. Both inputs fire continuously while
 * dragged, so the filter (and the URL, and the query) follows after a pause.
 */
function ColorFilter({ filters, setFilters }: { filters: CaptureFilters; setFilters: SetFilters }) {
  const pickerId = useId();
  const tolId = useId();
  const [draft, setDraft] = useState({ color: filters.color, tolerance: filters.tolerance });

  // Follow changes made elsewhere (a swatch click, clearing filters, the URL).
  useEffect(() => {
    setDraft({ color: filters.color, tolerance: filters.tolerance });
  }, [filters.color, filters.tolerance]);

  useEffect(() => {
    if (draft.color === filters.color && draft.tolerance === filters.tolerance) return;
    const t = window.setTimeout(() => setFilters({ color: draft.color, tolerance: draft.tolerance }), 250);
    return () => window.clearTimeout(t);
  }, [draft, filters.color, filters.tolerance, setFilters]);

  return (
    <fieldset className="min-w-0">
      <legend className={FIELD_LABEL}>Colour</legend>
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={pickerId} className="sr-only">
          Colour to match
        </label>
        <input
          id={pickerId}
          type="color"
          className="h-8 w-10 cursor-pointer rounded-md border border-[var(--border-strong)] bg-[var(--bg)] p-0.5"
          value={draft.color ?? "#808080"}
          onChange={(e) => setDraft((d) => ({ ...d, color: normalizeHexColor(e.target.value) }))}
        />
        <span className="mono w-16 text-[12px] text-[var(--text-muted)]">{draft.color ?? "Any"}</span>
        {draft.color && (
          <button
            type="button"
            className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-subtle)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
            aria-label="Clear colour"
            title="Clear colour"
            onClick={() => {
              setDraft((d) => ({ ...d, color: null }));
              setFilters({ color: null });
            }}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
        <label htmlFor={tolId} className="ml-1 text-[12px] text-[var(--text-muted)]">
          Tolerance
        </label>
        <input
          id={tolId}
          type="range"
          min={COLOR_TOLERANCE.min}
          max={COLOR_TOLERANCE.max}
          step={1}
          disabled={!draft.color}
          className="w-28 accent-[var(--blue-500)] disabled:opacity-40"
          value={draft.tolerance}
          aria-valuetext={`ΔE ${draft.tolerance}`}
          onChange={(e) => setDraft((d) => ({ ...d, tolerance: clampTolerance(Number(e.target.value)) }))}
        />
        <span className="w-6 text-[12px] tabular-nums text-[var(--text-subtle)]">{draft.tolerance}</span>
      </div>
    </fieldset>
  );
}

/** Session, date, colour and category filters, under the header. */
export function FilterPanel({
  id,
  filters,
  setFilters,
  sessions: list,
  selectedSession,
}: {
  id: string;
  filters: CaptureFilters;
  setFilters: SetFilters;
  sessions: SessionList;
  /** The URL's session once checked, so it shows even when older than the pages loaded. */
  selectedSession: SessionOption | null;
}) {
  const sessionId = useId();
  const sessions = list.sessions;
  const listed = sessions ?? [];
  const selected = filters.session
    ? (listed.find((s) => s.id === filters.session) ?? (selectedSession?.id === filters.session ? selectedSession : null))
    : null;
  const options = selected && !listed.some((s) => s.id === selected.id) ? [selected, ...listed] : listed;

  return (
    <section
      id={id}
      aria-label="Filters"
      className="shrink-0 space-y-3 border-b border-[var(--border)] px-4 py-3 sm:px-6"
    >
      <div className="flex flex-wrap items-start gap-x-8 gap-y-3">
        <div className="w-full min-w-0 sm:w-56">
          <label htmlFor={sessionId} className={FIELD_LABEL}>
            Session
          </label>
          <select
            id={sessionId}
            className="input-field"
            value={selected?.id ?? ""}
            disabled={!sessions}
            onChange={(e) => setFilters({ session: e.target.value || null })}
          >
            <option value="">All sessions</option>
            {options.map((s) => (
              <option key={s.id} value={s.id}>
                {s.displayName} · {new Date(s.startedAt).toLocaleDateString()}
              </option>
            ))}
          </select>
          {(list.canLoadMore || list.loadingMore) && (
            <button
              type="button"
              className="mt-1.5 text-[12px] text-[var(--text-muted)] transition-colors hover:text-[var(--text)] disabled:opacity-60"
              disabled={list.loadingMore}
              onClick={list.loadMore}
            >
              {list.loadingMore ? "Loading…" : "Show older sessions"}
            </button>
          )}
        </div>
        <DateFilter filters={filters} setFilters={setFilters} />
        <ColorFilter filters={filters} setFilters={setFilters} />
      </div>

      <fieldset className="min-w-0">
        <legend className={FIELD_LABEL}>Category</legend>
        <div className="flex flex-wrap gap-1">
          {AI_CATEGORIES.map((c) => (
            <ToggleChip
              key={c}
              pressed={filters.categories.includes(c)}
              onClick={() => setFilters({ categories: toggle(filters.categories, c) })}
            >
              {c}
            </ToggleChip>
          ))}
        </div>
      </fieldset>
    </section>
  );
}
