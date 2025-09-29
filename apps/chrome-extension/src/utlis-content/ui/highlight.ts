let highlightOverlay: HTMLElement | null = null;
let tagNameOverlay: HTMLElement | null = null;
let tagNameContainer: HTMLElement | null = null;

export function getHighlightOverlay(): HTMLElement | null {
  return highlightOverlay;
}

export function ensureHighlightOverlay(): HTMLElement {
  if (highlightOverlay) return highlightOverlay;

  highlightOverlay = document.createElement("div");
  highlightOverlay.style.position = "absolute";
  highlightOverlay.style.backgroundColor = "rgba(59, 130, 246, 0.3)";
  highlightOverlay.style.border = "2px solid #3b82f6";
  highlightOverlay.style.borderRadius = "4px";
  highlightOverlay.style.pointerEvents = "none";
  highlightOverlay.style.zIndex = "999999";
  highlightOverlay.style.transition = "all 0.1s ease-out";
  highlightOverlay.style.display = "none";
  highlightOverlay.style.boxShadow = "0 0 0 1px rgba(59, 130, 246, 0.5)";

  tagNameOverlay = document.createElement("p");
  tagNameOverlay.style.position = "absolute";
  tagNameOverlay.style.color = "white";
  tagNameOverlay.style.fontSize = "12px";
  tagNameOverlay.style.fontWeight = "bold";
  tagNameOverlay.style.margin = "0";
  tagNameOverlay.style.padding = "0";
  tagNameOverlay.style.zIndex = "999999";
  tagNameOverlay.style.transition = "all 0.1s ease-out";
  tagNameOverlay.style.display = "none";

  tagNameContainer = document.createElement("div");
  tagNameContainer.style.position = "absolute";
  tagNameContainer.style.backgroundColor = "rgba(0, 0, 0, 0.8)";
  tagNameContainer.style.borderRadius = "4px";
  tagNameContainer.style.pointerEvents = "none";
  tagNameContainer.style.zIndex = "999999";
  tagNameContainer.style.transition = "all 0.1s ease-out";
  tagNameContainer.style.display = "none";

  document.body.appendChild(highlightOverlay);
  document.body.appendChild(tagNameContainer);
  document.body.appendChild(tagNameOverlay);
  return highlightOverlay;
}

export function positionHighlightOverlay(element: HTMLElement) {
  if (!highlightOverlay || !tagNameOverlay || !tagNameContainer) return;

  const rect = element.getBoundingClientRect();
  const scrollX = window.pageXOffset || document.documentElement.scrollLeft;
  const scrollY = window.pageYOffset || document.documentElement.scrollTop;

  highlightOverlay.style.width = `${rect.width}px`;
  highlightOverlay.style.height = `${rect.height}px`;
  highlightOverlay.style.left = `${rect.left + scrollX}px`;
  highlightOverlay.style.top = `${rect.top + scrollY}px`;
  highlightOverlay.style.display = "block";

  tagNameOverlay.textContent = element.tagName;
  tagNameOverlay.style.display = "block";

  const tagNameHeight = 20;
  const tagNamePadding = 4;
  tagNameContainer.style.display = "flex";
  tagNameContainer.style.left = `${rect.left + scrollX}px`;
  tagNameContainer.style.top = `${rect.top + scrollY - tagNameHeight}px`;
  tagNameContainer.style.width = "100px";
  tagNameContainer.style.height = `20px`;
  tagNameContainer.style.padding = `3px 6px`;

  tagNameOverlay.style.left = `${rect.left + scrollX + tagNamePadding}px`;
  tagNameOverlay.style.top = `${rect.top + scrollY - tagNameHeight + tagNamePadding}px`;
}

export function hideHighlightOverlay() {
  if (highlightOverlay) {
    highlightOverlay.style.display = "none";
  }
  if (tagNameOverlay) {
    tagNameOverlay.style.display = "none";
  }
  if (tagNameContainer) {
    tagNameContainer.style.display = "none";
  }
}

export function cleanupHighlight() {
  if (highlightOverlay && highlightOverlay.parentNode) {
    highlightOverlay.parentNode.removeChild(highlightOverlay);
  }
  if (tagNameOverlay && tagNameOverlay.parentNode) {
    tagNameOverlay.parentNode.removeChild(tagNameOverlay);
  }
  if (tagNameContainer && tagNameContainer.parentNode) {
    tagNameContainer.parentNode.removeChild(tagNameContainer);
  }
  highlightOverlay = null;
  tagNameOverlay = null;
  tagNameContainer = null;
}
