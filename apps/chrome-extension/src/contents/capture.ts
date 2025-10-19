import type { PlasmoCSConfig } from "plasmo"
import "./styles/index.css"
import { showAuthNotification } from "./features/auth/auth-notification"
import { checkAuth } from "./features/auth/check-auth"
import { toggleSearchOverlay, closeSearchOverlay, isSearchOverlayOpen } from "./features/search/search-overlay"
import { cleanup, toggleSelectionMode, startScreenshotMode, exitAllModes } from "./features/capture"
import { cropAndUpload } from "./features/capture/crop-and-upload"

export const config: PlasmoCSConfig = {
  matches: ["<all_urls>"]
}

window.addEventListener("beforeunload", cleanup)

let activeMode: "selection-basic" | "selection-category" | "screenshot" | null = null

document.addEventListener(
  "keydown",
  (e) => {
    if (!e.key) return 
    
    const key = e.key.toUpperCase()
    const hasCtrlOrMeta = e.ctrlKey || e.metaKey

    if (key === "ESCAPE") {
      if (activeMode) {
        exitAllModes()
        activeMode = null
      }
      if (isSearchOverlayOpen()) {
        closeSearchOverlay()
      }
      return
    }

    if (hasCtrlOrMeta && e.shiftKey && !e.altKey && key === "S") {
      e.preventDefault()
      e.stopPropagation()
      
      if (activeMode === "selection-basic") {
        toggleSelectionMode()
        activeMode = null
      } else {
        void (async () => {
          const isAuthenticated = await checkAuth()
          if (!isAuthenticated) {
            showAuthNotification()
            return
          }
          toggleSelectionMode(false)
          activeMode = "selection-basic"
        })()
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
        // Check auth before entering mode
        void (async () => {
          const isAuthenticated = await checkAuth()
          if (!isAuthenticated) {
            showAuthNotification()
            return
          }
          // Enter selection mode (with category)
          toggleSelectionMode(true)
          activeMode = "selection-category"
        })()
      }
    }

    // Ctrl/Cmd + Shift + E - Toggle screenshot mode
    if (hasCtrlOrMeta && e.shiftKey && key === "E") {
      e.preventDefault()
      e.stopPropagation()
      
      if (activeMode === "screenshot") {
        exitAllModes()
        activeMode = null
      } else {
        void (async () => {
          const isAuthenticated = await checkAuth()
          if (!isAuthenticated) {
            showAuthNotification()
            return
          }
          startScreenshotMode()
          activeMode = "screenshot"
        })()
      }
    }

    // Ctrl/Cmd + Shift + K - Open search overlay
    if (hasCtrlOrMeta && e.shiftKey && key === "K") {
      e.preventDefault()
      e.stopPropagation()
      void (async () => {
        const isAuthenticated = await checkAuth()
        if (!isAuthenticated) {
          showAuthNotification()
          return
        }
        toggleSearchOverlay()
      })()
    }
  },
  true
)

chrome.runtime.onMessage.addListener((message) => {

  if (message?.type === "GET_TOKEN") {
    chrome.runtime.sendMessage({ type: "GET_TOKEN" }, (response) => { 
      console.log('[Content Script]: Response from background', response)
    })
  }
  if (message?.type === "START_SCREENSHOT_MODE") {
    void (async () => {
      const isAuthenticated = await checkAuth()
      if (!isAuthenticated) {
        showAuthNotification()
        return
      }
      startScreenshotMode()
      activeMode = "screenshot"
    })()
  }
  if (message?.type === "CROP_AND_UPLOAD") {
    void cropAndUpload(message as {
      dataUrl: string
      rect: { x: number; y: number; width: number; height: number; dpr: number; url: string }
    })
  }
})
