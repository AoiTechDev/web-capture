/**
 * Edge cases for the EMBED_QUERY external-message surface, beyond
 * external-messages.test.ts: lookalike origins against a localhost and a
 * pinned-port host, sender shapes Chrome can produce, text edge cases, what
 * the offscreen side can hand back, and the one-at-a-time query embedder.
 */
import { describe, expect, test, vi } from "vitest"

import {
  createExternalEmbedder,
  EMBED_QUERY,
  handleExternalMessage,
  isAllowedSender,
  normalizeQuery,
  NOT_ALLOWED,
  parseAllowedHost,
  QUERY_CACHE_SIZE,
  QueryBusyError,
} from "~background/functions/external-messages"
import {
  EMBED_QUERY_MAX_CHARS,
  LOCAL_EMBEDDING_DIM,
} from "../../../packages/backend/convex/lib/ai_config"

const vector = Array.from({ length: LOCAL_EMBEDDING_DIM }, () => 0.01)

describe("isAllowedSender: lookalikes of a port-less localhost host", () => {
  const local = parseAllowedHost("http://localhost")

  test.each([
    ["any port on the same host", { origin: "http://localhost:3000" }, true],
    ["case is normalised by URL", { origin: "HTTP://LOCALHOST:3000" }, true],
    ["suffix domain", { origin: "http://localhost.evil.com" }, false],
    ["suffix domain with port", { origin: "http://localhost.evil.com:3000" }, false],
    ["prefix domain", { origin: "http://evillocalhost" }, false],
    ["subdomain of localhost", { origin: "http://evil.localhost:3000" }, false],
    ["trailing dot", { origin: "http://localhost." }, false],
    ["loopback IP is a different host", { origin: "http://127.0.0.1:3000" }, false],
    ["IPv6 loopback is a different host", { origin: "http://[::1]:3000" }, false],
    ["https instead of http", { origin: "https://localhost:3000" }, false],
    ["ws scheme", { origin: "ws://localhost:3000" }, false],
    ["file scheme", { url: "file:///localhost/x.html" }, false],
    ["extension scheme", { origin: "chrome-extension://localhost" }, false],
    ["host only in the path", { url: "http://evil.com/localhost" }, false],
    ["host only in userinfo", { url: "http://localhost@evil.com/" }, false],
    ["host only in userinfo with port", { url: "http://localhost:3000@evil.com/" }, false],
    ["host only in the query", { url: "http://evil.com/?h=http://localhost" }, false],
  ])("%s", (_label, sender, ok) => {
    expect(isAllowedSender(sender, local)).toBe(ok)
  })
})

describe("isAllowedSender: a pinned port", () => {
  const pinned = parseAllowedHost("http://localhost:3000")

  test.each([
    ["same port", "http://localhost:3000", true],
    ["no port (80)", "http://localhost", false],
    ["port prefix", "http://localhost:300", false],
    ["port extension", "http://localhost:30000", false],
    ["other port", "http://localhost:3001", false],
    ["same port, other scheme", "https://localhost:3000", false],
  ])("%s", (_label, origin, ok) => {
    expect(isAllowedSender({ origin }, pinned)).toBe(ok)
  })
})

describe("isAllowedSender: an https production host", () => {
  const prod = parseAllowedHost("https://app.example.com")

  test.each([
    ["trailing dot", { origin: "https://app.example.com." }, false],
    ["punycode homograph (Cyrillic a)", { origin: "https://аpp.example.com" }, false],
    ["parent domain", { origin: "https://example.com" }, false],
    ["dash lookalike", { origin: "https://app-example.com" }, false],
    ["explicit default port is the same origin", { origin: "https://app.example.com:443" }, true],
  ])("%s", (_label, sender, ok) => {
    expect(isAllowedSender(sender, prod)).toBe(ok)
  })
})

describe("isAllowedSender: sender shapes", () => {
  const prod = parseAllowedHost("https://app.example.com")

  test("an opaque origin ('null', e.g. a sandboxed iframe) is refused even with an allowed url", () => {
    expect(isAllowedSender({ origin: "null", url: "https://app.example.com/dashboard" }, prod)).toBe(false)
  })

  test("an empty origin does not fall back to the url", () => {
    // `??` only falls back on null/undefined; "" is refused outright.
    expect(isAllowedSender({ origin: "", url: "https://app.example.com/" }, prod)).toBe(false)
  })

  test("missing origin and missing url are refused", () => {
    expect(isAllowedSender({ origin: undefined, url: undefined }, prod)).toBe(false)
    expect(isAllowedSender(undefined, prod)).toBe(false)
  })

  test("only the url, on the allowed host, is accepted (older Chrome)", () => {
    expect(isAllowedSender({ url: "https://app.example.com/dashboard#x" }, prod)).toBe(true)
  })
})

