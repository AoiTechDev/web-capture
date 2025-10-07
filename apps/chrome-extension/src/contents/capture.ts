import type { PlasmoCSConfig } from "plasmo"
import { cleanup, toggleSelectionMode, startScreenshotMode, exitAllModes } from "~utlis-content/mouse-events"


export const config: PlasmoCSConfig = {
  matches: ["<all_urls>"]
}

window.addEventListener("beforeunload", cleanup)

let activeMode: "selection-basic" | "selection-category" | "screenshot" | null = null

async function checkAuth(): Promise<boolean> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'CHECK_AUTH' }, (response) => {
      if (chrome.runtime.lastError) {
        console.error('[Content Script]: Error checking auth:', chrome.runtime.lastError)
        resolve(false)
        return
      }
      resolve(response?.isAuthenticated ?? false)
    })
  })
}

function showAuthNotification() {
  const notification = document.createElement('div')
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    padding: 16px 24px;
    border-radius: 12px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
    z-index: 999999;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 14px;
    font-weight: 500;
    animation: slideIn 0.3s ease-out;
    max-width: 320px;
  `
  notification.innerHTML = `
    <div style="display: flex; align-items: center; gap: 12px;">
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M10 0C4.48 0 0 4.48 0 10C0 15.52 4.48 20 10 20C15.52 20 20 15.52 20 10C20 4.48 15.52 0 10 0ZM9 15V13H11V15H9ZM11 11H9V5H11V11Z" fill="white"/>
      </svg>
      <div>
        <div style="font-weight: 600; margin-bottom: 4px;">Authentication Required</div>
        <div style="font-size: 12px; opacity: 0.9;">Please sign in to use capture features</div>
      </div>
    </div>
  `
  
  const style = document.createElement('style')
  style.textContent = `
    @keyframes slideIn {
      from {
        transform: translateX(400px);
        opacity: 0;
      }
      to {
        transform: translateX(0);
        opacity: 1;
      }
    }
    @keyframes slideOut {
      from {
        transform: translateX(0);
        opacity: 1;
      }
      to {
        transform: translateX(400px);
        opacity: 0;
      }
    }
  `
  document.head.appendChild(style)
  document.body.appendChild(notification)
  
  setTimeout(() => {
    notification.style.animation = 'slideOut 0.3s ease-out'
    setTimeout(() => {
      notification.remove()
      style.remove()
    }, 300)
  }, 4000)
}

console.log("Capture")
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


