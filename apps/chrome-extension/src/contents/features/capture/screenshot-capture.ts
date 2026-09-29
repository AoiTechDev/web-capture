import { dismissNotifications, reportCaptureSaved, showCaptureError } from "../auth/auth-notification"
import { collectDesignDna, type DesignDNA } from "./design-dna"

/** How the background should save the shot; defaults to a plain region screenshot. */
export type CaptureMeta = {
  kind?: "screenshot" | "element" | "viewport"
  tagName?: string
  clipped?: boolean
  category?: string
  tags?: string[]
  /** element only */
  designDna?: DesignDNA
}

/**
 * Ask the background to screenshot the tab and crop it to `r` (viewport
 * coordinates). The background crops, thumbnails and uploads, so only the
 * rectangle and metadata cross the message boundary, never image data.
 *
 * Waits two frames first so any overlay just removed is gone from the pixels.
 */
async function requestRegionScreenshot(
  r: { x: number; y: number; width: number; height: number },
  meta?: CaptureMeta
) {
  const rect = {
    ...r,
    url: window.location.href,
    dpr: window.devicePixelRatio || 1,
  }
  // A "Saved" toast from the previous capture would otherwise be in this shot.
  dismissNotifications()
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
  try {
    const res = await chrome.runtime.sendMessage({
      type: "SCREENSHOT_ELEMENT",
      rect,
      meta,
    })
    reportCaptureSaved(res)
  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : String(e)
    if (errorMessage.includes("Extension context invalidated")) {
      alert("Extension was reloaded. Please refresh this page to use the capture features.")
    } else {
      console.error("❌ Failed to request region screenshot:", e)
      showCaptureError(errorMessage)
    }
  }
}

/**
 * Save a picked element as a screenshot of its bounding box, with its Design
 * DNA read from computed styles just before the shot.
 *
 * Only what is on screen can be captured, so an element reaching past the
 * viewport is cropped to its visible part and flagged `clipped`.
 */
export async function captureElementScreenshot(
  element: HTMLElement,
  meta: Omit<CaptureMeta, "kind" | "clipped" | "tagName" | "designDna"> = {}
) {
  const box = element.getBoundingClientRect()
  const left = Math.max(0, box.left)
  const top = Math.max(0, box.top)
  const right = Math.min(window.innerWidth, box.right)
  const bottom = Math.min(window.innerHeight, box.bottom)
  const width = right - left
  const height = bottom - top
  if (width < 2 || height < 2) {
    showCaptureError("The element is not visible on screen.")
    return
  }
  // Sub-pixel slack: a box that ends at 800.4 on an 800px viewport is not clipped.
  const clipped =
    box.left < -1 || box.top < -1 || box.right > window.innerWidth + 1 || box.bottom > window.innerHeight + 1

  // A DNA failure must not cost the user the screenshot.
  let designDna: DesignDNA | undefined
  try {
    designDna = collectDesignDna(element, {
      clipped,
      viewport: { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight },
    })
  } catch (e) {
    console.warn("Design DNA collection failed:", e)
  }

  await requestRegionScreenshot(
    // Unrounded: computeCropBox rounds each edge once, in device pixels.
    { x: left, y: top, width, height },
    { ...meta, kind: "element", tagName: element.tagName.toLowerCase(), clipped, designDna }
  )
}

/** Save everything currently visible in the tab (kind `viewport`, no DNA). */
export async function captureViewport() {
  await requestRegionScreenshot(
    { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight },
    { kind: "viewport", clipped: false }
  )
}

let regionOverlay: HTMLDivElement | null = null
let selectionBox: HTMLDivElement | null = null
let isDraggingRegion = false
let startX = 0
let startY = 0

function destroyRegionOverlay() {
  if (regionOverlay && regionOverlay.parentNode) regionOverlay.parentNode.removeChild(regionOverlay)
  regionOverlay = null
  selectionBox = null
  document.body.style.cursor = ""
}

