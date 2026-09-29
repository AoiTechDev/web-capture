import { captureElement } from "./capture-element"
import { captureElementScreenshot } from "./screenshot-capture"
import { reportCaptureSaved, showCaptureError } from "../auth/auth-notification"
import { showCategoryOverlay } from "../category/category-overlay"
import { addRecentCategory, getRecentCategories, addRecentTags } from "../category/category-storage"
import {
  ensureHighlightOverlay,
  positionHighlightOverlay,
  hideHighlightOverlay,
} from "../../components/highlight-overlay"

type PendingCapture =
  | {
      kind: "image"
      src: string
      alt?: string
      url: string
      timestamp: number
      width?: number
      height?: number
    }
  | { kind: "text"; content: string; url: string; timestamp: number }
  | {
      kind: "link"
      href: string
      text?: string
      url: string
      timestamp: number
    }
  | {
      // Saved as a screenshot of `target`'s bounding box, not as data.
      kind: "element"
      tagName: string
      target: HTMLElement
      url: string
      timestamp: number
    }

let isSelecting = false
let categoryPromptEnabled = false
let selectedCategory: string | undefined
let pendingElementData: PendingCapture | null = null
let currentHoveredElement: HTMLElement | null = null

/**
 * Send one picked element to the background and tell the user if it failed.
 * Throws only for transport errors (e.g. the extension was reloaded).
 */
async function sendCapture(data: PendingCapture, category?: string, tags?: string[]) {
  if (data.kind === "element") {
    // The highlight box sits on top of the element; keep it out of the shot,
    // and stop hover tracking so a mouse move can't redraw it mid-capture.
    const wasSelecting = isSelecting
    if (wasSelecting) removeEventListeners()
    hideHighlightOverlay()
    currentHoveredElement = null
    try {
      await captureElementScreenshot(data.target, { category, tags })
    } finally {
      if (wasSelecting && isSelecting) addEventListeners()
    }
    return
  }
  const res = await chrome.runtime.sendMessage({
    type: data.kind === "image" ? "SAVE_IMAGE_CAPTURE" : "SAVE_NON_IMAGE_CAPTURE",
    data: { ...data, category, tags },
  })
  reportCaptureSaved(res)
}

async function openCategoryOverlayAndHandlePending() {
  const categories = await (async () => {
    try {
      const res = await chrome.runtime.sendMessage({ type: "GET_CATEGORIES" })
      const list: Array<{ _id: string; name: string }> = Array.isArray(
        res?.categories
      )
        ? res.categories
        : []
      if (list.length > 0) return list.map((c) => c.name)
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : String(e)
      if (errorMessage.includes("Extension context invalidated")) {
        alert("Extension was reloaded. Please refresh this page to use the capture features.")
        return []
      }
    }
    return await getRecentCategories()
  })()

  const result = await showCategoryOverlay(
    async () => categories,
    async () => {
      try {
        const res = await chrome.runtime.sendMessage({ type: "GET_TAGS" })
        const list: Array<{ name: string }> = Array.isArray(res?.tags)
          ? res.tags
          : []
        if (list.length > 0) {
          return list.map((t) => t.name)
        }
      } catch {}
      try {
        const local = await chrome.storage.sync.get({ recentTags: [] as string[] })
        if (Array.isArray(local.recentTags)) return local.recentTags.slice(0, 12)
      } catch {}
      return [] as string[]
    }
  )
  if (result.kind === "cancel") {
    selectedCategory = undefined
    pendingElementData = null
    categoryPromptEnabled = false
    return
  }
  const cat = result.category
  selectedCategory = cat
  const tags: string[] | undefined = Array.isArray(result.tags)
    ? result.tags
    : undefined
  if (tags && tags.length > 0) {
    await addRecentTags(tags)
  }
  if (cat) {
    void chrome.runtime
      .sendMessage({ type: "CREATE_CATEGORY", name: cat })
      .catch((e) => {
        const errorMessage = e instanceof Error ? e.message : String(e)
        if (errorMessage.includes("Extension context invalidated")) {
        }
      })
    void addRecentCategory(cat)
  }
  if (pendingElementData) {
    const toSend = pendingElementData
    pendingElementData = null
    const category = selectedCategory
    selectedCategory = undefined
    categoryPromptEnabled = false
    try {
      await sendCapture(toSend, category, tags)
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : String(e)
      if (errorMessage.includes("Extension context invalidated")) {
        alert("Extension was reloaded. Please refresh this page to use the capture features.")
      } else {
        console.error("❌ Failed to send message after category selection:", e)
        showCaptureError(errorMessage)
      }
    }
  }
}

