/**
 * The enrichment queue: embeds and zero-shot tags pending captures, one at a
 * time, entirely on this machine.
 *
 * Captures are saved as `pending`. The worker keeps a Convex subscription to
 * the user's oldest pending captures and drains it: claim (only succeeds if
 * still pending, so two browsers never both run one) -> embed + tag -> write
 * results as `ready`. A failure goes back to `pending` once, retried after
 * RETRY_DELAY_MS, then ends as `failed` with its error; the dashboard can
 * re-queue it. A save also kicks the queue directly, so a sleeping
 * subscription never delays fresh work.
 */

import type { ConvexClient } from "convex/browser"
import type { FunctionReturnType } from "convex/server"
import { api } from "../../../../../packages/backend/convex/_generated/api"
import type { Id } from "../../../../../packages/backend/convex/_generated/dataModel"
// Static imports: see the note in save-image-capture.ts (MV3 importScripts).
import { classifyImage } from "./auto-tag"
import { embedImageFromUrl, embedText } from "./local-embeddings"
import { broadcastSessionState } from "./session-broadcast"

/** Wait before the automatic retry, so a transient failure can clear. */
export const RETRY_DELAY_MS = 8000
/** One analysis may not hold the queue longer (first run downloads the model). */
export const ANALYZE_TIMEOUT_MS = 3 * 60 * 1000
const PENDING_BATCH = 5

type Claim = FunctionReturnType<typeof api.local_ai.claimCapture>
export type ClaimedItem = NonNullable<Claim["item"]>

export type AnalysisResult = {
  localEmbedding?: number[]
  textEmbedding?: number[]
  aiCategory?: Awaited<ReturnType<typeof classifyImage>>["aiCategory"]
  aiStyle?: string[]
  aiTags?: string[]
}

export type QueueEvent =
  | { type: "done" | "failed" | "retry"; id: string }
  /** Nothing left to take right now (empty, or signed out). */
  | { type: "idle" }

/* ─── State ─────────────────────────────────────────────────────── */

let convexRef: ConvexClient | null = null
let isSignedIn: () => Promise<boolean> = async () => false
let unsubscribe: (() => void) | null = null
let pending: Array<{ id: Id<"captures">; kind: string }> = []
/** Captures waiting out their retry delay. */
const notBefore = new Map<string, number>()
let draining = false
let wakeTimer: ReturnType<typeof setTimeout> | null = null
const listeners = new Set<(e: QueueEvent) => void>()

