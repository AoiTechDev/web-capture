/**
 * Image work done in the service worker: cropping a tab screenshot, making a
 * grid thumbnail and reading a pixel palette.
 *
 * Uses OffscreenCanvas + createImageBitmap, both available in an MV3 worker,
 * so no image data has to travel to or from a content script.
 */

import type { ConvexClient } from "convex/browser"
import { api } from "../../../../../packages/backend/convex/_generated/api"
import type { Id } from "../../../../../packages/backend/convex/_generated/dataModel"
import { paletteFromPixels, type PaletteColor } from "../../../../../packages/backend/convex/lib/color"

/** Larger originals are refused rather than uploaded. */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024
export const THUMB_MAX_WIDTH = 768
/** Caps very tall captures (long pages) so the WebP encode stays cheap. */
export const THUMB_MAX_HEIGHT = 2048
export const PALETTE_SAMPLE_WIDTH = 100
/** k-means cost grows with pixel count, so the sample is capped by area too. */
export const PALETTE_SAMPLE_MAX_PIXELS = 100 * 100
export const PALETTE_SIZE = 6
/** Fixed so the same image always yields the same palette. */
const PALETTE_SEED = 0x5eed

export type CssRect = { x: number; y: number; width: number; height: number }
export type CropBox = { sx: number; sy: number; sw: number; sh: number; clipped: boolean }

/**
 * Map a viewport rect (CSS px) onto the captured bitmap (device px) and clamp
 * it to what was actually captured. `clipped` is true when clamping cut
 * anything off. Returns null when nothing visible is left.
 */
export function computeCropBox(
  rect: CssRect,
  dpr: number,
  bitmapWidth: number,
  bitmapHeight: number
): CropBox | null {
  const scale = dpr > 0 && Number.isFinite(dpr) ? dpr : 1
  const x0 = Math.round(rect.x * scale)
  const y0 = Math.round(rect.y * scale)
  const x1 = Math.round((rect.x + rect.width) * scale)
  const y1 = Math.round((rect.y + rect.height) * scale)
  const sx = Math.max(0, x0)
  const sy = Math.max(0, y0)
  const ex = Math.min(bitmapWidth, x1)
  const ey = Math.min(bitmapHeight, y1)
  if (ex - sx < 1 || ey - sy < 1) return null
  // One device pixel of slack for rounding at the viewport edge.
  const clipped = sx - x0 > 1 || sy - y0 > 1 || x1 - ex > 1 || y1 - ey > 1
  return { sx, sy, sw: ex - sx, sh: ey - sy, clipped }
}

/** Size that fits within `maxWidth`, keeping the aspect ratio; never upscales. */
export function fitWidth(width: number, height: number, maxWidth: number) {
  if (width <= maxWidth) return { width, height }
  return { width: maxWidth, height: Math.max(1, Math.round((height * maxWidth) / width)) }
}

/**
 * Size that fits within `maxWidth` × `maxHeight` and, optionally, `maxPixels`,
 * keeping the aspect ratio; never upscales.
 */
export function fitBox(
  width: number,
  height: number,
  { maxWidth, maxHeight = Infinity, maxPixels = Infinity }: { maxWidth: number; maxHeight?: number; maxPixels?: number }
) {
  const scale = Math.min(1, maxWidth / width, maxHeight / height, Math.sqrt(maxPixels / (width * height)))
  if (scale >= 1) return { width, height }
  return {
    width: Math.max(1, Math.floor(width * scale)),
    height: Math.max(1, Math.floor(height * scale)),
  }
}

function draw(source: CanvasImageSource, sw: number, sh: number, dw: number, dh: number, sx = 0, sy = 0) {
  const canvas = new OffscreenCanvas(dw, dh)
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("2D canvas unavailable")
  ctx.imageSmoothingQuality = "high"
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, dw, dh)
  return { canvas, ctx }
}

/** Cut `box` out of `bitmap` at full resolution, as a PNG. */
export async function cropToPng(bitmap: ImageBitmap, box: CropBox): Promise<{ blob: Blob; bitmap: ImageBitmap }> {
  const { canvas } = draw(bitmap, box.sw, box.sh, box.sw, box.sh, box.sx, box.sy)
  const blob = await canvas.convertToBlob({ type: "image/png" })
  return { blob, bitmap: canvas.transferToImageBitmap() }
}

/** WebP thumbnail at most `maxWidth` wide (and THUMB_MAX_HEIGHT tall). */
export async function makeThumbnail(bitmap: ImageBitmap, maxWidth = THUMB_MAX_WIDTH): Promise<Blob> {
  const size = fitBox(bitmap.width, bitmap.height, { maxWidth, maxHeight: THUMB_MAX_HEIGHT })
  const { canvas } = draw(bitmap, bitmap.width, bitmap.height, size.width, size.height)
  return await canvas.convertToBlob({ type: "image/webp", quality: 0.82 })
}

/** Palette of the image's pixels: downscaled to ~100px wide, k-means in LAB. */
export function extractPalette(bitmap: ImageBitmap): PaletteColor[] {
  const size = fitBox(bitmap.width, bitmap.height, {
    maxWidth: PALETTE_SAMPLE_WIDTH,
    maxPixels: PALETTE_SAMPLE_MAX_PIXELS,
  })
  const { ctx } = draw(bitmap, bitmap.width, bitmap.height, size.width, size.height)
  const { data } = ctx.getImageData(0, 0, size.width, size.height)
  return paletteFromPixels(data, { k: PALETTE_SIZE, seed: PALETTE_SEED })
}

export function assertImageSize(blob: Blob) {
  if (blob.size > MAX_IMAGE_BYTES) {
    throw new Error(`Image is larger than ${MAX_IMAGE_BYTES / 1024 / 1024} MB`)
  }
}

/** Upload one file to Convex storage and return its id. */
export async function uploadBlob(
  convex: ConvexClient,
  blob: Blob,
  contentType?: string
): Promise<Id<"_storage">> {
  const postUrl = await convex.mutation(api.upload.generateUploadUrl, {})
  const res = await fetch(postUrl, {
    method: "POST",
    headers: { "Content-Type": contentType || blob.type || "application/octet-stream" },
    body: blob,
  })
  if (!res.ok) throw new Error(`Upload failed (HTTP ${res.status})`)
  const { storageId } = await res.json()
  return storageId
}

export type ImageExtras = { thumbStorageId?: Id<"_storage">; palette?: PaletteColor[] }

/**
 * Thumbnail and palette for an image about to be saved. Both are extras: if
 * either fails (odd formats, canvas limits) the capture is saved without it.
 */
export async function deriveImageExtras(
  convex: ConvexClient,
  bitmap: ImageBitmap
): Promise<ImageExtras> {
  const extras: ImageExtras = {}
  try {
    extras.palette = extractPalette(bitmap)
  } catch (e) {
    console.warn("[image] palette failed:", e)
  }
  try {
    extras.thumbStorageId = await uploadBlob(convex, await makeThumbnail(bitmap), "image/webp")
  } catch (e) {
    console.warn("[image] thumbnail failed:", e)
  }
  return extras
}
