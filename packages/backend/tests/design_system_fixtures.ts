/**
 * Three prepared sessions for the design system generator's acceptance
 * tests (spec 9, Phase 5): a light SaaS marketing site, a dark dashboard app
 * and a colourful e-commerce shop. Each capture is the Design DNA a picked
 * element would plausibly give (weights are area shares), plus a couple of
 * palette-only photo captures in the shop.
 */
import type { Id } from "../convex/_generated/dataModel";
import { hexToLab } from "../convex/lib/color";
import type { T } from "./fixtures";

type Usage = "text" | "background" | "border";
type ColorSpec = [hex: string, usage: Usage, weight: number];
/** family, size px, font-weight, line-height px (null = normal), weight */
type FontSpec = [family: string, size: number, fontWeight: number, lineHeight: number | null, weight: number];
type DnaSpec = {
  colors: ColorSpec[];
  fonts: FontSpec[];
  radii?: [number, number][];
  shadows?: [string, number][];
  spacing?: [number, number][];
};

export type FixtureCapture =
  | { kind: "element"; url: string; dna: DnaSpec }
  | { kind: "viewport"; url: string; palette: [hex: string, weight: number][] };

export type FixtureSession = { name: string; domain: string; captures: FixtureCapture[] };

const GENERIC = new Set(["serif", "sans-serif", "monospace", "system-ui"]);

export function designDna(url: string, spec: DnaSpec) {
  return {
    version: 1 as const,
    colors: spec.colors.map(([hex, usage, weight]) => ({ hex, usage, weight })),
    fonts: spec.fonts.map(([family, size, fontWeight, lineHeight, weight]) => ({
      family,
      generic: GENERIC.has(family),
      size,
      fontWeight,
      lineHeight,
      letterSpacing: null,
      weight,
    })),
    radii: (spec.radii ?? []).map(([value, weight]) => ({ value, weight })),
    shadows: (spec.shadows ?? []).map(([value, weight]) => ({ value, weight })),
    spacing: (spec.spacing ?? []).map(([value, weight]) => ({ value, weight })),
    source: {
      url,
      title: "Fixture",
      viewport: { w: 1440, h: 900 },
      dpr: 2,
      rect: { x: 0, y: 0, w: 800, h: 400 },
      clipped: false,
    },
  };
}

export function palette(colors: [string, number][]) {
  return colors.map(([hex, weight]) => ({ hex, lab: [...hexToLab(hex)!], weight }));
}

/* ---------- light SaaS marketing site ---------- */

const SAAS_SHADOW_LG = "rgba(50, 50, 93, 0.25) 0px 13px 27px -5px";
const SAAS_SHADOW_SM = "rgba(0, 0, 0, 0.1) 0px 1px 3px 0px";