describe("parseAllowedHost: unusual configured values", () => {
  test.each([
    ["javascript:", "javascript:alert(1)"],
    ["data:", "data:text/html,hi"],
    ["file:", "file:///etc"],
    ["ws:", "ws://localhost:3000"],
    ["bare host without scheme", "localhost:3000"],
    ["whitespace", "   "],
  ])("rejects %s", (_label, host) => {
    expect(parseAllowedHost(host)).toBeNull()
  })

  test("a path or trailing slash on the configured host is ignored", () => {
    expect(parseAllowedHost("https://app.example.com/dashboard/")).toEqual({
      protocol: "https:",
      hostname: "app.example.com",
      port: "",
    })
  })

  test("null configures nothing", () => {
    expect(parseAllowedHost(null)).toBeNull()
  })
})

describe("handleExternalMessage: text", () => {
  const allowed = parseAllowedHost("http://localhost")
  const sender = { origin: "http://localhost:3000" }
  const call = (msg: unknown, embed = vi.fn(async (_t: string) => vector)) => ({
    embed,
    result: handleExternalMessage(msg, sender, { allowed, embed }),
  })

  test("exactly EMBED_QUERY_MAX_CHARS is kept whole", async () => {
    const text = "a".repeat(EMBED_QUERY_MAX_CHARS)
    const { embed, result } = call({ type: EMBED_QUERY, text })
    expect(await result).toEqual({ ok: true, vector })
    expect(embed).toHaveBeenCalledWith(text)
  })

  test("one char over the cap (201) is cut to the cap, keeping the start", async () => {
    expect(EMBED_QUERY_MAX_CHARS).toBe(200)
    const text = "a".repeat(EMBED_QUERY_MAX_CHARS) + "Z"
    const { embed, result } = call({ type: EMBED_QUERY, text })
    await result
    expect(embed).toHaveBeenCalledTimes(1)
    expect(embed.mock.calls[0]![0]).toBe("a".repeat(EMBED_QUERY_MAX_CHARS))
  })

  test("whitespace is trimmed before the cap, so padding does not eat the budget", async () => {
    const body = "b".repeat(EMBED_QUERY_MAX_CHARS)
    const { embed, result } = call({ type: EMBED_QUERY, text: " ".repeat(50) + body + " ".repeat(50) })
    await result
    expect(embed.mock.calls[0]![0]).toBe(body)
  })

  test.each([
    ["tabs and newlines", "\t\n\r \n"],
    ["non-breaking space", "  "],
    ["line/paragraph separators", "  "],
    ["ideographic space", "　"],
    ["empty string", ""],
  ])("whitespace-only (%s) is 'empty query' and never reaches the model", async (_label, text) => {
    const { embed, result } = call({ type: EMBED_QUERY, text })
    expect(await result).toEqual({ ok: false, error: "empty query" })
    expect(embed).not.toHaveBeenCalled()
  })

  test.each([
    ["number", 42],
    ["boolean", true],
    ["array of strings", ["a"]],
    ["String object", new String("a")],
    ["null", null],
    ["undefined", undefined],
    ["object with toString", { toString: () => "a" }],
  ])("non-string text (%s) is refused without touching the model", async (_label, text) => {
    const { embed, result } = call({ type: EMBED_QUERY, text })
    expect(await result).toBeNull()
    expect(embed).not.toHaveBeenCalled()
  })

  test.each([
    ["lower-case type", { type: "embed_query", text: "a" }],
    ["type with whitespace", { type: " EMBED_QUERY", text: "a" }],
    ["array message", [EMBED_QUERY, "a"]],
    ["number message", 1],
  ])("malformed message (%s) is refused", async (_label, msg) => {
    const { embed, result } = call(msg)
    expect(await result).toBeNull()
    expect(embed).not.toHaveBeenCalled()
  })

  test("extra fields on the message are ignored, not echoed", async () => {
    const { result } = call({ type: EMBED_QUERY, text: "a", userId: "u1", token: "t" })
    const res = await result
    expect(res).toEqual({ ok: true, vector })
    expect(Object.keys(res!).sort()).toEqual(["ok", "vector"])
  })

  test("the origin is checked before the message is looked at", async () => {
    const embed = vi.fn(async () => vector)
    const res = await handleExternalMessage({ type: EMBED_QUERY, text: "   " }, { origin: "http://localhost.evil.com" }, {
      allowed,
      embed,
    })
    // An empty query from a stranger is a refusal, not an "empty query" hint.
    expect(res).toBeNull()
  })

  test("NOT_ALLOWED is a generic refusal carrying no detail", () => {
    expect(NOT_ALLOWED).toEqual({ ok: false, error: "not allowed" })
  })
})

