/**
 * Link previews on browse and search rows (search_scope loadLinkPreviews):
 * hydrated server-side, capped, deduplicated and bounded by
 * PREVIEW_READ_BUDGET.
 */
import { describe, expect, test } from "vitest";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { buildSearchText } from "../convex/lib/search_rank";
import { utf8Length } from "../convex/lib/capture_text";
import { PREVIEW_READ_BUDGET } from "../convex/lib/read_budget";
import { PREVIEW_CAPS } from "../convex/search_scope";
import { makeT, userA, type T } from "./fixtures";

type PreviewFields = Partial<{
  title: string;
  description: string;
  faviconUrl: string;
  imageUrl: string;
  siteName: string;
  keywords: string[];
  status: number;
}>;

async function preview(t: T, fields: PreviewFields, tag = "p") {
  return await t.run((ctx) =>
    ctx.db.insert("link_previews", {
      userId: userA.subject,
      canonicalUrl: `https://example.com/${tag}`,
      originalUrl: `https://example.com/${tag}`,
      domain: "example.com",
      createdAt: 1,
      updatedAt: 1,
      ...fields,
    })
  );
}

async function link(t: T, previewId: Id<"link_previews"> | undefined, title = "a link") {
  return await t.run((ctx) =>
    ctx.db.insert("captures", {
      kind: "link",
      href: "https://example.com/x",
      url: "https://page.example",
      timestamp: 1,
      userId: userA.subject,
      title,
      ...(previewId ? { linkPreviewId: previewId } : {}),
      searchText: buildSearchText({ title, url: "https://page.example", href: "https://example.com/x" }),
    })
  );
}

const browse = (t: T, limit?: number) =>
  t.withIdentity(userA).query(api.browse.browseCaptures, { kinds: ["link"], ...(limit ? { limit } : {}) });

describe("link rows carry their preview", () => {
  test("browse: the display fields, capped; no preview -> null", async () => {
    const t = makeT();
    const p = await preview(t, {
      title: "Example page",
      description: "d".repeat(5000),
      faviconUrl: "https://example.com/favicon.ico",
      imageUrl: "https://example.com/og.png",
      siteName: "Example",
      keywords: Array.from({ length: 30 }, (_, i) => `kw${i}`),
      status: 200,
    });
    const withPreview = await link(t, p);
    const without = await link(t, undefined);

    const { results } = await browse(t);
    const row = results.find((r) => r.id === withPreview)!;
    expect(row.preview).toMatchObject({
      domain: "example.com",
      siteName: "Example",
      title: "Example page",
      faviconUrl: "https://example.com/favicon.ico",
      imageUrl: "https://example.com/og.png",
      status: 200,
    });
    expect(utf8Length(row.preview!.description!)).toBe(PREVIEW_CAPS.description);
    expect(row.preview!.keywords).toHaveLength(PREVIEW_CAPS.keywords);
    expect(row.preview).not.toHaveProperty("canonicalUrl");
    expect(results.find((r) => r.id === without)!.preview).toBeNull();
  });

  test("only http(s) image URLs of sane length are passed on", async () => {
    const t = makeT();
    const p = await preview(t, {
      faviconUrl: "javascript:alert(1)",
      imageUrl: `https://example.com/${"a".repeat(PREVIEW_CAPS.url)}`,
    });
    await link(t, p);
    const [row] = (await browse(t)).results;
    expect(row!.preview).toMatchObject({ faviconUrl: null, imageUrl: null });
  });

  test("captures sharing a preview both show it", async () => {
    const t = makeT();
    const p = await preview(t, { title: "Shared" });
    await link(t, p);
    await link(t, p);
    const { results } = await browse(t);
    expect(results.map((r) => r.preview?.title)).toEqual(["Shared", "Shared"]);
  });

  test("past PREVIEW_READ_BUDGET the remaining links go without, and the page still loads", async () => {
    const t = makeT();
    const big = "x".repeat(100 * 1024);
    for (let i = 0; i < 12; i++) await link(t, await preview(t, { title: `T${i}`, description: big }, `p${i}`));
    const { results } = await browse(t, 12);
    expect(results).toHaveLength(12);
    const shown = results.filter((r) => r.preview !== null).length;
    // Each preview is ~100 KiB: the budget is crossed by the one that reaches it.
    expect(shown).toBe(Math.ceil(PREVIEW_READ_BUDGET / (100 * 1024)));
    expect(shown).toBeLessThan(12);
    // Newest first, so the newest links keep theirs.
    expect(results[0]!.preview?.title).toBe("T11");
  });

  test("search rows carry the preview too", async () => {
    const t = makeT();
    const p = await preview(t, { title: "Found page" });
    const id = await link(t, p, "needle");
    const res = await t.withIdentity(userA).action(api.search.searchCaptures, { query: "needle" });
    expect(res.results.map((r) => r.id)).toEqual([id]);
    expect(res.results[0]!.preview?.title).toBe("Found page");
  });
});
