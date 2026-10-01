/**
 * The dashboard's filter state, URL form, query arguments, browse paging and
 * tag editing (apps/web/src/lib). The web app has no test runner; these
 * modules are pure TS with relative imports only, so they are tested here,
 * like dashboard-embed.test.ts.
 */
import { describe, expect, test } from "vitest"

import {
  clearFilters,
  countActiveFilters,
  EMPTY_FILTERS,
  normalizeHexColor,
  parseDay,
  parseFilterParams,
  serializeFilterParams,
  toggle,
  withColorFilter,
  type CaptureFilters,
} from "../../web/src/lib/capture-filters"
import {
  argsKey,
  buildBrowseArgs,
  buildSearchArgs,
  dateBounds,
  filtersToArgs,
  kindsForTypes,
  mergePages,
  PAGE_SIZE,
  partitionByLayout,
} from "../../web/src/lib/capture-feed"
import {
  appendPage,
  canAppendPage,
  FIRST_PAGE,
  isFeedDone,
  rangeKey,
  reconcilePages,
  type BrowseReply,
  type PageRange,
} from "../../web/src/lib/browse-pages"
import { addTags, MAX_TAG_LENGTH, MAX_USER_TAGS, normalizeTag, removeTag } from "../../web/src/lib/tags"

const params = (qs: string) => parseFilterParams(new URLSearchParams(qs))
const SESSION = "jd7f6a1b2c3d4e5f6g7h8j9k0m1n2p3q"
const filters = (patch: Partial<CaptureFilters>): CaptureFilters => ({ ...EMPTY_FILTERS, ...patch })

describe("parseFilterParams", () => {
  test("no params is no filters", () => {
    expect(params("")).toEqual(EMPTY_FILTERS)
  })

  test("reads every filter", () => {
    expect(
      params(`q=pricing+table&session=${SESSION}&type=link,image&cat=pricing,hero&color=1A2B3C&tol=25&from=2026-09-01&to=2026-09-30`)
    ).toEqual({
      q: "pricing table",
      session: SESSION,
      types: ["image", "link"],
      categories: ["hero", "pricing"],
      color: "#1a2b3c",
      tolerance: 25,
      date: null,
      from: "2026-09-01",
      to: "2026-09-30",
    })
  })

  test("drops garbage instead of failing", () => {
    expect(
      params("session=../../etc&type=image,video,,IMAGE&cat=hero,bogus&color=red&tol=abc&date=1y&from=2026-02-30&to=yesterday")
    ).toEqual(filters({ types: ["image"], categories: ["hero"] }))
  })

  test("accepts a colour with or without # and in short form", () => {
    expect(params("color=%23ABC").color).toBe("#aabbcc")
    expect(params("color=abc").color).toBe("#aabbcc")
    expect(params("color=12345").color).toBeNull()
  })

  test("clamps an out-of-range tolerance and rounds it", () => {
    expect(params("color=000000&tol=500").tolerance).toBe(50)
    expect(params("color=000000&tol=0").tolerance).toBe(1)
    expect(params("color=000000&tol=12.6").tolerance).toBe(13)
    expect(params("color=000000&tol=").tolerance).toBe(10)
  })

  test("a preset wins over explicit days", () => {
    expect(params("date=7d&from=2026-01-01&to=2026-01-31")).toMatchObject({ date: "7d", from: null, to: null })
  })

  test("a reversed range is put the right way round", () => {
    expect(params("from=2026-09-30&to=2026-09-01")).toMatchObject({ from: "2026-09-01", to: "2026-09-30" })
  })

  test("caps the query length", () => {
    expect(params(`q=${"a".repeat(600)}`).q).toHaveLength(500)
  })
})

describe("serializeFilterParams", () => {
  test("no filters is an empty string", () => {
    expect(serializeFilterParams(EMPTY_FILTERS)).toBe("")
  })

  test("canonical order, defaults left out", () => {
    const qs = serializeFilterParams(
      filters({
        q: " cards ",
        session: SESSION,
        types: ["link", "image"],
        categories: ["pricing", "hero"],
        color: "#1a2b3c",
        tolerance: 10,
        from: "2026-09-01",
      })
    )
    expect(qs).toBe(`q=+cards+&session=${SESSION}&type=image%2Clink&cat=hero%2Cpricing&color=1a2b3c&from=2026-09-01`)
  })

  test("tolerance only travels with a colour", () => {
    expect(serializeFilterParams(filters({ tolerance: 30 }))).toBe("")
    expect(serializeFilterParams(filters({ color: "#000000", tolerance: 30 }))).toBe("color=000000&tol=30")
  })

  test("a preset leaves out explicit days", () => {
    expect(serializeFilterParams(filters({ date: "30d", from: "2026-01-01" }))).toBe("date=30d")
  })

  test("round-trips", () => {
    const f = filters({
      q: "hero with video",
      session: SESSION,
      types: ["screenshot", "text"],
      categories: ["cta"],
      color: "#ff0000",
      tolerance: 5,
      from: "2026-01-01",
      to: "2026-02-01",
    })
    expect(params(serializeFilterParams(f))).toEqual(f)
  })
})

