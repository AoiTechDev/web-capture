"use client";

import {
  TYPE_RATIOS,
  type ContrastCheck,
  type DesignSystemTokens,
} from "../../../../../packages/backend/convex/lib/design_system/types";
import {
  addSecondary,
  BASE_SIZE_MAX,
  BASE_SIZE_MIN,
  parseRem,
  RADIUS_MD_MAX_PX,
  removeSecondary,
  setBaseColor,
  setRadiusMd,
  setScale500,
  setSpacingBase,
  setTypeScale,
  setTypography,
  typeScaleNotes,
  withCurrent,
  type BaseColorKey,
} from "@/lib/design-system/edit";
import { ColorField, FontField, LABEL, NumberField, ScaleSwatches, Section, SelectField } from "./fields";

const BASE_COLORS: Array<{ key: BaseColorKey; label: string }> = [
  { key: "background", label: "Background" },
  { key: "surface", label: "Surface" },
  { key: "border", label: "Border" },
  { key: "text", label: "Text" },
  { key: "textMuted", label: "Muted text" },
];

/** Which field each contrast pair is reported under (its foreground, or the surface). */
const PAIR_FIELD: Record<ContrastCheck["pair"], string> = {
  "text/background": "text",
  "textMuted/background": "textMuted",
  "text/surface": "surface",
  "textMuted/surface": "surface",
  "primary/background": "primary",
};

const WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900] as const;


