import { getFunctionName } from "convex/server"
import { beforeEach, describe, expect, test, vi } from "vitest"

vi.mock("~background/functions/local-embeddings", () => ({
  embedText: vi.fn(async () => Array.from({ length: 768 }, () => 0.1)),
  embedImageFromUrl: vi.fn(async () => Array.from({ length: 768 }, () => 0.1)),
}))
vi.mock("~background/functions/auto-tag", () => ({
  classifyImage: vi.fn(async () => ({ aiCategory: "hero", aiStyle: ["dark"], aiTags: ["headline"], debug: { category: [] } })),
}))
vi.mock("~background/functions/session-broadcast", () => ({ broadcastSessionState: vi.fn(async () => {}) }))

type Call = { name: string; args: any }

/** A ConvexClient stand-in: records calls and answers from `respond`. */
function fakeConvex(respond: (name: string, args: any) => any) {
  const calls: Call[] = []
  const subscriptions: Array<{ cb: (res: any) => void; onError?: (e: Error) => void }> = []
  const run = async (ref: any, args: any) => {
    const name = getFunctionName(ref)
    calls.push({ name, args })
    return respond(name, args)
  }
  const client = {
    onUpdate: vi.fn((_ref: any, _args: any, cb: (res: any) => void, onError?: (e: Error) => void) => {
      subscriptions.push({ cb, onError })
      return Object.assign(() => {}, { unsubscribe() {}, getCurrentValue() {} })
    }),
    query: vi.fn(run),
    mutation: vi.fn(run),
  }
  return { client: client as any, calls, subscriptions }
}

const textItem = { id: "c1", kind: "text", visual: false, thumbUrl: null, imageUrl: null, text: "hello", palette: null, backgroundHexes: [], width: null, height: null }

/** Default backend: one pending text capture, claimable once. */
function backend(overrides: Record<string, (args: any) => any> = {}) {
  let claimed = false
  return (name: string, args: any) => {
    if (overrides[name]) return overrides[name]!(args)
    switch (name) {
      case "local_ai:listPendingCaptures":
        return { items: claimed ? [] : [{ id: "c1", kind: "text" }] }
      case "local_ai:recoverStaleProcessing":
        return { recovered: 0 }
      case "local_ai:claimCapture":
        if (claimed) return { claimed: false, claim: null, item: null }
        claimed = true
        return { claimed: true, claim: "tok-1", item: textItem }
      case "local_ai:completeProcessing":
        return { ok: true }
      case "local_ai:failProcessing":
        return { ok: true, retry: false }
      default:
        return {}
    }
  }
}

async function loadQueue() {
  vi.resetModules()
  return await import("~background/functions/processing-queue")
}

describe("processing queue", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test("starts while signed out (even if the auth check throws) and processes after sign-in", async () => {
    const q = await loadQueue()
    const { client, calls, subscriptions } = fakeConvex(backend())
    let signedIn: boolean | "throw" = "throw"
    await q.startProcessingQueue(client, {
      isSignedIn: async () => {
        if (signedIn === "throw") throw new Error("clerk unavailable")
        return signedIn
      },
    })
    // Subscribed, but nothing was claimed on behalf of nobody.
    expect(subscriptions).toHaveLength(1)
    expect(calls.map((c) => c.name)).not.toContain("local_ai:claimCapture")

    signedIn = true
    await q.notifySignedIn()
    await vi.waitFor(() =>
      expect(calls.find((c) => c.name === "local_ai:completeProcessing")?.args).toMatchObject({
        id: "c1",
        claim: "tok-1",
      })
    )
    expect(calls.map((c) => c.name)).toContain("local_ai:recoverStaleProcessing")
  })

  test("a subscription update drains the queue", async () => {
    const q = await loadQueue()
    const { client, calls, subscriptions } = fakeConvex(backend({ "local_ai:listPendingCaptures": () => ({ items: [] }) }))
    await q.startProcessingQueue(client, { isSignedIn: async () => true })
    expect(calls.map((c) => c.name)).not.toContain("local_ai:claimCapture")
    subscriptions[0]!.cb({ items: [{ id: "c1", kind: "text" }] })
    await vi.waitFor(() => expect(calls.map((c) => c.name)).toContain("local_ai:completeProcessing"))
  })

  test("re-subscribes after the subscription fails", async () => {
    const q = await loadQueue()
    const { client, subscriptions } = fakeConvex(backend())
    await q.startProcessingQueue(client, { isSignedIn: async () => false })
    subscriptions[0]!.onError!(new Error("socket closed"))
    await q.notifySignedIn()
    expect(client.onUpdate).toHaveBeenCalledTimes(2)
  })

  test("a refused result (claim no longer held) is not reported as done", async () => {
    const q = await loadQueue()
    const { client, calls } = fakeConvex(
      backend({ "local_ai:completeProcessing": () => ({ ok: false, reason: "claim no longer held" }) })
    )
    const events: string[] = []
    q.onQueueEvent((e) => events.push(e.type))
    await q.startProcessingQueue(client, { isSignedIn: async () => true })
    await vi.waitFor(() => expect(events).toContain("idle"))
    expect(calls.map((c) => c.name)).toContain("local_ai:completeProcessing")
    expect(events).not.toContain("done")
    expect(calls.map((c) => c.name)).not.toContain("sessions:mergeCaptureTags")
  })

  test("a failure quotes the claim token", async () => {
    const q = await loadQueue()
    const { client, calls } = fakeConvex(
      backend({
        "local_ai:completeProcessing": () => {
          throw new Error("server said no")
        },
      })
    )
    await q.startProcessingQueue(client, { isSignedIn: async () => true })
    await vi.waitFor(() =>
      expect(calls.find((c) => c.name === "local_ai:failProcessing")?.args).toMatchObject({
        id: "c1",
        claim: "tok-1",
        error: "server said no",
      })
    )
  })
})
