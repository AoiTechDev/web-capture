let highlightOverlay: HTMLElement | null = null
let labelOverlay: HTMLElement | null = null

const LABEL_HEIGHT = 20

export function getHighlightOverlay(): HTMLElement | null {
  return highlightOverlay
}

export function ensureHighlightOverlay(): HTMLElement {
  if (highlightOverlay) return highlightOverlay

  // Both layers are pointer-events: none so hovering and clicking still reach
  // the page element underneath.
  highlightOverlay = document.createElement("div")
  highlightOverlay.style.position = "absolute"
  highlightOverlay.style.backgroundColor = "rgba(59, 130, 246, 0.3)"
  highlightOverlay.style.border = "2px solid #3b82f6"
  highlightOverlay.style.borderRadius = "4px"
  highlightOverlay.style.pointerEvents = "none"
  highlightOverlay.style.zIndex = "999999"
  highlightOverlay.style.transition = "all 0.1s ease-out"
  highlightOverlay.style.display = "none"
  highlightOverlay.style.boxShadow = "0 0 0 1px rgba(59, 130, 246, 0.5)"
  highlightOverlay.style.boxSizing = "border-box"

  labelOverlay = document.createElement("div")
  labelOverlay.style.position = "absolute"
  labelOverlay.style.backgroundColor = "rgba(0, 0, 0, 0.8)"
  labelOverlay.style.color = "white"
  labelOverlay.style.font = "600 12px/20px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
  labelOverlay.style.height = `${LABEL_HEIGHT}px`
  labelOverlay.style.padding = "0 6px"
  labelOverlay.style.borderRadius = "4px"
  labelOverlay.style.whiteSpace = "nowrap"
  labelOverlay.style.maxWidth = "420px"
  labelOverlay.style.overflow = "hidden"
  labelOverlay.style.textOverflow = "ellipsis"
  labelOverlay.style.pointerEvents = "none"
  labelOverlay.style.zIndex = "999999"
  labelOverlay.style.display = "none"

  document.body.appendChild(highlightOverlay)
  document.body.appendChild(labelOverlay)
  return highlightOverlay
}

/** Up to two classes, each cut to a readable length. */
function shortClasses(element: Element): string {
  return Array.from(element.classList)
    .slice(0, 2)
    .map((c) => (c.length > 20 ? `${c.slice(0, 19)}…` : c))
    .map((c) => `.${c}`)
    .join("")
}

/** "div.card.shadow  320×200": tag, shortened classes, size in CSS px. */
export function describeElement(element: Element, rect: { width: number; height: number }): string {
  const size = `${Math.round(rect.width)}×${Math.round(rect.height)}`
  return `${element.tagName.toLowerCase()}${shortClasses(element)}  ${size}`
}

export function positionHighlightOverlay(element: HTMLElement) {
  if (!highlightOverlay || !labelOverlay) return

  const rect = element.getBoundingClientRect()
  const scrollX = window.pageXOffset || document.documentElement.scrollLeft
  const scrollY = window.pageYOffset || document.documentElement.scrollTop

  highlightOverlay.style.width = `${rect.width}px`
  highlightOverlay.style.height = `${rect.height}px`
  highlightOverlay.style.left = `${rect.left + scrollX}px`
  highlightOverlay.style.top = `${rect.top + scrollY}px`
  highlightOverlay.style.display = "block"

  labelOverlay.textContent = describeElement(element, rect)
  labelOverlay.style.display = "block"
  labelOverlay.style.left = `${Math.max(0, rect.left) + scrollX}px`
  // Above the element, or inside its top edge when there is no room above.
  const above = rect.top - LABEL_HEIGHT - 2
  labelOverlay.style.top = `${(above >= 0 ? above : Math.max(0, rect.top) + 2) + scrollY}px`
}

export function hideHighlightOverlay() {
  if (highlightOverlay) {
    highlightOverlay.style.display = "none"
  }
  if (labelOverlay) {
    labelOverlay.style.display = "none"
  }
}

export function cleanupHighlight() {
  if (highlightOverlay && highlightOverlay.parentNode) {
    highlightOverlay.parentNode.removeChild(highlightOverlay)
  }
  if (labelOverlay && labelOverlay.parentNode) {
    labelOverlay.parentNode.removeChild(labelOverlay)
  }
  highlightOverlay = null
  labelOverlay = null
}