export default function TokenEditor({
  tokens,
  contrast,
  onChange,
  googleFonts,
  onGoogleFontsChange,
}: {
  tokens: DesignSystemTokens;
  contrast: ContrastCheck[];
  onChange: (t: DesignSystemTokens) => void;
  googleFonts: boolean;
  onGoogleFontsChange: (on: boolean) => void;
}) {
  const checksFor = (field: string) => contrast.filter((c) => PAIR_FIELD[c.pair] === field);
  const ty = tokens.typography;
  const scaleNotes = typeScaleNotes(tokens);
  const radiusMdPx = Math.round((parseRem(tokens.radius.md) ?? 0.5) * 16 * 100) / 100;

  return (
    <div>
      <Section title="Colours">
        {BASE_COLORS.map(({ key, label }) => (
          <ColorField
            key={key}
            label={label}
            value={tokens.colors[key]}
            checks={checksFor(key)}
            onChange={(hex) => onChange(setBaseColor(tokens, key, hex))}
          />
        ))}

        <ColorField
          label="Primary 500"
          value={tokens.colors.primary["500"]}
          checks={checksFor("primary")}
          onChange={(hex) => onChange(setScale500(tokens, "primary", hex))}
        >
          <ScaleSwatches scale={tokens.colors.primary} />
        </ColorField>

        {tokens.colors.secondary ? (
          <ColorField
            label="Secondary 500"
            value={tokens.colors.secondary["500"]}
            onChange={(hex) => onChange(setScale500(tokens, "secondary", hex))}
          >
            <ScaleSwatches scale={tokens.colors.secondary} />
            <button
              type="button"
              className="mt-1.5 text-[12px] text-[var(--text-muted)] hover:text-[var(--text)]"
              onClick={() => onChange(removeSecondary(tokens))}
            >
              Remove secondary colour
            </button>
          </ColorField>
        ) : (
          <button
            type="button"
            className="btn-secondary"
            onClick={() => onChange(addSecondary(tokens))}
          >
            Add a secondary colour
          </button>
        )}
      </Section>

      <Section title="Typography">
        <FontField
          label="Heading font"
          value={ty.fontHeading}
          onChange={(fontHeading) => onChange(setTypography(tokens, { fontHeading }))}
        />
        <FontField
          label="Body font"
          value={ty.fontBody}
          onChange={(fontBody) => onChange(setTypography(tokens, { fontBody }))}
        />
        <div>
          <label className="flex cursor-pointer items-center gap-2 text-[13px] text-[var(--text)]">
            <input
              type="checkbox"
              className="h-3.5 w-3.5 accent-[var(--blue-500)]"
              checked={googleFonts}
              aria-describedby="ds-google-fonts-hint"
              onChange={(e) => onGoogleFontsChange(e.target.checked)}
            />
            Load fonts from Google for the preview
          </label>
          <p id="ds-google-fonts-hint" className="mt-1 text-[12px] text-[var(--text-subtle)]">
            Sends a request (with your IP address) to Google Fonts. Off: the preview uses installed fonts.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <SelectField
            label="Scale ratio"
            value={ty.ratio}
            options={withCurrent(TYPE_RATIOS, ty.ratio)}
            onChange={(ratio) => onChange(setTypeScale(tokens, { ratio }))}
          />
          <NumberField
            label="Base size"
            value={ty.baseSize}
            min={BASE_SIZE_MIN}
            max={BASE_SIZE_MAX}
            step={1}
            suffix="px"
            onChange={(baseSize) => onChange(setTypeScale(tokens, { baseSize }))}
          />
          <SelectField
            label="Heading weight"
            value={ty.headingWeight}
            options={withCurrent(WEIGHTS, ty.headingWeight)}
            onChange={(headingWeight) => onChange(setTypography(tokens, { headingWeight }))}
          />
          <SelectField
            label="Body weight"
            value={ty.bodyWeight}
            options={withCurrent(WEIGHTS, ty.bodyWeight)}
            onChange={(bodyWeight) => onChange(setTypography(tokens, { bodyWeight }))}
          />
          <NumberField
            label="Heading line height"
            value={ty.headingLineHeight}
            min={0.8}
            max={3}
            step={0.05}
            onChange={(headingLineHeight) => onChange(setTypography(tokens, { headingLineHeight }))}
          />
          <NumberField
            label="Body line height"
            value={ty.bodyLineHeight}
            min={0.8}
            max={3}
            step={0.05}
            onChange={(bodyLineHeight) => onChange(setTypography(tokens, { bodyLineHeight }))}
          />
        </div>
        <p className="mono text-[11px] leading-5 text-[var(--text-subtle)]">
          {Object.entries(ty.scale)
            .map(([step, size]) => `${step} ${size}`)
            .join(" · ")}
        </p>
        {scaleNotes.length > 0 && (
          <ul className="space-y-0.5 text-[12px] text-[var(--text-muted)]">
            {scaleNotes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Spacing & radius">
        <fieldset>
          <legend className={LABEL}>Spacing base</legend>
          <div className="mt-1 inline-flex overflow-hidden rounded-[var(--radius-sm)] border border-[var(--border-strong)]">
            {([4, 8] as const).map((base) => (
              <label
                key={base}
                className={`cursor-pointer px-3 py-1.5 text-[13px] has-[:focus-visible]:outline has-[:focus-visible]:outline-2 ${
                  tokens.spacing.base === base
                    ? "bg-[var(--surface-active)] text-[var(--text)]"
                    : "text-[var(--text-muted)] hover:bg-[var(--surface-hover)]"
                }`}
              >
                <input
                  type="radio"
                  name="spacing-base"
                  className="sr-only"
                  checked={tokens.spacing.base === base}
                  onChange={() => onChange(setSpacingBase(tokens, base))}
                />
                {base}px
              </label>
            ))}
          </div>
        </fieldset>
        <NumberField
          label="Radius (md)"
          value={radiusMdPx}
          min={0}
          max={RADIUS_MD_MAX_PX}
          step={1}
          suffix="px"
          hint={`sm ${tokens.radius.sm} · md ${tokens.radius.md} · lg ${tokens.radius.lg}`}
          onChange={(px) => onChange(setRadiusMd(tokens, px))}
        />
        {(tokens.shadow.sm || tokens.shadow.md || tokens.shadow.lg) && (
          <div>
            <p className={LABEL}>Shadows (from captures)</p>
            <ul className="mono mt-1 space-y-0.5 text-[11px] text-[var(--text-subtle)]">
              {(["sm", "md", "lg"] as const).map((k) =>
                tokens.shadow[k] ? (
                  <li key={k} className="break-all">
                    {k}: {tokens.shadow[k]}
                  </li>
                ) : null
              )}
            </ul>
          </div>
        )}
      </Section>
    </div>
  );
}
