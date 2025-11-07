import {
  applyButtonsRowStyles,
  applyInputStyles,
  applyOverlayStyles,
  applySuggestionsStyles,
  applyTitleStyles,
  styleButton,
  styleChip,
} from "~contents/components/overlay-styles"

export type CategoryOverlayResult =
  | {
      kind: "confirm"
      category?: string
      tags?: string[]
    }
  | { kind: "cancel" }

export function showCategoryOverlay(
  fetchCategories: () => Promise<string[]>,
  fetchTags?: () => Promise<string[]>
) {
  return new Promise<CategoryOverlayResult>((resolve) => {
    const overlay = document.createElement("div")
    applyOverlayStyles(overlay)

    const title = document.createElement("div")
    title.textContent = "Choose category"
    applyTitleStyles(title)
    overlay.appendChild(title)

    const input = document.createElement("input")
    input.type = "text"
    input.placeholder = "Category (Enter to confirm)"
    applyInputStyles(input)
    input.addEventListener(
      "keydown",
      (e) => {
        e.stopPropagation()
        if (e.key === "Enter") {
          const value = input.value.trim()
          const tags = collectTags()
          cleanup()
          resolve({ kind: "confirm", category: value || undefined, tags })
        }
        if (e.key === "Escape") {
          cleanup()
          resolve({ kind: "cancel" })
        }
      },
      true
    )
    overlay.appendChild(input)

    const tagsInput = document.createElement("input")
    tagsInput.type = "text"
    tagsInput.placeholder = "Tags (comma or Enter to add)"
    applyInputStyles(tagsInput)
    tagsInput.style.marginTop = "8px"
    overlay.appendChild(tagsInput)

    const tagChips = document.createElement("div")
    applySuggestionsStyles(tagChips)
    overlay.appendChild(tagChips)

    const recentTagsRow = document.createElement("div")
    applySuggestionsStyles(recentTagsRow)
    overlay.appendChild(recentTagsRow)


    const suggestions = document.createElement("div")
    applySuggestionsStyles(suggestions)
    overlay.appendChild(suggestions)

    const buttons = document.createElement("div")
    applyButtonsRowStyles(buttons)

    const confirmBtn = document.createElement("button")
    confirmBtn.textContent = "Confirm"
    styleButton(confirmBtn, "#00FF94")
    confirmBtn.addEventListener(
      "click",
      (e) => {
        e.stopPropagation()
        const value = input.value.trim()
        const tags = collectTags()
        cleanup()
        resolve({ kind: "confirm", category: value || undefined, tags })
      },
      false
    )

    const unsortedBtn = document.createElement("button")
    unsortedBtn.textContent = "Unsorted"
    styleButton(unsortedBtn, "#2a2b2d")
    unsortedBtn.addEventListener(
      "click",
      (e) => {
        e.stopPropagation()
        cleanup()
        const tags = collectTags()
        resolve({ kind: "confirm", category: undefined, tags })
      },
      false
    )

    const cancelBtn = document.createElement("button")
    cancelBtn.textContent = "Cancel"
    styleButton(cancelBtn, "#ef4444")
    cancelBtn.addEventListener(
      "click",
      (e) => {
        e.stopPropagation()
        cleanup()
        resolve({ kind: "cancel" })
      },
      false
    )

    buttons.appendChild(confirmBtn)
    buttons.appendChild(unsortedBtn)
    buttons.appendChild(cancelBtn)
    overlay.appendChild(buttons)

    overlay.addEventListener("click", (e) => e.stopPropagation(), false)
    overlay.addEventListener("mousedown", (e) => e.stopPropagation(), false)
    overlay.addEventListener("mouseup", (e) => e.stopPropagation(), false)
    overlay.addEventListener("pointerdown", (e) => e.stopPropagation(), false)
    overlay.addEventListener("pointerup", (e) => e.stopPropagation(), false)

    document.body.appendChild(overlay)

    void (async () => {
      try {
        const cats = await fetchCategories()
        for (const name of cats) {
          const chip = document.createElement("button")
          chip.textContent = name
          styleChip(chip)
          chip.addEventListener(
            "click",
            (e) => {
              e.stopPropagation()
              input.value = name
              input.focus()
            },
            false
          )
          suggestions.appendChild(chip)
        }
        if (fetchTags) {
          const tags = await fetchTags()
          for (const tag of tags) {
            const chip = document.createElement("button")
            chip.textContent = tag
            styleChip(chip)
            chip.addEventListener(
              "click",
              (e) => {
                e.stopPropagation()
                addTag(tag)
                tagsInput.focus()
              },
              false
            )
            recentTagsRow.appendChild(chip)
          }
        }
      } catch {
        // ignore
      }
    })()

    setTimeout(() => input.focus(), 0)

    function cleanup() {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay)
    }

    function addTag(name: string) {
      const normalized = name.trim().toLowerCase()
      if (!normalized) return
      const exists = Array.from(tagChips.children).some(
        (c) => (c as HTMLButtonElement).dataset["tag"] === normalized
      )
      if (exists) return
      const chip = document.createElement("button")
      chip.textContent = normalized + " ×"
      chip.dataset["tag"] = normalized
      styleChip(chip)
      chip.addEventListener("click", (e) => {
        e.stopPropagation()
        tagChips.removeChild(chip)
      })
      tagChips.appendChild(chip)
    }

    function collectTags(): string[] {
      return Array.from(tagChips.children).map((c) => (c as HTMLButtonElement).dataset["tag"] as string)
    }

    function parseTagsFromInput() {
      const raw = tagsInput.value
      const parts = raw.split(/[,\n]/g).map((p) => p.trim()).filter(Boolean)
      for (const p of parts) addTag(p)
      tagsInput.value = ""
    }

    tagsInput.addEventListener("keydown", (e) => {
      e.stopPropagation()
      if (e.key === "Enter" || e.key === ",") {
        e.preventDefault()
        parseTagsFromInput()
      }
      if (e.key === "Backspace" && tagsInput.value === "") {
        const last = tagChips.lastElementChild
        if (last) tagChips.removeChild(last)
      }
      if (e.key === "Escape") {
        cleanup()
        resolve({ kind: "cancel" })
      }
    }, true)
  })
}

