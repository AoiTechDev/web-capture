/**
 * lib/search_filters (pure): filter validation, the colour maths behind the
 * by_user_l prefilter, and the page cursors.
 */
import { describe, expect, test } from "vitest";
import { deltaE2000, seededRandom, type Lab } from "../convex/lib/color";
import {
  clampLimit,
  colorRowMatches,
  decodeBrowseCursor,
  decodeSearchCursor,
  encodeBrowseCursor,
  encodeSearchCursor,
  FILTER_LIMITS,
  lightnessBand,
  normalizeFilters,
  normalizeHex,
} from "../convex/lib/search_filters";

describe("normalizeFilters", () => {
  test("no filters: only the default tolerance", () => {
    expect(normalizeFilters({})).toEqual({ colorTolerance: 10 });
  });

  test("hex: #rgb and #rrggbb in any case become lowercase #rrggbb", () => {
    expect(normalizeHex("#ABC")).toBe("#aabbcc");
    expect(normalizeHex(" #1A2b3C ")).toBe("#1a2b3c");
    expect(normalizeFilters({ color: "#F00" }).color).toBe("#ff0000");
  });

  test.each(["red", "#12345", "#1234567", "#ggg", "123456", "", "#12345678", "rgb(1,2,3)"])(
    "rejects the colour %j",
    (color) => {
      expect(() => normalizeFilters({ color })).toThrow(/color must be a hex/);
    }
  );

  test.each([
    [undefined, 10],
    [0, 1],
    [-5, 1],
    [1, 1],
    [12.5, 12.5],
    [50, 50],
    [1000, 50],
  ])("tolerance %s is clamped to %s", (colorTolerance, want) => {
    expect(normalizeFilters({ colorTolerance }).colorTolerance).toBe(want);
  });

  test.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])("tolerance %s is refused", (x) => {
    expect(() => normalizeFilters({ colorTolerance: x })).toThrow(/colorTolerance/);
  });

  test("dates: equal bounds pass, dateFrom after dateTo is refused", () => {
    expect(normalizeFilters({ dateFrom: 5, dateTo: 5 })).toMatchObject({ dateFrom: 5, dateTo: 5 });
    expect(() => normalizeFilters({ dateFrom: 6, dateTo: 5 })).toThrow(/dateFrom must not be after dateTo/);
  });

  test.each([
    ["dateFrom", -1],
    ["dateTo", Number.NaN],
    ["dateFrom", Number.POSITIVE_INFINITY],
  ])("%s = %s is refused", (key, value) => {
    expect(() => normalizeFilters({ [key]: value })).toThrow(new RegExp(key));
  });

  test("lists are de-duplicated; empty lists mean no filter", () => {
    expect(normalizeFilters({ kinds: ["image", "image", "text"] }).kinds).toEqual(["image", "text"]);
    expect(normalizeFilters({ kinds: [], aiCategories: [] })).toEqual({ colorTolerance: 10 });
  });

  test("lists longer than maxListEntries are refused", () => {
    const many = Array.from({ length: FILTER_LIMITS.maxListEntries + 1 }, () => "image");
    expect(() => normalizeFilters({ kinds: many })).toThrow(/kinds has more than/);
    expect(() => normalizeFilters({ aiCategories: many })).toThrow(/aiCategories has more than/);
    expect(normalizeFilters({ kinds: many.slice(1) }).kinds).toEqual(["image"]);
  });

  test("the legacy aiCategory is folded into aiCategories", () => {
    expect(normalizeFilters({ aiCategory: "hero" }).aiCategories).toEqual(["hero"]);
    expect(normalizeFilters({ aiCategory: "hero", aiCategories: ["pricing"] }).aiCategories).toEqual([
      "pricing",
      "hero",
    ]);
    expect(normalizeFilters({ aiCategory: "hero", aiCategories: ["hero"] }).aiCategories).toEqual(["hero"]);
  });

  test("sessionId passes through untouched", () => {
    expect(normalizeFilters({ sessionId: "abc" }).sessionId).toBe("abc");
  });
});

describe("clampLimit", () => {
  test.each([
    [undefined, 30],
    [0, 1],
    [-3, 1],
    [1, 1],
    [2.9, 2],
    [100, 100],
    [5000, 100],
  ])("%s -> %s", (limit, want) => {
    expect(clampLimit(limit)).toBe(want);
  });

  test.each([Number.NaN, Number.POSITIVE_INFINITY])("%s is refused", (x) => {
    expect(() => clampLimit(x)).toThrow(/limit/);
  });
});

describe("colour maths", () => {
  test("lightnessBand never cuts a match: ΔE2000 < tol implies |ΔL| < lightnessBand(tol)", () => {
    const rand = seededRandom(42);
    const lab = (): Lab => [rand() * 100, rand() * 200 - 100, rand() * 200 - 100];
    let checked = 0;
    for (let i = 0; i < 20000; i++) {
      const p = lab();
      const q = lab();
      const d = deltaE2000(p, q);
      if (d >= 50) continue;
      checked++;
      // The tightest tolerance that admits the pair is just above d.
      expect(Math.abs(p[0] - q[0])).toBeLessThanOrEqual(lightnessBand(d) + 1e-9);
    }
    expect(checked).toBeGreaterThan(1000);
  });

  test("the bound is close to tight at the extremes of L (S_L near its maximum)", () => {
    // Pure lightness difference near black: ΔE = |ΔL| / S_L.
    const d = deltaE2000([0, 0, 0], [8, 0, 0]);
    expect(8 / d).toBeGreaterThan(1.6);
    expect(8 / d).toBeLessThanOrEqual(1.75);
  });

  test("colorRowMatches: strict tolerance, weight must exceed 0.05", () => {
    const target: Lab = [50, 20, 20];
    const row = { l: 50, a: 20, b: 20, weight: 0.5 };
    expect(colorRowMatches(target, row, 1)).toBe(true);
    expect(colorRowMatches(target, { ...row, weight: 0.05 }, 1)).toBe(false);
    expect(colorRowMatches(target, { ...row, weight: 0.0501 }, 1)).toBe(true);
    const far = { l: 60, a: 20, b: 20, weight: 0.5 };
    const d = deltaE2000(target, [far.l, far.a, far.b]);
    expect(colorRowMatches(target, far, d)).toBe(false);
    expect(colorRowMatches(target, far, d + 1e-6)).toBe(true);
  });
});

describe("cursors", () => {
  test("browse cursors round-trip, including fractional times", () => {
    const c = { t: 1727780000000.123, id: "10001;captures" };
    expect(decodeBrowseCursor(encodeBrowseCursor(c))).toEqual(c);
  });

  test("search cursors round-trip", () => {
    expect(decodeSearchCursor(encodeSearchCursor(60))).toBe(60);
  });

  test.each([
    "",
    "b",
    "b|1",
    "b||x",
    "b|abc|x",
    "b|-1|x",
    "b|1|bad id",
    "b|1|x|y",
    "s|1",
    `b|1|${"x".repeat(300)}`,
  ])("rejects the browse cursor %j", (cursor) => {
    expect(() => decodeBrowseCursor(cursor)).toThrow(/Invalid cursor/);
  });

  test.each(["", "s", "s|", "s|-1", "s|1.5", "s|x", `s|${FILTER_LIMITS.maxSearchOffset + 1}`, "b|1|x", "s|1|2"])(
    "rejects the search cursor %j",
    (cursor) => {
      expect(() => decodeSearchCursor(cursor)).toThrow(/Invalid cursor/);
    }
  );
});