function outlineSelectedElement(event: MouseEvent) {
  if (!isSelecting) return

  const hoveredElement = event.target as HTMLElement

  if (currentHoveredElement === hoveredElement) return

  ensureHighlightOverlay()

  positionHighlightOverlay(hoveredElement)
  currentHoveredElement = hoveredElement
}

function removeOutlineSelectedElement(event: MouseEvent) {
  if (!isSelecting) return

  const leftElement = event.target as HTMLElement

  if (currentHoveredElement === leftElement) {
    hideHighlightOverlay()
    currentHoveredElement = null
  }
}

async function handleElementClick(event: MouseEvent) {
  if (!isSelecting) return

  event.preventDefault()
  event.stopPropagation()

  // The highlighted element, which arrow keys may have moved off the one
  // under the cursor.
  await saveElement(currentHoveredElement ?? (event.target as HTMLElement))
}

/** Highlight `el` as the current pick, e.g. after moving with the arrow keys. */
function highlight(el: HTMLElement) {
  ensureHighlightOverlay()
  positionHighlightOverlay(el)
  currentHoveredElement = el
}

/**
 * Keyboard while picking: ↑ parent, ↓ first child, Enter saves the current
 * element, Esc cancels. Handled before the page sees the key.
 */
function handleSelectionKeydown(event: KeyboardEvent) {
  if (!isSelecting) return
  const current = currentHoveredElement

  if (event.key === "Escape") {
    event.preventDefault()
    event.stopPropagation()
    toggleSelectionInternal(false)
    return
  }
  if (!current) return

  if (event.key === "ArrowUp") {
    event.preventDefault()
    event.stopPropagation()
    const parent = current.parentElement
    // Stop at <body>: <html> is never a useful pick.
    if (parent && parent !== document.documentElement) highlight(parent)
  } else if (event.key === "ArrowDown") {
    event.preventDefault()
    event.stopPropagation()
    const child = current.firstElementChild
    if (child instanceof HTMLElement) highlight(child)
  } else if (event.key === "Enter") {
    event.preventDefault()
    event.stopPropagation()
    void saveElement(current)
  }
}

async function saveElement(target: HTMLElement) {
  const elementData = captureElement(target)
  console.log("🔍 Captured element data:", elementData)

  if (categoryPromptEnabled && !selectedCategory) {
    pendingElementData = elementData
    toggleSelectionInternal(false)
    void openCategoryOverlayAndHandlePending()
    return
  }

  const category: string | undefined = categoryPromptEnabled
    ? selectedCategory
    : undefined

  try {
    await sendCapture(elementData, category)
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    if (errorMessage.includes("Extension context invalidated")) {
      alert("Extension was reloaded. Please refresh this page to use the capture features.")
    } else {
      console.error("❌ Failed to send message to background:", error)
      showCaptureError(errorMessage)
    }
  }

  selectedCategory = undefined
  if (categoryPromptEnabled) {
    categoryPromptEnabled = false
  }
}

function addEventListeners() {
  document.addEventListener("mouseover", outlineSelectedElement, true)
  document.addEventListener("mouseout", removeOutlineSelectedElement, true)
  document.addEventListener("click", handleElementClick, true)
  document.addEventListener("keydown", handleSelectionKeydown, true)
}

function removeEventListeners() {
  document.removeEventListener("mouseover", outlineSelectedElement, true)
  document.removeEventListener("mouseout", removeOutlineSelectedElement, true)
  document.removeEventListener("click", handleElementClick, true)
  document.removeEventListener("keydown", handleSelectionKeydown, true)

  hideHighlightOverlay()
  currentHoveredElement = null
}

function toggleSelectionInternal(nextSelecting: boolean) {
  isSelecting = nextSelecting
  if (isSelecting) {
    document.body.style.cursor = "crosshair"
    addEventListeners()
  } else {
    document.body.style.cursor = "default"
    removeEventListeners()
    categoryPromptEnabled = false
    selectedCategory = undefined
  }
}

export function toggleSelectionMode(promptForCategory?: boolean) {
  if (typeof promptForCategory === "boolean") {
    categoryPromptEnabled = !!promptForCategory
    toggleSelectionInternal(true)
  } else {
    toggleSelectionInternal(!isSelecting)
  }
}

export function isInSelectionMode(): boolean {
  return isSelecting
}

export function exitSelectionMode() {
  if (isSelecting) {
    toggleSelectionInternal(false)
  }
}

