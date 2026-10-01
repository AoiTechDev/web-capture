/**
 * What a capture may store and what one query may read: text caps on every
 * write path (cut, flagged `truncated`), one tag normalisation everywhere,
 * and the read budget that keeps browse and search under Convex's 16 MiB.
 */
import { describe, expect, test } from "vitest";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import {
  capCaptureText,
  normalizeTag,
  TEXT_CAPS,
  truncateUtf8,
  utf8Length,
} from "../convex/lib/capture_text";
import { CAPTURE_READ_BUDGET, createReadBudget, estimateBytes } from "../convex/lib/read_budget";
import { MAX_BROWSE_SCAN } from "../convex/browse";
import { makeT, storeBlob, userA, DIM, type T } from "./fixtures";
import { addSession, axis } from "./filter_fixtures";

const doc = (t: T, id: Id<"captures">) => t.run((ctx) => ctx.db.get(id)) as Promise<any>;
const KIB = 1024;

describe("lib/capture_text", () => {
  test("truncateUtf8 cuts at the byte cap, on a character boundary", () => {
    expect(truncateUtf8("abcdef", 4)).toBe("abcd");
    expect(truncateUtf8("short", 100)).toBe("short");
    // é is 2 bytes, € 3, 😀 4 (a surrogate pair): never split.
    expect(truncateUtf8("éééé", 5)).toBe("éé");
    expect(truncateUtf8("€€", 5)).toBe("€");
    expect(truncateUtf8("a😀b", 4)).toBe("a");
    expect(truncateUtf8("a😀b", 5)).toBe("a😀");
    for (const s of ["x".repeat(50_000), "é".repeat(50_000), "😀".repeat(20_000)]) {
      const cut = truncateUtf8(s, TEXT_CAPS.content);
      expect(utf8Length(cut)).toBeLessThanOrEqual(TEXT_CAPS.content);
      expect(utf8Length(cut)).toBeGreaterThan(TEXT_CAPS.content - 4);
    }
  });

  test("capCaptureText caps known string fields only and reports a cut", () => {
    const r = capCaptureText({ content: "x".repeat(40 * KIB), title: "ok", tags: ["a"], width: 3 });
    expect(r.truncated).toBe(true);
    expect(r.fields.content).toHaveLength(TEXT_CAPS.content);
    expect(r.fields).toMatchObject({ title: "ok", tags: ["a"], width: 3 });
    expect(capCaptureText({ content: "short" }).truncated).toBe(false);
  });

  test("normalizeTag is what every path stores", () => {
    expect(normalizeTag("  Dark   MODE ")).toBe("dark mode");
    expect(normalizeTag(" ".repeat(5))).toBe("");
  });
});

