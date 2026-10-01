import { reportCaptureSaved, showCaptureError } from "../auth/auth-notification"
import {
  ensureHighlightOverlay,
  positionHighlightOverlay,
  hideHighlightOverlay,
} from "../../components/highlight-overlay"
import { findImageAtPoint } from "./find-image"

/**
 * Image picker: hover highlights only the image under the cursor (looking
 * through overlays), click saves the original file as an image capture.
 * Unlike the element picker it never screenshots - it is for the pictures
 * themselves. It stays on after a save so several images can be collected.
 */

let active = false
let lastPoint: { x: number; y: number } | null = null
let frame = 0
let previousCursor = ""

function updateHighlight() {
  frame = 0
  if (!active || !lastPoint) return
  const hit = findImageAtPoint(lastPoint.x, lastPoint.y)
  if (!hit) {
    hideHighlightOverlay()
    return
  }
  ensureHighlightOverlay()
  positionHighlightOverlay(hit.element)
}

function scheduleUpdate() {
  if (!frame) frame = requestAnimationFrame(updateHighlight)
}

function onMouseMove(event: MouseEvent) {
  lastPoint = { x: event.clientX, y: event.clientY }
  scheduleUpdate()
}

/** The page moves under a still cursor when it scrolls. */
function onScroll() {
  if (lastPoint) scheduleUpdate()
}

async function save(x: number, y: number) {
  const hit = findImageAtPoint(x, y)
  if (!hit) return
  try {
    const res = await chrome.runtime.sendMessage({
      type: "SAVE_IMAGE_CAPTURE",
      data: {
        kind: "image",
        src: hit.src,
        fallbackSrcs: hit.fallbackSrcs,
        alt: hit.alt,
        url: window.location.href,
        timestamp: Date.now(),
      },
    })
    reportCaptureSaved(res)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message.includes("Extension context invalidated")) {
      alert("Extension was reloaded. Please refresh this page to use the capture features.")
    } else {
      showCaptureError(message)
    }
  }
}

/** Keep the page from reacting (navigating, opening a lightbox) to a pick. */
function swallow(event: Event) {
  event.preventDefault()
  event.stopPropagation()
  event.stopImmediatePropagation()
}

function onClick(event: MouseEvent) {
  swallow(event)
  void save(event.clientX, event.clientY)
}

function onKeydown(event: KeyboardEvent) {
  if (event.key !== "Escape") return
  swallow(event)
  exitImagePickerMode()
}

const SWALLOWED = ["pointerdown", "mousedown", "mouseup", "auxclick", "dblclick"] as const

function setListeners(on: boolean) {
  const toggle = on ? document.addEventListener.bind(document) : document.removeEventListener.bind(document)
  toggle("mousemove", onMouseMove as EventListener, true)
  toggle("scroll", onScroll, true)
  toggle("click", onClick as EventListener, true)
  toggle("keydown", onKeydown as EventListener, true)
  for (const type of SWALLOWED) toggle(type, swallow, true)
}

export function isInImagePickerMode(): boolean {
  return active
}

export function toggleImagePickerMode() {
  if (active) {
    exitImagePickerMode()
    return
  }
  active = true
  previousCursor = document.body.style.cursor
  document.body.style.cursor = "crosshair"
  setListeners(true)
}

export function exitImagePickerMode() {
  if (!active) return
  active = false
  lastPoint = null
  if (frame) cancelAnimationFrame(frame)
  frame = 0
  document.body.style.cursor = previousCursor
  setListeners(false)
  hideHighlightOverlay()
}
