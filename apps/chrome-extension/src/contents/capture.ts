import type { PlasmoCSConfig } from "plasmo"
import { cleanup, toggleSelectionMode, startScreenshotMode, exitAllModes } from "~utlis-content/mouse-events"


export const config: PlasmoCSConfig = {
  matches: ["<all_urls>"]
}

window.addEventListener("beforeunload", cleanup)

// Track which mode and shortcut is currently active
let activeMode: "selection-basic" | "selection-category" | "screenshot" | null = null

console.log("Capture")
document.addEventListener(
  "keydown",
  (e) => {
    if (!e.key) return // Guard against undefined key
    
    const key = e.key.toUpperCase()
    const hasCtrlOrMeta = e.ctrlKey || e.metaKey

    // Escape key - exit any active mode
    if (key === "ESCAPE") {
      if (activeMode) {
        exitAllModes()
        activeMode = null
      }
      return
    }

    // Ctrl/Cmd + Shift + S - Toggle basic selection mode
    if (hasCtrlOrMeta && e.shiftKey && !e.altKey && key === "S") {
      e.preventDefault()
      e.stopPropagation()
      
      if (activeMode === "selection-basic") {
        // Exit if same mode is active
        toggleSelectionMode()
        activeMode = null
      } else {
        // Enter selection mode (basic)
        toggleSelectionMode(false)
        activeMode = "selection-basic"
      }
    }

    // Ctrl/Cmd + Shift + A OR Ctrl + Shift + Alt + S - Toggle selection with category
    if (
      (hasCtrlOrMeta && e.shiftKey && key === "A") ||
      (e.ctrlKey && e.shiftKey && e.altKey && key === "S")
    ) {
      e.preventDefault()
      e.stopPropagation()
      
      if (activeMode === "selection-category") {
        // Exit if same mode is active
        toggleSelectionMode()
        activeMode = null
      } else {
        // Enter selection mode (with category)
        toggleSelectionMode(true)
        activeMode = "selection-category"
      }
    }

    // Ctrl/Cmd + Shift + E - Toggle screenshot mode
    if (hasCtrlOrMeta && e.shiftKey && key === "E") {
      e.preventDefault()
      e.stopPropagation()
      
      if (activeMode === "screenshot") {
        // Exit if same mode is active
        exitAllModes()
        activeMode = null
      } else {
        // Enter screenshot mode
        startScreenshotMode()
        activeMode = "screenshot"
      }
    }
  },
  true
)

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "START_SCREENSHOT_MODE") {
    startScreenshotMode()
    activeMode = "screenshot"
  }
  if (message?.type === "CROP_AND_UPLOAD") {
    void (async () => {
      try {
        const { dataUrl, rect } = message as {
          dataUrl: string
          rect: { x: number; y: number; width: number; height: number; dpr: number; url: string }
        }
        const base = await fetch(dataUrl).then((r) => r.blob())
        const bmp = await createImageBitmap(base)
        const dpr = rect.dpr || window.devicePixelRatio || 1
        const sx = Math.round(rect.x * dpr)
        const sy = Math.round(rect.y * dpr)
        const sw = Math.round(rect.width * dpr)
        const sh = Math.round(rect.height * dpr)
        const canvas = document.createElement("canvas")
        canvas.width = sw
        canvas.height = sh
        const ctx = canvas.getContext("2d")!
        ctx.drawImage(bmp, sx, sy, sw, sh, 0, 0, sw, sh)
        const croppedDataUrl = canvas.toDataURL("image/png")
        await chrome.runtime.sendMessage({
          type: "UPLOAD_CROPPED_DATAURL",
          dataUrl: croppedDataUrl,
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          url: rect.url
        })
      } catch (e) {
        const errorMessage = e instanceof Error ? e.message : String(e)
        if (errorMessage.includes("Extension context invalidated")) {
          alert("Extension was reloaded. Please refresh this page to use the capture features.")
        } else {
          console.error("Failed to crop/upload screenshot:", e)
        }
      }
    })()
  }
})