export const LIGHT_SAAS: FixtureSession = {
  name: "Light SaaS marketing",
  domain: "acme-saas.com",
  captures: [
    { kind: "element", url: "https://acme-saas.com/", dna: {
      colors: [["#ffffff", "background", 0.55], ["#f6f9fc", "background", 0.15], ["#0a2540", "text", 0.12], ["#425466", "text", 0.08],
        ["#635bff", "background", 0.06], ["#ffffff", "text", 0.02], ["#e3e8ee", "border", 0.02]],
      fonts: [["Plus Jakarta Sans", 56, 700, 64, 0.3], ["Inter", 18, 400, 28, 0.5], ["Inter", 16, 600, 24, 0.2]],
      radii: [[8, 0.6], [9999, 0.4]], shadows: [[SAAS_SHADOW_LG, 1]], spacing: [[24, 0.3], [32, 0.3], [16, 0.2], [64, 0.2]],
    } },
    { kind: "element", url: "https://acme-saas.com/pricing", dna: {
      colors: [["#ffffff", "background", 0.4], ["#f6f9fc", "background", 0.3], ["#e3e8ee", "border", 0.06], ["#0a2540", "text", 0.1],
        ["#425466", "text", 0.08], ["#635bff", "background", 0.04], ["#635bff", "text", 0.02]],
      fonts: [["Plus Jakarta Sans", 36, 700, 40, 0.2], ["Plus Jakarta Sans", 48, 800, 48, 0.1], ["Inter", 16, 400, 26, 0.4], ["Inter", 14, 400, 20, 0.3]],
      radii: [[12, 0.5], [8, 0.5]], shadows: [[SAAS_SHADOW_SM, 0.6], [SAAS_SHADOW_LG, 0.4]], spacing: [[16, 0.4], [24, 0.3], [32, 0.2], [8, 0.1]],
    } },
    { kind: "element", url: "https://acme-saas.com/features", dna: {
      colors: [["#ffffff", "background", 0.6], ["#0a2540", "text", 0.12], ["#425466", "text", 0.14], ["#635bff", "text", 0.03],
        ["#00d4ff", "background", 0.12], ["#e3e8ee", "border", 0.04]],
      fonts: [["Plus Jakarta Sans", 30, 700, 36, 0.3], ["Inter", 16, 400, 26, 0.5], ["Inter", 18, 600, 28, 0.2]],
      radii: [[8, 1]], spacing: [[24, 0.4], [48, 0.3], [16, 0.3]],
    } },
    { kind: "element", url: "https://acme-saas.com/", dna: {
      colors: [["#ffffff", "background", 0.7], ["#0a2540", "text", 0.1], ["#425466", "text", 0.1], ["#635bff", "background", 0.05], ["#e3e8ee", "border", 0.05]],
      fonts: [["Inter", 15, 500, 24, 0.6], ["Inter", 14, 500, 20, 0.4]],
      radii: [[9999, 0.5], [6, 0.5]], spacing: [[8, 0.4], [16, 0.4], [24, 0.2]],
    } },
    { kind: "element", url: "https://acme-saas.com/", dna: {
      colors: [["#635bff", "background", 0.5], ["#ffffff", "text", 0.15], ["#ffffff", "background", 0.25], ["#635bff", "text", 0.05], ["#00d4ff", "background", 0.12]],
      fonts: [["Plus Jakarta Sans", 40, 700, 48, 0.4], ["Inter", 18, 400, 28, 0.6]],
      radii: [[8, 1]], shadows: [[SAAS_SHADOW_SM, 1]], spacing: [[32, 0.4], [48, 0.3], [16, 0.3]],
    } },
    { kind: "element", url: "https://acme-saas.com/about", dna: {
      colors: [["#f6f9fc", "background", 0.6], ["#0a2540", "text", 0.08], ["#425466", "text", 0.2], ["#e3e8ee", "border", 0.07], ["#635bff", "text", 0.05]],
      fonts: [["Inter", 14, 400, 20, 0.7], ["Inter", 16, 600, 24, 0.3]],
      spacing: [[8, 0.3], [16, 0.4], [32, 0.3]],
    } },
    { kind: "element", url: "https://acme-saas.com/customers", dna: {
      colors: [["#ffffff", "background", 0.5], ["#f6f9fc", "background", 0.2], ["#0a2540", "text", 0.15], ["#425466", "text", 0.1], ["#e3e8ee", "border", 0.05]],
      fonts: [["Plus Jakarta Sans", 24, 600, 32, 0.3], ["Inter", 18, 400, 30, 0.7]],
      radii: [[16, 0.5], [9999, 0.5]], shadows: [[SAAS_SHADOW_SM, 1]], spacing: [[24, 0.5], [16, 0.5]],
    } },
  ],
};

/* ---------- dark dashboard app ---------- */

