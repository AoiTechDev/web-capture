import { SessionPanel } from "~popup/components/session-panel"

const SHORTCUTS: [string, string][] = [
  ["Ctrl+Shift+S", "Pick an element to save"],
  ["Ctrl+Shift+E", "Screenshot a region"],
  ["Ctrl+Shift+X", "Save selected text"],
  ["Ctrl+Shift+L", "Save this page as a link"],
  ["Ctrl+Shift+K", "Search your captures"],
  ["Ctrl+Shift+G", "Start / finish a session"],
]

export const Home = () => {
  return (
    <div className="plasmo-flex plasmo-flex-col plasmo-h-full plasmo-bg-black plasmo-text-white plasmo-p-5 plasmo-gap-5 plasmo-overflow-y-auto">
      <SessionPanel />

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
