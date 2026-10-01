/**
 * Edge cases for the dashboard's extension client
 * (apps/web/src/lib/extension-embed), beyond dashboard-embed.test.ts: the
 * default timeout, missing or partial runtimes, lastError alongside a reply,
 * more malformed replies, and a round trip through the extension's real
 * external-message handler.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

import {
  createQueryEmbedder,
  DEFAULT_EMBED_TIMEOUT_MS,
  getExtensionSendMessage,
  isQueryVector,
  normalizeQuery,
  type ModelStatus,
  type SendMessage,
} from "../../web/src/lib/extension-embed"
import {
  handleExternalMessage,
  NOT_ALLOWED,
  parseAllowedHost,
} from "~background/functions/external-messages"
import { EMBED_QUERY_MAX_CHARS, LOCAL_EMBEDDING_DIM } from "../../../packages/backend/convex/lib/ai_config"

const vector = Array.from({ length: LOCAL_EMBEDDING_DIM }, (_, i) => (i + 1) / LOCAL_EMBEDDING_DIM)

function replyWith(reply: unknown, delayMs = 0) {
  const calls: any[] = []
  const send: SendMessage = (_id, msg, cb) => {
    calls.push(msg)
    setTimeout(() => cb(reply), delayMs)
  }
  return { send, calls }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  vi.useRealTimers()
  delete (globalThis as any).chrome
})

describe("timeout", () => {
  test("the default is 3 s: pending at 2999 ms, keyword (null) at 3000 ms", async () => {
    expect(DEFAULT_EMBED_TIMEOUT_MS).toBe(3000)
    const ext = replyWith({ ok: true, vector }, 60_000)
    const e = createQueryEmbedder({ extensionId: "id", sendMessage: ext.send })
    let settled: number[] | null | "pending" = "pending"
    void e.embed("hero").then((v) => (settled = v))
    await vi.advanceTimersByTimeAsync(2999)
    expect(settled).toBe("pending")
    await vi.advanceTimersByTimeAsync(1)
    expect(settled).toBeNull()
    expect(e.status).toBe("loading")
  })

  test("an extension that never answers resolves to null, every time", async () => {
    const send: SendMessage = () => {} // callback never called
    const e = createQueryEmbedder({ extensionId: "id", sendMessage: send, timeoutMs: 100 })
    for (let i = 0; i < 3; i++) {
      const p = e.embed("x")
      await vi.advanceTimersByTimeAsync(100)
      expect(await p).toBeNull()
    }
  })

  test("a fast reply clears its timeout timer (no stray timers)", async () => {
    const ext = replyWith({ ok: true, vector })
    const e = createQueryEmbedder({ extensionId: "id", sendMessage: ext.send })
    const p = e.embed("a")
    await vi.advanceTimersByTimeAsync(0)
    expect(await p).toEqual(vector)
    expect(vi.getTimerCount()).toBe(0)
  })

  test("a whitespace-only query is keyword-only and sends nothing", async () => {
    const ext = replyWith({ ok: true, vector })
    const e = createQueryEmbedder({ extensionId: "id", sendMessage: ext.send })
    expect(await e.embed(" \n\t ")).toBeNull()
    expect(ext.calls).toHaveLength(0)
    expect(e.status).toBe("idle")
  })

  // A late failure reply (the model failed to load) must not leave the
  // dashboard showing "Loading search model…" for as long as the page lives.
  test("a failure reply after a timeout moves the status from 'loading' to 'error'", async () => {
    const ext = replyWith({ ok: false, error: "model unavailable" }, 5000)
    const statuses: ModelStatus[] = []
    const e = createQueryEmbedder({
      extensionId: "id",
      sendMessage: ext.send,
      onStatus: (s) => statuses.push(s),
    })
    const p = e.embed("hero")
    await vi.advanceTimersByTimeAsync(3000)
    expect(await p).toBeNull()
    expect(e.status).toBe("loading")
    await vi.advanceTimersByTimeAsync(2000) // the failure reply arrives
    expect(e.status).toBe("error")
    expect(statuses).toEqual(["loading", "error"])
  })

  test("a 'busy' reply (superseded by a newer query) is keyword-only and leaves the status alone", async () => {
    const ext = replyWith({ ok: false, error: "busy" }, 5000)
    const e = createQueryEmbedder({ extensionId: "id", sendMessage: ext.send })
    const p = e.embed("hero")
    await vi.advanceTimersByTimeAsync(3000)
    expect(await p).toBeNull()
    await vi.advanceTimersByTimeAsync(2000)
    expect(e.status).toBe("loading")
  })

  test("once ready, a failure reply does not demote the status", async () => {
    let reply: unknown = { ok: true, vector }
    const send: SendMessage = (_id, _msg, cb) => void setTimeout(() => cb(reply), 0)
    const e = createQueryEmbedder({ extensionId: "id", sendMessage: send })
    let p = e.embed("a")
    await vi.runAllTimersAsync()
    await p
    reply = { ok: false, error: "model unavailable" }
    p = e.embed("b")
    await vi.runAllTimersAsync()
    expect(await p).toBeNull()
    expect(e.status).toBe("ready")
  })
})

describe("missing or partial chrome.runtime", () => {
  test.each([
    ["no chrome global", undefined],
    ["chrome without runtime", {}],
    ["runtime: null", { runtime: null }],
    ["runtime without sendMessage", { runtime: {} }],
    ["sendMessage not a function", { runtime: { sendMessage: "nope" } }],
  ])("%s -> no sender, embedder is unavailable and asks nothing", async (_label, chromeValue) => {
    if (chromeValue === undefined) delete (globalThis as any).chrome
    else (globalThis as any).chrome = chromeValue
    const send = getExtensionSendMessage()
    expect(send).toBeNull()
    const e = createQueryEmbedder({ extensionId: "id", sendMessage: send })
    expect(e.status).toBe("unavailable")
    expect(await e.embed("hero")).toBeNull()
  })

  test("extension ID undefined (NEXT_PUBLIC_EXTENSION_ID unset) is unavailable", async () => {
    const ext = replyWith({ ok: true, vector })
    const e = createQueryEmbedder({ extensionId: undefined, sendMessage: ext.send })
    expect(e.status).toBe("unavailable")
    expect(await e.embed("hero")).toBeNull()
    expect(ext.calls).toHaveLength(0)
  })
})

describe("lastError", () => {
  test("lastError set alongside a perfectly good reply still yields a null response", () => {
    const runtime: any = {
      sendMessage: (_id: string, _msg: unknown, cb: (r: unknown) => void) => {
        runtime.lastError = { message: "The message port closed before a response was received." }
        cb({ ok: true, vector })
        runtime.lastError = undefined
      },
    }
    ;(globalThis as any).chrome = { runtime }
    const cb = vi.fn()
    getExtensionSendMessage()!("id", { type: "EMBED_QUERY", text: "a" }, cb)
    expect(cb).toHaveBeenCalledWith(null)
  })

  test("the wrapper forwards extension ID and message unchanged", () => {
    const sendMessage = vi.fn((_id: string, _msg: unknown, cb: (r: unknown) => void) => cb({ ok: true, vector }))
    ;(globalThis as any).chrome = { runtime: { sendMessage } }
    const cb = vi.fn()
    getExtensionSendMessage()!("abcdefghijklmnop", { type: "EMBED_QUERY", text: "q" }, cb)
    expect(sendMessage).toHaveBeenCalledWith("abcdefghijklmnop", { type: "EMBED_QUERY", text: "q" }, expect.any(Function))
    expect(cb).toHaveBeenCalledWith({ ok: true, vector })
  })

  test("through the real wrapper, lastError marks the embedder unavailable and falls back to keyword", async () => {
    const runtime: any = {
      sendMessage: (_id: string, _msg: unknown, cb: (r: unknown) => void) => {
        setTimeout(() => {
          runtime.lastError = { message: "Could not establish connection. Receiving end does not exist." }
          cb(undefined)
          runtime.lastError = undefined
        }, 0)
      },
    }
    ;(globalThis as any).chrome = { runtime }
    const statuses: ModelStatus[] = []
    const e = createQueryEmbedder({
      extensionId: "id",
      sendMessage: getExtensionSendMessage(),
      onStatus: (s) => statuses.push(s),
    })
    const p = e.embed("hero")
    await vi.runAllTimersAsync()
    expect(await p).toBeNull()
    expect(statuses).toEqual(["unavailable"])
  })

  test("an extension that becomes reachable again recovers from 'unavailable' to 'ready'", async () => {
    let reply: unknown = null
    const send: SendMessage = (_id, _msg, cb) => void setTimeout(() => cb(reply), 0)
    const statuses: ModelStatus[] = []
    const e = createQueryEmbedder({ extensionId: "id", sendMessage: send, onStatus: (s) => statuses.push(s) })
    let p = e.embed("a")
    await vi.runAllTimersAsync()
    expect(await p).toBeNull()
    reply = { ok: true, vector }
    p = e.embed("a")
    await vi.runAllTimersAsync()
    expect(await p).toEqual(vector)
    expect(statuses).toEqual(["unavailable", "ready"])
  })
})

describe("malformed replies", () => {
  const withInf = vector.map((x, i) => (i === 0 ? Number.POSITIVE_INFINITY : x))
  const withNegInf = vector.map((x, i) => (i === LOCAL_EMBEDDING_DIM - 1 ? Number.NEGATIVE_INFINITY : x))
  const allNaN = vector.map(() => Number.NaN)

  test.each([
    ["a string", "ok"],
    ["a number", 768],
    ["true", true],
    ["an array (bare vector)", vector],
    ["ok as the string 'true'", { ok: "true", vector }],
    ["ok: 1", { ok: 1, vector }],
    ["ok without a vector", { ok: true }],
    ["vector: null", { ok: true, vector: null }],
    ["an empty vector", { ok: true, vector: [] }],
    ["a vector one too long", { ok: true, vector: [...vector, 0] }],
    ["a vector one too short", { ok: true, vector: vector.slice(1) }],
    ["the old CLIP size", { ok: true, vector: vector.slice(0, 512) }],
    ["a JSON-serialised Float32Array", { ok: true, vector: Object.fromEntries(vector.map((x, i) => [i, x])) }],
    ["nested arrays", { ok: true, vector: vector.map((x) => [x]) }],
    ["a null entry", { ok: true, vector: vector.map((x, i) => (i === 9 ? null : x)) }],
    ["Infinity", { ok: true, vector: withInf }],
    ["-Infinity in the last slot", { ok: true, vector: withNegInf }],
    ["all NaN", { ok: true, vector: allNaN }],
    ["NaN in the first slot", { ok: true, vector: vector.map((x, i) => (i === 0 ? Number.NaN : x)) }],
    ["the extension's refusal", NOT_ALLOWED],
  ])("%s -> null (keyword), never thrown, status not 'ready'", async (_label, reply) => {
    const ext = replyWith(reply)
    const e = createQueryEmbedder({ extensionId: "id", sendMessage: ext.send })
    const p = e.embed("hero")
    await vi.runAllTimersAsync()
    await expect(p).resolves.toBeNull()
    expect(e.status).not.toBe("ready")
  })

  test("isQueryVector rejects NaN anywhere and accepts negative zero", () => {
    for (const i of [0, 1, LOCAL_EMBEDDING_DIM - 1]) {
      expect(isQueryVector(vector.map((x, j) => (j === i ? Number.NaN : x)))).toBe(false)
    }
    expect(isQueryVector(vector.map(() => -0))).toBe(true)
  })

  // `embed` is documented "Never throws": a raw sendMessage (not wrapped by
  // getExtensionSendMessage) that throws synchronously resolves null, and the
  // request is not left in flight, so the next search asks again.
  test("embed never throws, even if a raw sendMessage throws", async () => {
    let throws = true
    const send: SendMessage = (_id, _msg, cb) => {
      if (throws) throw new Error("Invalid extension id")
      setTimeout(() => cb({ ok: true, vector }), 0)
    }
    const e = createQueryEmbedder({ extensionId: "id", sendMessage: send })
    // Settle into a value immediately so a rejection is observed, not "unhandled".
    const outcome = e.embed("hero").then(
      (value) => ({ threw: false, value }),
      (error) => ({ threw: true, error })
    )
    await vi.runAllTimersAsync()
    expect(await outcome).toEqual({ threw: false, value: null })
    expect(e.status).toBe("unavailable")

    throws = false
    const again = e.embed("hero")
    await vi.runAllTimersAsync()
    expect(await again).toEqual(vector)
  })
})

describe("round trip through the extension's handler", () => {
  /** The page's sendMessage, wired to the real onMessageExternal handler. */
  function viaHandler(origin: string, embed: (t: string) => Promise<any>, configured = "https://app.example.com") {
    const allowed = parseAllowedHost(configured)
    const embedSpy = vi.fn(embed)
    const send: SendMessage = (_id, msg, cb) => {
      handleExternalMessage(msg, { origin }, { allowed, embed: embedSpy })
        .then((res) => cb(res ?? NOT_ALLOWED))
        .catch(() => cb(NOT_ALLOWED))
    }
    return { send, embedSpy }
  }

  test("the dashboard's message is accepted and the vector comes back", async () => {
    const { send, embedSpy } = viaHandler("https://app.example.com", async () => vector)
    const e = createQueryEmbedder({ extensionId: "id", sendMessage: send })
    const p = e.embed("  pricing table  ")
    await vi.runAllTimersAsync()
    expect(await p).toEqual(vector)
    expect(embedSpy).toHaveBeenCalledWith("pricing table")
    expect(e.status).toBe("ready")
  })

  test("both sides cap at the same length, so the dashboard's cache key is what was embedded", async () => {
    const { send, embedSpy } = viaHandler("https://app.example.com", async () => vector)
    const e = createQueryEmbedder({ extensionId: "id", sendMessage: send })
    const long = "q".repeat(EMBED_QUERY_MAX_CHARS + 1)
    const p = e.embed(long)
    await vi.runAllTimersAsync()
    await p
    expect(embedSpy.mock.calls[0]![0]).toBe(normalizeQuery(long))
  })

  test("a page on a lookalike origin gets the generic refusal -> keyword", async () => {
    const { send, embedSpy } = viaHandler("https://app.example.com.evil.test", async () => vector)
    const e = createQueryEmbedder({ extensionId: "id", sendMessage: send })
    const p = e.embed("hero")
    await vi.runAllTimersAsync()
    expect(await p).toBeNull()
    expect(embedSpy).not.toHaveBeenCalled()
  })

  test("a failing model reaches the dashboard as keyword, not an error", async () => {
    const { send } = viaHandler("https://app.example.com", async () => {
      throw new Error("download failed")
    })
    const e = createQueryEmbedder({ extensionId: "id", sendMessage: send })
    const p = e.embed("hero")
    await vi.runAllTimersAsync()
    expect(await p).toBeNull()
  })

  test.each([
    ["wrong length (old CLIP model)", vector.slice(0, 512)],
    ["NaN inside", vector.map((x, i) => (i === 100 ? Number.NaN : x))],
  ])("a %s vector from the offscreen side is dropped by the dashboard", async (_label, bad) => {
    const { send } = viaHandler("https://app.example.com", async () => bad)
    const e = createQueryEmbedder({ extensionId: "id", sendMessage: send })
    const p = e.embed("hero")
    await vi.runAllTimersAsync()
    expect(await p).toBeNull()
    expect(e.status).not.toBe("ready")
  })
})