export const DARK_DASHBOARD: FixtureSession = {
  name: "Dark dashboard",
  domain: "metrics.app",
  captures: [
    { kind: "element", url: "https://metrics.app/overview", dna: {
      colors: [["#0b0f19", "background", 0.6], ["#151b2b", "background", 0.15], ["#e6e9f0", "text", 0.08], ["#6b7389", "text", 0.12],
        ["#10b981", "text", 0.03], ["#262f45", "border", 0.02]],
      fonts: [["Geist", 14, 500, 20, 0.8], ["Geist", 12, 500, 16, 0.2]],
      radii: [[6, 1]], spacing: [[4, 0.4], [12, 0.4], [8, 0.2]],
    } },
    { kind: "element", url: "https://metrics.app/overview", dna: {
      colors: [["#151b2b", "background", 0.55], ["#0b0f19", "background", 0.2], ["#262f45", "border", 0.05], ["#e6e9f0", "text", 0.1],
        ["#6b7389", "text", 0.06], ["#10b981", "text", 0.03], ["#ef4444", "text", 0.01]],
      fonts: [["Geist", 30, 600, 36, 0.4], ["Geist", 14, 400, 20, 0.4], ["Geist", 12, 400, 16, 0.2]],
      radii: [[8, 1]], spacing: [[20, 0.4], [12, 0.3], [4, 0.3]],
    } },
    { kind: "element", url: "https://metrics.app/revenue", dna: {
      colors: [["#151b2b", "background", 0.6], ["#10b981", "border", 0.08], ["#f59e0b", "border", 0.02], ["#262f45", "border", 0.07],
        ["#6b7389", "text", 0.08], ["#e6e9f0", "text", 0.05], ["#0b0f19", "background", 0.1]],
      fonts: [["Geist", 12, 400, 16, 0.6], ["Geist", 14, 400, 20, 0.4]],
      radii: [[8, 1]], spacing: [[12, 0.5], [20, 0.3], [16, 0.2]],
    } },
    { kind: "element", url: "https://metrics.app/customers", dna: {
      colors: [["#0b0f19", "background", 0.55], ["#151b2b", "background", 0.15], ["#262f45", "border", 0.08], ["#e6e9f0", "text", 0.12], ["#6b7389", "text", 0.1]],
      fonts: [["Geist", 14, 400, 20, 0.7], ["JetBrains Mono", 13, 400, 20, 0.3]],
      radii: [[6, 1]], spacing: [[12, 0.4], [4, 0.3], [8, 0.3]],
    } },
    { kind: "element", url: "https://metrics.app/overview", dna: {
      colors: [["#0b0f19", "background", 0.5], ["#10b981", "background", 0.15], ["#0b0f19", "text", 0.03], ["#e6e9f0", "text", 0.12],
        ["#6b7389", "text", 0.1], ["#262f45", "border", 0.05], ["#151b2b", "background", 0.05]],
      fonts: [["Geist", 24, 600, 32, 0.4], ["Geist", 14, 500, 20, 0.6]],
      radii: [[6, 0.7], [9999, 0.3]], spacing: [[12, 0.4], [4, 0.3], [24, 0.3]],
    } },
    { kind: "element", url: "https://metrics.app/settings", dna: {
      colors: [["#151b2b", "background", 0.6], ["#0b0f19", "background", 0.1], ["#262f45", "border", 0.06], ["#e6e9f0", "text", 0.1],
        ["#6b7389", "text", 0.09], ["#10b981", "background", 0.05]],
      fonts: [["Geist", 20, 600, 28, 0.3], ["Geist", 14, 400, 20, 0.7]],
      radii: [[12, 0.6], [6, 0.4]], shadows: [["rgba(0, 0, 0, 0.5) 0px 20px 25px -5px", 1]], spacing: [[20, 0.4], [12, 0.3], [4, 0.3]],
    } },
  ],
};

/* ---------- colourful e-commerce shop ---------- */

