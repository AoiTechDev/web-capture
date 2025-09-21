import { captureElement } from "./capture-element";

let isSelecting = false;
let currentHoveredElement: HTMLElement | null = null;
let highlightOverlay: HTMLElement | null = null;
let tagNameOverlay: HTMLElement | null = null;
let tagNameContainer: HTMLElement | null = null;
function createHighlightOverlay() {
  if (highlightOverlay) return highlightOverlay;

  // Highlight overlay
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

  // Tag name overlay
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

function positionHighlightOverlay(element: HTMLElement) {
  if (!highlightOverlay || !tagNameOverlay || !tagNameContainer) return;

  const rect = element.getBoundingClientRect();
  const scrollX = window.pageXOffset || document.documentElement.scrollLeft;
  const scrollY = window.pageYOffset || document.documentElement.scrollTop;

  highlightOverlay.style.width = `${rect.width}px`;
  highlightOverlay.style.height = `${rect.height}px`;
  highlightOverlay.style.left = `${rect.left + scrollX}px`;
  highlightOverlay.style.top = `${rect.top + scrollY}px`;
  highlightOverlay.style.display = "block";

  // Set up tag name text
  tagNameOverlay.textContent = element.tagName;
  tagNameOverlay.style.display = "block";

  // Position tag name container (black background box) above the top edge
  const tagNameHeight = 20; // Height of the background box
  const tagNamePadding = 4; // Padding inside the box
  tagNameContainer.style.display = "flex";
  tagNameContainer.style.left = `${rect.left + scrollX}px`;
  tagNameContainer.style.top = `${rect.top + scrollY - tagNameHeight}px`;
  tagNameContainer.style.width = "100px";
  tagNameContainer.style.height = `20px`;
  tagNameContainer.style.padding = `3px 6px`;

  // Position tag name text inside the container
  tagNameOverlay.style.left = `${rect.left + scrollX + tagNamePadding}px`;
  tagNameOverlay.style.top = `${rect.top + scrollY - tagNameHeight + tagNamePadding}px`;
}

function hideHighlightOverlay() {
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

function outlineSelectedElement(event: MouseEvent) {
  if (!isSelecting) return;

  const hoveredElement = event.target as HTMLElement;

  if (
    currentHoveredElement === hoveredElement ||
    hoveredElement === highlightOverlay
  )
    return;

  createHighlightOverlay();

  positionHighlightOverlay(hoveredElement);
  currentHoveredElement = hoveredElement;
}

function removeOutlineSelectedElement(event: MouseEvent) {
  if (!isSelecting) return;

  const leftElement = event.target as HTMLElement;

  if (currentHoveredElement === leftElement) {
    hideHighlightOverlay();
    currentHoveredElement = null;
  }
}

async function handleElementClick(event: MouseEvent) {
  if (!isSelecting) return;

  event.preventDefault();
  event.stopPropagation();

  const elementData = captureElement(event.target as HTMLElement);
  console.log("🔍 Captured element data:", elementData);

  try {
    if (elementData.kind === "image") {
      await chrome.runtime.sendMessage({
        type: "SAVE_IMAGE_CAPTURE",
        data: elementData,
      });
    } else {
      await chrome.runtime.sendMessage({
        type: "SAVE_NON_IMAGE_CAPTURE",
        data: elementData,
      });
    }
  } catch (error) {
    console.error("❌ Failed to send message to background:", error);
  }
}

function addEventListeners() {
  document.addEventListener("mouseover", outlineSelectedElement, true);
  document.addEventListener("mouseout", removeOutlineSelectedElement, true);
  document.addEventListener("click", handleElementClick, true);
}

function removeEventListeners() {
  document.removeEventListener("mouseover", outlineSelectedElement, true);
  document.removeEventListener("mouseout", removeOutlineSelectedElement, true);
  document.removeEventListener("click", handleElementClick, true);

  hideHighlightOverlay();
  currentHoveredElement = null;
}

export function cleanup() {
  if (highlightOverlay && highlightOverlay.parentNode) {
    highlightOverlay.parentNode.removeChild(highlightOverlay);
    highlightOverlay = null;
  }
  if (tagNameOverlay && tagNameOverlay.parentNode) {
    tagNameOverlay.parentNode.removeChild(tagNameOverlay);
    tagNameOverlay = null;
  }
  if (tagNameContainer && tagNameContainer.parentNode) {
    tagNameContainer.parentNode.removeChild(tagNameContainer);
    tagNameContainer = null;
  }
}

export function toggleSelectionMode() {
  isSelecting = !isSelecting;
  if (isSelecting) {
    document.body.style.cursor = "crosshair";
    addEventListeners();
  } else {
    document.body.style.cursor = "default";
    removeEventListeners();
  }
}
