/**
 * CSS custom properties the live preview is rendered from. They are set on the
 * preview container only, so the tokens never leak into the dashboard's own
 * theme. Every value goes through the same checks as the exports.
 *
 * Relative imports only, so the chrome-extension vitest suite can test it.
 */
import { contrastRatio } from "../../../../../packages/backend/convex/lib/design_system/contrast";
import {
  SHADE_STEPS,
  TYPE_STEPS,
  type DesignSystemTokens,
} from "../../../../../packages/backend/convex/lib/design_system/types";
import { safeHex, safeLength, safeShadow } from "./exports";
import { fontStack } from "./fonts";

/** Text colour for a filled button: white or the scale's 950, whichever reads better. */
export function onColor(fill: string, dark: string | undefined): string {
  const candidates = ["#ffffff", safeHex(dark) ?? "#000000"];
  return candidates.reduce((best, c) => (contrastRatio(c, fill) > contrastRatio(best, fill) ? c : best));
}

export function previewVars(t: DesignSystemTokens): Record<string, string> {
  const v: Record<string, string> = {};
  const set = (name: string, value: string | null | undefined) => {
    if (value) v[name] = value;
  };

  const c = t.colors;
  set("--ds-background", safeHex(c.background));
  set("--ds-surface", safeHex(c.surface));
  set("--ds-border", safeHex(c.border));
  set("--ds-text", safeHex(c.text));
  set("--ds-text-muted", safeHex(c.textMuted));
  for (const step of SHADE_STEPS) {
    set(`--ds-primary-${step}`, safeHex(c.primary?.[step]));
    set(`--ds-secondary-${step}`, safeHex(c.secondary?.[step]));
  }
  const p500 = safeHex(c.primary?.["500"]);
  if (p500) set("--ds-on-primary", onColor(p500, c.primary?.["950"]));
  const s500 = safeHex(c.secondary?.["500"]);
  if (s500) set("--ds-on-secondary", onColor(s500, c.secondary?.["950"]));

  const ty = t.typography;
  set("--ds-font-heading", fontStack(ty.fontHeading));
  set("--ds-font-body", fontStack(ty.fontBody));
  if (Number.isFinite(ty.headingWeight)) set("--ds-weight-heading", String(ty.headingWeight));
  if (Number.isFinite(ty.bodyWeight)) set("--ds-weight-body", String(ty.bodyWeight));
  if (Number.isFinite(ty.headingLineHeight)) set("--ds-leading-heading", String(ty.headingLineHeight));
  if (Number.isFinite(ty.bodyLineHeight)) set("--ds-leading-body", String(ty.bodyLineHeight));
  for (const step of TYPE_STEPS) set(`--ds-text-${step}`, safeLength(ty.scale?.[step]));

  for (const [k, value] of Object.entries(t.spacing?.scale ?? {})) {
    if (/^[0-9]+$/.test(k)) set(`--ds-space-${k}`, safeLength(value));
  }
  set("--ds-radius-sm", safeLength(t.radius?.sm));
  set("--ds-radius-md", safeLength(t.radius?.md));
  set("--ds-radius-lg", safeLength(t.radius?.lg));
  set("--ds-radius-full", safeLength(t.radius?.full));
  set("--ds-shadow-sm", safeShadow(t.shadow?.sm));
  set("--ds-shadow-md", safeShadow(t.shadow?.md));
  set("--ds-shadow-lg", safeShadow(t.shadow?.lg));
  return v;
}
