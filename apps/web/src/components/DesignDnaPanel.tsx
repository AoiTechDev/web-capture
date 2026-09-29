"use client";

import { useState, type ReactNode } from "react";
import { Check } from "lucide-react";

/* Shapes from spec 6.1 / 6.2 (`DesignDNA`, `PaletteColor`). */

type Weighted<T> = T & { weight: number };

export type PaletteColor = { hex: string; lab: number[]; weight: number };

export type DesignDNA = {
  version: 1;
  colors: Weighted<{ hex: string; usage: "text" | "background" | "border" }>[];
  fonts: Weighted<{
    family: string;
    generic: boolean;
    size: number;
    fontWeight: number;
    lineHeight: number | null;
    letterSpacing: number | null;
  }>[];
  radii: Weighted<{ value: number }>[];
  shadows: Weighted<{ value: string }>[];
  spacing: Weighted<{ value: number }>[];
};

/** What the detail view knows about a capture beyond its image. */
export type CaptureDetails = {
  designDna?: DesignDNA | null;
  palette?: PaletteColor[] | null;
  clipped?: boolean | null;
};

export function hasDetails(d: CaptureDetails | null | undefined): boolean {
  return !!d && (!!d.designDna || (d.palette?.length ?? 0) > 0);
}

const USAGE_LABEL = { background: "Background", text: "Text", border: "Border" } as const;

const pct = (w: number) => `${Math.max(1, Math.round(w * 100))}%`;

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t border-[var(--border)] px-4 py-3">
      <h3 className="mb-2 text-[11px] font-medium uppercase tracking-[0.06em] text-[var(--text-subtle)]">
        {title}
      </h3>
      {children}
    </section>
  );
}

/** A colour chip whose hex copies to the clipboard on click. */
function Swatch({ hex, weight }: { hex: string; weight: number }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      title={`Copy ${hex}`}
      onClick={() => {
        void navigator.clipboard?.writeText(hex).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        });
      }}
      className="flex items-center gap-2 rounded-md border border-[var(--border)] px-1.5 py-1 text-left transition-colors hover:border-[var(--border-strong)] hover:bg-[var(--surface-hover)]"
    >
      <span
        className="h-5 w-5 shrink-0 rounded-[4px] border border-white/10"
        style={{ backgroundColor: hex }}
      />
      <span className="mono text-[11px] text-[var(--text)]">{copied ? "Copied" : hex}</span>
      {copied ? (
        <Check className="h-3 w-3 text-[var(--text-muted)]" />
      ) : (
        <span className="text-[11px] tabular-nums text-[var(--text-subtle)]">{pct(weight)}</span>
      )}
    </button>
  );
}

function SwatchGrid({ colors }: { colors: { hex: string; weight: number }[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {colors.map((c, i) => (
        <Swatch key={`${c.hex}-${i}`} hex={c.hex} weight={c.weight} />
      ))}
    </div>
  );
}

function ValueChips({ values }: { values: { value: number; weight: number }[] }) {
  return (
    <div className="flex flex-wrap gap-1">
      {values.map((v) => (
        <span key={v.value} className="chip mono" title={`${pct(v.weight)} of the element`}>
          {v.value}px
        </span>
      ))}
    </div>
  );
}

/**
 * Side panel for the full-size view: the Design DNA of a picked element and
 * the pixel palette of any image capture. Renders nothing for captures that
 * have neither (everything saved before they existed).
 */
export default function DesignDnaPanel({ details }: { details: CaptureDetails }) {
  if (!hasDetails(details)) return null;
  const dna = details.designDna;
  const palette = details.palette ?? [];

  const byUsage = (["background", "text", "border"] as const)
    .map((usage) => ({ usage, colors: (dna?.colors ?? []).filter((c) => c.usage === usage) }))
    .filter((g) => g.colors.length > 0);

  return (
    <aside className="flex max-h-[40vh] w-full shrink-0 flex-col overflow-y-auto border-t border-[var(--border)] bg-[var(--surface)] md:max-h-[90vh] md:w-[320px] md:border-l md:border-t-0">
      <div className="px-4 py-3">
        <h2 className="text-[13px] font-medium text-[var(--text)]">
          {dna ? "Design DNA" : "Palette"}
        </h2>
        {details.clipped && (
          <p className="mt-1 text-[12px] text-[var(--text-muted)]">Saved the visible part</p>
        )}
      </div>

      {byUsage.length > 0 && (
        <Section title="Colours">
          <div className="space-y-2.5">
            {byUsage.map((g) => (
              <div key={g.usage}>
                <p className="mb-1 text-[12px] text-[var(--text-muted)]">{USAGE_LABEL[g.usage]}</p>
                <SwatchGrid colors={g.colors} />
              </div>
            ))}
          </div>
        </Section>
      )}

      {palette.length > 0 && (
        <Section title="Pixel palette">
          <div className="mb-2 flex h-3 overflow-hidden rounded-[4px] border border-[var(--border)]">
            {palette.map((p, i) => (
              <span key={`${p.hex}-${i}`} style={{ backgroundColor: p.hex, flexGrow: p.weight }} />
            ))}
          </div>
          <SwatchGrid colors={palette} />
        </Section>
      )}

      {dna && dna.fonts.length > 0 && (
        <Section title="Type">
          <ul className="space-y-1.5">
            {dna.fonts.map((f, i) => (
              <li key={i} className="flex items-baseline justify-between gap-3 text-[12px]">
                <span className="truncate text-[var(--text)]" title={f.family}>
                  {f.family}
                  {f.generic && <span className="ml-1 text-[var(--text-subtle)]">(generic)</span>}
                </span>
                <span className="mono shrink-0 text-[11px] text-[var(--text-muted)]">
                  {f.size}px · {f.fontWeight}
                  {f.lineHeight !== null && ` / ${f.lineHeight}px`}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {dna && dna.radii.length > 0 && (
        <Section title="Radii">
          <ValueChips values={dna.radii} />
        </Section>
      )}

      {dna && dna.shadows.length > 0 && (
        <Section title="Shadows">
          <div className="space-y-2">
            {dna.shadows.map((s) => (
              <div key={s.value} className="flex items-center gap-3">
                {/* A light tile so dark shadows are visible at all. */}
                <span className="flex h-12 w-14 shrink-0 items-center justify-center rounded-md bg-[#e9eaec]">
                  <span className="h-7 w-8 rounded-[4px] bg-white" style={{ boxShadow: s.value }} />
                </span>
                <span className="mono line-clamp-3 break-all text-[11px] text-[var(--text-muted)]" title={s.value}>
                  {s.value}
                </span>
              </div>
            ))}
          </div>
        </Section>
      )}

      {dna && dna.spacing.length > 0 && (
        <Section title="Spacing">
          <ValueChips values={dna.spacing} />
        </Section>
      )}
    </aside>
  );
}
