import { afterEach, describe, expect, test } from "bun:test"
import { startSigmaForgeServer } from "@/sigmaforge/server"
import { stripStageMarkers, ThinkingMarkerReader, ThinkingSummaryStore } from "@/sigmaforge/thinking"

let server: ReturnType<typeof startSigmaForgeServer> | undefined

afterEach(() => {
  void server?.stop(true)
  server = undefined
})

describe("ThinkingMarkerReader", () => {
  test("detects markers split across streaming chunks", () => {
    const reader = new ThinkingMarkerReader()
    expect(reader.push("先算积分。\n[[STA")).toEqual({ text: "先算积分。\n", markers: 0 })
    expect(reader.push("GE]]\n接着验证。")).toEqual({ text: "\n接着验证。", markers: 1 })
    expect(reader.flush()).toEqual({ text: "", markers: 0 })
  })

  test("removes marker lines from persisted answers", () => {
    expect(stripStageMarkers("引言\n[[STAGE]]\n答案")).toBe("引言\n答案")
    expect(stripStageMarkers("[[STAGE]]回答")).toBe("回答")
  })
})

describe("ThinkingSummaryStore", () => {
  test("adds, edits, and removes summaries", () => {
    const store = new ThinkingSummaryStore()
    const first = store.add({ method: "integration by parts", reason: "x times e^x is a product", caution: "watch signs" })
    const second = store.add({ method: "substitution", reason: "linear inner term", caution: "update bounds" })

    expect(first.order).toBe(1)
    expect(second.order).toBe(2)
    expect(store.snapshot().summaries.map((item) => item.id)).toEqual([first.id, second.id])

    const updated = store.update(first.id, { caution: "keep the sign" })
    expect(updated.caution).toBe("keep the sign")

    const removed = store.remove(first.id)
    expect(removed.removed.id).toBe(first.id)
    expect(store.snapshot().summaries.map((item) => item.id)).toEqual([second.id])
  })

  test("rollback removes a target and all later summaries", () => {
    const store = new ThinkingSummaryStore()
    const first = store.add({ method: "expand", reason: "simplify product", caution: "" })
    const second = store.add({ method: "factor", reason: "new direction", caution: "" })
    const third = store.add({ method: "verify", reason: "check result", caution: "" })

    const result = store.rollbackTo(second.id)
    expect(result.removed.map((item) => item.id)).toEqual([second.id, third.id])
    expect(store.snapshot().summaries.map((item) => item.id)).toEqual([first.id])
  })
})

