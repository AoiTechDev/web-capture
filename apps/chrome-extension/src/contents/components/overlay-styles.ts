export function applyOverlayStyles(el: HTMLElement) {
  el.style.position = "fixed"
  el.style.top = "20px"
  el.style.right = "20px"
  el.style.zIndex = "1000000"
  el.style.background = "#111827" 
  el.style.color = "#e5e7eb" 
  el.style.border = "1px solid #374151" 
  el.style.borderRadius = "10px"
  el.style.padding = "12px"
  el.style.boxShadow = "0 10px 30px rgba(0,0,0,0.35)"
  el.style.minWidth = "280px"
  el.style.maxWidth = "360px"
  el.style.fontFamily =
    "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial"
}

export function applyTitleStyles(el: HTMLElement) {
  el.style.fontSize = "14px"
  el.style.fontWeight = "600"
  el.style.marginBottom = "8px"
}

export function applyInputStyles(input: HTMLInputElement) {
  input.style.width = "100%"
  input.style.padding = "8px 10px"
  input.style.border = "1px solid #4b5563"
  input.style.borderRadius = "8px"
  input.style.background = "#1f2937"
  input.style.color = "#f3f4f6"
  input.style.outline = "none"
}

export function applyButtonsRowStyles(container: HTMLElement) {
  container.style.display = "flex"
  container.style.gap = "8px"
  container.style.marginTop = "10px"
}

export function styleButton(btn: HTMLButtonElement, background: string) {
  btn.style.background = background
  btn.style.color = "white"
  btn.style.border = "none"
  btn.style.borderRadius = "8px"
  btn.style.padding = "8px 10px"
  btn.style.cursor = "pointer"
}

export function styleChip(btn: HTMLButtonElement) {
  btn.style.background = "#1f2937"
  btn.style.color = "#e5e7eb"
  btn.style.border = "1px solid #374151"
  btn.style.borderRadius = "9999px"
  btn.style.padding = "6px 10px"
  btn.style.cursor = "pointer"
  btn.style.fontSize = "12px"
}

export function applySuggestionsStyles(container: HTMLElement) {
  container.style.display = "flex"
  container.style.flexWrap = "wrap"
  container.style.gap = "6px"
  container.style.marginTop = "10px"
}

