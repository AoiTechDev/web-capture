import { afterEach, describe, expect, test, vi } from "vitest";
import {
  collectDesignDna,
  DNA_MAX_NODES,
  DNA_TOP,
  isGenericFamily,
  isVisibleShadow,
  parseFontStack,
  parsePx,
  pickFontFamily,
  visibleArea,
  type DnaOptions,
  type RectLike,
} from "~contents/features/capture/design-dna";
import { describeElement } from "~contents/components/highlight-overlay";

/**
 * happy-dom reports zero-sized rects, so geometry is injected: an element's
 * rect comes from `data-r="left,top,width,height"`; a text node's rect is its
 * parent's `data-tr` (or `data-r`) rect.
 */
const ZERO: RectLike = { left: 0, top: 0, width: 0, height: 0 };
function rectOf(el: Element | null, attr = "data-r"): RectLike {
  const raw = el?.getAttribute(attr) ?? (attr === "data-tr" ? el?.getAttribute("data-r") : null);
  if (!raw) return ZERO;
  const [left, top, width, height] = raw.split(",").map(Number);
  return { left: left!, top: top!, width: width!, height: height! };
}

const geometry = (loaded: string[] = []): DnaOptions => ({
  getRect: (el) => rectOf(el),
  getTextRects: (node) => [rectOf(node.parentElement, "data-tr")],
  isFontLoaded: (f) => loaded.includes(f),
});

function mount(html: string): Element {
  document.body.innerHTML = `<div id="root" data-r="0,0,400,400">${html}</div>`;
  return document.getElementById("root")!;
}

afterEach(() => {
  document.body.innerHTML = "";
});

const hexes = (dna: ReturnType<typeof collectDesignDna>, usage?: string) =>
  dna.colors.filter((c) => !usage || c.usage === usage).map((c) => c.hex);

describe("collectDesignDna: visibility filters", () => {
  test("display:none subtree is skipped entirely", () => {
    const root = mount(`
      <div style="display:none" data-r="0,0,100,100">
        <div style="background-color: rgb(255, 0, 0)" data-r="0,0,100,100"></div>
      </div>
      <div style="background-color: rgb(0, 0, 255)" data-r="0,0,100,100"></div>`);
    const dna = collectDesignDna(root, geometry());
    expect(hexes(dna)).toEqual(["#0000ff"]);
  });

  test("visibility:hidden element skipped but a visible child still counts", () => {
    const root = mount(`
      <div style="visibility:hidden; background-color: rgb(255, 0, 0)" data-r="0,0,100,100">
        <div style="visibility:visible; background-color: rgb(0, 255, 0)" data-r="0,0,50,50"></div>
        <div style="background-color: rgb(0, 0, 255)" data-r="50,50,50,50"></div>
      </div>`);
    const dna = collectDesignDna(root, geometry());
    // Blue inherits visibility:hidden.
    expect(hexes(dna)).toEqual(["#00ff00"]);
  });

  test("opacity below 0.05 hides the subtree; 0.05 does not", () => {
    const root = mount(`
      <div style="opacity: 0.04; background-color: rgb(255, 0, 0)" data-r="0,0,100,100">
        <div style="opacity: 1; background-color: rgb(0, 255, 0)" data-r="0,0,100,100"></div>
      </div>
      <div style="opacity: 0.05; background-color: rgb(0, 0, 255)" data-r="0,0,100,100"></div>`);
    expect(hexes(collectDesignDna(root, geometry()))).toEqual(["#0000ff"]);
  });

  test("zero-sized and out-of-selection elements contribute nothing themselves", () => {
    const root = mount(`
      <div style="background-color: rgb(255, 0, 0)" data-r="10,10,0,50">
        <div style="background-color: rgb(0, 255, 0)" data-r="10,10,20,20"></div>
      </div>
      <div style="background-color: rgb(0, 0, 255)" data-r="500,500,100,100"></div>
      <div style="background-color: rgb(255, 255, 0)" data-r="-200,0,100,100"></div>`);
    // Zero-sized parent skipped, its overflowing child kept.
    expect(hexes(collectDesignDna(root, geometry()))).toEqual(["#00ff00"]);
  });

  test("walk is capped at maxNodes (default DNA_MAX_NODES = 2000)", () => {
    const kids = Array.from({ length: 2500 }, () => `<div data-r="0,0,10,10"></div>`).join("");
    const root = mount(kids);
    const seen: Element[] = [];
    const opts = geometry();
    collectDesignDna(root, {
      ...opts,
      getStyle: (el) => {
        seen.push(el);
        return getComputedStyle(el);
      },
    });
    expect(DNA_MAX_NODES).toBe(2000);
    expect(seen.length).toBe(2000);

    // With a small cap, only the first children in document order are read.
    mount(`
      <div style="background-color: rgb(255, 0, 0)" data-r="0,0,10,10"></div>
      <div style="background-color: rgb(0, 255, 0)" data-r="0,0,10,10"></div>
      <div style="background-color: rgb(0, 0, 255)" data-r="0,0,10,10"></div>`);
    const small = collectDesignDna(document.getElementById("root")!, { ...opts, maxNodes: 3 });
    expect(hexes(small).sort()).toEqual(["#00ff00", "#ff0000"]);
  });
});

