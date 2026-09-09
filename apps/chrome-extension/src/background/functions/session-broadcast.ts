import type { ConvexClient } from "convex/browser"
import { api } from "../../../../../packages/backend/convex/_generated/api"

/**
 * Push current session state to every tab's content script.
 *
 * Lives in its own module so the capture handlers can call it without importing
 * the background entrypoint, which imports them.
 *
 * The indicator cannot poll for changes - that would cost a message per tab per
 * interval - so state is pushed whenever it actually changes: on start, finish,
 * rename, and after each capture joins the session.
 */
export async function broadcastSessionState(convex: ConvexClient): Promise<void> {
  let state: { running: boolean; name?: string | null; itemCount?: number } = {
    running: false,
  }

  try {
    const session = await convex.query((api as any).sessions.getActiveSession, {})
    state = session
      ? { running: true, name: session.displayName, itemCount: session.itemCount }
      : { running: false }
  } catch (e) {
    console.warn("[Session] could not read state for broadcast:", e)
    return
  }

  const tabs = await chrome.tabs.query({})
  await Promise.all(
    tabs.map((tab) =>
      tab.id
        ? chrome.tabs
            .sendMessage(tab.id, { type: "SESSION_STATE", state })
            // Tabs with no content script (chrome://, the web store, PDF viewer)
            // have no receiver. Expected, not worth surfacing.
            .catch(() => {})
        : Promise.resolve()
    )
  )
}
