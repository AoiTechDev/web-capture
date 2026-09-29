import { describe, expect, test } from "vitest";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { makeT, seedAB, storageExists, storeBlob, userA, userB, type T } from "./fixtures";

const HEXES = [
  "#ff0000", "#00ff00", "#0000ff", "#ffff00", "#00ffff", "#ff00ff", "#000000", "#ffffff",
  "#808080", "#800000", "#008000", "#000080", "#808000", "#008080", "#800080", "#ff8000",
  "#0080ff", "#80ff00",
];

function dna(over: Partial<Record<"colors" | "fonts" | "radii" | "shadows" | "spacing", number>> = {}) {
  const n = { colors: 3, fonts: 1, radii: 1, shadows: 1, spacing: 1, ...over };
  return {
    version: 1 as const,
    colors: HEXES.slice(0, n.colors).map((hex, i) => ({
      hex,
      usage: (["text", "background", "border"] as const)[i % 3]!,
      weight: 1 / Math.max(1, n.colors),
    })),
    fonts: Array.from({ length: n.fonts }, (_, i) => ({
      family: `Font${i}`,
      generic: false,
      size: 12 + i,
      fontWeight: 400,
      lineHeight: null,
      letterSpacing: null,
      weight: 0.1,
    })),
    radii: Array.from({ length: n.radii }, (_, i) => ({ value: i + 1, weight: 0.1 })),
    shadows: Array.from({ length: n.shadows }, (_, i) => ({ value: `rgba(0, 0, 0, 0.2) 0px ${i}px 2px 0px`, weight: 0.1 })),
    spacing: Array.from({ length: n.spacing }, (_, i) => ({ value: i + 1, weight: 0.1 })),
    source: {
      url: "https://page.example",
      title: "DNA_SECRET_TITLE",
      viewport: { w: 1280, h: 800 },
      dpr: 2,
      rect: { x: 1, y: 2, w: 3, h: 4 },
      clipped: false,
    },
  };
}

function palette(n = 3) {
  return ["#123456", "#abcdef", "#fedcba", "#0f0f0f", "#f0f0f0", "#336699", "#996633"]
    .slice(0, n)
    .map((hex) => ({ hex, lab: [50, 0, 0], weight: 1 / n }));
}

async function save(t: T, who: typeof userA, extra: Record<string, unknown> = {}) {
  const storageId = await storeBlob(t, `img-${Math.random()}`);
  const id = await t.withIdentity(who).mutation(api.upload.saveImageCapture, {
    storageId,
    url: "https://page.example",
    timestamp: 10,
    width: 100,
    height: 50,
    ...extra,
  } as any);
  return { id, storageId };
}

const colorRows = (t: T, captureId?: Id<"captures">) =>
  t.run(async (ctx) => {
    const all = await ctx.db.query("captureColors").collect();
    return captureId ? all.filter((r) => r.captureId === captureId) : all;
  });