describe("handleExternalMessage: the offscreen side", () => {
  const allowed = parseAllowedHost("https://app.example.com")
  const sender = { origin: "https://app.example.com" }
  const run = (embed: (t: string) => Promise<any>) =>
    handleExternalMessage({ type: EMBED_QUERY, text: "hero" }, sender, { allowed, embed })

  test.each([
    ["rejects with an Error", async () => Promise.reject(new Error("ENOENT /home/me/.cache/model.onnx"))],
    ["rejects with a string", async () => Promise.reject("boom")],
    ["rejects with undefined", async () => Promise.reject(undefined)],
    ["resolves undefined (offscreen sent no response)", async () => undefined],
    ["resolves null", async () => null],
    ["resolves the raw offscreen reply object", async () => ({ vector })],
    ["resolves a JSON-serialised Float32Array", async () => ({ 0: 0.1, 1: 0.2 })],
    ["resolves a string", async () => "0.1,0.2"],
  ])("%s -> 'model unavailable', no details", async (_label, embed) => {
    const res = await run(embed as any)
    expect(res).toEqual({ ok: false, error: "model unavailable" })
  })

  test("a correctly sized vector is passed through untouched", async () => {
    const res = await run(async () => vector)
    expect(res).toEqual({ ok: true, vector })
  })

  // Defence in depth: the dashboard (isQueryVector) and the backend
  // (assertLocalEmbedding) reject these too, but the extension never sends them.
  test("a vector of the wrong length is answered as 'model unavailable'", async () => {
    const res = await run(async () => vector.slice(0, 512))
    expect(res).toEqual({ ok: false, error: "model unavailable" })
  })

  test.each([
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["a string", "0.1"],
  ])("a vector containing %s is answered as 'model unavailable'", async (_label, bad) => {
    const res = await run(async () => vector.map((x, i) => (i === 5 ? bad : x)))
    expect(res).toEqual({ ok: false, error: "model unavailable" })
  })

  test("a query replaced by a newer one is answered 'busy'", async () => {
    const res = await run(async () => Promise.reject(new QueryBusyError()))
    expect(res).toEqual({ ok: false, error: "busy" })
  })

  test("the text is lowercased before it is embedded", async () => {
    const embed = vi.fn(async (_t: string) => vector)
    await handleExternalMessage({ type: EMBED_QUERY, text: "  Pricing TABLE " }, sender, { allowed, embed })
    expect(embed).toHaveBeenCalledWith("pricing table")
  })
})