describe("filter helpers", () => {
  test("countActiveFilters counts groups, not the query", () => {
    expect(countActiveFilters(filters({ q: "x" }))).toBe(0)
    expect(
      countActiveFilters(filters({ types: ["image", "link"], categories: ["hero"], color: "#000000", date: "7d", session: SESSION }))
    ).toBe(5)
    expect(countActiveFilters(filters({ to: "2026-01-01" }))).toBe(1)
  })

  test("clearFilters keeps the query", () => {
    expect(clearFilters(filters({ q: "x", types: ["image"], color: "#000000" }))).toEqual(filters({ q: "x" }))
  })

  test("toggle adds and removes", () => {
    expect(toggle(["a"], "b")).toEqual(["a", "b"])
    expect(toggle(["a", "b"], "a")).toEqual(["b"])
  })

  test("withColorFilter keeps the other filters", () => {
    expect(withColorFilter("?q=nav&type=image&color=000000", "#FFF")).toBe("?q=nav&type=image&color=ffffff")
    expect(withColorFilter("", "#123456")).toBe("?color=123456")
    expect(withColorFilter("?type=image", "not-a-colour")).toBe("?type=image")
  })

  test("normalizeHexColor and parseDay", () => {
    expect(normalizeHexColor(" #A1B2C3 ")).toBe("#a1b2c3")
    expect(normalizeHexColor("rgb(0,0,0)")).toBeNull()
    expect(parseDay("2024-02-29")).toBe("2024-02-29")
    expect(parseDay("2026-02-29")).toBeNull()
    expect(parseDay("2026-9-1")).toBeNull()
  })
})

describe("query arguments", () => {
  // 15 Sep 2026, 15:30 local time.
  const now = new Date(2026, 8, 15, 15, 30).getTime()

  test("no filters sends no filter arguments", () => {
    expect(filtersToArgs(EMPTY_FILTERS, now)).toEqual({})
  })

  test("types expand to stored kinds", () => {
    expect(kindsForTypes(["screenshot", "image"])).toEqual(["screenshot", "element", "viewport", "image"])
    expect(kindsForTypes([])).toBeUndefined()
  })

  test("every filter maps to its argument", () => {
    const f = filters({ types: ["link"], categories: ["hero", "cta"], color: "#00ff00", tolerance: 20, session: SESSION })
    expect(filtersToArgs(f, now, SESSION)).toEqual({
      sessionId: SESSION,
      kinds: ["link"],
      aiCategories: ["hero", "cta"],
      color: "#00ff00",
      colorTolerance: 20,
    })
  })

  test("the session is sent only once the caller has checked it", () => {
    expect(filtersToArgs(filters({ session: SESSION }), now)).toEqual({})
  })

  test("presets start at local midnight and stay put all day", () => {
    expect(dateBounds({ date: "7d", from: null, to: null }, now)).toEqual({
      dateFrom: new Date(2026, 8, 9).getTime(),
    })
    const later = new Date(2026, 8, 15, 23, 59).getTime()
    expect(dateBounds({ date: "30d", from: null, to: null }, later)).toEqual(
      dateBounds({ date: "30d", from: null, to: null }, now)
    )
    expect(dateBounds({ date: "30d", from: null, to: null }, now).dateFrom).toBe(new Date(2026, 7, 17).getTime())
  })

  test("custom days are inclusive local days", () => {
    expect(dateBounds({ date: null, from: "2026-09-01", to: "2026-09-02" }, now)).toEqual({
      dateFrom: new Date(2026, 8, 1).getTime(),
      dateTo: new Date(2026, 8, 3).getTime() - 1,
    })
    expect(dateBounds({ date: null, from: null, to: "2026-09-02" }, now)).toEqual({
      dateTo: new Date(2026, 8, 3).getTime() - 1,
    })
  })

  test("buildSearchArgs carries filters, vectors and cursor", () => {
    const f = filtersToArgs(filters({ types: ["image"], color: "#ff0000" }), now)
    expect(buildSearchArgs("hero", f)).toEqual({
      query: "hero",
      kinds: ["image"],
      color: "#ff0000",
      colorTolerance: 10,
      limit: PAGE_SIZE,
    })
    const vector = [0.1, 0.2]
    expect(buildSearchArgs("hero", f, { vector }, "c1")).toMatchObject({ vector, cursor: "c1" })
    expect(buildSearchArgs("hero", f, {})).not.toHaveProperty("vector")
    expect(buildSearchArgs("hero", f)).not.toHaveProperty("aiCategory")
  })

  test("buildBrowseArgs adds the page range", () => {
    expect(buildBrowseArgs({})).toEqual({ limit: PAGE_SIZE })
    expect(buildBrowseArgs({ kinds: ["text"] }, { start: "a", end: "b" })).toEqual({
      kinds: ["text"],
      limit: PAGE_SIZE,
      cursor: "a",
      endCursor: "b",
    })
  })

  test("argsKey ignores key order", () => {
    expect(argsKey({ a: 1, b: [2] })).toBe(argsKey({ b: [2], a: 1 }))
    expect(argsKey({ a: 1 })).not.toBe(argsKey({ a: 2 }))
  })
})