describe("upload.saveImageCapture: DNA, palette, thumbnail", () => {
  test("element capture stores DNA, palette, thumb and colour rows", async () => {
    const t = makeT();
    const thumb = await storeBlob(t, "thumb");
    const { id } = await save(t, userA, {
      kind: "element",
      tagName: "div",
      clipped: true,
      designDna: dna(),
      palette: palette(),
      thumbStorageId: thumb,
    });
    const doc = (await t.run((ctx) => ctx.db.get(id))) as any;
    expect(doc).toMatchObject({ kind: "element", tagName: "div", clipped: true, thumbStorageId: thumb, userId: userA.subject });
    expect(doc.designDna.colors).toHaveLength(3);
    expect(doc.palette).toHaveLength(3);

    const rows = await colorRows(t, id);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThanOrEqual(12);
    expect(rows.every((r) => r.userId === userA.subject)).toBe(true);
    expect(rows.reduce((s, r) => s + r.weight, 0)).toBeCloseTo(1, 6);
    for (const r of rows) expect(r.hex).toMatch(/^#[0-9a-f]{6}$/);
  });

  test("16 DNA colours + 6 palette colours still give at most 12 rows", async () => {
    const t = makeT();
    const { id } = await save(t, userA, {
      kind: "element",
      designDna: dna({ colors: 16 }),
      palette: HEXES.slice(10, 16).map((hex, i) => ({ hex, lab: [10 + i * 15, i * 10 - 30, 20 - i * 8], weight: 1 / 6 })),
    });
    const rows = await colorRows(t, id);
    expect(rows.length).toBeLessThanOrEqual(12);
    expect(rows.reduce((s, r) => s + r.weight, 0)).toBeCloseTo(1, 6);
  });

  test.each(["image", "screenshot", "viewport", undefined])("designDna rejected on kind %s", async (kind) => {
    const t = makeT();
    await expect(save(t, userA, { kind, designDna: dna() })).rejects.toThrow(/only accepted for element/);
    expect(await colorRows(t)).toHaveLength(0);
    expect(await t.run((ctx) => ctx.db.query("captures").collect())).toHaveLength(0);
  });

  test.each(["image", "screenshot", "viewport"])("palette + thumb accepted on kind %s", async (kind) => {
    const t = makeT();
    const thumb = await storeBlob(t, "thumb");
    const { id } = await save(t, userA, { kind, palette: palette(6), thumbStorageId: thumb });
    const doc = (await t.run((ctx) => ctx.db.get(id))) as any;
    expect(doc.thumbStorageId).toBe(thumb);
    expect(doc.palette).toHaveLength(6);
    expect((await colorRows(t, id)).length).toBeGreaterThan(0);
  });

  test("no DNA and no palette -> no colour rows", async () => {
    const t = makeT();
    const { id } = await save(t, userA, { kind: "screenshot" });
    expect(await colorRows(t, id)).toHaveLength(0);
  });

  test.each([
    ["17 DNA colours", { designDna: dna({ colors: 17 }) }],
    ["9 fonts", { designDna: dna({ fonts: 9 }) }],
    ["11 radii", { designDna: dna({ radii: 11 }) }],
    ["11 shadows", { designDna: dna({ shadows: 11 }) }],
    ["11 spacing", { designDna: dna({ spacing: 11 }) }],
    ["7 palette colours", { palette: palette(7) }],
    ["bad DNA hex", { designDna: { ...dna(), colors: [{ hex: "red", usage: "text", weight: 1 }] } }],
    ["DNA weight > 1", { designDna: { ...dna(), radii: [{ value: 1, weight: 2 }] } }],
    ["oversized shadow", { designDna: { ...dna(), shadows: [{ value: "x".repeat(501), weight: 1 }] } }],
    ["bad palette lab", { palette: [{ hex: "#123456", lab: [1, 2], weight: 1 }] }],
    ["bad palette hex", { palette: [{ hex: "#12345", lab: [1, 2, 3], weight: 1 }] }],
  ])("rejects %s", async (_name, extra) => {
    const t = makeT();
    await expect(save(t, userA, { kind: "element", ...extra })).rejects.toThrow();
    expect(await t.run((ctx) => ctx.db.query("captures").collect())).toHaveLength(0);
  });

  test("limits are inclusive: 16/8/10/10/10 DNA and 6 palette accepted", async () => {
    const t = makeT();
    const { id } = await save(t, userA, {
      kind: "element",
      designDna: dna({ colors: 16, fonts: 8, radii: 10, shadows: 10, spacing: 10 }),
      palette: palette(6),
    });
    expect(await t.run((ctx) => ctx.db.get(id))).not.toBeNull();
  });

  test("thumbStorageId owned by another capture (any user) is rejected", async () => {
    const t = makeT();
    const { b } = await seedAB(t);
    // B's image file as A's thumbnail.
    await expect(save(t, userA, { kind: "screenshot", thumbStorageId: b.storageId })).rejects.toThrow(/in use/);
    // A thumbnail already used as a thumbnail.
    const thumb = await storeBlob(t, "thumb");
    await save(t, userB, { kind: "screenshot", thumbStorageId: thumb });
    await expect(save(t, userA, { kind: "screenshot", thumbStorageId: thumb })).rejects.toThrow(/in use/);
    // A thumbnail cannot later be adopted as someone's main image either.
    await expect(
      t.withIdentity(userA).mutation(api.upload.saveImageCapture, {
        storageId: thumb, url: "u", timestamp: 1, width: 1, height: 1,
      })
    ).rejects.toThrow(/in use/);
  });

  test("thumbStorageId equal to storageId is rejected", async () => {
    const t = makeT();
    const s = await storeBlob(t, "same");
    await expect(
      t.withIdentity(userA).mutation(api.upload.saveImageCapture, {
        storageId: s, thumbStorageId: s, url: "u", timestamp: 1, width: 1, height: 1,
      })
    ).rejects.toThrow(/in use/);
  });
});

describe("upload.uploadCapture drops image-derived fields", () => {
  test("designDna, palette and thumbStorageId are silently discarded", async () => {
    const t = makeT();
    const thumb = await storeBlob(t, "thumb");
    const img = await storeBlob(t, "img");
    const id = await t.withIdentity(userA).mutation(api.upload.uploadCapture, {
      capture: {
        kind: "element",
        url: "https://p.example",
        timestamp: 1,
        storageId: img,
        width: 10,
        height: 10,
        designDna: dna({ colors: 3 }),
        palette: palette(),
        thumbStorageId: thumb,
      },
    } as any);
    const doc = (await t.run((ctx) => ctx.db.get(id))) as any;
    expect(doc.designDna).toBeUndefined();
    expect(doc.palette).toBeUndefined();
    expect(doc.thumbStorageId).toBeUndefined();
    expect(await colorRows(t)).toHaveLength(0);
  });
});

describe("upload.deleteById cleans up colours and thumbnail", () => {
  test("deletes own colour rows and thumbnail, leaves B's untouched", async () => {
    const t = makeT();
    const thumbA = await storeBlob(t, "thumbA");
    const thumbB = await storeBlob(t, "thumbB");
    const a = await save(t, userA, { kind: "element", designDna: dna(), palette: palette(), thumbStorageId: thumbA });
    const b = await save(t, userB, { kind: "element", designDna: dna(), palette: palette(), thumbStorageId: thumbB });
    const bRowsBefore = await colorRows(t, b.id);
    expect(bRowsBefore.length).toBeGreaterThan(0);

    await t.withIdentity(userA).mutation(api.upload.deleteById, { docId: a.id });

    expect(await colorRows(t, a.id)).toHaveLength(0);
    expect(await storageExists(t, thumbA)).toBe(false);
    expect(await storageExists(t, a.storageId)).toBe(false);
    expect(await colorRows(t, b.id)).toEqual(bRowsBefore);
    expect(await storageExists(t, thumbB)).toBe(true);
    expect(await storageExists(t, b.storageId)).toBe(true);
  });

  test("B cannot delete A's capture, rows or thumbnail", async () => {
    const t = makeT();
    const thumbA = await storeBlob(t, "thumbA");
    const a = await save(t, userA, { kind: "element", designDna: dna(), thumbStorageId: thumbA });
    const before = await colorRows(t, a.id);
    await expect(t.withIdentity(userB).mutation(api.upload.deleteById, { docId: a.id })).rejects.toThrow();
    expect(await colorRows(t, a.id)).toEqual(before);
    expect(await storageExists(t, thumbA)).toBe(true);
  });

  test("old capture without thumbnail or colours still deletes", async () => {
    const t = makeT();
    const { a } = await seedAB(t);
    await t.withIdentity(userA).mutation(api.upload.deleteById, { docId: a.shotId });
    expect(await t.run((ctx) => ctx.db.get(a.shotId))).toBeNull();
    expect(await storageExists(t, a.storageId)).toBe(false);
  });
});

describe("dashboard queries: thumbUrl, DNA, legacy captures, isolation", () => {
  async function world() {
    const t = makeT();
    const seeded = await seedAB(t);
    const thumbA = await storeBlob(t, "thumbA");
    const thumbB = await storeBlob(t, "thumbB");
    const a = await save(t, userA, { kind: "element", designDna: dna(), palette: palette(), thumbStorageId: thumbA });
    const b = await save(t, userB, {
      kind: "element",
      designDna: { ...dna(), source: { ...dna().source, title: "B_DNA_SECRET" } },
      palette: [{ hex: "#b0b0b0", lab: [72, 0, 0], weight: 1 }],
      thumbStorageId: thumbB,
    });
    // Put both new captures in their owner's session so getSession sees them.
    await t.run(async (ctx) => {
      await ctx.db.patch(a.id, { sessionId: seeded.a.sessionId });
      await ctx.db.patch(b.id, { sessionId: seeded.b.sessionId });
    });
    return { t, ...seeded, newA: a, newB: b, thumbA, thumbB };
  }

  test("byCategoryAndKind(screenshot) returns thumbUrl for new and null for old", async () => {
    const { t, a, newA } = await world();
    const rows = (await t.withIdentity(userA).query(api.captures.byCategoryAndKind, {
      category: "unsorted",
      kind: "screenshot",
    })) as any[];
    expect(rows.map((r) => r._id).sort()).toEqual([a.shotId, newA.id].sort());
    const fresh = rows.find((r) => r._id === newA.id)!;
    const old = rows.find((r) => r._id === a.shotId)!;
    expect(typeof fresh.thumbUrl).toBe("string");
    expect(fresh.thumbUrl).not.toBe(fresh.url);
    expect(old.thumbUrl).toBeNull();
    expect(typeof old.url).toBe("string");
  });

  test("getSession returns thumbUrl / palette / designDna, null for legacy", async () => {
    const { t, a, newA } = await world();
    const s = (await t.withIdentity(userA).query(api.sessions.getSession, { id: a.sessionId })) as any;
    const items = s.items ?? s.captures ?? s;
    const fresh = items.find((i: any) => i._id === newA.id);
    const old = items.find((i: any) => i._id === a.shotId);
    expect(typeof fresh.thumbUrl).toBe("string");
    expect(fresh.designDna.version).toBe(1);
    expect(fresh.palette).toHaveLength(3);
    expect(old).toMatchObject({ thumbUrl: null, palette: null, designDna: null, clipped: false });
  });

  test("listSessions prefers the thumbnail URL", async () => {
    const { t, thumbA } = await world();
    const thumbUrl = await t.run((ctx) => ctx.storage.getUrl(thumbA));
    const res = (await t.withIdentity(userA).query(api.sessions.listSessions, {})) as any;
    const thumbs = res.sessions.flatMap((s: any) => s.thumbnails);
    expect(thumbs).toContain(thumbUrl);
  });

  test("searchCapturesFallback returns thumbUrl and DNA for own captures", async () => {
    const { t, newA } = await world();
    const res = (await t.withIdentity(userA).query(api.search.searchCapturesFallback, { q: "page.example" })) as any;
    const fresh = res.results.find((r: any) => r.id === newA.id);
    expect(typeof fresh.thumbUrl).toBe("string");
    expect(fresh.designDna.source.title).toBe("DNA_SECRET_TITLE");
  });

  test("A never sees B's DNA, palette, thumbnail or colour rows", async () => {
    const { t, a, b, newB, thumbB } = await world();
    const bThumbUrl = await t.run((ctx) => ctx.storage.getUrl(thumbB));
    const bRows = await colorRows(t, newB.id);
    const markers = ["B_DNA_SECRET", "#b0b0b0", newB.id, thumbB, bThumbUrl!, ...bRows.map((r) => r._id)];
    const asA = t.withIdentity(userA);
    const outputs = [
      await asA.query(api.captures.byCategoryAndKind, { category: "unsorted", kind: "screenshot" }),
      await asA.query(api.captures.byCategoryAndKind, { category: "unsorted", kind: "element" }),
      await asA.query(api.captures.listAllForUser, {}),
      await asA.query(api.captures.getCaptureById, { id: newB.id }),
      await asA.query(api.sessions.getSession, { id: b.sessionId }),
      await asA.query(api.sessions.getSession, { id: a.sessionId }),
      await asA.query(api.sessions.listSessions, {}),
      await asA.query(api.search.searchCapturesFallback, { q: "page.example" }),
    ];
    for (const out of outputs) {
      const json = JSON.stringify(out);
      for (const m of markers) expect(json, `leaked ${m}`).not.toContain(m);
    }
  });
});
