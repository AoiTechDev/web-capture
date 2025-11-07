export function applyOverlayStyles(el: HTMLElement) {
  el.style.position = "fixed"
  el.style.top = "20px"
  el.style.right = "20px"
  el.style.zIndex = "1000000"
  el.style.background = "rgba(255, 255, 255, 0.06)"
  el.style.backdropFilter = "blur(8px)"
  el.style.color = "#ffffff"
  el.style.border = "1px solid #1b1c1d"
  el.style.borderRadius = "12px"
  el.style.padding = "12px"
  el.style.boxShadow = "0 8px 24px rgba(0,0,0,0.4)"
  el.style.minWidth = "280px"
  el.style.maxWidth = "360px"
  el.style.fontFamily =
    "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial"
}

export function applyTitleStyles(el: HTMLElement) {
  el.style.fontSize = "14px"
  el.style.fontWeight = "600"
  el.style.marginBottom = "8px"
  el.style.color = "#e5e7eb"
}

export function applyInputStyles(input: HTMLInputElement) {
  input.style.width = "100%"
  input.style.padding = "8px 10px"
  input.style.border = "1px solid #1b1c1d"
  input.style.borderRadius = "10px"
  input.style.background = "#0f1011"
  input.style.color = "#ffffff"
  input.style.outline = "none"
  input.style.boxShadow = "none"
  input.addEventListener("focus", () => {
    input.style.borderColor = "#00D9FF"
    input.style.boxShadow = "0 0 0 3px rgba(0, 217, 255, 0.25)"
  })
  input.addEventListener("blur", () => {
    input.style.borderColor = "#1b1c1d"
    input.style.boxShadow = "none"
  })
}

export function applyButtonsRowStyles(container: HTMLElement) {
  container.style.display = "flex"
  container.style.gap = "8px"
  container.style.marginTop = "10px"
}

export function styleButton(btn: HTMLButtonElement, background: string) {
  btn.style.background = background
  btn.style.color = "white"
  btn.style.border = "1px solid rgba(255, 255, 255, 0.08)"
  btn.style.borderRadius = "10px"
  btn.style.padding = "8px 10px"
  btn.style.cursor = "pointer"
  btn.style.transition = "filter 120ms ease, box-shadow 120ms ease, transform 120ms ease"
  btn.onmouseenter = () => {
    btn.style.filter = "brightness(1.05)"
  }
  btn.onmouseleave = () => {
    btn.style.filter = "none"
  }
  btn.onfocus = () => {
    btn.style.boxShadow = "0 0 0 3px rgba(0, 217, 255, 0.25)"
  }
  btn.onblur = () => {
    btn.style.boxShadow = "none"
  }
}

export function styleChip(btn: HTMLButtonElement) {
  btn.style.background = "#151617"
  btn.style.color = "#e5e7eb"
  btn.style.border = "1px solid #2a2b2d"
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