describe("thinking summary server API", () => {
  test("adds, edits, deletes, and rolls back summaries", async () => {
    server = startSigmaForgeServer({ port: 0 })
    const origin = `http://${server.hostname}:${server.port}`
    const created = await fetch(`${origin}/sessions`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })
    const session = (await created.json()) as { id: string }

    const firstResponse = await fetch(`${origin}/sessions/${session.id}/thinking`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ method: "integration by parts", reason: "product of x and e^x", caution: "watch signs" }),
    })
    expect(firstResponse.status).toBe(201)
    const first = (await firstResponse.json()) as { summary: { id: string }; summaries: Array<{ id: string }> }

    const secondResponse = await fetch(`${origin}/sessions/${session.id}/thinking`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ method: "substitution", reason: "linear inner term", caution: "" }),
    })
    expect(secondResponse.status).toBe(201)
    const second = (await secondResponse.json()) as { summary: { id: string } }

    const edit = await fetch(`${origin}/sessions/${session.id}/thinking/${first.summary.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ caution: "keep the sign" }),
    })
    expect(edit.status).toBe(200)
    const edited = (await edit.json()) as { summary: { caution: string }; summaries: Array<{ id: string }> }
    expect(edited.summary.caution).toBe("keep the sign")

    const detail = await (await fetch(`${origin}/sessions/${session.id}`)).json() as { thinkingSummaries: Array<{ id: string }> }
    expect(detail.thinkingSummaries.map((item) => item.id)).toEqual([first.summary.id, second.summary.id])

    const rollback = await fetch(`${origin}/sessions/${session.id}/thinking/rollback`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ targetSummaryID: second.summary.id, reason: "wrong direction" }),
    })
    expect(rollback.status).toBe(200)
    const rolled = (await rollback.json()) as { removed: string[]; summaries: Array<{ id: string }> }
    expect(rolled.removed).toEqual([second.summary.id])
    expect(rolled.summaries.map((item) => item.id)).toEqual([first.summary.id])

    const remove = await fetch(`${origin}/sessions/${session.id}/thinking/${first.summary.id}`, { method: "DELETE" })
    expect(remove.status).toBe(200)
    const removed = (await remove.json()) as { summaries: Array<{ id: string }> }
    expect(removed.summaries).toEqual([])
  })

  test("streams thinking markers without leaking them into the answer", async () => {
    const requests: Array<{ tools?: Array<{ function: { name: string } }> }> = []
    const provider = {
      id: "marker-test",
      model: "marker-test-model",
      async stream(request: { tools?: Array<{ function: { name: string } }> }, onChunk: (text: string) => void, onReasoning?: (text: string) => void) {
        requests.push(request)
        onReasoning?.("先判断被积函数结构。")
        onChunk("[[STA")
        onChunk("GE]]")
        onChunk("回答完毕")
        return { content: "[[STAGE]]回答完毕", toolCalls: [] }
      },
    }
    server = startSigmaForgeServer({ port: 0, mockProvider: false, provider })
    const origin = `http://${server.hostname}:${server.port}`
    const created = await fetch(`${origin}/sessions`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })
    const session = (await created.json()) as { id: string }
    const events = fetch(`${origin}/sessions/${session.id}/events`)
    await Bun.sleep(10)
    await fetch(`${origin}/sessions/${session.id}/messages`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: "solve with markers", reasoning: "high" }) })
    const stream = await (await events).text()
    expect(stream.match(/"type":"thinking.marker"/g)?.length).toBe(1)
    expect(stream).toContain("先判断被积函数结构。")
    expect(stream).toContain("回答完毕")
    expect(stream).not.toContain("STAGE")
    expect(requests[0]?.tools?.some((tool) => tool.function.name === "sigmaforge_thinking_summary")).toBe(false)
    const detail = await (await fetch(`${origin}/sessions/${session.id}`)).json() as { messages: Array<{ role: string; content: string }>; thinkingSummaries: unknown[] }
    expect(detail.messages.at(-1)?.content).toBe("回答完毕")
    expect(detail.thinkingSummaries).toHaveLength(1)
  })

  test("does not auto-record summaries for computational tools", async () => {
    let round = 0
    const provider = {
      id: "auto-thinking-test",
      model: "auto-thinking-test-model",
      async stream(_request: unknown, onChunk: (text: string) => void) {
        round++
        if (round === 1) return {
          content: "",
          toolCalls: [
            { id: "diff", name: "sigmaforge_diff", arguments: '{"expression":"x^2","variable":"x"}' },
            { id: "eval", name: "sigmaforge_eval", arguments: '{"expression":"2^3"}' },
          ],
        }
        onChunk("done")
        return { content: "done", toolCalls: [] }
      },
    }
    const kernel = {
      async execute() {
        return { text: "ok", images: [] }
      },
      async reset() {},
    }
    server = startSigmaForgeServer({ port: 0, mockProvider: false, provider, kernel })
    const origin = `http://${server.hostname}:${server.port}`
    const created = await fetch(`${origin}/sessions`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })
    const session = (await created.json()) as { id: string }
    const events = fetch(`${origin}/sessions/${session.id}/events`)
    await Bun.sleep(10)
    await fetch(`${origin}/sessions/${session.id}/messages`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: "solve with tools" }) })
    await (await events).text()
    const detail = await (await fetch(`${origin}/sessions/${session.id}`)).json() as { thinkingSummaries: unknown[] }
    expect(detail.thinkingSummaries).toEqual([])
  })

  test("summarizes trimmed thinking in an isolated model session", async () => {
    const requests: Array<{ messages?: Array<{ role: string; content: string | null }>; tools?: unknown; reasoning?: string; maxTokens?: number }> = []
    const provider = {
      id: "summarizer-test",
      model: "summarizer-test-model",
      async stream(request: { messages?: Array<{ role: string; content: string | null }>; tools?: unknown; reasoning?: string; maxTokens?: number }, onChunk: (text: string) => void) {
        requests.push(request)
        onChunk('```json\n{"method":"分部积分","reason":"两项相乘适合分部","caution":"注意符号"}\n```')
        return { content: "summarized", toolCalls: [] }
      },
    }
    server = startSigmaForgeServer({ port: 0, mockProvider: false, provider })
    const origin = `http://${server.hostname}:${server.port}`
    const response = await fetch(`${origin}/thinking/summarize`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "把 x 与 e^x 分开处理，先用分部积分。" }),
    })
    expect(response.status).toBe(200)
    const body = (await response.json()) as { summary: { method: string; reason: string; caution: string }; degraded: boolean }
    expect(body.degraded).toBe(false)
    expect(body.summary).toEqual({ method: "分部积分", reason: "两项相乘适合分部", caution: "注意符号" })
    expect(requests[0]?.tools).toBeUndefined()
    expect(requests[0]?.reasoning).toBe("none")
    expect(requests[0]?.messages?.length).toBe(2)
    expect(requests[0]?.messages?.[0]?.role).toBe("system")
    expect(requests[0]?.messages?.[1]?.content).toContain("分部积分")
  })

  test("falls back to a local summary when no real provider is configured", async () => {
    server = startSigmaForgeServer({ port: 0 })
    const origin = `http://${server.hostname}:${server.port}`
    const response = await fetch(`${origin}/thinking/summarize`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "先判断被积函数结构。再决定方法。" }),
    })
    expect(response.status).toBe(200)
    const body = (await response.json()) as { summary: { method: string; reason: string }; degraded: boolean }
    expect(body.degraded).toBe(true)
    expect(body.summary.method).toBe("思考阶段")
    expect(body.summary.reason).toContain("先判断被积函数结构")
  })
})
