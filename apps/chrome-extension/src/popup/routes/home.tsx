import { useState } from "react"

import { SessionPanel } from "~popup/components/session-panel"

const SHORTCUTS: [string, string][] = [
  ["Ctrl+Shift+S", "Pick an element to save"],
  ["↑ ↓ Enter", "While picking: parent, child, save"],
  ["Ctrl+Shift+F", "Pick an image to save (original file)"],
  ["Ctrl+Shift+E", "Screenshot a region"],
  ["Ctrl+Shift+X", "Save selected text"],
  ["Ctrl+Shift+L", "Save this page as a link"],
  ["Ctrl+Shift+K", "Search your captures"],
  ["Ctrl+Shift+G", "Start / finish a session"],
]

/**
 * Ask the active tab's content script to save everything visible. The page
 * does the capture (and shows the result) so the popup can close right away;
 * pages without a content script (chrome://, the web store) cannot be saved.
 */
function useSaveVisiblePage() {
  const [error, setError] = useState<string | null>(null)
  const save = async () => {
    setError(null)
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (!tab?.id) throw new Error("No active tab")
      await chrome.tabs.sendMessage(tab.id, { type: "CAPTURE_VIEWPORT" })
      // Close first so the popup is gone before the page is screenshotted.
      window.close()
    } catch {
      setError("This page can't be captured. Try reloading it.")
    }
  }
  return { save, error }
}

export const Home = () => {
  const { save, error } = useSaveVisiblePage()
  return (
    <div className="plasmo-flex plasmo-flex-col plasmo-h-full plasmo-bg-black plasmo-text-white plasmo-p-5 plasmo-gap-5 plasmo-overflow-y-auto">
      <SessionPanel />

      <div>
        <button
          onClick={() => void save()}
          className="plasmo-w-full plasmo-text-xs plasmo-border plasmo-border-neutral-700 plasmo-rounded plasmo-py-1.5 plasmo-text-neutral-300 hover:plasmo-bg-neutral-800 hover:plasmo-text-white plasmo-transition-colors"
        >
          Save visible page
        </button>
        {error && (
          <p className="plasmo-text-xs plasmo-text-red-400 plasmo-mt-2 plasmo-break-words">{error}</p>
        )}
      </div>

      <div>
        <h2 className="plasmo-text-xs plasmo-uppercase plasmo-tracking-wide plasmo-text-neutral-500 plasmo-mb-2">
          Shortcuts
        </h2>
        <ul className="plasmo-space-y-1.5">
          {SHORTCUTS.map(([keys, label]) => (
            <li key={keys} className="plasmo-flex plasmo-items-center plasmo-gap-3">
              <kbd className="plasmo-text-[10px] plasmo-bg-neutral-900 plasmo-border plasmo-border-neutral-700 plasmo-rounded plasmo-px-1.5 plasmo-py-0.5 plasmo-shrink-0">
                {keys}
              </kbd>
              <span className="plasmo-text-xs plasmo-text-neutral-400">{label}</span>
            </li>
          ))}
        </ul>
      </div>

      <p className="plasmo-text-[11px] plasmo-text-neutral-600 plasmo-mt-auto">
        With a session running, everything you capture joins it. Otherwise
        captures go to All Captures.
      </p>
    </div>
  )
}
