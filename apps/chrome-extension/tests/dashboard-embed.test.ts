/**
 * The dashboard's extension client (apps/web/src/lib/extension-embed). It
 * lives in the web app, which has no test runner yet; it is pure TS with no
 * Next or React imports, so it is tested here.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

import {
  createQueryEmbedder,
  getExtensionSendMessage,
  isQueryVector,
  type ModelStatus,
  type SendMessage,
} from "../../web/src/lib/extension-embed"
import { EMBED_QUERY_MAX_CHARS, LOCAL_EMBEDDING_DIM } from "../../../packages/backend/convex/lib/ai_config"

const vector = Array.from({ length: LOCAL_EMBEDDING_DIM }, (_, i) => i / LOCAL_EMBEDDING_DIM)

/** A fake extension: answers each message after `delayMs` with `reply(message)`. */
function fakeExtension(reply: (msg: any) => unknown, delayMs = 0) {
  const calls: any[] = []
  const send: SendMessage = (_id, msg, cb) => {
    calls.push(msg)
    setTimeout(() => cb(reply(msg)), delayMs)
  }
  return { send, calls }
}

function make(send: SendMessage | null, extensionId: string | undefined = "ext-id", timeoutMs = 3000) {
  const statuses: ModelStatus[] = []
  const e = createQueryEmbedder({ extensionId, sendMessage: send, timeoutMs, onStatus: (s) => statuses.push(s) })
  return { e, statuses }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe("createQueryEmbedder", () => {
  test("returns the extension's vector and caches it per query", async () => {
    const ext = fakeExtension(() => ({ ok: true, vector }))
    const { e, statuses } = make(ext.send)
    const first = e.embed("  pricing ")
    await vi.runAllTimersAsync()
    expect(await first).toEqual(vector)
    expect(ext.calls).toEqual([{ type: "EMBED_QUERY", text: "pricing" }])
    expect(await e.embed("pricing")).toEqual(vector)
    expect(ext.calls).toHaveLength(1)
    expect(statuses).toEqual(["ready"])
  })

  test("sends at most EMBED_QUERY_MAX_CHARS", async () => {
    const ext = fakeExtension(() => ({ ok: true, vector }))
    const { e } = make(ext.send)
    const p = e.embed("x".repeat(1000))
    await vi.runAllTimersAsync()
    await p
    expect(ext.calls[0].text).toHaveLength(EMBED_QUERY_MAX_CHARS)
  })

  test("keyword only, without asking, when there is no extension or no ID", async () => {
    const ext = fakeExtension(() => ({ ok: true, vector }))
    const noRuntime = make(null)
    expect(noRuntime.e.status).toBe("unavailable")
    expect(await noRuntime.e.embed("a")).toBeNull()
    const noId = make(ext.send, "") // NEXT_PUBLIC_EXTENSION_ID unset or empty
    expect(await noId.e.embed("a")).toBeNull()
    expect(ext.calls).toHaveLength(0)
  })

  test("unreachable extension (lastError -> null) is unavailable", async () => {
    const { e, statuses } = make(fakeExtension(() => null).send)
    const p = e.embed("a")
    await vi.runAllTimersAsync()
    expect(await p).toBeNull()
    expect(statuses).toEqual(["unavailable"])
  })

  test.each([
    ["an error reply", { ok: false, error: "model unavailable" }],
    ["a vector without ok", { vector }],
    ["a vector of another model's size", { ok: true, vector: vector.slice(0, 512) }],
    ["non-numeric entries", { ok: true, vector: vector.map((x, i) => (i === 3 ? "1" : x)) }],
    ["NaN", { ok: true, vector: vector.map((x, i) => (i === 3 ? Number.NaN : x)) }],
  ])("%s falls back to keyword and is not cached", async (_label, reply) => {
    const ext = fakeExtension(() => reply)
    const { e } = make(ext.send)
    const p = e.embed("a")
    await vi.runAllTimersAsync()
    expect(await p).toBeNull()
    const again = e.embed("a")
    await vi.runAllTimersAsync()
    await again
    expect(ext.calls).toHaveLength(2)
  })

  test("a cold model times out to keyword, says 'loading' once, and the late vector is cached", async () => {
    const ext = fakeExtension(() => ({ ok: true, vector }), 10_000)
    const { e, statuses } = make(ext.send, "ext-id", 3000)
    const p = e.embed("hero")
    await vi.advanceTimersByTimeAsync(3000)
    expect(await p).toBeNull()
    expect(e.status).toBe("loading")

    // The same query while the first request is still running: no second message.
    await vi.advanceTimersByTimeAsync(6000)
    const q2 = e.embed("hero")
    await vi.advanceTimersByTimeAsync(1000)
    expect(await q2).toEqual(vector)
    expect(ext.calls).toHaveLength(1)
    expect(statuses).toEqual(["loading", "ready"])

    expect(await e.embed("hero")).toEqual(vector)
  })

  test("once ready, a slow reply does not bring 'loading' back", async () => {
    let delay = 0
    const send: SendMessage = (_id, _msg, cb) => void setTimeout(() => cb({ ok: true, vector }), delay)
    const { e, statuses } = make(send, "ext-id", 3000)
    const a = e.embed("a")
    await vi.runAllTimersAsync()
    await a
    delay = 5000
    const b = e.embed("b")
    await vi.advanceTimersByTimeAsync(3000)
    expect(await b).toBeNull()
    expect(statuses).toEqual(["ready"])
  })

  test("the cache is bounded", async () => {
    const ext = fakeExtension(() => ({ ok: true, vector }))
    const e = createQueryEmbedder({ extensionId: "x", sendMessage: ext.send, cacheSize: 2 })
    for (const q of ["a", "b", "c", "a"]) {
      const p = e.embed(q)
      await vi.runAllTimersAsync()
      await p
    }
    // "a" was evicted by "c", so it was asked for twice.
    expect(ext.calls.map((m) => m.text)).toEqual(["a", "b", "c", "a"])
  })
})

describe("getExtensionSendMessage", () => {
  afterEach(() => {
    delete (globalThis as any).chrome
  })

  test("null when the page has no extension runtime", () => {
    delete (globalThis as any).chrome
    expect(getExtensionSendMessage()).toBeNull()
  })

  test("reads lastError and reports it as a null response", () => {
    const runtime: any = {
      lastError: undefined,
      sendMessage: (_id: string, _msg: unknown, cb: (r: unknown) => void) => {
        runtime.lastError = { message: "Could not establish connection" }
        cb(undefined)
        runtime.lastError = undefined
      },
    }
    ;(globalThis as any).chrome = { runtime }
    const cb = vi.fn()
    getExtensionSendMessage()!("id", { type: "EMBED_QUERY", text: "a" }, cb)
    expect(cb).toHaveBeenCalledWith(null)
  })

  test("a throwing sendMessage (bad ID format) becomes a null response", () => {
    ;(globalThis as any).chrome = {
      runtime: {
        sendMessage: () => {
          throw new Error("Invalid extension id")
        },
      },
    }
    const cb = vi.fn()
    getExtensionSendMessage()!("??", {}, cb)
    expect(cb).toHaveBeenCalledWith(null)
  })
})

describe("isQueryVector", () => {
  test("only the local model's size of finite numbers", () => {
    expect(isQueryVector(vector)).toBe(true)
    expect(isQueryVector(vector.slice(1))).toBe(false)
    expect(isQueryVector(null)).toBe(false)
    expect(isQueryVector("x")).toBe(false)
  })
})
