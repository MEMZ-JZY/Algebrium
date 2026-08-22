import { afterEach, describe, expect, test } from "bun:test"
import { startSigmaForgeServer } from "@/sigmaforge/server"
import { ThinkingSummaryStore } from "@/sigmaforge/thinking"

let server: ReturnType<typeof startSigmaForgeServer> | undefined

afterEach(() => {
  void server?.stop(true)
  server = undefined
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

  test("executes model thinking summary and rollback tools", async () => {
    let round = 0
    const requests: Array<{ tools?: Array<{ function: { name: string } }> }> = []
    const provider = {
      id: "thinking-test",
      model: "thinking-test-model",
      async stream(request: { tools?: Array<{ function: { name: string } }> }, onChunk: (text: string) => void) {
        requests.push(request)
        round++
        if (round === 1) return { content: "", toolCalls: [{ id: "summary", name: "sigmaforge_thinking_summary", arguments: '{"method":"integration by parts","reason":"x times e^x is a product","caution":"watch signs"}' }] }
        if (round === 2) return { content: "", toolCalls: [{ id: "rollback", name: "sigmaforge_thinking_rollback", arguments: '{"reason":"wrong direction"}' }] }
        onChunk("corrected path complete")
        return { content: "corrected path complete", toolCalls: [] }
      },
    }
    server = startSigmaForgeServer({ port: 0, mockProvider: false, provider })
    const origin = `http://${server.hostname}:${server.port}`
    const created = await fetch(`${origin}/sessions`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })
    const session = (await created.json()) as { id: string }
    const events = fetch(`${origin}/sessions/${session.id}/events`)
    await Bun.sleep(10)
    await fetch(`${origin}/sessions/${session.id}/messages`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: "solve with thinking" }) })
    const stream = await (await events).text()
    expect(stream).toContain('"type":"thinking.updated"')
    expect(stream).toContain('"method":"integration by parts"')
    expect(stream).toContain('"type":"tool.result","tool":"thinking.summary"')
    expect(stream).toContain('"type":"tool.result","tool":"thinking.rollback"')
    expect(requests[0]?.tools?.some((tool) => tool.function.name === "sigmaforge_thinking_summary")).toBe(true)
    const detail = await (await fetch(`${origin}/sessions/${session.id}`)).json() as { thinkingSummaries: unknown[] }
    expect(detail.thinkingSummaries).toEqual([])
  })

  test("auto-records summaries for computational tools when the model omits them", async () => {
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
    const stream = await (await events).text()
    expect(stream).toContain('"type":"thinking.updated"')
    const detail = await (await fetch(`${origin}/sessions/${session.id}`)).json() as { thinkingSummaries: Array<{ method: string }> }
    expect(detail.thinkingSummaries.map((item) => item.method)).toEqual(["计算导数", "计算数学表达式"])
  })

  test("only auto-records tools not already covered by a model summary", async () => {
    let round = 0
    const provider = {
      id: "covered-thinking-test",
      model: "covered-thinking-test-model",
      async stream(_request: unknown, onChunk: (text: string) => void) {
        round++
        if (round === 1) return {
          content: "",
          toolCalls: [
            { id: "summary", name: "sigmaforge_thinking_summary", arguments: '{"method":"求导","reason":"先分析函数变化","caution":"注意链式法则"}' },
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
    await fetch(`${origin}/sessions/${session.id}/messages`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: "solve with mixed summaries" }) })
    await (await events).text()
    const detail = await (await fetch(`${origin}/sessions/${session.id}`)).json() as { thinkingSummaries: Array<{ method: string }> }
    expect(detail.thinkingSummaries.map((item) => item.method)).toEqual(["求导", "计算数学表达式"])
  })
})