describe("text caps on save", () => {
  test("uploadCapture cuts oversized text, flags it, and the row says so", async () => {
    const t = makeT();
    const asA = t.withIdentity(userA);
    const id = await asA.mutation(api.upload.uploadCapture, {
      capture: {
        kind: "text",
        content: "word ".repeat(20 * KIB),
        title: "T".repeat(5000),
        note: "n".repeat(10_000),
        url: "https://p.example/" + "q".repeat(10_000),
        timestamp: 1,
      },
    });
    const d = await doc(t, id);
    expect(utf8Length(d.content)).toBe(TEXT_CAPS.content);
    expect(d.title).toHaveLength(TEXT_CAPS.title);
    expect(d.note).toHaveLength(TEXT_CAPS.note);
    expect(d.url).toHaveLength(TEXT_CAPS.url);
    expect(d.truncated).toBe(true);
    expect(utf8Length(d.searchText)).toBeLessThanOrEqual(8 * KIB);
    const rows = await asA.query(api.browse.browseCaptures, {});
    expect(rows.results[0]).toMatchObject({ id, truncated: true });
  });

  test("a client cannot set the flag, and small captures are not flagged", async () => {
    const t = makeT();
    const id = await t.withIdentity(userA).mutation(api.upload.uploadCapture, {
      capture: { kind: "text", content: "hi", url: "u", timestamp: 1, truncated: true },
    });
    expect((await doc(t, id)).truncated).toBeUndefined();
  });

  test("saveImageCapture cuts its text fields too", async () => {
    const t = makeT();
    const storageId = await storeBlob(t);
    const id = await t.withIdentity(userA).mutation(api.upload.saveImageCapture, {
      storageId,
      kind: "element",
      tagName: "DIV".repeat(100),
      alt: "a".repeat(10_000),
      title: "t".repeat(10_000),
      src: "data:image/png;base64," + "A".repeat(100_000),
      url: "https://p.example",
      timestamp: 1,
      width: 1,
      height: 1,
    });
    const d = await doc(t, id);
    expect(d.alt).toHaveLength(TEXT_CAPS.alt);
    expect(d.title).toHaveLength(TEXT_CAPS.title);
    expect(d.tagName).toHaveLength(TEXT_CAPS.tagName);
    expect(d.truncated).toBe(true);
  });

  test("a capture at every cap, with its vector, stays under ~80 KiB", async () => {
    const t = makeT();
    const big = (n: number) => "é".repeat(n);
    const id = await t.withIdentity(userA).mutation(api.upload.uploadCapture, {
      capture: {
        kind: "screenshot",
        content: big(40 * KIB),
        title: big(5000),
        alt: big(5000),
        note: big(5000),
        caption: big(5000),
        src: big(5000),
        url: big(5000),
        tagName: big(500),
        category: big(500),
        tags: Array.from({ length: 50 }, (_, i) => `${i}${big(60)}`),
        timestamp: 1,
      },
    });
    await t.run((ctx) =>
      ctx.db.patch(id, {
        localEmbedding: Array.from({ length: DIM }, () => 0.1),
        aiTags: Array.from({ length: 10 }, () => big(40)),
        aiStyle: Array.from({ length: 4 }, () => big(40)),
        error: big(500),
        domain: big(256),
      })
    );
    expect(estimateBytes(await doc(t, id))).toBeLessThan(80 * KIB);
  });
});

describe("one tag normalisation everywhere", () => {
  test("uploadCapture and saveImageCapture store tags as setCaptureTags would", async () => {
    const t = makeT();
    const asA = t.withIdentity(userA);
    const raw = ["  Hero ", "hero", "Dark   Mode", "", ...Array.from({ length: 30 }, (_, i) => `t${i}`)];
    const text = await asA.mutation(api.upload.uploadCapture, {
      capture: { kind: "text", content: "x", url: "u", timestamp: 1, tags: raw },
    });
    const shot = await asA.mutation(api.upload.saveImageCapture, {
      storageId: await storeBlob(t),
      url: "u",
      timestamp: 1,
      width: 1,
      height: 1,
      tags: raw,
    });
    const set = await asA.mutation(api.captures.setCaptureTags, { captureId: text, tags: raw });
    expect((await doc(t, text)).tags).toEqual(set.tags);
    expect((await doc(t, shot)).tags).toEqual(set.tags);
    expect(set.tags.slice(0, 3)).toEqual(["hero", "dark mode", "t0"]);
    expect(set.tags).toHaveLength(20);
  });

  test("an existing tag re-saved in another case or spacing is not counted as new", async () => {
    const t = makeT();
    const asA = t.withIdentity(userA);
    const id = await t.run((ctx) =>
      ctx.db.insert("captures", { kind: "text", content: "x", url: "u", timestamp: 1, userId: userA.subject, tags: ["Dark  Mode"] })
    );
    await asA.mutation(api.captures.setCaptureTags, { captureId: id, tags: ["dark mode", "new"] });
    const tags = await asA.query(api.captures.listTags, {});
    expect(tags.map((x) => [x.name, x.useCount])).toEqual([["new", 1]]);
  });

  test("removing a tag does not uncount it; upsertTags normalises like the rest", async () => {
    const t = makeT();
    const asA = t.withIdentity(userA);
    const id = await t.run((ctx) =>
      ctx.db.insert("captures", { kind: "text", content: "x", url: "u", timestamp: 1, userId: userA.subject })
    );
    await asA.mutation(api.captures.setCaptureTags, { captureId: id, tags: ["kept"] });
    await asA.mutation(api.captures.setCaptureTags, { captureId: id, tags: [] });
    await asA.mutation(api.upload.upsertTags, { names: ["  KEPT ", "kept"] });
    const tags = await asA.query(api.captures.listTags, {});
    expect(tags.map((x) => [x.name, x.useCount])).toEqual([["kept", 2]]);
  });

  test("legacy captures with more than 20 tags keep their first 20 when edited", async () => {
    const t = makeT();
    const legacy = Array.from({ length: 25 }, (_, i) => `old${i}`);
    const id = await t.run((ctx) =>
      ctx.db.insert("captures", { kind: "text", content: "x", url: "u", timestamp: 1, userId: userA.subject, tags: legacy })
    );
    const r = await t.withIdentity(userA).mutation(api.captures.setCaptureTags, { captureId: id, tags: legacy });
    expect(r.tags).toEqual(legacy.slice(0, 20));
    expect(await t.withIdentity(userA).query(api.captures.listTags, {})).toEqual([]);
  });
});

