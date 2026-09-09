/**
 * Floating "recording" indicator, injected into every page.
 *
 * Explicit sessions trade away the automatic model's convenience for
 * predictability, and that trade only pays off if the state is visible. A
 * session with no on-screen presence is worse than no session at all: you
 * cannot tell whether the thing you just saved was filed or not, and a session
 * left running for days silently swallows everything.
 *
 * So the indicator lives in the page, not the popup, because the page is where
 * you actually are when you capture.
 */

const HOST_ID = "__web_capture_session_indicator__"

let host: HTMLDivElement | null = null
let shadow: ShadowRoot | null = null
let labelEl: HTMLSpanElement | null = null
let countEl: HTMLSpanElement | null = null

export type IndicatorState = {
  running: boolean
  name?: string | null
  itemCount?: number
}

const STYLES = `
  :host { all: initial; }

  .wrap {
    position: fixed;
    left: 16px;
    bottom: 16px;
    z-index: 2147483646;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px 8px 10px;
    border-radius: 999px;
    background: rgba(9, 9, 11, 0.92);
    border: 1px solid rgba(52, 211, 153, 0.35);
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.45);
    color: #fafafa;
    font: 500 12px/1.2 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    backdrop-filter: blur(8px);
    cursor: default;
    user-select: none;
    /* Animate in so it registers as a state change, not page furniture. */
    animation: wc-in 220ms cubic-bezier(0.16, 1, 0.3, 1);
    max-width: 260px;
  }

  /* Fades to unobtrusive once seen, back to full on hover. */
  .wrap { opacity: 0.55; transition: opacity 160ms ease; }
  .wrap:hover { opacity: 1; }

  @keyframes wc-in {
    from { transform: translateY(8px); opacity: 0; }
    to   { transform: translateY(0); opacity: 0.55; }
  }

  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #34d399;
    flex: none;
    animation: wc-pulse 1.8s ease-in-out infinite;
  }

  @keyframes wc-pulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50%      { opacity: 0.45; transform: scale(0.82); }
  }

  .label {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .count {
    flex: none;
    font-size: 11px;
    color: #a1a1aa;
    padding-left: 6px;
    border-left: 1px solid rgba(255, 255, 255, 0.12);
  }

  @media (prefers-reduced-motion: reduce) {
    .wrap { animation: none; }
    .dot { animation: none; }
  }
`

function build() {
  if (host) return

  host = document.createElement("div")
  host.id = HOST_ID
  // Shadow DOM so no host page's CSS can restyle or hide it, and so nothing
  // we inject leaks into the page.
  shadow = host.attachShadow({ mode: "closed" })

  const style = document.createElement("style")
  style.textContent = STYLES

  const wrap = document.createElement("div")
  wrap.className = "wrap"

  const dot = document.createElement("span")
  dot.className = "dot"

  labelEl = document.createElement("span")
  labelEl.className = "label"

  countEl = document.createElement("span")
  countEl.className = "count"

  wrap.append(dot, labelEl, countEl)
  shadow.append(style, wrap)

  document.documentElement.appendChild(host)
}

export function showIndicator(state: IndicatorState) {
  if (!state.running) {
    hideIndicator()
    return
  }

  build()
  if (labelEl) labelEl.textContent = state.name?.trim() || "Recording session"
  if (countEl) {
    const n = state.itemCount ?? 0
    countEl.textContent = `${n}`
    countEl.style.display = n > 0 ? "" : "none"
  }
}

export function hideIndicator() {
  host?.remove()
  host = null
  shadow = null
  labelEl = null
  countEl = null
}

export function isIndicatorVisible(): boolean {
  return !!host
}
