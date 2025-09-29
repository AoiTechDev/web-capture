import { captureElement } from "./capture-element";
import { showCategoryOverlay } from "./ui/categoryOverlay";
import {
  ensureHighlightOverlay,
  positionHighlightOverlay,
  hideHighlightOverlay,
  cleanupHighlight,
} from "./ui/highlight";

let isSelecting = false;
let categoryPromptEnabled = false;
let selectedCategory: string | undefined;
type PendingCapture =
  | {
      kind: "image";
      src: string;
      alt?: string;
      url: string;
      timestamp: number;
      width?: number;
      height?: number;
    }
  | { kind: "text"; content: string; url: string; timestamp: number }
  | {
      kind: "link";
      href: string;
      text?: string;
      url: string;
      timestamp: number;
    }
  | { kind: "code"; content: string; url: string; timestamp: number }
  | {
      kind: "element";
      tagName: string;
      content?: string;
      url: string;
      timestamp: number;
    };

let pendingElementData: PendingCapture | null = null;
let currentHoveredElement: HTMLElement | null = null;

async function getRecentCategories(): Promise<string[]> {
  try {
    const res = await chrome.storage.sync.get({
      recentCategories: [] as string[],
    });
    const arr = Array.isArray(res.recentCategories) ? res.recentCategories : [];
    return arr.slice(0, 8);
  } catch {
    return [];
  }
}

async function addRecentCategory(name: string) {
  try {
    const res = await chrome.storage.sync.get({
      recentCategories: [] as string[],
    });
    const arr: string[] = Array.isArray(res.recentCategories)
      ? res.recentCategories
      : [];
    const next = [name, ...arr.filter((c) => c !== name)].slice(0, 12);
    await chrome.storage.sync.set({ recentCategories: next });
  } catch {
    // ignore
  }
}

async function openCategoryOverlayAndHandlePending() {
  const categories = await (async () => {
    try {
      const res = await chrome.runtime.sendMessage({ type: "GET_CATEGORIES" });
      const list: Array<{ _id: string; name: string }> = Array.isArray(
        res?.categories
      )
        ? res.categories
        : [];
      if (list.length > 0) return list.map((c) => c.name);
    } catch {
      // ignore
    }
    // fallback to recents
    return await getRecentCategories();
  })();

  const result = await showCategoryOverlay(async () => categories);
  if (result.kind === "cancel") {
    selectedCategory = undefined;
    pendingElementData = null;
    categoryPromptEnabled = false;
    return;
  }
  const cat = result.category;
  selectedCategory = cat;
  if (cat) {
    void chrome.runtime
      .sendMessage({ type: "CREATE_CATEGORY", name: cat })
      .catch(() => {});
    void addRecentCategory(cat);
  }
  if (pendingElementData) {
    const toSend = pendingElementData;
    pendingElementData = null;
    const category = selectedCategory;
    selectedCategory = undefined;
    categoryPromptEnabled = false;
    try {
      if (toSend.kind === "image") {
        await chrome.runtime.sendMessage({
          type: "SAVE_IMAGE_CAPTURE",
          data: { ...toSend, category },
        });
      } else {
        await chrome.runtime.sendMessage({
          type: "SAVE_NON_IMAGE_CAPTURE",
          data: { ...toSend, category },
        });
      }
    } catch (e) {
      console.error("❌ Failed to send message after category selection:", e);
    }
  }
}

