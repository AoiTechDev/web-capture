/**
 * lib/search_filters (pure): filter validation, the colour maths behind the
 * by_user_significant_l prefilter, and the page cursors.
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
  isSearchCursor,
  isSignificantColor,
  lightnessRange,
  lightnessWeight,
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

  test("the removed single aiCategory is ignored, not folded in", () => {
    expect(normalizeFilters({ aiCategory: "hero" } as any)).toEqual({ colorTolerance: 10 });
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
  const inRange = (target: Lab, row: Lab, tol: number) => {
    const [lo, hi] = lightnessRange(target[0], tol);
    return row[0] >= lo && row[0] <= hi;
  };

  test("lightnessRange never cuts a match: random pairs at the tightest tolerance that admits them", () => {
    const rand = seededRandom(42);
    const lab = (): Lab => [rand() * 100, rand() * 200 - 100, rand() * 200 - 100];
    let checked = 0;
    for (let i = 0; i < 40000; i++) {
      const p = lab();
      // Half the pairs close together, so small tolerances are exercised too.
      const q: Lab = i % 2 ? lab() : [p[0] + (rand() - 0.5) * 30, p[1] + (rand() - 0.5) * 30, p[2] + (rand() - 0.5) * 30];
      if (q[0] < 0 || q[0] > 100) continue;
      const d = deltaE2000(p, q);
      if (d >= 50 || d < 1) continue;
      checked++;
      // ΔE < tol is a match; the tightest such tol is just above d.
      expect(inRange(p, q, d * (1 + 1e-12))).toBe(true);
    }
    expect(checked).toBeGreaterThan(10000);
  });

  test.each([0, 0.5, 2, 5, 15, 35, 50, 65, 85, 95, 98, 99.5, 100])(
    "pure lightness differences (ΔE = |ΔL| / S_L exactly) stay inside the range around L = %s",
    (l0) => {
      // a = b = 0 leaves only the lightness term, the case the band is tight
      // for; near L = 0 and 100, moving towards 50 lowers S_L along the way.
      for (let l1 = 0; l1 <= 100; l1 += 0.25) {
        const d = deltaE2000([l0, 0, 0], [l1, 0, 0]);
        if (d === 0 || d >= 50) continue;
        expect(inRange([l0, 0, 0], [l1, 0, 0], d * (1 + 1e-12))).toBe(true);
      }
    }
  );

  test("near-grey worst cases at the extremes: chroma adds to ΔE, never lets L stray further", () => {
    for (const l0 of [0, 1, 99, 100]) {
      for (let l1 = 0; l1 <= 100; l1 += 0.5) {
        for (const c of [0.5, 2, 8]) {
          const q: Lab = [l1, c, -c];
          const d = deltaE2000([l0, 0, 0], q);
          if (d >= 50) continue;
          expect(inRange([l0, 0, 0], q, d * (1 + 1e-12))).toBe(true);
        }
      }
    }
  });

  test("tighter than the flat bound: ±10.6 around mid-grey at tolerance 10, never wider than 1.75 x tol", () => {
    const [lo, hi] = lightnessRange(50, 10);
    expect(hi - 50).toBeLessThan(10.7);
    expect(50 - lo).toBeLessThan(10.7);
    for (const l0 of [0, 10, 30, 50, 70, 90, 100]) {
      for (const tol of [1, 10, 50]) {
        const [a, b] = lightnessRange(l0, tol);
        expect(l0 - a).toBeLessThanOrEqual(tol * 1.75 + 1e-6);
        expect(b - l0).toBeLessThanOrEqual(tol * 1.75 + 1e-6);
        expect(l0 - a).toBeGreaterThanOrEqual(tol);
        expect(b - l0).toBeGreaterThanOrEqual(tol);
      }
    }
  });

  test("S_L grows with distance from L = 50 and peaks below 1.75", () => {
    expect(lightnessWeight(50)).toBe(1);
    expect(lightnessWeight(40)).toBeCloseTo(lightnessWeight(60), 12);
    expect(lightnessWeight(20)).toBeGreaterThan(lightnessWeight(30));
    expect(lightnessWeight(0)).toBeLessThan(1.75);
    expect(lightnessWeight(0)).toBeGreaterThan(1.74);
  });

  test("the flat bound is close to tight at the extremes of L (S_L near its maximum)", () => {
    // Pure lightness difference near black: ΔE = |ΔL| / S_L.
    const d = deltaE2000([0, 0, 0], [8, 0, 0]);
    expect(8 / d).toBeGreaterThan(1.6);
    expect(8 / d).toBeLessThanOrEqual(1.75);
  });

  test("isSignificantColor: weight must exceed 0.05", () => {
    expect(isSignificantColor(0.05)).toBe(false);
    expect(isSignificantColor(0.0501)).toBe(true);
    expect(isSignificantColor(0)).toBe(false);
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

  test("search cursors round-trip with their snapshot and mode", () => {
    for (const c of [
      { offset: 60, snapshot: 1727780000000.123, mode: "index" as const },
      { offset: 0, snapshot: 0, mode: "exact" as const },
      { offset: FILTER_LIMITS.maxSearchOffset, snapshot: 5, mode: "index" as const },
    ]) {
      expect(decodeSearchCursor(encodeSearchCursor(c))).toEqual(c);
    }
    expect(encodeSearchCursor({ offset: 2, snapshot: 7.5, mode: "exact" })).toBe("s|2|7.5|exact");
    expect(isSearchCursor("s|2|7.5|exact")).toBe(true);
    expect(isSearchCursor("b|1|x")).toBe(false);
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
    "b|1e3|x",
    "b|0x10|x",
    "b| 1|x",
    "b|01|x",
    "b|Infinity|x",
    `b|1|${"x".repeat(300)}`,
  ])("rejects the browse cursor %j", (cursor) => {
    expect(() => decodeBrowseCursor(cursor)).toThrow(/Invalid cursor/);
  });

  test.each([
    "",
    "s",
    "s|",
    "s|1",
    "s|1|2",
    "s|-1|5|index",
    "s|1.5|5|index",
    "s|x|5|index",
    "s|1e2|5|index",
    "s|01|5|index",
    "s| 1|5|index",
    `s|${FILTER_LIMITS.maxSearchOffset + 1}|5|index`,
    "s|1|-5|index",
    "s|1|x|index",
    "s|1|1e12|index",
    "s|1|5|",
    "s|1|5|browse",
    "s|1|5|INDEX",
    "s|1|5|index|x",
    `s|1|${"9".repeat(250)}|index`,
    "b|1|x",
  ])(
    "rejects the search cursor %j",
    (cursor) => {
      expect(() => decodeSearchCursor(cursor)).toThrow(/Invalid cursor/);
    }
  );
});
