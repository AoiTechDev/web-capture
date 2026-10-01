/**
 * Messages from web pages (`externally_connectable`): the dashboard asks the
 * extension to embed a search query with the local model, so it never has to
 * load a model of its own.
 *
 * The surface is deliberately tiny: one message type, from one origin, with a
 * capped query, answered with nothing but the vector. No auth data, captures
 * or Convex access is reachable from here. A page cannot tie up the model
 * either: `createExternalEmbedder` runs one query at a time, keeps at most one
 * waiting (latest wins) and answers repeats from a small cache.
 *
 * Pure apart from the injected `embed` (and the embedder's own queue and
 * cache), for tests.
 */

import {
  EMBED_QUERY_MAX_CHARS,
  imageQueryText,
  LOCAL_EMBEDDING_DIM,
} from "../../../../../packages/backend/convex/lib/ai_config"

export const EMBED_QUERY = "EMBED_QUERY"

/** Who may send external messages: parsed from the configured sync host. */
export type AllowedHost = { protocol: string; hostname: string; port: string }

/**
 * The configured host URL ("https://app.example.com"), parsed; null if it is
 * missing or not http(s). A port is only enforced when the URL names one,
 * matching the manifest's `externally_connectable` pattern
 * ("http://localhost/*" admits any localhost port).
 */
export function parseAllowedHost(host: string | undefined | null): AllowedHost | null {
  if (!host) return null
  try {
    const url = new URL(host)
    if (url.protocol !== "https:" && url.protocol !== "http:") return null
    return { protocol: url.protocol, hostname: url.hostname, port: url.port }
  } catch {
    return null
  }
}

/**
 * Whether a message comes from the allowed host. `sender.origin` is set by
 * Chrome and cannot be forged by the page; `sender.url` is the fallback for
 * older Chrome versions. Compared as parsed URLs, never as string prefixes,
 * so "https://app.example.com.evil.test" does not pass for "https://app.example.com".
 */
export function isAllowedSender(
  sender: Pick<chrome.runtime.MessageSender, "origin" | "url"> | undefined,
  allowed: AllowedHost | null
): boolean {
  if (!sender || !allowed) return false
  const claimed = sender.origin ?? sender.url
  if (!claimed) return false
  try {
    const url = new URL(claimed)
    return (
      url.protocol === allowed.protocol &&
      url.hostname === allowed.hostname &&
      (!allowed.port || url.port === allowed.port)
    )
  } catch {
    return false
  }
}

export type EmbedQueryResponse = { ok: true; vector: number[] } | { ok: false; error: string }

/** A vector worth answering with: the local model's size, all finite. */
export function isQueryVector(v: unknown): v is number[] {
  return (
    Array.isArray(v) &&
    v.length === LOCAL_EMBEDDING_DIM &&
    v.every((x) => typeof x === "number" && Number.isFinite(x))
  )
}

/**
 * The query as embedded and cached: trimmed, capped and lowercased (the
 * offscreen tokenizer lowercases anyway, so case never changes the vector).
 */
export function normalizeQuery(raw: string): string {
  return raw.trim().slice(0, EMBED_QUERY_MAX_CHARS).toLowerCase()
}

/** Thrown to a waiting query that a newer one replaced. */
export class QueryBusyError extends Error {
  constructor() {
    super("busy")
    this.name = "QueryBusyError"
  }
}

export const QUERY_CACHE_SIZE = 32

/**
 * Wrap `embed` for the dashboard: at most one inference at a time, at most
 * one more waiting. A query that arrives while another waits takes its
 * place, and the replaced one rejects with QueryBusyError (a typing user only
 * needs the latest query). A query identical to the running one shares its
 * result. Valid vectors are kept in an LRU of `cacheSize` entries keyed by
 * the text, so a repeated search skips the model.
 */
export function createExternalEmbedder(
  embed: (text: string) => Promise<number[]>,
  cacheSize = QUERY_CACHE_SIZE
): (text: string) => Promise<number[]> {
  const cache = new Map<string, number[]>()
  let running: { text: string; promise: Promise<number[]> } | null = null
  let waiting: { text: string; resolve: (v: number[]) => void; reject: (e: unknown) => void } | null = null

  const cached = (text: string) => {
    const hit = cache.get(text)
    if (hit) {
      cache.delete(text)
      cache.set(text, hit)
    }
    return hit
  }

  const remember = (text: string, vector: number[]) => {
    cache.delete(text)
    cache.set(text, vector)
    while (cache.size > cacheSize) cache.delete(cache.keys().next().value as string)
  }

  const start = (text: string): Promise<number[]> => {
    const promise = (async () => {
      const vector = await embed(text)
      if (!isQueryVector(vector)) throw new Error("invalid vector")
      remember(text, vector)
      return vector
    })()
    running = { text, promise }
    const next = () => {
      running = null
      const w = waiting
      waiting = null
      if (w) run(w.text).then(w.resolve, w.reject)
    }
    promise.then(next, next)
    return promise
  }

  const run = (text: string): Promise<number[]> => {
    const hit = cached(text)
    if (hit) return Promise.resolve(hit)
    if (!running) return start(text)
    if (running.text === text) return running.promise
    waiting?.reject(new QueryBusyError())
    return new Promise((resolve, reject) => {
      waiting = { text, resolve, reject }
    })
  }

  return run
}

/**
 * Handle one external message: `{ type: "EMBED_QUERY", text }`. Returns null
 * for anything that is not a well-formed EMBED_QUERY from the allowed origin:
 * the caller then answers with a generic refusal, so a probing page learns
 * nothing. The text is embedded as normalizeQuery leaves it, with no caption
 * around it (lib/ai_config `imageQueryText` is the identity for SigLIP2),
 * exactly as the extension's own search does. Only a well-formed vector
 * (isQueryVector) is answered with `ok: true`.
 */
export async function handleExternalMessage(
  msg: unknown,
  sender: Pick<chrome.runtime.MessageSender, "origin" | "url"> | undefined,
  deps: { allowed: AllowedHost | null; embed: (text: string) => Promise<number[]> }
): Promise<EmbedQueryResponse | null> {
  if (!isAllowedSender(sender, deps.allowed)) return null
  if (!msg || typeof msg !== "object" || (msg as any).type !== EMBED_QUERY) return null
  const raw = (msg as any).text
  if (typeof raw !== "string") return null
  const text = normalizeQuery(raw)
  if (!text) return { ok: false, error: "empty query" }
  try {
    const vector = await deps.embed(imageQueryText(text))
    if (!isQueryVector(vector)) return { ok: false, error: "model unavailable" }
    return { ok: true, vector }
  } catch (e) {
    if (e instanceof QueryBusyError) return { ok: false, error: "busy" }
    // The model may still be downloading; details stay in the extension.
    return { ok: false, error: "model unavailable" }
  }
}

/** The answer to anything handleExternalMessage refuses. */
export const NOT_ALLOWED: EmbedQueryResponse = { ok: false, error: "not allowed" }
