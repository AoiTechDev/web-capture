import { useEffect, useRef, useState } from "react"

type Session = {
  id: string
  name: string | null
  autoName: string | null
  displayName: string
  startedAt: number
  lastCaptureAt: number
  itemCount: number
  domains: string[]
  tags: string[]
}

function elapsed(ms: number): string {
  const mins = Math.max(0, Math.round((Date.now() - ms) / 60000))
  if (mins < 1) return "just started"
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  const rest = mins % 60
  if (hours < 24) return rest ? `${hours}h ${rest}m` : `${hours}h`
  return `${Math.round(hours / 24)}d`
}

/**
 * Start/stop control for the current session.
 *
 * Sessions are explicit: nothing is grouped unless the user says so. The panel
 * always states plainly where the next capture will land, because the whole
 * point of choosing explicit over inferred grouping is that you never have to
 * guess.
 */
export const SessionPanel = () => {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [starting, setStarting] = useState(false)
  const [draft, setDraft] = useState("")
  const [editing, setEditing] = useState(false)
  // Surfaced in the panel rather than only the service worker console: a
  // silent no-op button is the least debuggable thing a UI can do.
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const load = () => {
    chrome.runtime.sendMessage({ type: "SESSION_STATUS" }, (r) => {
      setLoading(false)
      if (chrome.runtime.lastError || !r) return
      setSession(r.session ?? null)
    })
  }

  useEffect(load, [])

  useEffect(() => {
    if (starting || editing) inputRef.current?.focus()
  }, [starting, editing])

  const start = (name: string) => {
    setStarting(false)
    setDraft("")
    setError(null)
    chrome.runtime.sendMessage({ type: "SESSION_START", name }, (r) => {
      if (chrome.runtime.lastError) {
        setError(chrome.runtime.lastError.message ?? "No response from background")
        return
      }
      if (!r?.ok) {
        setError(r?.error ?? "Could not start session")
        return
      }
      load()
    })
  }

  const finish = () => {
    setSession(null)
    chrome.runtime.sendMessage({ type: "SESSION_END" }, () => load())
  }

  const rename = () => {
    if (!session) return
    const name = draft.trim()
    setEditing(false)
    setSession({
      ...session,
      name: name || null,
      displayName: name || session.autoName || "Untitled session",
    })
    chrome.runtime.sendMessage({ type: "SESSION_RENAME", id: session.id, name }, () => load())
  }

  if (loading) {
    return (
      <div className="plasmo-text-xs plasmo-text-neutral-500 plasmo-p-4">Checking…</div>
    )
  }

  /* ── Nothing running ───────────────────────────────────────────── */
  if (!session) {
    return (
      <div className="plasmo-border plasmo-border-neutral-800 plasmo-rounded-lg plasmo-p-4">
        <p className="plasmo-text-sm plasmo-font-medium plasmo-mb-1">No session running</p>
        <p className="plasmo-text-xs plasmo-text-neutral-400 plasmo-mb-3">
          Captures go straight to All Captures. Start a session to group
          everything you save into one place.
        </p>

        {error && (
          <p className="plasmo-text-xs plasmo-text-red-400 plasmo-mb-3 plasmo-break-words">
            {error}
          </p>
        )}

        {starting ? (
          <div className="plasmo-flex plasmo-gap-2">
            <input
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") start(draft)
                if (e.key === "Escape") setStarting(false)
              }}
              placeholder="Name it (optional)"
              className="plasmo-flex-1 plasmo-min-w-0 plasmo-bg-transparent plasmo-border plasmo-border-neutral-700 plasmo-rounded plasmo-px-2 plasmo-py-1 plasmo-text-xs plasmo-outline-none focus:plasmo-border-neutral-500"
            />
            <button
              onClick={() => start(draft)}
              className="plasmo-text-xs plasmo-bg-white plasmo-text-black plasmo-rounded plasmo-px-3 plasmo-py-1 plasmo-font-medium"
            >
              Start
            </button>
          </div>
        ) : (
          <button
            onClick={() => setStarting(true)}
            className="plasmo-w-full plasmo-text-xs plasmo-bg-white plasmo-text-black plasmo-rounded plasmo-py-1.5 plasmo-font-medium hover:plasmo-bg-neutral-200"
          >
            Start a session
          </button>
        )}
      </div>
    )
  }

  /* ── Running ───────────────────────────────────────────────────── */
  return (
    <div className="plasmo-border plasmo-border-emerald-900/60 plasmo-bg-emerald-950/20 plasmo-rounded-lg plasmo-p-4">
      <div className="plasmo-flex plasmo-items-start plasmo-justify-between plasmo-gap-2 plasmo-mb-2">
        <div className="plasmo-min-w-0 plasmo-flex-1">
          {editing ? (
            <input
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={rename}
              onKeyDown={(e) => {
                if (e.key === "Enter") rename()
                if (e.key === "Escape") setEditing(false)
              }}
              placeholder={session.autoName ?? "Name this session"}
              className="plasmo-w-full plasmo-bg-transparent plasmo-border-b plasmo-border-neutral-600 plasmo-text-sm plasmo-outline-none plasmo-pb-0.5"
            />
          ) : (
            <button
              onClick={() => {
                setDraft(session.name ?? "")
                setEditing(true)
              }}
              title="Rename"
              className="plasmo-text-sm plasmo-font-medium plasmo-text-left plasmo-truncate plasmo-w-full hover:plasmo-underline"
            >
              {session.displayName}
            </button>
          )}
          <p className="plasmo-text-xs plasmo-text-neutral-400 plasmo-mt-1">
            {session.itemCount} item{session.itemCount === 1 ? "" : "s"} ·{" "}
            {elapsed(session.startedAt)}
          </p>
        </div>

        <span className="plasmo-shrink-0 plasmo-flex plasmo-items-center plasmo-gap-1 plasmo-text-[10px] plasmo-uppercase plasmo-tracking-wide plasmo-text-emerald-400">
          <span className="plasmo-w-1.5 plasmo-h-1.5 plasmo-rounded-full plasmo-bg-emerald-400" />
          Recording
        </span>
      </div>

      {session.tags.length > 0 && (
        <div className="plasmo-flex plasmo-flex-wrap plasmo-gap-1 plasmo-mt-3">
          {session.tags.slice(0, 6).map((tag) => (
            <span
              key={tag}
              className="plasmo-text-[10px] plasmo-bg-neutral-800 plasmo-text-neutral-300 plasmo-rounded plasmo-px-1.5 plasmo-py-0.5"
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      <button
        onClick={finish}
        className="plasmo-mt-4 plasmo-w-full plasmo-text-xs plasmo-border plasmo-border-neutral-700 plasmo-rounded plasmo-py-1.5 plasmo-text-neutral-300 hover:plasmo-bg-neutral-800 hover:plasmo-text-white plasmo-transition-colors"
      >
        Finish session
      </button>
    </div>
  )
}
