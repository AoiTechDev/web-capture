"use client";

import type { CSSProperties } from "react";
import type { DesignSystemTokens } from "../../../../../packages/backend/convex/lib/design_system/types";
import { useGoogleFont } from "@/hooks/useGoogleFont";
import { previewVars } from "@/lib/design-system/preview";

/**
 * Live preview of a design system, rendered ONLY from the tokens: every colour,
 * font, size, space, radius and shadow below reads a --ds-* custom property
 * set on this container (previewVars), never the dashboard's own theme.
 */
export default function Preview({ tokens }: { tokens: DesignSystemTokens }) {
  const t = tokens.typography;
  useGoogleFont(t.fontHeading, [t.headingWeight]);
  useGoogleFont(t.fontBody, [t.bodyWeight, 600]);

  const hasSecondary = !!tokens.colors.secondary;
  const vars = previewVars(tokens) as CSSProperties;

  const heading = (size: string): CSSProperties => ({
    margin: 0,
    fontFamily: "var(--ds-font-heading)",
    fontWeight: "var(--ds-weight-heading)" as unknown as number,
    lineHeight: "var(--ds-leading-heading)",
    fontSize: `var(--ds-text-${size})`,
    letterSpacing: "normal",
    color: "var(--ds-text)",
  });

  const button: CSSProperties = {
    fontFamily: "var(--ds-font-body)",
    fontSize: "var(--ds-text-sm)",
    fontWeight: 600,
    lineHeight: 1.2,
    padding: "var(--ds-space-2) var(--ds-space-4)",
    borderRadius: "var(--ds-radius-md)",
    border: "1px solid transparent",
    cursor: "pointer",
  };

  return (
    <div
      style={{
        ...vars,
        background: "var(--ds-background)",
        color: "var(--ds-text)",
        fontFamily: "var(--ds-font-body)",
        fontWeight: "var(--ds-weight-body)" as unknown as number,
        lineHeight: "var(--ds-leading-body)",
        fontSize: "var(--ds-text-base)",
        letterSpacing: "normal",
        padding: "var(--ds-space-8, 2rem)",
        borderRadius: "var(--ds-radius-lg)",
        border: "1px solid var(--ds-border)",
        colorScheme: tokens.mode === "dark" ? "dark" : "light",
      }}
      aria-label="Design system preview"
      role="region"
    >
      {/* Static rule: ::placeholder can't be styled inline. */}
      <style>{`.ds-preview-input::placeholder{color:var(--ds-text-muted);opacity:1}`}</style>
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--ds-space-3)" }}>
        <h1 style={heading("4xl")}>Heading one</h1>
        <h2 style={heading("3xl")}>Heading two</h2>
        <h3 style={heading("2xl")}>Heading three</h3>
        <h4 style={heading("xl")}>Heading four</h4>
        <p style={{ margin: 0, maxWidth: "60ch" }}>
          Body copy sits on the background in the body font. It should stay comfortable to read at
          length, with <span style={{ color: tokens.mode === "dark" ? "var(--ds-primary-300)" : "var(--ds-primary-700)", textDecoration: "underline" }}>
            a link
          </span>{" "}
          and <span style={{ color: "var(--ds-text-muted)" }}>some muted supporting text</span>.
        </p>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--ds-space-3)", marginTop: "var(--ds-space-6)" }}>
        <button type="button" style={{ ...button, background: "var(--ds-primary-500)", color: "var(--ds-on-primary)" }}>
          Primary
        </button>
        <button
          type="button"
          style={
            hasSecondary
              ? { ...button, background: "var(--ds-secondary-500)", color: "var(--ds-on-secondary)" }
              : {
                  ...button,
                  background: "var(--ds-surface)",
                  color: "var(--ds-text)",
                  borderColor: "var(--ds-border)",
                }
          }
        >
          Secondary
        </button>
        <button
          type="button"
          style={{
            ...button,
            background: "transparent",
            color: tokens.mode === "dark" ? "var(--ds-primary-300)" : "var(--ds-primary-700)",
          }}
        >
          Ghost
        </button>
      </div>

      <div
        style={{
          marginTop: "var(--ds-space-6)",
          background: "var(--ds-surface)",
          border: "1px solid var(--ds-border)",
          borderRadius: "var(--ds-radius-lg)",
          boxShadow: "var(--ds-shadow-md, none)",
          padding: "var(--ds-space-6)",
          maxWidth: "28rem",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "var(--ds-space-2)" }}>
          <h4 style={{ ...heading("lg") }}>Card title</h4>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              padding: "0 var(--ds-space-2)",
              borderRadius: "var(--ds-radius-full)",
              fontSize: "var(--ds-text-xs)",
              fontWeight: 600,
              lineHeight: 1.6,
              background: tokens.mode === "dark" ? "var(--ds-primary-900)" : "var(--ds-primary-100)",
              color: tokens.mode === "dark" ? "var(--ds-primary-200)" : "var(--ds-primary-800)",
            }}
          >
            Badge
          </span>
        </div>
        <p style={{ margin: "var(--ds-space-2) 0 0", color: "var(--ds-text-muted)", fontSize: "var(--ds-text-sm)" }}>
          A surface with the border, radius and shadow tokens.
        </p>
        <label
          style={{
            display: "block",
            marginTop: "var(--ds-space-4)",
            fontSize: "var(--ds-text-sm)",
            fontWeight: 600,
          }}
        >
          Email
          <input
            className="ds-preview-input"
            type="email"
            placeholder="you@example.com"
            style={{
              display: "block",
              width: "100%",
              marginTop: "var(--ds-space-1)",
              padding: "var(--ds-space-2) var(--ds-space-3)",
              background: "var(--ds-background)",
              color: "var(--ds-text)",
              border: "1px solid var(--ds-border)",
              borderRadius: "var(--ds-radius-md)",
              fontFamily: "var(--ds-font-body)",
              fontSize: "var(--ds-text-base)",
              fontWeight: "var(--ds-weight-body)" as unknown as number,
              outlineColor: "var(--ds-primary-500)",
            }}
          />
        </label>
      </div>
    </div>
  );
}
