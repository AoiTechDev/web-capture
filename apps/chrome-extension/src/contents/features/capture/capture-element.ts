/**
 * What the element picker saves for the element the user chose.
 *
 * The picker is for capturing how something looks, so whatever is picked is
 * saved as an element screenshot with its Design DNA - a card stays a card
 * even when it contains an image, a link or text. The one exception is a
 * picked `<img>` itself, where the original file is better than a screenshot.
 * Text and links have their own shortcuts (Ctrl+Shift+X, Ctrl+Shift+L).
 */
export function captureElement(element: HTMLElement) {
  const base = { url: window.location.href, timestamp: Date.now() }
  if (element instanceof HTMLImageElement && (element.currentSrc || element.src)) {
    return {
      ...base,
      kind: "image" as const,
      src: element.currentSrc || element.src,
      alt: element.alt || undefined,
    }
  }
  return {
    ...base,
    kind: "element" as const,
    tagName: element.tagName.toLowerCase(),
    target: element,
  }
}