describe("pages and layout", () => {
  test("mergePages keeps first appearances, in order, minus removed", () => {
    const rows = (...ids: string[]) => ids.map((id) => ({ id }))
    expect(mergePages([rows("a", "b"), undefined, rows("b", "c"), rows("d")], new Set(["c"]))).toEqual(
      rows("a", "b", "d")
    )
  })

  test("partitionByLayout splits by kind and drops code", () => {
    const rows = ["image", "text", "element", "link", "code", "viewport", "screenshot"].map((kind, i) => ({ kind, i }))
    const { visual, text, link } = partitionByLayout(rows)
    expect(visual.map((r) => r.i)).toEqual([0, 2, 5, 6])
    expect(text.map((r) => r.i)).toEqual([1])
    expect(link.map((r) => r.i)).toEqual([3])
  })
})

describe("browse page ranges", () => {
  const reply = (patch: Partial<BrowseReply<{ id: string }>> = {}): BrowseReply<{ id: string }> => ({
    results: [],
    cursor: null,
    isDone: false,
    ...patch,
  })

  test("an open page is pinned to the cursor of its first reply", () => {
    expect(reconcilePages(FIRST_PAGE, [reply({ cursor: "x" })])).toEqual([{ start: null, end: "x" }])
  })

  test("nothing changes while replies are loading, or once pinned", () => {
    const ranges: PageRange[] = [{ start: null, end: "x" }, { start: "x", end: null }]
    expect(reconcilePages(ranges, [undefined, undefined])).toBe(ranges)
    expect(reconcilePages(ranges, [reply({ cursor: "x" }), undefined])).toBe(ranges)
  })

  test("a split cursor splits the page in two", () => {
    const ranges: PageRange[] = [{ start: null, end: "x" }, { start: "x", end: "y" }]
    expect(reconcilePages(ranges, [reply({ cursor: "x", splitCursor: "m" }), undefined])).toEqual([
      { start: null, end: "m" },
      { start: "m", end: "x" },
      { start: "x", end: "y" },
    ])
  })

  test("a split at the page's own edge is ignored", () => {
    const ranges: PageRange[] = [{ start: "a", end: "x" }]
    expect(reconcilePages(ranges, [reply({ splitCursor: "x" })])).toBe(ranges)
  })

  test("pages after the end of the library are dropped", () => {
    const ranges: PageRange[] = [{ start: null, end: null }, { start: "x", end: null }]
    expect(reconcilePages(ranges, [reply({ isDone: true }), undefined])).toEqual([{ start: null, end: null }])
  })

  test("only a pinned last page can be followed", () => {
    expect(canAppendPage(FIRST_PAGE)).toBe(false)
    expect(appendPage(FIRST_PAGE)).toBe(FIRST_PAGE)
    const pinned: PageRange[] = [{ start: null, end: "x" }]
    expect(appendPage(pinned)).toEqual([...pinned, { start: "x", end: null }])
  })

  test("done once the open last page reaches the end", () => {
    const ranges: PageRange[] = [{ start: null, end: "x" }, { start: "x", end: null }]
    expect(isFeedDone(ranges, [reply(), undefined])).toBe(false)
    expect(isFeedDone(ranges, [reply(), reply({ cursor: "y" })])).toBe(false)
    expect(isFeedDone(ranges, [reply(), reply({ isDone: true })])).toBe(true)
    // An empty page that is not the end keeps the feed going.
    expect(isFeedDone(FIRST_PAGE, [reply({ results: [], cursor: "z" })])).toBe(false)
  })

  test("rangeKey tells ranges apart", () => {
    expect(rangeKey({ start: null, end: null })).not.toBe(rangeKey({ start: null, end: "x" }))
  })
})

describe("tags", () => {
  test("normalised like the backend stores them", () => {
    expect(normalizeTag("  Dark   Mode ")).toBe("dark mode")
    expect(normalizeTag("x".repeat(60))).toHaveLength(MAX_TAG_LENGTH)
    expect(normalizeTag("   ")).toBe("")
  })

  test("addTags splits on commas, skips duplicates and blanks", () => {
    expect(addTags(["hero"], "Pricing, hero, ,cards")).toEqual(["hero", "pricing", "cards"])
  })

  test("addTags returns the same list when nothing is added", () => {
    const tags = ["hero"]
    expect(addTags(tags, " HERO ")).toBe(tags)
  })

  test("addTags stops at the cap", () => {
    const full = Array.from({ length: MAX_USER_TAGS }, (_, i) => `t${i}`)
    expect(addTags(full, "one more")).toBe(full)
  })

  test("removeTag", () => {
    expect(removeTag(["a", "b"], "a")).toEqual(["b"])
  })
})
