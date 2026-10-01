import { describe, expect, test, vi } from "vitest"

import {
  EMBED_QUERY,
  handleExternalMessage,
  isAllowedSender,
  parseAllowedHost,
} from "~background/functions/external-messages"
import { EMBED_QUERY_MAX_CHARS } from "../../../packages/backend/convex/lib/ai_config"

const allowed = parseAllowedHost("https://app.example.com")
const vector = Array.from({ length: 768 }, () => 0.01)

function run(
  msg: unknown,
  sender: { origin?: string; url?: string } | undefined,
  embed = vi.fn(async (_text: string) => vector)
) {
  return { embed, result: handleExternalMessage(msg, sender, { allowed, embed }) }
}

describe("parseAllowedHost", () => {
  test("accepts http(s) hosts, rejects anything else", () => {
    expect(parseAllowedHost("https://app.example.com/")).toEqual({ protocol: "https:", hostname: "app.example.com", port: "" })
    expect(parseAllowedHost("http://localhost:3000")).toEqual({ protocol: "http:", hostname: "localhost", port: "3000" })
    expect(parseAllowedHost(undefined)).toBeNull()
    expect(parseAllowedHost("")).toBeNull()
    expect(parseAllowedHost("not a url")).toBeNull()
    expect(parseAllowedHost("chrome-extension://abc")).toBeNull()
  })
})

describe("isAllowedSender", () => {
  test.each([
    ["exact origin", { origin: "https://app.example.com" }, true],
    ["url fallback", { url: "https://app.example.com/dashboard?q=1" }, true],
    ["origin wins over url", { origin: "https://evil.test", url: "https://app.example.com/" }, false],
    ["suffix attack", { origin: "https://app.example.com.evil.test" }, false],
    ["subdomain", { origin: "https://x.app.example.com" }, false],
    ["other scheme", { origin: "http://app.example.com" }, false],
    ["userinfo trick", { url: "https://app.example.com@evil.test/" }, false],
    ["no origin or url", {}, false],
    ["garbage", { origin: "::::" }, false],
  ])("%s", (_label, sender, ok) => {
    expect(isAllowedSender(sender, allowed)).toBe(ok)
  })

  test("nothing is allowed without a configured host", () => {
    expect(isAllowedSender({ origin: "https://app.example.com" }, null)).toBe(false)
  })

  test("a host without a port admits any port, as the manifest pattern does", () => {
    const local = parseAllowedHost("http://localhost")
    expect(isAllowedSender({ origin: "http://localhost:3000" }, local)).toBe(true)
    const pinned = parseAllowedHost("http://localhost:3000")
    expect(isAllowedSender({ origin: "http://localhost:3000" }, pinned)).toBe(true)
    expect(isAllowedSender({ origin: "http://localhost:4000" }, pinned)).toBe(false)
  })
})

describe("handleExternalMessage", () => {
  const ok = { origin: "https://app.example.com" }

  test("embeds the raw text and returns only the vector", async () => {
    const { embed, result } = run({ type: EMBED_QUERY, text: "  pricing table " }, ok)
    expect(await result).toEqual({ ok: true, vector })
    expect(embed).toHaveBeenCalledWith("pricing table")
  })

  test("caps the query length", async () => {
    const { embed, result } = run({ type: EMBED_QUERY, text: "x".repeat(5000) }, ok)
    await result
    expect(embed.mock.calls[0]![0]).toHaveLength(EMBED_QUERY_MAX_CHARS)
  })

  test.each([
    ["wrong origin", { type: EMBED_QUERY, text: "a" }, { origin: "https://evil.test" }],
    ["no sender", { type: EMBED_QUERY, text: "a" }, undefined],
    ["other message type", { type: "CHECK_AUTH" }, ok],
    ["internal search type", { type: "SEARCH_SEMANTIC", q: "a" }, ok],
    ["non-string text", { type: EMBED_QUERY, text: { toString: () => "a" } }, ok],
    ["missing text", { type: EMBED_QUERY }, ok],
    ["legacy query field", { type: EMBED_QUERY, query: "a" }, ok],
    ["not an object", "EMBED_QUERY", ok],
    ["null", null, ok],
  ])("refuses %s without touching the model", async (_label, msg, sender) => {
    const { embed, result } = run(msg, sender)
    expect(await result).toBeNull()
    expect(embed).not.toHaveBeenCalled()
  })

  test("empty query is an error, not a model call", async () => {
    const { embed, result } = run({ type: EMBED_QUERY, text: "   " }, ok)
    expect(await result).toEqual({ ok: false, error: "empty query" })
    expect(embed).not.toHaveBeenCalled()
  })

  test("model failures do not leak details", async () => {
    const embed = vi.fn(async () => {
      throw new Error("secret internal path /x/y")
    })
    const { result } = run({ type: EMBED_QUERY, text: "a" }, ok, embed)
    expect(await result).toEqual({ ok: false, error: "model unavailable" })
  })

  test("an empty vector counts as unavailable", async () => {
    const { result } = run({ type: EMBED_QUERY, text: "a" }, ok, vi.fn(async () => []))
    expect(await result).toEqual({ ok: false, error: "model unavailable" })
  })
})