export const COLORFUL_SHOP: FixtureSession = {
  name: "Colourful e-commerce",
  domain: "shop.example",
  captures: [
    { kind: "element", url: "https://shop.example/p/linen-shirt", dna: {
      colors: [["#fffaf5", "background", 0.45], ["#fdebdc", "background", 0.1], ["#1f1a17", "text", 0.12], ["#6b5e55", "text", 0.1],
        ["#e11d48", "text", 0.05], ["#e11d48", "background", 0.08], ["#ffffff", "text", 0.02], ["#eadfd6", "border", 0.08]],
      fonts: [["Playfair Display", 28, 700, 34, 0.25], ["DM Sans", 16, 400, 24, 0.5], ["DM Sans", 14, 500, 20, 0.25]],
      radii: [[12, 0.6], [9999, 0.4]], shadows: [["rgba(31, 26, 23, 0.08) 0px 4px 12px 0px", 1]], spacing: [[12, 0.3], [16, 0.3], [24, 0.3], [8, 0.1]],
    } },
    { kind: "element", url: "https://shop.example/", dna: {
      colors: [["#e11d48", "background", 0.35], ["#fffaf5", "text", 0.1], ["#fffaf5", "background", 0.35], ["#1f1a17", "text", 0.1], ["#0ea5e9", "background", 0.1]],
      fonts: [["Playfair Display", 48, 800, 52, 0.4], ["DM Sans", 18, 400, 28, 0.6]],
      radii: [[16, 1]], spacing: [[32, 0.4], [48, 0.3], [24, 0.3]],
    } },
    { kind: "element", url: "https://shop.example/", dna: {
      colors: [["#fdebdc", "background", 0.3], ["#fffaf5", "background", 0.3], ["#0ea5e9", "background", 0.1], ["#e11d48", "background", 0.05],
        ["#1f1a17", "text", 0.15], ["#6b5e55", "text", 0.05], ["#eadfd6", "border", 0.05]],
      fonts: [["Playfair Display", 24, 700, 30, 0.3], ["DM Sans", 15, 500, 22, 0.7]],
      radii: [[16, 0.7], [12, 0.3]], spacing: [[16, 0.4], [24, 0.4], [12, 0.2]],
    } },
    { kind: "element", url: "https://shop.example/", dna: {
      colors: [["#fffaf5", "background", 0.7], ["#1f1a17", "text", 0.15], ["#6b5e55", "text", 0.08], ["#e11d48", "background", 0.03], ["#eadfd6", "border", 0.04]],
      fonts: [["DM Sans", 15, 500, 24, 0.8], ["DM Sans", 13, 500, 18, 0.2]],
      radii: [[9999, 0.5], [8, 0.5]], spacing: [[8, 0.3], [12, 0.3], [16, 0.2], [20, 0.2]],
    } },
    { kind: "element", url: "https://shop.example/newsletter", dna: {
      colors: [["#fffaf5", "background", 0.5], ["#1f1a17", "text", 0.15], ["#ffffff", "background", 0.15], ["#eadfd6", "border", 0.05],
        ["#e11d48", "background", 0.1], ["#6b5e55", "text", 0.05]],
      fonts: [["Playfair Display", 32, 700, 40, 0.3], ["DM Sans", 16, 400, 24, 0.7]],
      radii: [[12, 1]], shadows: [["rgba(31, 26, 23, 0.05) 0px 1px 2px 0px", 1]], spacing: [[24, 0.4], [16, 0.3], [8, 0.2], [32, 0.1]],
    } },
    { kind: "element", url: "https://shop.example/p/linen-shirt#reviews", dna: {
      colors: [["#fffaf5", "background", 0.55], ["#fdebdc", "background", 0.15], ["#1f1a17", "text", 0.12], ["#6b5e55", "text", 0.1],
        ["#f59e0b", "text", 0.05], ["#eadfd6", "border", 0.03]],
      fonts: [["Playfair Display", 24, 700, 30, 0.2], ["DM Sans", 16, 400, 26, 0.6], ["DM Sans", 14, 400, 20, 0.2]],
      radii: [[12, 1]], spacing: [[16, 0.4], [24, 0.3], [12, 0.2], [8, 0.1]],
    } },
    { kind: "viewport", url: "https://shop.example/c/summer", palette: [["#2f5d50", 0.3], ["#facc15", 0.2], ["#f4efe9", 0.3], ["#8b5a3c", 0.2]] },
    { kind: "viewport", url: "https://shop.example/c/new", palette: [["#fef3c7", 0.4], ["#1e3a8a", 0.2], ["#fb7185", 0.2], ["#f8fafc", 0.2]] },
  ],
};

export const FIXTURE_SESSIONS = [LIGHT_SAAS, DARK_DASHBOARD, COLORFUL_SHOP];

/** Insert a fixture as one of `userId`'s sessions, with its captures (and their stored files). */
export async function seedFixtureSession(t: T, userId: string, fixture: FixtureSession): Promise<Id<"sessions">> {
  return await t.run(async (ctx) => {
    const sessionId = await ctx.db.insert("sessions", {
      userId,
      name: fixture.name,
      startedAt: 1,
      lastCaptureAt: 1,
      itemCount: fixture.captures.length,
    });
    for (const [i, c] of fixture.captures.entries()) {
      const common = {
        url: c.url,
        timestamp: i + 1,
        userId,
        sessionId,
        domain: fixture.domain,
        width: 800,
        height: 400,
        storageId: await ctx.storage.store(new Blob([`${fixture.domain}-${i}`])),
      };
      if (c.kind === "element") await ctx.db.insert("captures", { kind: "element", ...common, designDna: designDna(c.url, c.dna) });
      else await ctx.db.insert("captures", { kind: "viewport", ...common, palette: palette(c.palette) });
    }
    return sessionId;
  });
}
