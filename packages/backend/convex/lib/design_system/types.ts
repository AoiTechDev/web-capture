/**
 * Design system tokens a session's captures are distilled into (spec 6.5).
 * Shared by the generator (convex/lib/design_system), the stored
 * `designSystems` rows and the dashboard's editor, preview and exports.
 */

export const SHADE_STEPS = ["50", "100", "200", "300", "400", "500", "600", "700", "800", "900", "950"] as const;
export type ShadeStep = (typeof SHADE_STEPS)[number];
export type ColorScale = Record<ShadeStep, string>;

export const TYPE_STEPS = ["xs", "sm", "base", "lg", "xl", "2xl", "3xl", "4xl", "5xl"] as const;
export type TypeStep = (typeof TYPE_STEPS)[number];

/** Ratios a collected type scale is fitted to. */
export const TYPE_RATIOS = [1.125, 1.2, 1.25, 1.333, 1.5] as const;

export type DesignSystemTokens = {
  version: 1;
  mode: "light" | "dark";
  colors: {
    /** All colours are lowercase `#rrggbb`. */
    background: string;
    surface: string;
    border: string;
    text: string;
    textMuted: string;
    primary: ColorScale;
    secondary?: ColorScale;
  };
  typography: {
    /** Family names only; exports add the generic fallback. */
    fontHeading: string;
    fontBody: string;
    ratio: number;
    /** px */
    baseSize: number;
    /** rem, e.g. "1.25rem" */
    scale: Record<TypeStep, string>;
    headingWeight: number;
    bodyWeight: number;
    /** Unitless multipliers, e.g. 1.2 */
    headingLineHeight: number;
    bodyLineHeight: number;
  };
  /** `scale` keys are "0", "1", "2", "3", "4", "6", "8", "12", "16", "24"; values in rem. */
  spacing: { base: 4 | 8; scale: Record<string, string> };
  /** rem, except `full` = "9999px" */
  radius: { sm: string; md: string; lg: string; full: string };
  /** CSS box-shadow values */
  shadow: { sm?: string; md?: string; lg?: string };
};

/** A colour pair the generator or editor checks against WCAG AA. */
export type ContrastCheck = {
  pair: "text/background" | "textMuted/background" | "text/surface" | "primary/background";
  foreground: string;
  background: string;
  ratio: number;
  /** 4.5 for text pairs, 3 for primary on background */
  required: number;
  passes: boolean;
};
