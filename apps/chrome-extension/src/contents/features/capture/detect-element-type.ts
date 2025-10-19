export function detectElementType(element: HTMLElement) {
  // Find the best element to analyze (not just the clicked one)
  const bestElement = findBestElementToAnalyze(element)

  // PRIORITY 1: Look for ANY image in the best element
  const imgElement = findImageInElement(bestElement)
  if (imgElement) {
    return {
      kind: "image" as const,
      src: imgElement.src,
      alt: imgElement.alt || undefined,
    }
  }

  // PRIORITY 2: Only if NO images found, then look for links
  const linkElement = findLinkInElement(bestElement)
  if (linkElement) {
    return {
      kind: "link" as const,
      href: linkElement.href,
      text:
        linkElement.textContent?.trim() ||
        bestElement.textContent?.trim() ||
        undefined,
    }
  }

  // Check for code elements
  if (
    element.classList.contains("code") ||
    element.closest("pre") ||
    element.tagName.toLowerCase() === "code"
  ) {
    return { kind: "code" as const, content: element.textContent ?? "" }
  }

  // Look for code within children
  const codeElement = findCodeInElement(element)
  if (codeElement) {
    return { kind: "code" as const, content: codeElement.textContent ?? "" }
  }

  // Check for text content
  const text = element.textContent?.trim()
  if (text && text.length > 0) {
    return { kind: "text" as const, content: text }
  }

  // Fallback to element type
  return {
    kind: "element" as const,
    tagName: element.tagName.toLowerCase(),
    content: element.textContent ?? undefined,
  }
}

// Helper function to find images within an element
function findImageInElement(element: HTMLElement): HTMLImageElement | null {
  // Check the element itself first
  if (element.tagName.toLowerCase() === "img") {
    return element as HTMLImageElement
  }

  // Check if element has background image (common for Pinterest-style cards)
  const computedStyle = window.getComputedStyle(element)
  const backgroundImage = computedStyle.backgroundImage
  if (backgroundImage && backgroundImage !== "none") {
    // Extract URL from background-image: url("...")
    const urlMatch = backgroundImage.match(/url\(["']?([^"')]+)["']?\)/)
    if (urlMatch) {
      // Create a pseudo image element for consistency
      const img = document.createElement("img")
      img.src = urlMatch[1]
      return img
    }
  }

  // Search recursively through ALL children and descendants for ANY image
  // This will find images even if they're deeply nested in divs, links, etc.

  // Try querySelectorAll
  const allImages = element.querySelectorAll("img")

  if (allImages.length > 0) {
    return allImages[0] as HTMLImageElement
  }

  // Try recursive search manually
  const foundImage = searchForImagesRecursively(element)
  if (foundImage) {
    return foundImage
  }

  return null
}

// Manual recursive search for images (in case querySelectorAll fails)
function searchForImagesRecursively(
  element: HTMLElement,
  depth = 0
): HTMLImageElement | null {
  // Prevent infinite recursion
  if (depth > 10) return null

  // Check if current element is an image
  if (element.tagName.toLowerCase() === "img") {
    return element as HTMLImageElement
  }

  // Check all children
  for (let i = 0; i < element.children.length; i++) {
    const child = element.children[i] as HTMLElement

    const found = searchForImagesRecursively(child, depth + 1)
    if (found) {
      return found
    }
  }

  return null
}

// Helper function to find links within an element
function findLinkInElement(element: HTMLElement): HTMLAnchorElement | null {
  // Check if the element itself is a link
  if (element.tagName.toLowerCase() === "a") {
    return element as HTMLAnchorElement
  }

  // Check direct children
  const directLink = Array.from(element.children).find(
    (child) => child.tagName.toLowerCase() === "a"
  ) as HTMLAnchorElement

  if (directLink) {
    return directLink
  }

  // Look for closest parent link
  const parentLink = element.closest("a")
  if (parentLink) {
    return parentLink as HTMLAnchorElement
  }

  return null
}

// Helper function to find code elements within an element
function findCodeInElement(element: HTMLElement): HTMLElement | null {
  // Check the element itself
  if (
    element.classList.contains("code") ||
    element.tagName.toLowerCase() === "code"
  ) {
    return element
  }

  // Check for pre elements
  if (element.tagName.toLowerCase() === "pre") {
    return element
  }

  // Look for code elements in children
  const codeElement = element.querySelector("code, pre")
  return codeElement as HTMLElement
}

// Find the best element to analyze (smart element selection)
function findBestElementToAnalyze(clickedElement: HTMLElement): HTMLElement {
  // Check if the clicked element itself is meaningful
  if (isMeaningfulElement(clickedElement)) {
    return clickedElement
  }

  // Look for meaningful elements in parents (going up the DOM tree)
  let current = clickedElement.parentElement
  let level = 0

  while (current && level < 5) {
    if (isMeaningfulElement(current)) {
      return current
    }

    current = current.parentElement
    level++
  }

  // If no meaningful parent found, return the original element
  return clickedElement
}

// Check if an element is meaningful (contains important content)
function isMeaningfulElement(element: HTMLElement): boolean {
  const tag = element.tagName.toLowerCase()

  // Elements that are likely to contain important content
  const meaningfulTags = [
    "article",
    "section",
    "div",
    "figure",
    "picture",
    "a",
    "img",
    "video",
    "canvas",
    "svg",
  ]

  if (!meaningfulTags.includes(tag)) {
    return false
  }

  // Check if element has substantial content
  const hasImages = element.querySelector("img") !== null
  const hasText = element.textContent && element.textContent.trim().length > 10
  const hasBackgroundImage = hasBackgroundImageStyle(element)

  // Element is meaningful if it has images, substantial text, or background image
  const isMeaningful = hasImages || hasText || hasBackgroundImage

  return isMeaningful
}

// Check if element has background image
function hasBackgroundImageStyle(element: HTMLElement): boolean {
  const style = window.getComputedStyle(element)
  const backgroundImage = style.backgroundImage
  return typeof backgroundImage === "string" && backgroundImage !== "none"
}

