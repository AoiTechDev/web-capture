import { detectElementType } from "./detect-element-type";

export function captureElement(element: HTMLElement) {
  const variant = detectElementType(element); // e.g. { kind: "image", src, alt }
  return {
    ...variant,                     // puts kind + variant fields at top level
    url: window.location.href,
    timestamp: Date.now(),
  };
}