export function onQueueEvent(fn: (e: QueueEvent) => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

function emit(e: QueueEvent) {
  for (const fn of listeners) {
    try {
      fn(e)
    } catch (err) {
      console.warn("[queue] listener failed:", err)
    }
  }
}

function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message
  return String(e ?? "Unknown error")
}

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${what} timed out after ${Math.round(ms / 1000)}s`)), ms)
    p.then(
      (v) => {
        clearTimeout(t)
        resolve(v)
      },
      (e) => {
        clearTimeout(t)
        reject(e)
      }
    )
  })
}

/* ─── Analysis ──────────────────────────────────────────────────── */

/**
 * Embed a claimed capture and, for images, tag it. Images embed their grid
 * thumbnail when there is one (the model sees 384px anyway); text, link and code
 * captures embed their text with the text encoder, into a separate index.
 */
export async function analyzeCapture(item: ClaimedItem): Promise<AnalysisResult> {
  if (item.visual) {
    const url = item.thumbUrl ?? item.imageUrl
    if (!url) throw new Error("No image to analyze")
    const vector = await embedImageFromUrl(url)
    if (!Array.isArray(vector) || vector.length === 0) throw new Error("Image embedding came back empty")
    const tags = await classifyImage(vector, { palette: item.palette, backgroundHexes: item.backgroundHexes })
    console.log(
      "[queue] tagged",
      item.id,
      tags.aiCategory,
      tags.aiStyle.join(","),
      tags.debug.category.map((s) => `${s.key}:${s.prob.toFixed(2)}`).join(" ")
    )
    return { localEmbedding: vector, aiCategory: tags.aiCategory, aiStyle: tags.aiStyle, aiTags: tags.aiTags }
  }
  if (!item.text) throw new Error("No text to analyze")
  const vector = await embedText(item.text)
  if (!Array.isArray(vector) || vector.length === 0) throw new Error("Text embedding came back empty")
  return { textEmbedding: vector }
}

/** Carry the model's labels into the capture's session aggregate, if it has one. */
async function mergeSessionTags(convex: ConvexClient, id: Id<"captures">, result: AnalysisResult) {
  const tags = [
    ...(result.aiCategory && result.aiCategory !== "other" ? [result.aiCategory] : []),
    ...(result.aiTags ?? []).slice(0, 5),
  ]
  if (!tags.length) return
  try {
    const merged = await convex.mutation(api.sessions.mergeCaptureTags, { captureId: id, tags })
    if (merged?.merged) void broadcastSessionState(convex)
  } catch (e) {
    console.warn("[queue] failed to merge session tags:", e)
  }
}

async function processOne(convex: ConvexClient, id: Id<"captures">): Promise<void> {
  let claim: Claim
  try {
    claim = await convex.mutation(api.local_ai.claimCapture, { id })
  } catch (e) {
    // Deleted, or no longer ours (account switch): nothing to do.
    console.warn("[queue] claim failed for", id, e)
    return
  }
  if (!claim.claimed || !claim.item || !claim.claim) return
  // Quoted back with the result, so a claim released meanwhile (stale, or
  // retried from the dashboard) cannot be overwritten by this worker.
  const token = claim.claim

  try {
    const result = await withTimeout(analyzeCapture(claim.item), ANALYZE_TIMEOUT_MS, "Analysis")
    const done = await convex.mutation(api.local_ai.completeProcessing, { id, claim: token, ...result })
    notBefore.delete(id)
    if (!done.ok) {
      console.warn("[queue] result for", id, "discarded:", done.reason)
      return
    }
    emit({ type: "done", id })
    await mergeSessionTags(convex, id, result)
  } catch (e) {
    const error = errorMessage(e)
    console.warn("[queue] analysis failed for", id, error)
    try {
      const res = await convex.mutation(api.local_ai.failProcessing, { id, claim: token, error })
      if (!res.ok) return // claim already released; its new owner decides
      if (res.retry) notBefore.set(id, Date.now() + RETRY_DELAY_MS)
      emit({ type: res.retry ? "retry" : "failed", id })
    } catch (e2) {
      // Left `processing`; the release claimCapture scheduled frees it later.
      console.warn("[queue] could not record the failure for", id, e2)
    }
  }
}

/* ─── Draining ──────────────────────────────────────────────────── */

/** Re-run the drain when the earliest delayed retry comes due. */
function scheduleWake() {
  if (wakeTimer) clearTimeout(wakeTimer)
  wakeTimer = null
  const due = pending.map((p) => notBefore.get(p.id)).filter((t): t is number => t !== undefined)
  if (!due.length) return
  wakeTimer = setTimeout(() => void drain(), Math.max(0, Math.min(...due) - Date.now()) + 50)
}

/**
 * Process pending captures until none is ready. Single-flight: a call while
 * draining returns at once, and the running loop sees the updated list.
 */
async function drain(): Promise<void> {
  const convex = convexRef
  if (!convex || draining) return
  draining = true
  let idle = false
  try {
    for (;;) {
      const now = Date.now()
      const next = pending.find((p) => (notBefore.get(p.id) ?? 0) <= now)
      if (!next) {
        scheduleWake()
        idle = pending.length === 0
        break
      }
      // Never process on behalf of nobody: a signed-out worker leaves the
      // queue alone, and the subscription restarts it after sign-in.
      if (!(await isSignedIn())) {
        idle = true
        break
      }
      pending = pending.filter((p) => p.id !== next.id)
      await processOne(convex, next.id)
    }
  } finally {
    draining = false
  }
  if (idle) emit({ type: "idle" })
}

/** Subscribe to the pending list unless already subscribed. */
function ensureSubscribed() {
  const convex = convexRef
  if (!convex || unsubscribe) return
  const unsub = convex.onUpdate(
    api.local_ai.listPendingCaptures,
    { limit: PENDING_BATCH },
    (res) => {
      pending = res?.items ?? []
      void drain()
    },
    (err) => {
      // Drop the dead subscription; the next kick or sign-in subscribes again.
      console.warn("[queue] pending subscription failed:", err)
      unsub()
      if (unsubscribe === stop) unsubscribe = null
    }
  )
  const stop = () => unsub()
  unsubscribe = stop
}

/**
 * Fetch the pending list now and drain it. Called after every save, so new
 * work does not wait for the subscription (which may be asleep with the worker).
 */
export async function kickProcessingQueue(): Promise<void> {
  const convex = convexRef
  if (!convex) return
  ensureSubscribed()
  try {
    if (await isSignedIn()) {
      const res = await convex.query(api.local_ai.listPendingCaptures, { limit: PENDING_BATCH })
      pending = res.items
    }
  } catch (e) {
    console.warn("[queue] could not fetch pending captures:", e)
  }
  void drain()
}

/**
 * Call when the user signs in (and at start): subscribe if needed, release
 * claims a killed worker left behind, and drain.
 */
export async function notifySignedIn(): Promise<void> {
  const convex = convexRef
  if (!convex) return
  ensureSubscribed()
  try {
    if (await isSignedIn()) {
      const { recovered } = await convex.mutation(api.local_ai.recoverStaleProcessing, {})
      if (recovered) console.log("[queue] released", recovered, "abandoned claim(s)")
    }
  } catch (e) {
    console.warn("[queue] stale-claim recovery failed:", e)
  }
  await kickProcessingQueue()
}

/**
 * Start the queue once per worker. Registers the client synchronously and
 * never depends on auth succeeding: signed out, it subscribes and waits, and
 * `notifySignedIn` (or the subscription itself, once auth changes) wakes it.
 */
export async function startProcessingQueue(
  convex: ConvexClient,
  opts: { isSignedIn: () => Promise<boolean> }
): Promise<void> {
  convexRef = convex
  isSignedIn = async () => {
    try {
      return await opts.isSignedIn()
    } catch (e) {
      console.warn("[queue] auth check failed:", e)
      return false
    }
  }
  await notifySignedIn()
}

/** True while nothing is being processed and nothing is waiting. */
export function isQueueIdle(): boolean {
  return !draining && pending.length === 0
}
