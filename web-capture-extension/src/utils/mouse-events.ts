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
