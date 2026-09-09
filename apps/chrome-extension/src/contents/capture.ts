import type { PlasmoCSConfig } from "plasmo"
import "./styles/index.css"
import { showAuthNotification } from "./features/auth/auth-notification"
import { checkAuth } from "./features/auth/check-auth"
import { toggleSearchOverlay, closeSearchOverlay, isSearchOverlayOpen } from "./features/search/search-overlay"
import { cleanup, toggleSelectionMode, startScreenshotMode, exitAllModes } from "./features/capture"
import { cropAndUpload } from "./features/capture/crop-and-upload"
import { captureSelectedText } from "./features/capture/selected-text-capture"
import { captureCurrentPageLink } from "./features/capture/capture-link"
import { showIndicator, hideIndicator } from "./features/session/session-indicator"

export const config: PlasmoCSConfig = {
  matches: ["<all_urls>"]
}

window.addEventListener("beforeunload", cleanup)

/* ─── Session indicator ─────────────────────────────────────────── */

// Ask on load rather than waiting for a broadcast: a tab opened mid-session
// would otherwise show nothing until the next state change.
chrome.runtime.sendMessage({ type: "SESSION_STATUS" }, (r) => {
  if (chrome.runtime.lastError || !r?.session) return
  showIndicator({
    running: true,
    name: r.session.displayName,
    itemCount: r.session.itemCount,
  })
})

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type !== "SESSION_STATE") return
  if (msg.state?.running) showIndicator(msg.state)
  else hideIndicator()
})

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
        toggleSelectionMode()
        activeMode = null
      } else {
        void (async () => {
          const isAuthenticated = await checkAuth()
          if (!isAuthenticated) {
            showAuthNotification()
            return
          }
          toggleSelectionMode(true)
          activeMode = "selection-category"
        })()
      }
    }

    // Ctrl/Cmd + Shift + X - Capture currently selected text (Alt to choose category)
    if (hasCtrlOrMeta && e.shiftKey && key === "X") {
      e.preventDefault()
      e.stopPropagation()
      void (async () => {
        const isAuthenticated = await checkAuth()
        if (!isAuthenticated) {
          showAuthNotification()
          return
        }
        const ok = await captureSelectedText(e.altKey)
        if (ok) {
        }
      })()
      return
    }

    // Ctrl/Cmd + Shift + L - Capture current page link (Alt to choose category)
    if (hasCtrlOrMeta && e.shiftKey && key === "L") {
      e.preventDefault()
      e.stopPropagation()
      void (async () => {
        const isAuthenticated = await checkAuth()
        if (!isAuthenticated) {
          showAuthNotification()
          return
        }
        await captureCurrentPageLink(e.altKey)
      })()
      return
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

    // Ctrl/Cmd + Shift + G - Start or finish a capture session
    if (hasCtrlOrMeta && e.shiftKey && key === "G") {
      e.preventDefault()
      e.stopPropagation()
      void (async () => {
        const isAuthenticated = await checkAuth()
        if (!isAuthenticated) {
          showAuthNotification()
          return
        }
        chrome.runtime.sendMessage({ type: "SESSION_TOGGLE" }, (r) => {
          if (chrome.runtime.lastError) return
          // The background broadcasts to every tab, but update this one
          // immediately so the keystroke feels instant.
          if (r?.ok) {
            if (r.running) showIndicator({ running: true, name: "Recording session", itemCount: 0 })
            else hideIndicator()
          }
        })
      })()
      return
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