describe("collectDesignDna: colours", () => {
  test("text, background and border usage, weighted by area", () => {
    const root = mount(`
      <div style="background-color: rgb(255, 0, 0)" data-r="0,0,100,100"></div>
      <div style="background-color: rgb(0, 0, 255)" data-r="0,100,100,300"></div>
      <p style="color: rgb(0, 128, 0)" data-r="200,0,100,20" data-tr="200,0,100,20">hello</p>
      <div style="border-top-width: 2px; border-top-style: solid; border-top-color: rgb(1, 2, 3)" data-r="200,100,100,50"></div>`);
    const dna = collectDesignDna(root, geometry());
    const by = Object.fromEntries(dna.colors.map((c) => [`${c.usage}:${c.hex}`, c.weight]));
    // Areas: red 10000, blue 30000, text 2000, border 100 * 2 = 200. Total 42200.
    expect(by["background:#ff0000"]).toBeCloseTo(10000 / 42200, 4);
    expect(by["background:#0000ff"]).toBeCloseTo(30000 / 42200, 4);
    expect(by["text:#008000"]).toBeCloseTo(2000 / 42200, 4);
    expect(by["border:#010203"]).toBeCloseTo(200 / 42200, 4);
    expect(dna.colors[0]).toMatchObject({ hex: "#0000ff", usage: "background" });
    expect(dna.colors.reduce((s, c) => s + c.weight, 0)).toBeCloseTo(1, 3);
  });

  test("area outside the selection is not counted", () => {
    const root = mount(`
      <div style="background-color: rgb(255, 0, 0)" data-r="300,0,200,100"></div>
      <div style="background-color: rgb(0, 0, 255)" data-r="0,0,100,100"></div>`);
    const dna = collectDesignDna(root, geometry());
    // Red: only 100x100 of its 200x100 is inside the 400x400 root.
    expect(dna.colors.map((c) => c.weight)).toEqual([0.5, 0.5]);
  });

  test("alpha below 0.1 is skipped; 0.1 is kept", () => {
    const root = mount(`
      <div style="background-color: rgba(255, 0, 0, 0.05)" data-r="0,0,100,100"></div>
      <div style="background-color: rgba(0, 0, 255, 0.1)" data-r="0,0,100,100"></div>
      <div style="background-color: transparent" data-r="0,0,100,100"></div>
      <div style="border-top-width: 1px; border-top-style: none; border-top-color: rgb(0, 255, 0)" data-r="0,0,100,100"></div>`);
    expect(hexes(collectDesignDna(root, geometry()))).toEqual(["#0000ff"]);
  });

  test("top-N caps: 16 colours, 8 fonts, 10 radii / shadows / spacing", () => {
    const n = 20;
    const html = Array.from({ length: n }, (_, i) => {
      const r = `${i * 10},0,10,10`;
      return `<div data-r="${r}" data-tr="${r}" style="
        background-color: rgb(${i * 12}, 0, 0);
        font-family: sans-serif; font-size: ${10 + i}px;
        border-top-left-radius: ${i + 1}px;
        box-shadow: rgba(0, 0, 0, 0.5) 0px ${i + 1}px 2px 0px;
        padding-top: ${i + 1}px">t</div>`;
    }).join("");
    const dna = collectDesignDna(mount(html), geometry());
    expect(DNA_TOP).toEqual({ colors: 16, fonts: 8, radii: 10, shadows: 10, spacing: 10 });
    expect(hexes(dna, "background")).toHaveLength(16);
    expect(dna.colors).toHaveLength(16);
    expect(dna.fonts).toHaveLength(8);
    expect(dna.radii).toHaveLength(10);
    expect(dna.shadows).toHaveLength(10);
    expect(dna.spacing).toHaveLength(10);
    // Weights are shares of everything seen, so the kept top-N sums below 1.
    expect(dna.radii.reduce((s, r) => s + r.weight, 0)).toBeCloseTo(0.5, 3);
  });

  test("radii, shadows and spacing values; transparent shadows ignored", () => {
    const root = mount(`
      <div data-r="0,0,100,100" style="border-top-left-radius: 8px; border-bottom-right-radius: 8px; box-shadow: rgba(0, 0, 0, 0) 0px 0px 0px 0px; padding-top: 12px; padding-left: 12px; row-gap: 4px"></div>`);
    const dna = collectDesignDna(root, geometry());
    expect(dna.radii).toEqual([{ value: 8, weight: 1 }]);
    expect(dna.shadows).toEqual([]);
    expect(dna.spacing.map((s) => s.value).sort()).toEqual([12, 4]);
  });
});