export function startScreenshotMode() {
  if (regionOverlay) return 

  regionOverlay = document.createElement("div")
  regionOverlay.style.position = "fixed"
  regionOverlay.style.inset = "0"
  regionOverlay.style.zIndex = "9999999"
  regionOverlay.style.background = "rgba(0,0,0,0.25)"
  regionOverlay.style.cursor = "crosshair"

  selectionBox = document.createElement("div")
  selectionBox.style.position = "absolute"
  selectionBox.style.border = "2px solid #3b82f6"
  selectionBox.style.background = "rgba(59,130,246,0.2)"
  selectionBox.style.pointerEvents = "none"
  selectionBox.style.display = "none"
  regionOverlay.appendChild(selectionBox)

  const stop = (e: Event) => e.stopPropagation()
  ;["mousedown", "mousemove", "mouseup", "click", "dblclick", "contextmenu"].forEach((t) =>
    regionOverlay!.addEventListener(t, stop, true)
  )

  const onMouseDown = (e: MouseEvent) => {
    isDraggingRegion = true
    startX = e.clientX
    startY = e.clientY
    if (selectionBox) {
      selectionBox.style.left = `${startX}px`
      selectionBox.style.top = `${startY}px`
      selectionBox.style.width = "0px"
      selectionBox.style.height = "0px"
      selectionBox.style.display = "block"
    }
  }

  const onMouseMove = (e: MouseEvent) => {
    if (!isDraggingRegion || !selectionBox) return
    const currX = e.clientX
    const currY = e.clientY
    const x = Math.min(startX, currX)
    const y = Math.min(startY, currY)
    const w = Math.abs(currX - startX)
    const h = Math.abs(currY - startY)
    selectionBox.style.left = `${x}px`
    selectionBox.style.top = `${y}px`
    selectionBox.style.width = `${w}px`
    selectionBox.style.height = `${h}px`
  }

  const finishWithRect = async (x: number, y: number, w: number, h: number) => {
    const rx = Math.max(0, Math.min(Math.round(x), window.innerWidth))
    const ry = Math.max(0, Math.min(Math.round(y), window.innerHeight))
    const rw = Math.max(0, Math.min(Math.round(w), window.innerWidth - rx))
    const rh = Math.max(0, Math.min(Math.round(h), window.innerHeight - ry))
    await requestRegionScreenshot({ x: rx, y: ry, width: rw, height: rh })
  }

  const onMouseUp = async (e: MouseEvent) => {
    const endX = e.clientX
    const endY = e.clientY
    const x = Math.min(startX, endX)
    const y = Math.min(startY, endY)
    const w = Math.abs(endX - startX)
    const h = Math.abs(endY - startY)
    isDraggingRegion = false
    window.removeEventListener("keydown", onKeyDown, true)
    regionOverlay?.removeEventListener("mousedown", onMouseDown, true)
    regionOverlay?.removeEventListener("mousemove", onMouseMove, true)
    regionOverlay?.removeEventListener("mouseup", onMouseUp, true)
    destroyRegionOverlay()
    if (w > 2 && h > 2) await finishWithRect(x, y, w, h)
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      isDraggingRegion = false
      window.removeEventListener("keydown", onKeyDown, true)
      regionOverlay?.removeEventListener("mousedown", onMouseDown, true)
      regionOverlay?.removeEventListener("mousemove", onMouseMove, true)
      regionOverlay?.removeEventListener("mouseup", onMouseUp, true)
      destroyRegionOverlay()
    }
  }

  regionOverlay.addEventListener("mousedown", onMouseDown, true)
  regionOverlay.addEventListener("mousemove", onMouseMove, true)
  regionOverlay.addEventListener("mouseup", onMouseUp, true)
  window.addEventListener("keydown", onKeyDown, true)
  document.body.appendChild(regionOverlay)
}

export function isInScreenshotMode(): boolean {
  return regionOverlay !== null
}

export function exitScreenshotMode() {
  if (regionOverlay) {
    destroyRegionOverlay()
  }
}