describe("createExternalEmbedder: one inference at a time, latest wins", () => {
  /** An embed whose calls resolve only when the test says so. */
  function controlled() {
    const calls: Array<{ text: string; resolve: (v: unknown) => void; reject: (e: unknown) => void }> = []
    const embed = vi.fn(
      (text: string) => new Promise<number[]>((resolve, reject) => calls.push({ text, resolve: resolve as any, reject }))
    )
    return { calls, embed }
  }
  const settle = <T,>(p: Promise<T>) =>
    p.then(
      (value) => ({ ok: true as const, value }),
      (error) => ({ ok: false as const, error })
    )
  const flush = () => new Promise((r) => setTimeout(r, 0))

  test("a second query waits for the first instead of running alongside it", async () => {
    const { calls, embed } = controlled()
    const q = createExternalEmbedder(embed)
    const a = q("a")
    const b = q("b")
    await flush()
    expect(calls.map((c) => c.text)).toEqual(["a"])
    calls[0]!.resolve(vector)
    expect(await a).toBe(vector)
    await flush()
    expect(calls.map((c) => c.text)).toEqual(["a", "b"])
    calls[1]!.resolve(vector)
    expect(await b).toBe(vector)
  })

  test("only the latest waiting query runs; the one it replaced is busy", async () => {
    const { calls, embed } = controlled()
    const q = createExternalEmbedder(embed)
    const a = q("a")
    const b = settle(q("b"))
    const c = q("c")
    expect(await b).toEqual({ ok: false, error: expect.any(QueryBusyError) })
    calls[0]!.resolve(vector)
    await a
    await flush()
    expect(calls.map((x) => x.text)).toEqual(["a", "c"])
    calls[1]!.resolve(vector)
    expect(await c).toBe(vector)
  })

  test("through the handler, the replaced query is answered 'busy'", async () => {
    const { calls, embed } = controlled()
    const q = createExternalEmbedder(embed)
    const allowed = parseAllowedHost("https://app.example.com")
    const sender = { origin: "https://app.example.com" }
    const send = (text: string) => handleExternalMessage({ type: EMBED_QUERY, text }, sender, { allowed, embed: q })
    const a = send("a")
    const b = send("b")
    const c = send("c")
    expect(await b).toEqual({ ok: false, error: "busy" })
    calls[0]!.resolve(vector)
    expect(await a).toEqual({ ok: true, vector })
    await flush()
    calls[1]!.resolve(vector)
    expect(await c).toEqual({ ok: true, vector })
  })

  test("a query identical to the running one shares it", async () => {
    const { calls, embed } = controlled()
    const q = createExternalEmbedder(embed)
    const a1 = q("a")
    const a2 = q("a")
    calls[0]!.resolve(vector)
    expect(await a1).toBe(vector)
    expect(await a2).toBe(vector)
    expect(embed).toHaveBeenCalledTimes(1)
  })

  test("a failed inference frees the slot for the waiting query", async () => {
    const { calls, embed } = controlled()
    const q = createExternalEmbedder(embed)
    const a = settle(q("a"))
    const b = q("b")
    calls[0]!.reject(new Error("model failed"))
    expect(await a).toMatchObject({ ok: false })
    await flush()
    calls[1]!.resolve(vector)
    expect(await b).toBe(vector)
  })

  test("an invalid vector is rejected and not cached", async () => {
    const embed = vi.fn(async (_t: string) => vector.slice(0, 512))
    const q = createExternalEmbedder(embed)
    await expect(q("a")).rejects.toThrow()
    await expect(q("a")).rejects.toThrow()
    expect(embed).toHaveBeenCalledTimes(2)
  })
})

describe("createExternalEmbedder: LRU cache", () => {
  test("a repeated query is answered from the cache, without the model", async () => {
    const embed = vi.fn(async (_t: string) => vector)
    const q = createExternalEmbedder(embed)
    expect(await q("hero")).toBe(vector)
    expect(await q("hero")).toBe(vector)
    expect(embed).toHaveBeenCalledTimes(1)
  })

  test("the handler's normalisation makes case and padding share one entry", async () => {
    const embed = vi.fn(async (_t: string) => vector)
    const q = createExternalEmbedder(embed)
    const allowed = parseAllowedHost("https://app.example.com")
    const sender = { origin: "https://app.example.com" }
    for (const text of ["Hero", "  hero ", "HERO"]) {
      expect(await handleExternalMessage({ type: EMBED_QUERY, text }, sender, { allowed, embed: q })).toEqual({
        ok: true,
        vector,
      })
    }
    expect(embed).toHaveBeenCalledTimes(1)
  })

  test(`holds ${QUERY_CACHE_SIZE} entries by default, evicting the least recently used`, async () => {
    const embed = vi.fn(async (_t: string) => vector)
    const q = createExternalEmbedder(embed)
    for (let i = 0; i < QUERY_CACHE_SIZE; i++) await q(`q${i}`)
    await q("q0") // refresh q0, so q1 is now the oldest
    await q("new") // evicts q1
    embed.mockClear()
    await q("q0")
    await q(`q${QUERY_CACHE_SIZE - 1}`)
    expect(embed).not.toHaveBeenCalled()
    await q("q1")
    expect(embed).toHaveBeenCalledTimes(1)
  })

  test("normalizeQuery trims, caps and lowercases", () => {
    expect(normalizeQuery("  Pricing TABLE  ")).toBe("pricing table")
    expect(normalizeQuery("A".repeat(EMBED_QUERY_MAX_CHARS + 10))).toBe("a".repeat(EMBED_QUERY_MAX_CHARS))
    expect(normalizeQuery(" \n\t ")).toBe("")
  })
})
