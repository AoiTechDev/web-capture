import { describe, expect, test } from "vitest";
import {
  assertImageSize,
  computeCropBox,
  fitBox,
  fitWidth,
  MAX_IMAGE_BYTES,
  PALETTE_SAMPLE_MAX_PIXELS,
  PALETTE_SAMPLE_WIDTH,
  THUMB_MAX_HEIGHT,
  THUMB_MAX_WIDTH,
} from "~background/functions/image-processing";

describe("computeCropBox", () => {
  test("dpr 1, fully visible: rect maps 1:1 and is not clipped", () => {
    expect(computeCropBox({ x: 10, y: 20, width: 100, height: 50 }, 1, 1280, 800)).toEqual({
      sx: 10, sy: 20, sw: 100, sh: 50, clipped: false,
    });
  });

  test("dpr 2 scales CSS px to device px", () => {
    expect(computeCropBox({ x: 10, y: 20, width: 100, height: 50 }, 2, 2560, 1600)).toEqual({
      sx: 20, sy: 40, sw: 200, sh: 100, clipped: false,
    });
  });

  test("element flush with the viewport edges is not clipped", () => {
    expect(computeCropBox({ x: 0, y: 0, width: 1280, height: 800 }, 1, 1280, 800)).toEqual({
      sx: 0, sy: 0, sw: 1280, sh: 800, clipped: false,
    });
  });

  test("partly above/left of the viewport: clamped and clipped", () => {
    expect(computeCropBox({ x: -30, y: -10, width: 100, height: 50 }, 1, 1280, 800)).toEqual({
      sx: 0, sy: 0, sw: 70, sh: 40, clipped: true,
    });
  });

  test("partly below/right of the viewport at dpr 2: clamped and clipped", () => {
    const box = computeCropBox({ x: 1200, y: 700, width: 200, height: 300 }, 2, 2560, 1600)!;
    expect(box).toEqual({ sx: 2400, sy: 1400, sw: 160, sh: 200, clipped: true });
    expect(box.sx + box.sw).toBeLessThanOrEqual(2560);
    expect(box.sy + box.sh).toBeLessThanOrEqual(1600);
  });

  test("sub-pixel overhang from rounding is not reported as clipped", () => {
    // 1280.4 css px at dpr 1 rounds onto the bitmap edge.
    const box = computeCropBox({ x: 1180.2, y: 0, width: 100.2, height: 10 }, 1, 1280, 800)!;
    expect(box.clipped).toBe(false);
    expect(box.sx + box.sw).toBe(1280);
    // At dpr 1.5 a half-pixel rect edge still stays within one device px of slack.
    expect(computeCropBox({ x: 0, y: 0, width: 853.5, height: 10 }, 1.5, 1280, 800)!.clipped).toBe(false);
  });

  test("entirely outside the viewport or empty -> null", () => {
    expect(computeCropBox({ x: 2000, y: 0, width: 100, height: 100 }, 1, 1280, 800)).toBeNull();
    expect(computeCropBox({ x: 0, y: -500, width: 100, height: 100 }, 1, 1280, 800)).toBeNull();
    expect(computeCropBox({ x: 10, y: 10, width: 0, height: 100 }, 1, 1280, 800)).toBeNull();
  });

  test("invalid dpr falls back to 1", () => {
    const want = { sx: 10, sy: 10, sw: 20, sh: 20, clipped: false };
    expect(computeCropBox({ x: 10, y: 10, width: 20, height: 20 }, 0, 100, 100)).toEqual(want);
    expect(computeCropBox({ x: 10, y: 10, width: 20, height: 20 }, NaN, 100, 100)).toEqual(want);
    expect(computeCropBox({ x: 10, y: 10, width: 20, height: 20 }, -2, 100, 100)).toEqual(want);
  });
});

describe("fitWidth / thumbnail sizing", () => {
  test("THUMB_MAX_WIDTH is 768", () => {
    expect(THUMB_MAX_WIDTH).toBe(768);
  });

  test.each([
    [1920, 1080],
    [2560, 1600],
    [769, 3000],
    [4000, 500],
    [3000, 3000],
  ])("%ix%i fits within 768 wide, aspect preserved", (w, h) => {
    const out = fitWidth(w, h, THUMB_MAX_WIDTH);
    expect(out.width).toBe(THUMB_MAX_WIDTH);
    expect(out.width).toBeLessThanOrEqual(768);
    // Aspect ratio within one pixel of rounding on the height.
    expect(Math.abs(out.height - (h * 768) / w)).toBeLessThanOrEqual(0.5);
  });

  test("never upscales", () => {
    expect(fitWidth(500, 300, 768)).toEqual({ width: 500, height: 300 });
    expect(fitWidth(768, 100, 768)).toEqual({ width: 768, height: 100 });
  });

  test("very wide images keep at least 1px height", () => {
    expect(fitWidth(100000, 1, 768)).toEqual({ width: 768, height: 1 });
  });
});

describe("assertImageSize", () => {
  test("allows up to 10 MB, refuses larger", () => {
    expect(MAX_IMAGE_BYTES).toBe(10 * 1024 * 1024);
    expect(() => assertImageSize({ size: MAX_IMAGE_BYTES } as Blob)).not.toThrow();
    expect(() => assertImageSize({ size: MAX_IMAGE_BYTES + 1 } as Blob)).toThrow(/larger than 10 MB/);
  });
});

describe("fitBox", () => {
  test("never upscales", () => {
    expect(fitBox(50, 40, { maxWidth: 100 })).toEqual({ width: 50, height: 40 });
  });

  test("a very tall page image is capped in height for the thumbnail", () => {
    const size = fitBox(1000, 60000, { maxWidth: THUMB_MAX_WIDTH, maxHeight: THUMB_MAX_HEIGHT });
    expect(size.height).toBeLessThanOrEqual(THUMB_MAX_HEIGHT);
    expect(size.width).toBeLessThanOrEqual(THUMB_MAX_WIDTH);
    expect(size.width / size.height).toBeCloseTo(1000 / 60000, 2);
  });

  test("the palette sample is capped by area, so k-means stays cheap", () => {
    const size = fitBox(1000, 60000, { maxWidth: PALETTE_SAMPLE_WIDTH, maxPixels: PALETTE_SAMPLE_MAX_PIXELS });
    expect(size.width * size.height).toBeLessThanOrEqual(PALETTE_SAMPLE_MAX_PIXELS);
    expect(size.width).toBeGreaterThanOrEqual(1);
  });
});
