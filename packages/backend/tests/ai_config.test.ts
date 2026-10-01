import { describe, expect, test } from "vitest";
import { imageQueryText, MATCH_DISPLAY_BANDS, matchScore, SEARCH_TUNING } from "../convex/lib/ai_config";

describe("imageQueryText", () => {
  test("embeds the raw (trimmed) query: SigLIP2 does best without a caption template", () => {
    expect(imageQueryText("  pricing table ")).toBe("pricing table");
    expect(imageQueryText("cennik z trzema planami")).toBe("cennik z trzema planami");
  });
});

describe("matchScore", () => {
  test("null when no vector source found the hit", () => {
    expect(matchScore({})).toBeNull();
  });

  test("maps each space's cosine band linearly onto 0-1 and clamps", () => {
    const [lo, hi] = MATCH_DISPLAY_BANDS.image;
    expect(matchScore({ image: { score: lo } })).toBe(0);
    expect(matchScore({ image: { score: hi } })).toBe(1);
    expect(matchScore({ image: { score: (lo + hi) / 2 } })).toBeCloseTo(0.5, 4);
    expect(matchScore({ image: { score: -0.2 } })).toBe(0);
    expect(matchScore({ image: { score: 0.9 } })).toBe(1);
  });

  test("text cosines use their own band, so a routine 0.8 text hit is not '100%'", () => {
    expect(matchScore({ text: { score: 0.8 } })).toBeGreaterThan(0);
    expect(matchScore({ text: { score: 0.8 } })).toBeLessThan(0.5);
  });

  test("takes the better of the two spaces", () => {
    expect(matchScore({ image: { score: 0.2 }, text: { score: 0.75 } })).toBe(1);
  });

  test("the floors sit below the display bands' useful range", () => {
    expect(SEARCH_TUNING.imageMinScore).toBeLessThanOrEqual(MATCH_DISPLAY_BANDS.image[0]);
    expect(SEARCH_TUNING.textMinScore).toBeLessThanOrEqual(MATCH_DISPLAY_BANDS.text[0]);
  });
});
