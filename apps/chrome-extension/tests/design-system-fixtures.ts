/**
 * Shared design system tokens for the design-system-*.test.ts files. Built with
 * the generator's own builders so the fixture has the shape the backend stores.
 */
import { radiusScale, spacingScale, typeScale } from "../../../packages/backend/convex/lib/design_system/builders"
import { buildScale } from "../../../packages/backend/convex/lib/design_system/scale"
import type { DesignSystemTokens } from "../../../packages/backend/convex/lib/design_system/types"

export function makeTokens(overrides: Partial<DesignSystemTokens["typography"]> = {}): DesignSystemTokens {
  return {
    version: 1,
    mode: "light",
    colors: {
      background: "#ffffff",
      surface: "#f8fafc",
      border: "#e2e8f0",
      text: "#0f172a",
      textMuted: "#475569",
      primary: buildScale("#6d28d9"),
      secondary: buildScale("#0891b2"),
    },
    typography: {
      fontHeading: "Space Grotesk",
      fontBody: "Inter",
      ratio: 1.25,
      baseSize: 16,
      scale: typeScale(16, 1.25),
      headingWeight: 700,
      bodyWeight: 400,
      headingLineHeight: 1.2,
      bodyLineHeight: 1.5,
      ...overrides,
    },
    spacing: { base: 4, scale: spacingScale(4) },
    radius: radiusScale(8),
    shadow: {
      sm: "0 1px 2px rgba(15, 23, 42, 0.06)",
      md: "0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)",
      lg: "0 10px 15px -3px rgba(0,0,0,0.1)",
    },
  }
}