describe("collectDesignDna: fonts", () => {
  test("first loaded family wins; generic families flagged; lineHeight normal -> null", () => {
    const root = mount(`
      <p data-r="0,0,100,20" style="font-family: 'NotLoaded', Inter, sans-serif; font-size: 14px; font-weight: 600; line-height: normal; letter-spacing: 1px">a</p>
      <p data-r="0,20,100,40" style="font-family: 'Missing', monospace; font-size: 12px; line-height: 18px">b</p>`);
    const dna = collectDesignDna(root, geometry(["Inter"]));
    expect(dna.fonts).toEqual([
      { family: "monospace", generic: true, size: 12, fontWeight: 400, lineHeight: 18, letterSpacing: null, weight: expect.closeTo(2 / 3, 3) },
      { family: "Inter", generic: false, size: 14, fontWeight: 600, lineHeight: null, letterSpacing: 1, weight: expect.closeTo(1 / 3, 3) },
    ]);
  });

  test("only elements with their own text contribute fonts and text colour", () => {
    const root = mount(`
      <div data-r="0,0,200,200" style="font-family: Wrapper; color: rgb(255, 0, 0)">
        <span data-r="0,0,50,20" style="font-family: Inner; color: rgb(0, 0, 255)">text</span>
        <span data-r="0,50,50,20" style="font-family: Blank">   </span>
      </div>`);
    const dna = collectDesignDna(root, geometry(["Wrapper", "Inner", "Blank"]));
    expect(dna.fonts.map((f) => f.family)).toEqual(["Inner"]);
    expect(hexes(dna, "text")).toEqual(["#0000ff"]);
  });
});

describe("collectDesignDna: privacy", () => {
  test("form values, input contents and page text never appear in the result", () => {
    const root = mount(`
      <form data-r="0,0,400,400" style="background-color: rgb(250, 250, 250)">
        <label data-r="0,0,100,20" style="font-family: sans-serif">LABEL_TEXT_SECRET</label>
        <input type="password" name="pw" value="ATTR_PASSWORD_SECRET" data-r="0,20,200,30" style="background-color: rgb(255, 255, 255)">
        <input type="text" value="ATTR_TEXT_SECRET" data-r="0,60,200,30">
        <textarea data-r="0,100,200,60">TEXTAREA_SECRET</textarea>
        <select data-r="0,200,200,30"><option value="OPTION_VALUE_SECRET" selected>OPTION_LABEL_SECRET</option></select>
        <input type="hidden" value="HIDDEN_SECRET">
      </form>`);
    const pw = root.querySelector<HTMLInputElement>("input[type=password]")!;
    pw.value = "TYPED_PASSWORD_SECRET";
    const valueSpy = vi.spyOn(pw, "value", "get");
    const json = JSON.stringify(collectDesignDna(root, geometry()));
    expect(json).not.toMatch(/SECRET/);
    expect(valueSpy).not.toHaveBeenCalled();
  });

  test("source carries page info and rounded selection rect only", () => {
    const root = mount("");
    root.setAttribute("data-r", "10.4,20.6,100.2,50.5");
    const dna = collectDesignDna(root, { ...geometry(), clipped: true });
    expect(dna.version).toBe(1);
    expect(dna.source).toEqual({
      url: location.href,
      title: document.title,
      viewport: { w: window.innerWidth, h: window.innerHeight },
      dpr: window.devicePixelRatio || 1,
      rect: { x: 10, y: 21, w: 100, h: 51 },
      clipped: true,
    });
    expect(collectDesignDna(root, geometry()).source.clipped).toBe(false);
  });
});

