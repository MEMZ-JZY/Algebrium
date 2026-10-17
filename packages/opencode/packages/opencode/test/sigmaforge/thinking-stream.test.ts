import { expect, test } from "bun:test"
import { startSigmaForgeServer } from "@/sigmaforge/server"
import { summarizeThinking } from "@/sigmaforge/thinking-jobs"
import type { ThinkingSummarySnapshot } from "@/sigmaforge/thinking"

test("summary subscription survives main done, persists stage identity and reconnects with a snapshot", async () => {
  let finishSummary!: () => void
  const summaryReady = new Promise<void>((resolve) => { finishSummary = resolve })
  const server = startSigmaForgeServer({ port: 0, mockProvider: false, provider: {
    id: "stream-test", model: "stream-test",
    async stream(request, chunk, reasoning) {
      if (request.maxTokens === 600) {
        await summaryReady
        chunk('{"method":"已归纳","reason":"阶段完成","caution":""}')
        return { content: "", toolCalls: [] }
      }
      reasoning?.("阶段的原始思考")
      chunk("[[STA")
      chunk("GE]]\n最终回答")
      return { content: "[[STAGE]]\n最终回答", toolCalls: [] }
    },
  } })
  const origin = `http://${server.hostname}:${server.port}`
  const post = (path: string, body: unknown) => fetch(origin + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  try {
    const session = await (await post("/sessions", {})).json() as { id: string }
    const response = await fetch(`${origin}/sessions/${session.id}/thinking/events`)
    reader = response.body!.getReader()
    let buffer = ""
    const decoder = new TextDecoder()
    async function nextSnapshot() {
      while (true) {
        const end = buffer.indexOf("\n\n")
        if (end >= 0) {
          const frame = buffer.slice(0, end)
          buffer = buffer.slice(end + 2)
          const line = frame.split("\n").find((item) => item.startsWith("data: "))
          if (line) return JSON.parse(line.slice(6)) as ThinkingSummarySnapshot
          continue
        }
        const next = await reader!.read()
        if (next.done) throw new Error("Summary subscription ended with the main reply")
        buffer += decoder.decode(next.value, { stream: true })
      }
    }
    expect((await nextSnapshot()).summaries).toEqual([])
    const main = await fetch(`${origin}/sessions/${session.id}/events`)
    await post(`/sessions/${session.id}/messages`, { message: "test" })
    expect(await main.text()).toContain('"type":"done"')
    expect((await nextSnapshot()).summaries[0].status).toBe("pending")
    finishSummary()
    const ready = await nextSnapshot()
    expect(ready.summaries[0].status).toBe("ready")
    expect(ready.summaries[0].method).toBe("已归纳")
    const detail = await (await fetch(`${origin}/sessions/${session.id}`)).json() as { processRuns: Array<{ events: Array<{ type: string; stageID?: string; summaryID?: string }> }> }
    const marker = detail.processRuns[0].events.find((event) => event.type === "thinking.marker")!
    expect(marker.stageID).toBe(ready.summaries[0].stageID)
    expect(marker.summaryID).toBe(ready.summaries[0].id)
    await reader.cancel()
    reader = (await fetch(`${origin}/sessions/${session.id}/thinking/events`)).body!.getReader()
    buffer = ""
    expect((await nextSnapshot()).summaries[0].method).toBe("已归纳")
  } finally {
    finishSummary()
    await reader?.cancel()
    server.stop(true)
  }
}, 10000)

test("summary timeout and unsupported reasoning only degrade the summary", async () => {
  const result = await summarizeThinking("保留此阶段", {
    id: "timeout", model: "timeout",
    async stream() { return await new Promise<never>(() => {}) },
  }, undefined, 10)
  expect(result.degraded).toBe(true)
  expect(result.summary.reason).toBe("保留此阶段")
  const unsupported = await summarizeThinking("摘要兼容", {
    id: "unsupported", model: "unsupported",
    async stream() { throw new Error("reasoning_effort none unsupported") },
  })
  expect(unsupported.degraded).toBe(true)
})
