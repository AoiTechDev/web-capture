import { detectElementType } from "./detect-element-type"

export function captureElement(element: HTMLElement) {
  const variant = detectElementType(element)
  return {
    ...variant,
    url: window.location.href,
    timestamp: Date.now(),
  }
}

