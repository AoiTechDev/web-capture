import { describe, expect, test } from "vitest";
import * as ai from "../convex/ai";
import * as captures from "../convex/captures";
import * as links from "../convex/links";
import * as search from "../convex/search";

/**
 * `api` from _generated is a runtime proxy that accepts any name, so
 * "absent from api" is checked on the registered functions themselves: an
 * internal function has isInternal=true and isPublic unset.
 */
const isInternal = (fn: any) => fn?.isInternal === true && fn?.isPublic !== true;
const isPublic = (fn: any) => fn?.isPublic === true;

describe("function visibility", () => {
  test.each([
    ["links.patchPreview", links.patchPreview],
    ["links.attachPreviewToCapture", links.attachPreviewToCapture],
    ["ai.generateImageCaptionAndEmbedding", ai.generateImageCaptionAndEmbedding],
    ["ai.embedQuery", ai.embedQuery],
    ["search.searchCapturesSemantic", search.searchCapturesSemantic],
    ["captures.backfillCaptureStatus", captures.backfillCaptureStatus],
    ["search.rankAndHydrate", search.rankAndHydrate],
  ])("%s is internal (not callable via api)", (_name, fn) => {
    expect(isInternal(fn)).toBe(true);
  });

  test("ai.ts exports no public functions", () => {
    const pub = Object.entries(ai).filter(([, fn]) => isPublic(fn));
    expect(pub.map(([n]) => n)).toEqual([]);
  });

  test("search.ts: only the auth-scoped search functions are public", () => {
    const pub = Object.entries(search).filter(([, fn]) => isPublic(fn));
    expect(pub.map(([n]) => n).sort()).toEqual(["searchCaptures", "searchCapturesFallback"]);
  });

  test("links.ts public surface is limited to read/insert/enrich", () => {
    const pub = Object.entries(links)
      .filter(([, fn]) => isPublic(fn))
      .map(([n]) => n)
      .sort();
    expect(pub).toEqual(["enrichLinkPreviewForCapture", "getByUserAndCanonicalUrl", "insertPreview"]);
  });
});