describe("read budget", () => {
  test("the budget counts what is read and says when it is spent", () => {
    const b = createReadBudget(1000);
    b.charge({ content: "x".repeat(500) });
    expect(b.exhausted).toBe(false);
    b.charge({ content: "x".repeat(500) });
    expect(b.exhausted).toBe(true);
    expect(estimateBytes(Array.from({ length: DIM }, () => 0.5))).toBeGreaterThan(DIM * 8);
  });

  /** Heavy text captures, as saved before the caps (100 KiB each). */
  async function heavyLibrary(t: T, n: number, extra: Record<string, unknown> = {}) {
    const ids: Id<"captures">[] = [];
    await t.run(async (ctx) => {
      for (let i = 0; i < n; i++) {
        ids.push(
          await ctx.db.insert("captures", {
            kind: "text",
            content: "y".repeat(100 * KIB),
            url: "u",
            timestamp: 1,
            userId: userA.subject,
            searchText: "heavy",
            ...extra,
          })
        );
      }
    });
    return ids.reverse();
  }

  test("browse stops a page at the budget, well before MAX_BROWSE_SCAN, and resumes without gaps", async () => {
    const t = makeT();
    const n = Math.ceil(CAPTURE_READ_BUDGET / (100 * KIB)) + 20;
    expect(n).toBeLessThan(MAX_BROWSE_SCAN);
    const ids = await heavyLibrary(t, n);
    const seen: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    for (; pages < 20; pages++) {
      const r = await t.withIdentity(userA).query(api.browse.browseCaptures, {
        kinds: ["link"],
        ...(cursor ? { cursor } : {}),
      });
      seen.push(...r.results.map((x) => x.id));
      if (r.isDone) break;
      cursor = r.cursor!;
    }
    expect(pages).toBeGreaterThanOrEqual(1);
    expect(seen).toEqual([]);
    // Same library, every capture matching: all of them, in order, once.
    const all: string[] = [];
    cursor = undefined;
    for (let i = 0; i < 20; i++) {
      const r = await t.withIdentity(userA).query(api.browse.browseCaptures, {
        limit: 100,
        ...(cursor ? { cursor } : {}),
      });
      all.push(...r.results.map((x) => x.id));
      if (r.isDone) break;
      cursor = r.cursor!;
    }
    expect(all).toEqual(ids);
  });

  test("an exact search whose candidates exceed the budget falls back to the indexes", async () => {
    const t = makeT();
    const s = await addSession(t, userA.subject);
    const n = Math.ceil(CAPTURE_READ_BUDGET / (100 * KIB)) + 5;
    await heavyLibrary(t, n, { sessionId: s, title: "heavy" });
    const r = await t.withIdentity(userA).action(api.search.searchCaptures, { query: "heavy", sessionId: s });
    expect(r.diagnostics).toMatchObject({ mode: "index", candidates: null });
    expect(r.results.length).toBeGreaterThan(0);
  });

  test("index-mode search leaves unread the lowest-ranked hits past the budget", async () => {
    const t = makeT();
    await heavyLibrary(t, 120, { textEmbedding: axis(0) });
    const r = await t
      .withIdentity(userA)
      .action(api.search.searchCaptures, { query: "", vector: axis(0), kinds: ["text"] });
    expect(r.diagnostics).toMatchObject({ mode: "index" });
    expect((r.diagnostics as any).hitsUnreadForBudget).toBeGreaterThan(0);
    expect(r.results.length).toBeGreaterThan(0);
  });
});
