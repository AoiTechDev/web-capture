import {
  applyButtonsRowStyles,
  applyInputStyles,
  applyOverlayStyles,
  applySuggestionsStyles,
  applyTitleStyles,
  styleButton,
  styleChip,
} from "./styles";

export type CategoryOverlayResult =
  | {
      kind: "confirm";
      category?: string;
    }
  | { kind: "cancel" };

export function showCategoryOverlay(fetchCategories: () => Promise<string[]>) {
  return new Promise<CategoryOverlayResult>((resolve) => {
    const overlay = document.createElement("div");
    applyOverlayStyles(overlay);

    const title = document.createElement("div");
    title.textContent = "Choose category";
    applyTitleStyles(title);
    overlay.appendChild(title);

    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = "Type or pick (Enter to confirm)";
    applyInputStyles(input);
    input.addEventListener(
      "keydown",
      (e) => {
        e.stopPropagation();
        if (e.key === "Enter") {
          const value = input.value.trim();
          cleanup();
          resolve({ kind: "confirm", category: value || undefined });
        }
        if (e.key === "Escape") {
          cleanup();
          resolve({ kind: "cancel" });
        }
      },
      true
    );
    overlay.appendChild(input);

    const suggestions = document.createElement("div");
    applySuggestionsStyles(suggestions);
    overlay.appendChild(suggestions);

    const buttons = document.createElement("div");
    applyButtonsRowStyles(buttons);

    const confirmBtn = document.createElement("button");
    confirmBtn.textContent = "Confirm";
    styleButton(confirmBtn, "#10b981");
    confirmBtn.addEventListener(
      "click",
      (e) => {
        e.stopPropagation();
        const value = input.value.trim();
        cleanup();
        resolve({ kind: "confirm", category: value || undefined });
      },
      false
    );

    const unsortedBtn = document.createElement("button");
    unsortedBtn.textContent = "Unsorted";
    styleButton(unsortedBtn, "#6b7280");
    unsortedBtn.addEventListener(
      "click",
      (e) => {
        e.stopPropagation();
        cleanup();
        resolve({ kind: "confirm", category: undefined });
      },
      false
    );

    const cancelBtn = document.createElement("button");
    cancelBtn.textContent = "Cancel";
    styleButton(cancelBtn, "#ef4444");
    cancelBtn.addEventListener(
      "click",
      (e) => {
        e.stopPropagation();
        cleanup();
        resolve({ kind: "cancel" });
      },
      false
    );

    buttons.appendChild(confirmBtn);
    buttons.appendChild(unsortedBtn);
    buttons.appendChild(cancelBtn);
    overlay.appendChild(buttons);

    overlay.addEventListener("click", (e) => e.stopPropagation(), false);
    overlay.addEventListener("mousedown", (e) => e.stopPropagation(), false);
    overlay.addEventListener("mouseup", (e) => e.stopPropagation(), false);
    overlay.addEventListener("pointerdown", (e) => e.stopPropagation(), false);
    overlay.addEventListener("pointerup", (e) => e.stopPropagation(), false);

    document.body.appendChild(overlay);

    void (async () => {
      try {
        const cats = await fetchCategories();
        for (const name of cats) {
          const chip = document.createElement("button");
          chip.textContent = name;
          styleChip(chip);
          chip.addEventListener(
            "click",
            (e) => {
              e.stopPropagation();
              input.value = name;
              input.focus();
            },
            false
          );
          suggestions.appendChild(chip);
        }
      } catch {
        // ignore
      }
    })();

    setTimeout(() => input.focus(), 0);

    function cleanup() {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    }
  });
}
