import { describe, expect, test } from "vitest";
import * as captures from "../convex/captures";
import * as links from "../convex/links";
import * as search from "../convex/search";
import * as upload from "../convex/upload";
import * as userStats from "../convex/user_stats";
import { modules } from "./setup";

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
    ["user_stats.backfillUserStats", userStats.backfillUserStats],
    ["captures.backfillCaptureStatus", captures.backfillCaptureStatus],
    ["captures.backfillColorSignificance", captures.backfillColorSignificance],
    ["search.rankAndHydrate", search.rankAndHydrate],
  ])("%s is internal (not callable via api)", (_name, fn) => {
    expect(isInternal(fn)).toBe(true);
  });

  test("removed functions are gone, not just hidden", () => {
    expect((captures as any).patchImageCaptionAndEmbedding).toBeUndefined();
    expect((captures as any).listAllForUser).toBeUndefined();
    expect((search as any).searchCapturesFallback).toBeUndefined();
    expect((search as any).searchCapturesSemantic).toBeUndefined();
    // Legacy folder browsing, superseded by browse.browseCaptures.
    expect((captures as any).byCategoryAndKind).toBeUndefined();
    expect((upload as any).reassignCaptureCategory).toBeUndefined();
  });

  test("ai.ts (the unused OpenAI query embedding) is gone", () => {
    expect(Object.keys(modules).some((m) => /\/ai\.[jt]s$/.test(m))).toBe(false);
  });

  test("user_stats.ts exports no public functions", () => {
    const pub = Object.entries(userStats).filter(([, fn]) => isPublic(fn));
    expect(pub.map(([n]) => n)).toEqual([]);
  });

  test("search.ts: only the auth-scoped search functions are public", () => {
    const pub = Object.entries(search).filter(([, fn]) => isPublic(fn));
    expect(pub.map(([n]) => n).sort()).toEqual(["searchCaptures"]);
  });

  test("links.ts public surface is limited to read/insert/enrich", () => {
    const pub = Object.entries(links)
      .filter(([, fn]) => isPublic(fn))
      .map(([n]) => n)
      .sort();
    expect(pub).toEqual(["enrichLinkPreviewForCapture", "getByUserAndCanonicalUrl", "insertPreview"]);
  });
});
