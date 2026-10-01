"use client";

import { useEffect, useId, useState, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import type { ContrastCheck } from "../../../../../packages/backend/convex/lib/design_system/types";
import { isValidFontName, MAX_FONT_NAME } from "../../../../../packages/backend/convex/lib/design_system/validate";
import { normalizeHex } from "@/lib/design-system/edit";
import { FONT_SUGGESTIONS } from "@/lib/design-system/fonts";

export const LABEL = "text-[12px] font-medium text-[var(--text-muted)]";

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-b border-[var(--border)] px-4 py-4 last:border-b-0">
      <h2 className="mb-3 text-[11px] font-medium uppercase tracking-[0.06em] text-[var(--text-subtle)]">{title}</h2>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

const PAIR_LABEL: Record<ContrastCheck["pair"], string> = {
  "text/background": "Text on background",
  "textMuted/background": "Muted text on background",
  "text/surface": "Text on surface",
  "textMuted/surface": "Muted text on surface",
  "primary/background": "Primary on background",
};

/**
 * "Text on background is 3.21:1, needs 4.5:1 (WCAG AA)" for each failing
 * check. The live region is always rendered (empty when all pass) so screen
 * readers announce a warning when it appears; `id` lets the colour inputs
 * reference it with aria-describedby.
 */
export function ContrastNotes({ id, checks }: { id: string; checks: ContrastCheck[] }) {
  const failing = checks.filter((c) => !c.passes);
  return (
    <div id={id} role="status" aria-live="polite">
      {failing.length > 0 && (
        <ul className="mt-1.5 space-y-1">
          {failing.map((c) => (
            <li key={c.pair} className="flex items-start gap-1.5 text-[12px] text-[var(--warning)]">
              <AlertTriangle size={13} className="mt-[1px] flex-none" aria-hidden />
              <span>
                {PAIR_LABEL[c.pair]} is {c.ratio.toFixed(2)}:1, needs {c.required}:1 (WCAG AA
                {c.required === 3 ? ", non-text" : ""})
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Colour picker plus a hex input; the hex is committed once it parses. */
export function ColorField({
  label,
  value,
  onChange,
  checks = [],
  children,
}: {
  label: string;
  value: string;
  onChange: (hex: string) => void;
  checks?: ContrastCheck[];
  children?: ReactNode;
}) {
  const id = useId();
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const invalid = normalizeHex(draft) === null;
  const contrastId = `${id}-contrast`;
  // Both inputs point at the contrast warnings; the hex field also at its error.
  const describedBy = [invalid ? `${id}-err` : null, checks.length > 0 ? contrastId : null].filter(Boolean).join(" ") || undefined;

  return (
    <div>
      <label htmlFor={`${id}-hex`} className={LABEL}>
        {label}
      </label>
      <div className="mt-1 flex items-center gap-2">
        <input
          type="color"
          aria-label={`${label} colour picker`}
          aria-describedby={checks.length > 0 ? contrastId : undefined}
          value={normalizeHex(value) ?? "#000000"}
          onChange={(e) => onChange(e.target.value)}
          className="h-8 w-10 flex-none cursor-pointer rounded-[var(--radius-sm)] border border-[var(--border-strong)] bg-[var(--bg)] p-0.5"
        />
        <input
          id={`${id}-hex`}
          className="input-field mono"
          value={draft}
          spellCheck={false}
          autoComplete="off"
          maxLength={7}
          aria-invalid={invalid}
          aria-describedby={describedBy}
          onChange={(e) => {
            setDraft(e.target.value);
            const hex = normalizeHex(e.target.value);
            if (hex && e.target.value.replace("#", "").length === 6) onChange(hex);
          }}
          onBlur={() => {
            const hex = normalizeHex(draft);
            if (hex) onChange(hex);
            else setDraft(value);
          }}
        />
      </div>
      {invalid && (
        <p id={`${id}-err`} className="mt-1 text-[12px] text-[var(--danger)]">
          Use a hex colour like #1d4ed8.
        </p>
      )}
      {children}
      {checks.length > 0 && <ContrastNotes id={contrastId} checks={checks} />}
    </div>
  );
}

/** A number input that keeps what is typed and commits values inside [min, max]. */
export function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step,
  suffix,
  hint,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  hint?: string;
}) {
  const id = useId();
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const n = Number(draft);
  const invalid = draft.trim() === "" || !Number.isFinite(n) || n < min || n > max;

  return (
    <div>
      <label htmlFor={id} className={LABEL}>
        {label}
      </label>
      <div className="mt-1 flex items-center gap-2">
        <input
          id={id}
          type="number"
          inputMode="decimal"
          className="input-field"
          min={min}
          max={max}
          step={step}
          value={draft}
          aria-invalid={invalid}
          aria-describedby={hint || invalid ? `${id}-hint` : undefined}
          onChange={(e) => {
            setDraft(e.target.value);
            const v = Number(e.target.value);
            if (e.target.value.trim() !== "" && Number.isFinite(v) && v >= min && v <= max) onChange(v);
          }}
          onBlur={() => {
            if (invalid) setDraft(String(value));
          }}
        />
        {suffix && <span className="text-[12px] text-[var(--text-subtle)]">{suffix}</span>}
      </div>
      {(hint || invalid) && (
        <p id={`${id}-hint`} className={`mt-1 text-[12px] ${invalid ? "text-[var(--danger)]" : "text-[var(--text-subtle)]"}`}>
          {invalid ? `Between ${min} and ${max}.` : hint}
        </p>
      )}
    </div>
  );
}


export function FontField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (family: string) => void;
}) {
  const id = useId();
  // Checked trimmed: a space typed between two words is still on its way.
  const invalid = !isValidFontName(value.trim()) || value.trim() === "";
  return (
    <div>
      <label htmlFor={id} className={LABEL}>
        {label}
      </label>
      <input
        id={id}
        className="input-field mt-1"
        list={`${id}-fonts`}
        value={value}
        maxLength={MAX_FONT_NAME + 2}
        spellCheck={false}
        autoComplete="off"
        aria-invalid={invalid}
        aria-describedby={`${id}-hint`}
        onChange={(e) => onChange(e.target.value)}
      />
      <datalist id={`${id}-fonts`}>
        {FONT_SUGGESTIONS.map((f) => (
          <option key={f} value={f} />
        ))}
      </datalist>
      <p id={`${id}-hint`} className={`mt-1 text-[12px] ${invalid ? "text-[var(--danger)]" : "text-[var(--text-subtle)]"}`}>
        {invalid
          ? `Letters, digits, spaces and - _ . & + only, up to ${MAX_FONT_NAME} characters.`
          : "The preview uses this family if it's installed, else system fonts. Turn on Google Fonts below to load it."}
      </p>
    </div>
  );
}

export function SelectField<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (v: T) => void;
}) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className={LABEL}>
        {label}
      </label>
      <select
        id={id}
        className="input-field mt-1"
        value={String(value)}
        onChange={(e) => {
          const hit = options.find((o) => String(o.value) === e.target.value);
          if (hit) onChange(hit.value);
        }}
      >
        {options.map((o) => (
          <option key={String(o.value)} value={String(o.value)}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/** A row of 50-950 swatches under a scale colour. */
export function ScaleSwatches({ scale }: { scale: Record<string, string> }) {
  return (
    <div className="mt-1.5 flex overflow-hidden rounded-[var(--radius-sm)] border border-[var(--border)]" aria-hidden>
      {Object.entries(scale).map(([step, hex]) => (
        <span key={step} title={`${step} ${hex}`} className="h-4 flex-1" style={{ background: hex }} />
      ))}
    </div>
  );
}
