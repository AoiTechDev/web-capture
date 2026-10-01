/**
 * The design system generator (spec 6.5): stage 1 analysis, then the
 * contrast correction and the template description. Pure and deterministic:
 * the same captures always give the same tokens.
 *
 * The spec's stage 2 (an AI model as editor) is deliberately not built: the
 * owner chose no paid AI. See `DesignSystemEditor` for where one would go.
 */

import { assignRoles, clusterColors, collectColors, type ColorUsage, type SourceColor } from "./colors";
import { checkContrast, fixContrast } from "./contrast";
import { describeTokens } from "./describe";
import { deriveRadius, deriveShadows, deriveSpacing, type WeightedValue } from "./metrics";
import type { ContrastCheck, DesignSystemTokens } from "./types";
import { deriveTypography, type SourceFont } from "./typography";

/** What the generator reads from one capture. */
export type DesignSource = {
  colors: SourceColor[];
  fonts: SourceFont[];
  radii: WeightedValue<number>[];
  shadows: WeightedValue<string>[];
  spacing: WeightedValue<number>[];
};

export type GeneratedDesignSystem = {
  tokens: DesignSystemTokens;
  contrast: ContrastCheck[];
  description: string;
  /** What the generator corrected or had to guess, in order. */
  notes: string[];
};

/**
 * Seam for an optional stage 2 editor (e.g. an AI model). Not implemented.
 *
 * An editor would receive the stage 1 result and source domains only (no
 * images), may re-assign roles and rewrite the description, and must return
 * tokens that pass validateTokens. It has to run between stage 1 and
 * fixContrast, which always runs afterwards, so contrast is re-checked by
 * code whatever the editor returns. Being asynchronous and external, it
 * would need a Convex action around generateDesignSystem rather than the
 * current mutation.
 */
export interface DesignSystemEditor {
  edit(input: {
    tokens: DesignSystemTokens;
    notes: string[];
    sourceDomains: string[];
  }): Promise<{ tokens: DesignSystemTokens; notes: string[]; description?: string }>;
}

/** Stored notes are capped so a pathological session cannot bloat the row. */
export const MAX_NOTES = 20;

/** Stage 1: tokens straight from the captures, before any correction. */
export function analyzeSources(sources: DesignSource[]): { tokens: DesignSystemTokens; notes: string[] } {
  const roles = assignRoles(clusterColors(collectColors(sources.map((s) => s.colors))));
  const type = deriveTypography(sources.map((s) => s.fonts));
  const spacing = deriveSpacing(sources.map((s) => s.spacing));
  const radius = deriveRadius(sources.map((s) => s.radii));
  const shadow = deriveShadows(sources.map((s) => s.shadows));
  return {
    tokens: {
      version: 1,
      mode: roles.mode,
      colors: roles.colors,
      typography: type.typography,
      spacing: spacing.spacing,
      radius: radius.radius,
      shadow: shadow.shadow,
    },
    notes: [...roles.notes, ...type.notes, ...spacing.notes, ...radius.notes, ...shadow.notes],
  };
}

export function generateDesignSystem(sources: DesignSource[]): GeneratedDesignSystem {
  const stage1 = analyzeSources(sources);
  // A stage 2 editor (DesignSystemEditor) would run here, before the fix.
  const fixed = fixContrast(stage1.tokens);
  const notes = [...fixed.notes, ...stage1.notes].slice(0, MAX_NOTES);
  return {
    tokens: fixed.tokens,
    contrast: checkContrast(fixed.tokens),
    description: describeTokens(fixed.tokens),
    notes,
  };
}

/* ---------- reading captures ---------- */

type DnaLike = {
  colors: { hex: string; usage: ColorUsage; weight: number }[];
  fonts: SourceFont[];
  radii: WeightedValue<number>[];
  shadows: WeightedValue<string>[];
  spacing: WeightedValue<number>[];
};

/**
 * A capture's design source: DNA colours with their usage when it has DNA,
 * otherwise its pixel palette, otherwise its stored captureColors rows.
 * Null when it has none of them.
 */
export function sourceFromCapture(
  capture: { designDna?: DnaLike | null; palette?: { hex: string; weight: number }[] | null },
  captureColors: { hex: string; weight: number }[] = []
): DesignSource | null {
  const dna = capture.designDna ?? null;
  const colors: SourceColor[] = dna?.colors.length
    ? dna.colors.map((c) => ({ hex: c.hex, weight: c.weight, usage: c.usage }))
    : capture.palette?.length
      ? capture.palette.map((c) => ({ hex: c.hex, weight: c.weight }))
      : captureColors.map((c) => ({ hex: c.hex, weight: c.weight }));
  if (!dna && !colors.length) return null;
  return {
    colors,
    fonts: dna?.fonts ?? [],
    radii: dna?.radii ?? [],
    shadows: dna?.shadows ?? [],
    spacing: dna?.spacing ?? [],
  };
}