describe("pure helpers", () => {
  test("pickFontFamily", () => {
    expect(pickFontFamily(`"Foo Bar", Inter, sans-serif`, (f) => f === "Foo Bar")).toEqual({ family: "Foo Bar", generic: false });
    expect(pickFontFamily(`Foo, Inter, sans-serif`, (f) => f === "Inter")).toEqual({ family: "Inter", generic: false });
    expect(pickFontFamily(`Foo, system-ui, Inter`, () => true)).toEqual({ family: "Foo", generic: false });
    expect(pickFontFamily(`Foo, ui-monospace, Inter`, () => false)).toEqual({ family: "ui-monospace", generic: true });
    // Nothing loaded and no generic: the last entry is what renders.
    expect(pickFontFamily(`Foo, Bar`, () => false)).toEqual({ family: "Bar", generic: false });
    expect(pickFontFamily(``, () => true)).toBeNull();
  });

  test("parseFontStack / isGenericFamily", () => {
    expect(parseFontStack(` "A B" , 'C',D,, `)).toEqual(["A B", "C", "D"]);
    for (const g of ["serif", "SANS-SERIF", "monospace", "system-ui", "ui-rounded", "emoji"]) expect(isGenericFamily(g)).toBe(true);
    expect(isGenericFamily("Inter")).toBe(false);
  });

  test("parsePx", () => {
    expect(parsePx("12px")).toBe(12);
    expect(parsePx("12.345px")).toBe(12.35);
    expect(parsePx("-1px")).toBe(-1);
    for (const v of ["normal", "auto", "50%", "1em", "", null, undefined]) expect(parsePx(v)).toBeNull();
  });

  test("visibleArea", () => {
    const clip = { left: 0, top: 0, width: 100, height: 100 };
    expect(visibleArea({ left: 50, top: 50, width: 100, height: 100 }, clip)).toBe(2500);
    expect(visibleArea({ left: 100, top: 0, width: 10, height: 10 }, clip)).toBe(0);
    expect(visibleArea({ left: 10, top: 10, width: 10, height: 10 }, clip)).toBe(100);
  });

  test("isVisibleShadow", () => {
    expect(isVisibleShadow("rgba(0, 0, 0, 0.2) 0px 1px 2px 0px")).toBe(true);
    expect(isVisibleShadow("rgba(0, 0, 0, 0) 0px 0px 0px 0px")).toBe(false);
    expect(isVisibleShadow("rgba(0, 0, 0, 0) 0px 0px 0px 0px, rgb(1, 2, 3) 0px 2px 4px 0px")).toBe(true);
    expect(isVisibleShadow("0px 1px 2px black")).toBe(true);
    expect(isVisibleShadow("#0000 0px 0px 1px")).toBe(false);
    expect(isVisibleShadow("none")).toBe(false);
    expect(isVisibleShadow("")).toBe(false);
    expect(isVisibleShadow(null)).toBe(false);
    expect(isVisibleShadow(`rgb(0, 0, 0) 0px 0px 1px${", rgb(0, 0, 0) 0px 0px 1px".repeat(20)}`)).toBe(false);
  });

  test("describeElement", () => {
    const el = document.createElement("div");
    el.className = "card shadow extra";
    expect(describeElement(el, { width: 320.4, height: 199.6 })).toBe("div.card.shadow  320×200");
    el.className = "a-very-long-class-name-indeed";
    expect(describeElement(el, { width: 1, height: 1 })).toBe("div.a-very-long-class-n…  1×1");
    expect(describeElement(document.createElement("section"), { width: 0, height: 0 })).toBe("section  0×0");
  });
});

describe("collectDesignDna: viewport clipping", () => {
  const viewport = { left: 0, top: 0, width: 400, height: 100 };

  test("with a viewport, only the visible part of the selection counts", () => {
    const root = mount(`
      <div style="background-color: rgb(255, 0, 0)" data-r="0,0,400,100"></div>
      <div style="background-color: rgb(0, 0, 255)" data-r="0,100,400,300"></div>`);
    expect(hexes(collectDesignDna(root, geometry())).sort()).toEqual(["#0000ff", "#ff0000"]);
    expect(hexes(collectDesignDna(root, { ...geometry(), viewport }))).toEqual(["#ff0000"]);
  });

  test("off-screen elements don't use up the node budget", () => {
    const offscreen = Array.from({ length: 20 }, () => `<div style="background-color: rgb(0, 0, 255)" data-r="0,200,10,10"></div>`).join("");
    const root = mount(`${offscreen}<div style="background-color: rgb(255, 0, 0)" data-r="0,0,400,100"></div>`);
    // Budget of 3: root + the one visible child must still be reached after 20 off-screen siblings (hard walk cap is 10x budget).
    const dna = collectDesignDna(root, { ...geometry(), viewport, maxNodes: 3 });
    expect(hexes(dna)).toEqual(["#ff0000"]);
  });
});
