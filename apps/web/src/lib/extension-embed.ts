/**
 * Query embeddings for dashboard search, borrowed from the installed Chrome
 * extension: the dashboard never loads a model of its own. The extension
 * answers `{ type: "EMBED_QUERY", text }` (externally_connectable) with
 * `{ ok: true, vector }` from the same local model that embedded the
 * captures, or `{ ok: false, error }`.
 *
 * Anything short of a well-formed vector (no extension, wrong ID, a model
 * still downloading, an older extension on another model) yields null, and
 * the caller searches by keyword only. No React here, so it is testable.
 */

import {
  EMBED_QUERY_MAX_CHARS,
  LOCAL_EMBEDDING_DIM,
} from "../../../../packages/backend/convex/lib/ai_config";

/** `chrome.runtime.sendMessage(extensionId, message, callback)` as exposed to web pages. */
export type SendMessage = (extensionId: string, message: unknown, callback: (response: unknown) => void) => void;

/**
 * - idle: nothing asked yet
 * - loading: a request outlived the timeout, the model is probably still loading
 * - ready: the extension has answered with a vector
 * - error: the extension answered, but without a usable vector (the model
 *   failed to load, or an older extension runs another model)
 * - unavailable: no extension to ask (not installed, no ID configured, or unreachable)
 */
export type ModelStatus = "idle" | "loading" | "ready" | "error" | "unavailable";

type ChromeLike = {
  runtime?: { sendMessage?: (...args: unknown[]) => void; lastError?: { message?: string } };
};

/**
 * The page's `chrome.runtime.sendMessage`, wrapped so `lastError` is read (and
 * reported as a null response) instead of logged. Null when the browser
 * exposes no runtime to this page, i.e. no extension lists it as connectable.
 */
export function getExtensionSendMessage(): SendMessage | null {
  const chromeApi = (globalThis as { chrome?: ChromeLike }).chrome;
  const runtime = chromeApi?.runtime;
  if (!runtime || typeof runtime.sendMessage !== "function") return null;
  return (extensionId, message, callback) => {
    try {
      runtime.sendMessage!(extensionId, message, (response: unknown) => {
        callback(runtime.lastError ? null : response);
      });
    } catch {
      callback(null);
    }
  };
}

/** A usable query vector: the local model's size, all finite numbers. */
export function isQueryVector(x: unknown): x is number[] {
  return (
    Array.isArray(x) &&
    x.length === LOCAL_EMBEDDING_DIM &&
    x.every((n) => typeof n === "number" && Number.isFinite(n))
  );
}

/** The query as the extension will embed it (and as it is cached). */
export function normalizeQuery(query: string): string {
  return query.trim().slice(0, EMBED_QUERY_MAX_CHARS);
}

export type EmbedderOptions = {
  extensionId: string | undefined;
  sendMessage: SendMessage | null;
  /** How long a search waits for a vector before going keyword-only. */
  timeoutMs?: number;
  /** Vectors remembered, most recent kept. */
  cacheSize?: number;
  onStatus?: (status: ModelStatus) => void;
};

export type QueryEmbedder = {
  /** The query's vector, or null to search by keyword only. Never throws. */
  embed(query: string): Promise<number[] | null>;
  readonly status: ModelStatus;
};

export const DEFAULT_EMBED_TIMEOUT_MS = 3000;

/**
 * `busy`: the extension dropped this request for a newer one (it runs one
 * query at a time, latest wins); says nothing about the model.
 */
type Reply = { kind: "vector"; vector: number[] } | { kind: "failed" } | { kind: "busy" } | { kind: "unreachable" };

function toReply(response: unknown): Reply {
  if (response === null || response === undefined) return { kind: "unreachable" };
  const { ok, vector, error } = response as { ok?: unknown; vector?: unknown; error?: unknown };
  if (ok === true && isQueryVector(vector)) return { kind: "vector", vector };
  return ok === false && error === "busy" ? { kind: "busy" } : { kind: "failed" };
}

export function createQueryEmbedder(opts: EmbedderOptions): QueryEmbedder {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_EMBED_TIMEOUT_MS;
  const cacheSize = opts.cacheSize ?? 100;
  const cache = new Map<string, number[]>();
  const inFlight = new Map<string, Promise<Reply>>();
  let status: ModelStatus = opts.extensionId && opts.sendMessage ? "idle" : "unavailable";

  const setStatus = (next: ModelStatus) => {
    if (next === status) return;
    status = next;
    opts.onStatus?.(next);
  };

  const remember = (key: string, vector: number[]) => {
    cache.delete(key);
    cache.set(key, vector);
    while (cache.size > cacheSize) cache.delete(cache.keys().next().value as string);
  };

  // One message per distinct query, even if searches for it overlap. A reply
  // that arrives after the timeout is still cached for the next search.
  const ask = (key: string): Promise<Reply> => {
    const pending = inFlight.get(key);
    if (pending) return pending;
    const p = new Promise<Reply>((resolve) => {
      try {
        opts.sendMessage!(opts.extensionId!, { type: "EMBED_QUERY", text: key }, (response) =>
          resolve(toReply(response))
        );
      } catch {
        // A raw sendMessage throws for an ID no extension answers to.
        resolve({ kind: "unreachable" });
      }
    }).then((reply) => {
      inFlight.delete(key);
      if (reply.kind === "vector") {
        remember(key, reply.vector);
        setStatus("ready");
      } else if (reply.kind === "unreachable") {
        setStatus("unavailable");
      } else if (reply.kind === "failed" && status !== "ready") {
        // Out of "loading" (or "idle"): the extension has answered, the model just can't.
        setStatus("error");
      }
      return reply;
    });
    inFlight.set(key, p);
    return p;
  };

  return {
    get status() {
      return status;
    },
    async embed(query) {
      const key = normalizeQuery(query);
      if (!key || !opts.extensionId || !opts.sendMessage) return null;
      const cached = cache.get(key);
      if (cached) {
        remember(key, cached);
        return cached;
      }
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<"timeout">((resolve) => {
        timer = setTimeout(() => resolve("timeout"), timeoutMs);
      });
      const reply = await Promise.race([ask(key), timeout]);
      clearTimeout(timer);
      if (reply === "timeout") {
        // Only a cold model is "loading"; once it has answered, a slow reply is just slow.
        if (status !== "ready") setStatus("loading");
        return null;
      }
      return reply.kind === "vector" ? reply.vector : null;
    },
  };
}