function outlineSelectedElement(event: MouseEvent) {
  if (!isSelecting) return;

  const hoveredElement = event.target as HTMLElement;

  if (currentHoveredElement === hoveredElement) return;

  ensureHighlightOverlay();

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

  if (categoryPromptEnabled && !selectedCategory) {
    pendingElementData = elementData;
    toggleSelectionInternal(false);
    void openCategoryOverlayAndHandlePending();
    return;
  }

  const category: string | undefined = categoryPromptEnabled
    ? selectedCategory
    : undefined;

  try {
    if (elementData.kind === "image") {
      await chrome.runtime.sendMessage({
        type: "SAVE_IMAGE_CAPTURE",
        data: { ...elementData, category },
      });
    } else {
      await chrome.runtime.sendMessage({
        type: "SAVE_NON_IMAGE_CAPTURE",
        data: { ...elementData, category },
      });
    }
  } catch (error) {
    console.error("❌ Failed to send message to background:", error);
  }

  selectedCategory = undefined;
  if (categoryPromptEnabled) {
    categoryPromptEnabled = false;
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
  cleanupHighlight();
}

function toggleSelectionInternal(nextSelecting: boolean) {
  isSelecting = nextSelecting;
  if (isSelecting) {
    document.body.style.cursor = "crosshair";
    addEventListeners();
  } else {
    document.body.style.cursor = "default";
    removeEventListeners();
    categoryPromptEnabled = false;
    selectedCategory = undefined;
  }
}

export function toggleSelectionMode(promptForCategory?: boolean) {
  if (typeof promptForCategory === "boolean") {
    categoryPromptEnabled = !!promptForCategory;
    toggleSelectionInternal(true);
  } else {
    toggleSelectionInternal(!isSelecting);
  }
}

export function setCategoryPromptEnabled(enabled: boolean) {
  categoryPromptEnabled = enabled;
}

// macOS-style region screenshot overlay
let regionOverlay: HTMLDivElement | null = null;
let selectionBox: HTMLDivElement | null = null;
let isDraggingRegion = false;
let startX = 0;
let startY = 0;

function destroyRegionOverlay() {
  if (regionOverlay && regionOverlay.parentNode) regionOverlay.parentNode.removeChild(regionOverlay);
  regionOverlay = null;
  selectionBox = null;
  // restore cursor
  document.body.style.cursor = "";
}

export function startScreenshotMode() {
  if (regionOverlay) return; // already active

  // Build overlay
  regionOverlay = document.createElement("div");
  regionOverlay.style.position = "fixed";
  regionOverlay.style.inset = "0";
  regionOverlay.style.zIndex = "9999999";
  regionOverlay.style.background = "rgba(0,0,0,0.25)";
  regionOverlay.style.cursor = "crosshair";

  selectionBox = document.createElement("div");
  selectionBox.style.position = "absolute";
  selectionBox.style.border = "2px solid #3b82f6";
  selectionBox.style.background = "rgba(59,130,246,0.2)";
  selectionBox.style.pointerEvents = "none";
  selectionBox.style.display = "none";
  regionOverlay.appendChild(selectionBox);

  // Prevent events to page beneath
  const stop = (e: Event) => e.stopPropagation();
  ["mousedown", "mousemove", "mouseup", "click", "dblclick", "contextmenu"].forEach((t) =>
    regionOverlay!.addEventListener(t, stop, true)
  );

  const onMouseDown = (e: MouseEvent) => {
    isDraggingRegion = true;
    startX = e.clientX;
    startY = e.clientY;
    if (selectionBox) {
      selectionBox.style.left = `${startX}px`;
      selectionBox.style.top = `${startY}px`;
      selectionBox.style.width = "0px";
      selectionBox.style.height = "0px";
      selectionBox.style.display = "block";
    }
  };

  const onMouseMove = (e: MouseEvent) => {
    if (!isDraggingRegion || !selectionBox) return;
    const currX = e.clientX;
    const currY = e.clientY;
    const x = Math.min(startX, currX);
    const y = Math.min(startY, currY);
    const w = Math.abs(currX - startX);
    const h = Math.abs(currY - startY);
    selectionBox.style.left = `${x}px`;
    selectionBox.style.top = `${y}px`;
    selectionBox.style.width = `${w}px`;
    selectionBox.style.height = `${h}px`;
  };

  const finishWithRect = async (x: number, y: number, w: number, h: number) => {
    // Use viewport-relative coordinates without adding scroll offsets
    const rx = Math.max(0, Math.min(Math.round(x), window.innerWidth));
    const ry = Math.max(0, Math.min(Math.round(y), window.innerHeight));
    const rw = Math.max(0, Math.min(Math.round(w), window.innerWidth - rx));
    const rh = Math.max(0, Math.min(Math.round(h), window.innerHeight - ry));
    const rect = {
      x: rx,
      y: ry,
      width: rw,
      height: rh,
      url: window.location.href,
      dpr: window.devicePixelRatio || 1,
    };
    // Ensure overlay removal is painted before capture: wait 2 RAFs
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    try {
      await chrome.runtime.sendMessage({ type: "SCREENSHOT_ELEMENT", rect });
    } catch (e) {
      console.error("❌ Failed to request region screenshot:", e);
    }
  };

  const onMouseUp = async (e: MouseEvent) => {
    const endX = e.clientX;
    const endY = e.clientY;
    const x = Math.min(startX, endX);
    const y = Math.min(startY, endY);
    const w = Math.abs(endX - startX);
    const h = Math.abs(endY - startY);
    isDraggingRegion = false;
    window.removeEventListener("keydown", onKeyDown, true);
    regionOverlay?.removeEventListener("mousedown", onMouseDown, true);
    regionOverlay?.removeEventListener("mousemove", onMouseMove, true);
    regionOverlay?.removeEventListener("mouseup", onMouseUp, true);
    destroyRegionOverlay();
    if (w > 2 && h > 2) await finishWithRect(x, y, w, h);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      isDraggingRegion = false;
      window.removeEventListener("keydown", onKeyDown, true);
      regionOverlay?.removeEventListener("mousedown", onMouseDown, true);
      regionOverlay?.removeEventListener("mousemove", onMouseMove, true);
      regionOverlay?.removeEventListener("mouseup", onMouseUp, true);
      destroyRegionOverlay();
    }
  };

  regionOverlay.addEventListener("mousedown", onMouseDown, true);
  regionOverlay.addEventListener("mousemove", onMouseMove, true);
  regionOverlay.addEventListener("mouseup", onMouseUp, true);
  window.addEventListener("keydown", onKeyDown, true);
  document.body.appendChild(regionOverlay);
}
