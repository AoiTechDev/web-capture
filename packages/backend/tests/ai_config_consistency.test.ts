/**
 * The SigLIP2 constants in lib/ai_config agree with each other, with the
 * schema's vector indexes and with Convex's limits, beyond ai_config.test.ts.
 */
import { describe, expect, test } from "vitest";
import schema from "../convex/schema";
import {
  EMBED_QUERY_MAX_CHARS,
  LOCAL_EMBEDDING_DIM,
  LOCAL_MODEL_ID,
  LOCAL_TEXT_MAX_TOKENS,
  MATCH_DISPLAY_BANDS,
  matchScore,
  SEARCH_TUNING,
  SIGLIP_LOGIT_BIAS,
  SIGLIP_LOGIT_SCALE,
} from "../convex/lib/ai_config";

describe("model identity", () => {
  test("SigLIP2 base/16-384 with 768-d pooled output", () => {
    expect(LOCAL_MODEL_ID).toBe("onnx-community/siglip2-base-patch16-384-ONNX");
    expect(LOCAL_EMBEDDING_DIM).toBe(768);
    expect(LOCAL_TEXT_MAX_TOKENS).toBe(64);
  });

  test("both vector indexes on captures use LOCAL_EMBEDDING_DIM", () => {
    const indexes = (schema as any).tables.captures.export().vectorIndexes as Array<{
      indexDescriptor: string;
      dimensions: number;
      filterFields: string[];
    }>;
    expect(indexes.map((i) => i.indexDescriptor).sort()).toEqual(["by_localEmbedding", "by_textEmbedding"]);
    for (const i of indexes) {
      expect(i.dimensions).toBe(LOCAL_EMBEDDING_DIM);
      // Isolation in searchCaptures depends on filtering by owner inside the index.
      expect(i.filterFields).toContain("userId");
    }
  });

  test("the logit scale is exp(4.7260) from the original weights; the bias is negative", () => {
    expect(SIGLIP_LOGIT_SCALE).toBeCloseTo(Math.exp(4.726), 1);
    expect(SIGLIP_LOGIT_BIAS).toBeLessThan(0);
  });
});

describe("thresholds are self-consistent", () => {
  const spaces = [
    ["image", SEARCH_TUNING.imageMinScore, MATCH_DISPLAY_BANDS.image],
    ["text", SEARCH_TUNING.textMinScore, MATCH_DISPLAY_BANDS.text],
  ] as const;

  test.each(spaces)("%s: -1 <= floor < band low < band high <= 1", (_space, floor, [lo, hi]) => {
    expect(floor).toBeGreaterThanOrEqual(-1);
    expect(floor).toBeLessThan(lo);
    expect(lo).toBeLessThan(hi);
    expect(hi).toBeLessThanOrEqual(1);
  });

  test.each(spaces)("%s: floors drop only near-orthogonal hits (non-negative)", (_space, floor) => {
    expect(floor).toBeGreaterThan(0);
  });

  test("SigLIP's crowded text space sits well above its image space", () => {
    expect(SEARCH_TUNING.textMinScore).toBeGreaterThan(SEARCH_TUNING.imageMinScore);
    expect(MATCH_DISPLAY_BANDS.text[0]).toBeGreaterThan(MATCH_DISPLAY_BANDS.image[1]);
  });

  test("CLIP-era floors are gone (0.18 image / 0.6 text would drop SigLIP2 matches or admit junk)", () => {
    expect(SEARCH_TUNING.imageMinScore).toBeLessThan(0.18);
    expect(SEARCH_TUNING.textMinScore).toBeGreaterThan(0.6);
  });

  test.each([
    ["image", SEARCH_TUNING.imageRelativeMargin, MATCH_DISPLAY_BANDS.image],
    ["text", SEARCH_TUNING.textRelativeMargin, MATCH_DISPLAY_BANDS.text],
  ] as const)("%s: the vector-only margin is positive and narrower than the display band", (_space, margin, [lo, hi]) => {
    expect(margin).toBeGreaterThan(0);
    expect(margin).toBeLessThan(hi - lo);
  });

  test("the image margin is below the gap between a typical correct (0.16) and unrelated (0.08) screenshot", () => {
    expect(SEARCH_TUNING.imageRelativeMargin).toBeLessThan(0.16 - 0.08);
  });

  test("vector candidates fit Convex's vectorSearch limit (1-256) and RRF k is positive", () => {
    expect(Number.isInteger(SEARCH_TUNING.vectorCandidates)).toBe(true);
    expect(SEARCH_TUNING.vectorCandidates).toBeGreaterThanOrEqual(1);
    expect(SEARCH_TUNING.vectorCandidates).toBeLessThanOrEqual(256);
    expect(Number.isInteger(SEARCH_TUNING.filteredVectorCandidates)).toBe(true);
    expect(SEARCH_TUNING.filteredVectorCandidates).toBeGreaterThanOrEqual(SEARCH_TUNING.vectorCandidates);
    expect(SEARCH_TUNING.filteredVectorCandidates).toBeLessThanOrEqual(256);
    expect(SEARCH_TUNING.rrfK).toBeGreaterThan(0);
  });

  test("the extension's query cap fits within what searchCaptures keeps of a query (500 chars)", () => {
    expect(Number.isInteger(EMBED_QUERY_MAX_CHARS)).toBe(true);
    expect(EMBED_QUERY_MAX_CHARS).toBeGreaterThan(0);
    expect(EMBED_QUERY_MAX_CHARS).toBeLessThanOrEqual(500);
  });
});

describe("matchScore over the whole cosine range", () => {
  test.each([
    ["image", "image"],
    ["text", "text"],
  ] as const)("%s: in [0, 1] and non-decreasing from -1 to 1", (_label, space) => {
    let prev = -Infinity;
    for (let c = -1; c <= 1.0001; c += 0.01) {
      const s = matchScore({ [space]: { score: c } } as any)!;
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(1);
      expect(s).toBeGreaterThanOrEqual(prev);
      prev = s;
    }
  });

  test.each([
    ["image", SEARCH_TUNING.imageMinScore],
    ["text", SEARCH_TUNING.textMinScore],
  ] as const)("%s: a hit exactly at the floor displays 0%%", (space, floor) => {
    expect(matchScore({ [space]: { score: floor } } as any)).toBe(0);
  });

  test("a typical correct English image match (median ~0.16) shows well above half", () => {
    expect(matchScore({ image: { score: 0.16 } })!).toBeGreaterThan(0.5);
  });

  test("a typical unrelated screenshot (median ~0.08) shows low", () => {
    expect(matchScore({ image: { score: 0.08 } })!).toBeLessThan(0.3);
  });

  test("unrelated text (median ~0.79) does not show as a strong match", () => {
    expect(matchScore({ text: { score: 0.79 } })!).toBeLessThan(0.5);
  });
});
