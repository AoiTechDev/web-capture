export function detectElementType(element: HTMLElement) {
  const bestElement = findBestElementToAnalyze(element)

  const imgElement = findImageInElement(bestElement)
  if (imgElement) {
    return {
      kind: "image" as const,
      src: imgElement.src,
      alt: imgElement.alt || undefined,
    }
  }

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

  if (
    element.classList.contains("code") ||
    element.closest("pre") ||
    element.tagName.toLowerCase() === "code"
  ) {
    return { kind: "code" as const, content: element.textContent ?? "" }
  }

  const codeElement = findCodeInElement(element)
  if (codeElement) {
    return { kind: "code" as const, content: codeElement.textContent ?? "" }
  }

  const text = element.textContent?.trim()
  if (text && text.length > 0) {
    return { kind: "text" as const, content: text }
  }

  return {
    kind: "element" as const,
    tagName: element.tagName.toLowerCase(),
    content: element.textContent ?? undefined,
  }
}

function findImageInElement(element: HTMLElement): HTMLImageElement | null {
  if (element.tagName.toLowerCase() === "img") {
    return element as HTMLImageElement
  }

  const computedStyle = window.getComputedStyle(element)
  const backgroundImage = computedStyle.backgroundImage
  if (backgroundImage && backgroundImage !== "none") {
    const urlMatch = backgroundImage.match(/url\(["']?([^"')]+)["']?\)/)
    if (urlMatch) {
      const img = document.createElement("img")
      img.src = urlMatch[1]
      return img
    }
  }

  
  const allImages = element.querySelectorAll("img")

  if (allImages.length > 0) {
    return allImages[0] as HTMLImageElement
  }

  const foundImage = searchForImagesRecursively(element)
  if (foundImage) {
    return foundImage
  }

  return null
}

function searchForImagesRecursively(
  element: HTMLElement,
  depth = 0
): HTMLImageElement | null {
  if (depth > 10) return null

  if (element.tagName.toLowerCase() === "img") {
    return element as HTMLImageElement
  }

  for (let i = 0; i < element.children.length; i++) {
    const child = element.children[i] as HTMLElement

    const found = searchForImagesRecursively(child, depth + 1)
    if (found) {
      return found
    }
  }

  return null
}

function findLinkInElement(element: HTMLElement): HTMLAnchorElement | null {
  if (element.tagName.toLowerCase() === "a") {
    return element as HTMLAnchorElement
  }

  const directLink = Array.from(element.children).find(
    (child) => child.tagName.toLowerCase() === "a"
  ) as HTMLAnchorElement

  if (directLink) {
    return directLink
  }

  const parentLink = element.closest("a")
  if (parentLink) {
    return parentLink as HTMLAnchorElement
  }

  return null
}

function findCodeInElement(element: HTMLElement): HTMLElement | null {
  if (
    element.classList.contains("code") ||
    element.tagName.toLowerCase() === "code"
  ) {
    return element
  }

  if (element.tagName.toLowerCase() === "pre") {
    return element
  }

  const codeElement = element.querySelector("code, pre")
  return codeElement as HTMLElement
}

function findBestElementToAnalyze(clickedElement: HTMLElement): HTMLElement {
  if (isMeaningfulElement(clickedElement)) {
    return clickedElement
  }

  let current = clickedElement.parentElement
  let level = 0

  while (current && level < 5) {
    if (isMeaningfulElement(current)) {
      return current
    }

    current = current.parentElement
    level++
  }

  return clickedElement
}

function isMeaningfulElement(element: HTMLElement): boolean {
  const tag = element.tagName.toLowerCase()

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

  const hasImages = element.querySelector("img") !== null
  const hasText = element.textContent && element.textContent.trim().length > 10
  const hasBackgroundImage = hasBackgroundImageStyle(element)

  const isMeaningful = hasImages || hasText || hasBackgroundImage

  return isMeaningful
}

function hasBackgroundImageStyle(element: HTMLElement): boolean {
  const style = window.getComputedStyle(element)
  const backgroundImage = style.backgroundImage
  return typeof backgroundImage === "string" && backgroundImage !== "none"
}

