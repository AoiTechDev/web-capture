import type { PlasmoCSConfig } from "plasmo"
import { cleanup, toggleSelectionMode, startScreenshotMode, exitAllModes } from "~utlis-content/mouse-events"


export const config: PlasmoCSConfig = {
  matches: ["<all_urls>"]
}

window.addEventListener("beforeunload", cleanup)

let activeMode: "selection-basic" | "selection-category" | "screenshot" | null = null
let searchOverlayEl: HTMLDivElement | null = null
let searchInputEl: HTMLInputElement | null = null
let searchResultsEl: HTMLDivElement | null = null
let isSearchOpen = false

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
      if (isSearchOpen) {
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


function toggleSearchOverlay() {
  if (isSearchOpen) {
    closeSearchOverlay()
  } else {
    openSearchOverlay()
  }
}

function openSearchOverlay() {
  if (isSearchOpen) return
  isSearchOpen = true
  if (!searchOverlayEl) {
    searchOverlayEl = document.createElement('div')
    searchOverlayEl.style.position = 'fixed'
    searchOverlayEl.style.top = '20px'
    searchOverlayEl.style.left = '50%'
    searchOverlayEl.style.transform = 'translateX(-50%)'
    searchOverlayEl.style.zIndex = '1000001'
    searchOverlayEl.style.background = '#0b0f1a'
    searchOverlayEl.style.color = '#e5e7eb'
    searchOverlayEl.style.border = '1px solid #243047'
    searchOverlayEl.style.borderRadius = '12px'
    searchOverlayEl.style.padding = '12px'
    searchOverlayEl.style.boxShadow = '0 12px 40px rgba(0,0,0,0.5)'
    searchOverlayEl.style.width = '560px'
    searchOverlayEl.style.maxWidth = '90vw'

    const input = document.createElement('input')
    input.type = 'text'
    input.placeholder = 'Search your captures...'
    input.style.width = '100%'
    input.style.padding = '10px 12px'
    input.style.border = '1px solid #334155'
    input.style.borderRadius = '8px'
    input.style.background = '#0f172a'
    input.style.color = '#f3f4f6'
    input.style.outline = 'none'
    input.addEventListener('keydown', onSearchKeyDown, true)
    input.addEventListener('input', debounceSearch, true)
    searchOverlayEl.appendChild(input)
    searchInputEl = input

    const results = document.createElement('div')
    results.style.marginTop = '10px'
    results.style.maxHeight = '60vh'
    results.style.overflow = 'auto'
    results.style.display = 'grid'
    results.style.gridTemplateColumns = '1fr'
    results.style.gap = '8px'
    searchOverlayEl.appendChild(results)
    searchResultsEl = results
  }
  document.body.appendChild(searchOverlayEl!)
  setTimeout(() => searchInputEl?.focus(), 0)
}

function closeSearchOverlay() {
  if (!isSearchOpen) return
  isSearchOpen = false
  if (searchOverlayEl && searchOverlayEl.parentNode) {
    searchOverlayEl.parentNode.removeChild(searchOverlayEl)
  }
}

function onSearchKeyDown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.stopPropagation()
    closeSearchOverlay()
  }
}

let searchDebounce: number | null = null
function debounceSearch() {
  if (searchDebounce) window.clearTimeout(searchDebounce)
  searchDebounce = window.setTimeout(runSearch, 180)
}

async function runSearch() {
  const q = (searchInputEl?.value ?? '').trim()
  if (!q) {
    renderSearchResults([])
    return
  }
  try {
    // Prefer semantic search; fallback to metadata search if model not available
    const resp = await new Promise<{ results: any[]; mode?: string }>((resolve) => {
      chrome.runtime.sendMessage({ type: 'SEARCH_SEMANTIC', q, limit: 30 }, (r) => resolve(r))
    })
    if (resp && Array.isArray(resp.results)) {
      renderSearchResults(resp.results)
      return
    }
    const fallback = await new Promise<{ results: any[] }>((resolve) => {
      chrome.runtime.sendMessage({ type: 'SEARCH_CAPTURES', q, limit: 30 }, (r) => resolve(r))
    })
    renderSearchResults(Array.isArray(fallback?.results) ? fallback.results : [])
  } catch (e) {
    renderSearchResults([])
  }
}

function renderSearchResults(results: any[]) {
  if (!searchResultsEl) return
  searchResultsEl.innerHTML = ''
  if (!results.length) {
    const empty = document.createElement('div')
    empty.textContent = 'No results'
    empty.style.color = '#9ca3af'
    empty.style.fontSize = '14px'
    searchResultsEl.appendChild(empty)
    return
  }
  for (const item of results) {
    const row = document.createElement('div')
    row.style.display = 'grid'
    row.style.gridTemplateColumns = '56px 1fr'
    row.style.gap = '10px'
    row.style.alignItems = 'center'
    row.style.padding = '8px'
    row.style.border = '1px solid #243047'
    row.style.borderRadius = '8px'
    row.style.background = '#0b1220'
    row.style.cursor = 'pointer'
    row.addEventListener('click', (e) => {
      e.stopPropagation()
      if (item.pageUrl) window.open(item.pageUrl, '_blank')
      else if (item.imageUrl) window.open(item.imageUrl, '_blank')
      else if (item.id) window.open(item.pageUrl || 'about:blank', '_blank')
      closeSearchOverlay()
    })

    const thumb = document.createElement('div')
    thumb.style.width = '56px'
    thumb.style.height = '42px'
    thumb.style.background = '#111827'
    thumb.style.border = '1px solid #1f2a44'
    thumb.style.borderRadius = '6px'
    thumb.style.overflow = 'hidden'
    if (item.imageUrl) {
      const img = document.createElement('img')
      img.src = item.imageUrl
      img.style.width = '100%'
      img.style.height = '100%'
      img.style.objectFit = 'cover'
      thumb.appendChild(img)
    } else {
      thumb.textContent = item.kind?.toUpperCase?.() || 'CAP'
      thumb.style.display = 'flex'
      thumb.style.alignItems = 'center'
      thumb.style.justifyContent = 'center'
      thumb.style.fontSize = '10px'
      thumb.style.color = '#9ca3af'
    }

    const meta = document.createElement('div')
    const title = document.createElement('div')
    title.textContent = item.title || item.alt || (new URL(item.pageUrl || 'about:blank').host || 'Capture')
    title.style.fontSize = '14px'
    title.style.fontWeight = '600'
    title.style.color = '#e5e7eb'
    const sub = document.createElement('div')
    const host = (() => { try { return item.pageUrl ? new URL(item.pageUrl).host : '' } catch { return '' } })()
    const tagText = Array.isArray(item.tags) && item.tags.length ? ` #${item.tags.slice(0,3).join(' #')}` : ''
    sub.textContent = [host, item.category].filter(Boolean).join(' • ') + tagText
    sub.style.fontSize = '12px'
    sub.style.color = '#94a3b8'

    meta.appendChild(title)
    meta.appendChild(sub)

    row.appendChild(thumb)
    row.appendChild(meta)
    searchResultsEl.appendChild(row)
  }
}

