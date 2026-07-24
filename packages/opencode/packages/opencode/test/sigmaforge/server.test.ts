import { afterEach, describe, expect, test } from "bun:test"
import { startSigmaForgeServer } from "@/sigmaforge/server"
import type { KernelExecutor } from "@/sigmaforge/kernel"
import type { KnowledgeBaseReader, KBEntry } from "@/sigmaforge/kb"
import type { ChatProvider } from "@/sigmaforge/provider"
import type { WebSearchClient } from "@/sigmaforge/web-search"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

class ServerKernel implements KernelExecutor {
  readonly calls: string[] = []
  readonly resetSessions: string[] = []

  async execute(_sessionID: string, code: string) {
    this.calls.push(code)
    if (code.includes("json.dumps")) return { text: '{"x":[-1,0,1],"y":[-1,0,1],"z":[[-1,0,1],[0,0,0],[1,0,-1]]}', images: [] }
    if (code.includes("p.show")) return { text: "", images: ["iVBORw0KGgo="] }
    if (code.includes("d == 0")) return { text: "0\nTrue", images: [] }
    return { text: "(x - 1)*e^x", images: [] }
  }

  async reset(sessionID: string) {
    this.resetSessions.push(sessionID)
  }
}

const kbEntry: KBEntry = { id: "parts", subject: "math", grade: "高三", type: "theorem", title: "分部积分", contentMd: "先复习乘法法则", difficulty: 0.6, prerequisites: [], qualityScore: 1 }
const knowledgeBase: KnowledgeBaseReader = {
  get: (id) => id === kbEntry.id ? kbEntry : undefined,
  search: async () => [{ ...kbEntry, score: 0.9 }],
  similar: async () => [kbEntry],
}
const queuedMistakes: string[] = []
const provider: ChatProvider = {
  id: "test",
  model: "test-model",
  async stream(_request, onChunk) {
    onChunk("真实")
    onChunk("回复")
    return { content: "真实回复", toolCalls: [] }
  },
}

let server: ReturnType<typeof startSigmaForgeServer> | undefined
const directories: string[] = []
afterEach(() => {
  void server?.stop(true)
  server = undefined
  directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true }))
})

describe("SigmaForge streaming server", () => {
  test("streams the mock provider response in order", async () => {
    server = startSigmaForgeServer({ port: 0 })
    const origin = `http://${server.hostname}:${server.port}`
    const created = await fetch(`${origin}/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ subject: "math" }),
    })
    const session = (await created.json()) as { id: string }
    const events = fetch(`${origin}/sessions/${session.id}/events`)
    await Bun.sleep(10)
    const sent = await fetch(`${origin}/sessions/${session.id}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "什么是导数" }),
    })
    expect(sent.status).toBe(202)
    const body = await (await events).text()
    expect(body).toContain('"type":"done"')
    expect(body).toContain('"type":"answer"')
    expect(body).toContain('"type":"theory.updated"')
    expect(body.indexOf("瞬时变化率")).toBeLessThan(body.indexOf("切线的斜率"))
    expect(body.indexOf('"type":"answer"')).toBeLessThan(body.indexOf('"type":"done"'))

    const nextEvents = fetch(`${origin}/sessions/${session.id}/events`)
    await Bun.sleep(10)
    await fetch(`${origin}/sessions/${session.id}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "再解释一次导数" }),
    })
    await (await nextEvents).text()
    const detail = await (await fetch(`${origin}/sessions/${session.id}`)).json() as { processRuns: Array<{ completed: boolean; events: Array<{ type: string }> }> }
    expect(detail.processRuns).toHaveLength(2)
    expect(detail.processRuns[0]?.completed).toBe(true)
    expect(detail.processRuns[0]?.events.some((event) => event.type === "chunk")).toBe(true)
    expect(detail.processRuns[0]?.events.some((event) => event.type === "answer")).toBe(true)
    expect(detail.processRuns[1]?.completed).toBe(true)
  })

  test("opens the SSE stream before a message is submitted", async () => {
    server = startSigmaForgeServer({ port: 0 })
    const origin = `http://${server.hostname}:${server.port}`
    const created = await fetch(`${origin}/sessions`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })
    const session = (await created.json()) as { id: string }
    const events = await fetch(`${origin}/sessions/${session.id}/events`)
    expect(events.status).toBe(200)
    const reader = events.body!.getReader()
    const first = await reader.read()
    expect(new TextDecoder().decode(first.value)).toBe(": connected\n\n")
    await reader.cancel()
  })

  test("reads and updates the active provider through local settings", async () => {
    let active = provider
    server = startSigmaForgeServer({
      port: 0,
      mockProvider: false,
      provider: active,
      providerSettings: {
        get: () => ({ active: active.id, profiles: {} }),
        update: () => (active = { ...provider, id: "alternate", model: "alternate-model" }),
      },
    })
    const origin = `http://${server.hostname}:${server.port}`
    expect(await (await fetch(`${origin}/settings/provider`)).json()).toMatchObject({ active: "test" })
    const updated = await fetch(`${origin}/settings/provider`, { method: "PUT", headers: { "content-type": "application/json" }, body: "{}" })
    expect(updated.status).toBe(200)
    expect(await updated.json()).toMatchObject({ active: "alternate" })
    expect(await (await fetch(`${origin}/health`)).json()).toMatchObject({ provider: { id: "alternate", model: "alternate-model" } })
  })

  test("rejects unknown subjects", async () => {
    server = startSigmaForgeServer({ port: 0 })
    const response = await fetch(`http://${server.hostname}:${server.port}/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ subject: "chemistry" }),
    })
    expect(response.status).toBe(400)
  })

  test("deletes an idle history session", async () => {
    const kernel = new ServerKernel()
    server = startSigmaForgeServer({ port: 0, kernel })
    const origin = `http://${server.hostname}:${server.port}`
    const created = await fetch(`${origin}/sessions`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })
    const session = (await created.json()) as { id: string }
    expect((await fetch(`${origin}/sessions/${session.id}`, { method: "DELETE" })).status).toBe(200)
    expect(kernel.resetSessions).toEqual([session.id])
    expect((await fetch(`${origin}/sessions/${session.id}`)).status).toBe(404)
  })

  test("enforces the CAS endpoint and streams verified integral artifacts", async () => {
    server = startSigmaForgeServer({ port: 0, kernel: new ServerKernel() })
    const origin = `http://${server.hostname}:${server.port}`
    const created = await fetch(`${origin}/sessions`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })
    const session = (await created.json()) as { id: string }
    const unsafe = await fetch(`${origin}/sessions/${session.id}/tools/cas`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tool: "eval", expression: "__import__(os)" }) })
    expect(unsafe.status).toBe(403)
    const events = fetch(`${origin}/sessions/${session.id}/events`)
    await Bun.sleep(10)
    await fetch(`${origin}/sessions/${session.id}/messages`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: "求 ∫ x e^x dx" }) })
    const stream = await (await events).text()
    expect(stream).toContain('"type":"tool.result"')
    expect(stream).toContain('"type":"artifact"')
    expect(stream).toContain('"type":"artifact.pending"')
    expect(stream).toContain("✓ 通过")
    expect(stream.indexOf('"type":"tool.start"')).toBeLessThan(stream.indexOf('"type":"tool.result"'))
    const tree = await fetch(`${origin}/sessions/${session.id}/theory`)
    const treeBody = await tree.text()
    expect(treeBody).toContain("分部积分")
    expect(treeBody).toContain('"status":"verified"')
    const context = await fetch(`${origin}/sessions/${session.id}/context`)
    const contextBody = await context.text()
    expect(contextBody).toContain('"budget":8192')
    expect(contextBody).not.toContain('"prompt"')
  })

  test("restores verification and plot artifacts after a server restart", async () => {
    const directory = mkdtempSync(join(tmpdir(), "sigmaforge-server-sessions-"))
    directories.push(directory)
    const storage = join(directory, "sessions.json")
    server = startSigmaForgeServer({ port: 0, kernel: new ServerKernel(), sessionStoragePath: storage })
    let origin = `http://${server.hostname}:${server.port}`
    const created = await fetch(`${origin}/sessions`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })
    const session = (await created.json()) as { id: string }
    const events = fetch(`${origin}/sessions/${session.id}/events`)
    await Bun.sleep(10)
    await fetch(`${origin}/sessions/${session.id}/messages`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: "求 ∫ x e^x dx" }) })
    await (await events).text()
    await server.stop(true)
    server = startSigmaForgeServer({ port: 0, kernel: new ServerKernel(), sessionStoragePath: storage })
    origin = `http://${server.hostname}:${server.port}`
    const detail = await (await fetch(`${origin}/sessions/${session.id}`)).json() as { artifacts: Array<{ kind: string }> }
    expect(detail.artifacts.map((artifact) => artifact.kind)).toEqual(["plotly2d"])
    const theory = await (await fetch(`${origin}/sessions/${session.id}/theory`)).text()
    expect(theory).toContain('"status":"verified"')
    expect(theory).toContain('"artifactIDs"')
  })

  test("keeps KB access subject-scoped and streams mistake learning guidance", async () => {
    server = startSigmaForgeServer({ port: 0, knowledgeBase, mistakeSink: { enqueue: (input) => (queuedMistakes.push(input.attribution), "mistake") } })
    const origin = `http://${server.hostname}:${server.port}`
    const created = await fetch(`${origin}/sessions`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })
    const session = (await created.json()) as { id: string }
    const found = await fetch(`${origin}/sessions/${session.id}/tools/kb`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ operation: "search", query: "分部积分" }) })
    expect(found.status).toBe(200)
    expect(await found.json()).toEqual([{ ...kbEntry, score: 0.9 }])

    const events = fetch(`${origin}/sessions/${session.id}/events`)
    await Bun.sleep(10)
    await fetch(`${origin}/sessions/${session.id}/messages`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: "这道题我为什么错，分部积分公式用错了" }) })
    const stream = await (await events).text()
    expect(stream).toContain('"type":"mistake.attributed"')
    expect(stream).toContain('"type":"kb.result"')
    expect(stream).toContain('"type":"learning.path"')
    expect(stream).toContain("KB:parts")
    expect(queuedMistakes.at(-1)).toBe("rule")
  })

  test("streams a configured real provider and reports it in health", async () => {
    server = startSigmaForgeServer({ port: 0, mockProvider: false, provider })
    const origin = `http://${server.hostname}:${server.port}`
    expect(await (await fetch(`${origin}/health`)).json()).toMatchObject({ provider: { mode: "real", id: "test", model: "test-model" } })
    const created = await fetch(`${origin}/sessions`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })
    const session = (await created.json()) as { id: string }
    const events = fetch(`${origin}/sessions/${session.id}/events`)
    await Bun.sleep(10)
    await fetch(`${origin}/sessions/${session.id}/messages`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: "你好" }) })
    const stream = await (await events).text()
    expect(stream).toContain("真实")
    expect(stream).toContain("回复")
    expect(stream).toContain('"type":"done"')
  })

  test("buffers provider output into complete lines and keeps reasoning before the answer", async () => {
    const lineProvider: ChatProvider = {
      id: "test",
      model: "line-model",
      async stream(_request, onChunk, onReasoning) {
        onReasoning?.("先分")
        onReasoning?.("析\n")
        onChunk("第一")
        onChunk("行\n第二行")
        return { content: "第一行\n第二行", toolCalls: [] }
      },
    }
    server = startSigmaForgeServer({ port: 0, mockProvider: false, provider: lineProvider })
    const origin = `http://${server.hostname}:${server.port}`
    const created = await fetch(`${origin}/sessions`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })
    const session = (await created.json()) as { id: string }
    const events = fetch(`${origin}/sessions/${session.id}/events`)
    await Bun.sleep(10)
    await fetch(`${origin}/sessions/${session.id}/messages`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: "逐行回答" }) })
    const stream = await (await events).text()
    expect(stream).toContain('"type":"reasoning.chunk","text":"先分析\\n"')
    expect(stream).toContain('"type":"chunk","text":"第一行\\n"')
    expect(stream).toContain('"type":"chunk","text":"第二行"')
    expect(stream.indexOf('"type":"reasoning.chunk"')).toBeLessThan(stream.indexOf('"type":"chunk"'))
  })

  test("executes real provider CAS, verification, and plot tool calls before the final answer", async () => {
    const requests: Parameters<ChatProvider["stream"]>[0][] = []
    let round = 0
    const toolProvider: ChatProvider = {
      id: "test",
      model: "tool-model",
      async stream(request, onChunk) {
        requests.push(request)
        round++
        if (round === 1) return {
          content: "",
          toolCalls: [
            { id: "integrate", name: "sigmaforge_integrate", arguments: '{"expression":"x*e^x","variable":"x"}' },
            { id: "verify", name: "sigmaforge_verify", arguments: '{"lhs":"diff((x-1)*e^x,x)","rhs":"x*e^x"}' },
            { id: "plot", name: "sigmaforge_plot_function2d", arguments: '{"expression":"x*e^x","variable":"x","min":-3,"max":2,"width":800}' },
          ],
        }
        onChunk("已使用真实工具完成计算、验证和绘图。")
        return { content: "已使用真实工具完成计算、验证和绘图。", toolCalls: [] }
      },
    }
    server = startSigmaForgeServer({ port: 0, mockProvider: false, provider: toolProvider, kernel: new ServerKernel() })
    const origin = `http://${server.hostname}:${server.port}`
    const created = await fetch(`${origin}/sessions`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })
    const session = (await created.json()) as { id: string }
    const events = fetch(`${origin}/sessions/${session.id}/events`)
    await Bun.sleep(10)
    await fetch(`${origin}/sessions/${session.id}/messages`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: "求积分并验证和绘图" }) })
    const stream = await (await events).text()
    expect(stream).toContain('"tool":"integrate"')
    expect(stream).toContain('"type":"verification"')
    expect(stream).toContain('"type":"artifact.pending"')
    expect(stream).toContain('"type":"artifact"')
    expect(stream).toContain("已使用真实工具")
    expect(requests[0]?.tools?.some((tool) => tool.function.name === "sigmaforge_integrate")).toBe(true)
    expect(requests[1]?.messages?.filter((message) => message.role === "tool")).toHaveLength(3)
  })

  test("permits explicit web search, persists cited sources, and exposes them in the session", async () => {
    let calls = 0
    const webSearch: WebSearchClient = {
      async search(input) {
        calls++
        expect(input).toEqual({ query: "gamma function", limit: 2 })
        return { query: "gamma function", sources: [{ title: "DLMF Gamma", url: "https://dlmf.nist.gov/5.2", domain: "dlmf.nist.gov", snippet: "Definition" }] }
      },
    }
    let round = 0
    const webProvider: ChatProvider = {
      id: "test",
      model: "web-model",
      async stream(_request, onChunk) {
        round++
        if (round === 1) return { content: "", toolCalls: [{ id: "web", name: "sigmaforge_web_search", arguments: '{"query":"gamma function","limit":2}' }] }
        onChunk("已列出可核查来源。")
        return { content: "已列出可核查来源。", toolCalls: [] }
      },
    }
    server = startSigmaForgeServer({ port: 0, mockProvider: false, provider: webProvider, webSearch })
    const origin = `http://${server.hostname}:${server.port}`
    const created = await fetch(`${origin}/sessions`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })
    const session = (await created.json()) as { id: string }
    const events = fetch(`${origin}/sessions/${session.id}/events`)
    await Bun.sleep(10)
    await fetch(`${origin}/sessions/${session.id}/messages`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: "请联网搜索 gamma function 的权威出处" }) })
    const stream = await (await events).text()
    expect(calls).toBe(1)
    expect(stream).toContain('"type":"web.result"')
    expect(stream).toContain("https://dlmf.nist.gov/5.2")
    const detail = await (await fetch(`${origin}/sessions/${session.id}`)).json() as { webResults: Array<{ sources: unknown[] }> }
    expect(detail.webResults[0]?.sources).toHaveLength(1)
  })

  test("permits web search without an explicit user request even when the local KB matches", async () => {
    let webCalls = 0
    const webSearch: WebSearchClient = { async search() { webCalls++; return { query: "", sources: [] } } }
    let round = 0
    const webProvider: ChatProvider = {
      id: "test",
      model: "web-fallback-model",
      async stream(_request, onChunk) {
        round++
        if (round === 1) return { content: "", toolCalls: [{ id: "web", name: "sigmaforge_web_search", arguments: '{"query":"分部积分"}' }] }
        onChunk("已查询网络来源。")
        return { content: "已查询网络来源。", toolCalls: [] }
      },
    }
    server = startSigmaForgeServer({ port: 0, mockProvider: false, provider: webProvider, knowledgeBase, webSearch })
    const origin = `http://${server.hostname}:${server.port}`
    const created = await fetch(`${origin}/sessions`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })
    const session = (await created.json()) as { id: string }
    const events = fetch(`${origin}/sessions/${session.id}/events`)
    await Bun.sleep(10)
    await fetch(`${origin}/sessions/${session.id}/messages`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: "解释分部积分" }) })
    const stream = await (await events).text()
    expect(webCalls).toBe(1)
    expect(stream).toContain('"type":"web.result"')
    expect(stream).not.toContain('"type":"kb.result"')
  })

  test("falls back to the controlled search only when the local KB has no match", async () => {
    let webCalls = 0
    const webSearch: WebSearchClient = { async search() { webCalls++; return { query: "unknown theorem", sources: [] } } }
    let round = 0
    const webProvider: ChatProvider = {
      id: "test",
      model: "web-empty-kb-model",
      async stream(_request, onChunk) {
        round++
        if (round === 1) return { content: "", toolCalls: [{ id: "web", name: "sigmaforge_web_search", arguments: '{"query":"unknown theorem"}' }] }
        onChunk("本地没有匹配内容，已查询受控来源。")
        return { content: "本地没有匹配内容，已查询受控来源。", toolCalls: [] }
      },
    }
    const emptyKnowledgeBase: KnowledgeBaseReader = { get: () => undefined, search: async () => [], similar: async () => [] }
    server = startSigmaForgeServer({ port: 0, mockProvider: false, provider: webProvider, knowledgeBase: emptyKnowledgeBase, webSearch })
    const origin = `http://${server.hostname}:${server.port}`
    const created = await fetch(`${origin}/sessions`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })
    const session = (await created.json()) as { id: string }
    const events = fetch(`${origin}/sessions/${session.id}/events`)
    await Bun.sleep(10)
    await fetch(`${origin}/sessions/${session.id}/messages`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: "解释 unknown theorem" }) })
    const stream = await (await events).text()
    expect(webCalls).toBe(1)
    expect(stream).toContain('"type":"web.result"')
  })

  test("reports a controlled-search outage without exposing a general browsing fallback", async () => {
    const webSearch: WebSearchClient = { async search() { throw new Error("Local SearXNG search failed: 503") } }
    let round = 0
    const webProvider: ChatProvider = {
      id: "test",
      model: "web-error-model",
      async stream(_request, onChunk) {
        round++
        if (round === 1) return { content: "", toolCalls: [{ id: "web", name: "sigmaforge_web_search", arguments: '{"query":"Euler formula"}' }] }
        onChunk("本地检索不可用。")
        return { content: "本地检索不可用。", toolCalls: [] }
      },
    }
    server = startSigmaForgeServer({ port: 0, mockProvider: false, provider: webProvider, webSearch })
    const origin = `http://${server.hostname}:${server.port}`
    const created = await fetch(`${origin}/sessions`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })
    const session = (await created.json()) as { id: string }
    const events = fetch(`${origin}/sessions/${session.id}/events`)
    await Bun.sleep(10)
    await fetch(`${origin}/sessions/${session.id}/messages`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: "请联网搜索 Euler formula" }) })
    const stream = await (await events).text()
    expect(stream).toContain('"type":"tool.error"')
    expect(stream).toContain("Local SearXNG search failed: 503")
    expect(stream).not.toContain('"type":"web.result"')
  })

  test("rejects a provider request for a disabled tool", async () => {
    const unsafeProvider: ChatProvider = {
      id: "test",
      model: "unsafe-model",
      async stream() {
        return { content: "", toolCalls: [{ id: "bad", name: "sigmaforge_bash", arguments: '{}' }] }
      },
    }
    server = startSigmaForgeServer({ port: 0, mockProvider: false, provider: unsafeProvider })
    const origin = `http://${server.hostname}:${server.port}`
    const created = await fetch(`${origin}/sessions`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })
    const session = (await created.json()) as { id: string }
    const events = fetch(`${origin}/sessions/${session.id}/events`)
    await Bun.sleep(10)
    await fetch(`${origin}/sessions/${session.id}/messages`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: "运行命令" }) })
    const stream = await (await events).text()
    expect(stream).toContain("unknown or disabled tool")
    expect(stream).toContain('"type":"done"')
  })

  test("allows more than six productive tool rounds", async () => {
    let calls = 0
    const loopingProvider: ChatProvider = {
      id: "test",
      model: "looping-model",
      async stream(request, onChunk) {
        calls++
        if (calls <= 8) {
          return { content: "", toolCalls: [{ id: `call-${calls}`, name: "sigmaforge_simplify", arguments: JSON.stringify({ expression: `x+${calls}` }) }] }
        }
        onChunk("根据已有 CAS 结果，最终答案为 $2x$。")
        return { content: "根据已有 CAS 结果，最终答案为 $2x$。", toolCalls: [] }
      },
    }
    const kernel = new ServerKernel()
    server = startSigmaForgeServer({ port: 0, mockProvider: false, provider: loopingProvider, kernel })
    const origin = `http://${server.hostname}:${server.port}`
    const created = await fetch(`${origin}/sessions`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })
    const session = (await created.json()) as { id: string }
    const events = fetch(`${origin}/sessions/${session.id}/events`)
    await Bun.sleep(10)
    await fetch(`${origin}/sessions/${session.id}/messages`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: "化简 x+x" }) })
    const stream = await (await events).text()
    expect(calls).toBe(9)
    expect(kernel.calls.filter((code) => code.includes("simplify_full"))).toHaveLength(8)
    expect(stream).toContain("最终答案")
    expect(stream).toContain('"type":"done"')
    expect(stream).not.toContain("maximum of 6 tool rounds")
  })

  test("lets the provider correct an allowed tool error", async () => {
    let calls = 0
    const correctingProvider: ChatProvider = {
      id: "test",
      model: "correcting-model",
      async stream(_request, onChunk) {
        calls++
        if (calls === 1) return { content: "", toolCalls: [{ id: "bad", name: "sigmaforge_simplify", arguments: '{"expression":' }] }
        if (calls === 2) return { content: "", toolCalls: [{ id: "fixed", name: "sigmaforge_simplify", arguments: '{"expression":"x+x"}' }] }
        onChunk("参数已修正，结果为 $2x$。")
        return { content: "参数已修正，结果为 $2x$。", toolCalls: [] }
      },
    }
    server = startSigmaForgeServer({ port: 0, mockProvider: false, provider: correctingProvider, kernel: new ServerKernel() })
    const origin = `http://${server.hostname}:${server.port}`
    const created = await fetch(`${origin}/sessions`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })
    const session = (await created.json()) as { id: string }
    const events = fetch(`${origin}/sessions/${session.id}/events`)
    await Bun.sleep(10)
    await fetch(`${origin}/sessions/${session.id}/messages`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: "化简" }) })
    const stream = await (await events).text()
    expect(stream).toContain('"type":"tool.error"')
    expect(stream).toContain("参数已修正")
    expect(stream).toContain('"type":"done"')
  })

  test("forces a final response after repeated cached calls make no progress", async () => {
    let calls = 0
    const repetitiveProvider: ChatProvider = {
      id: "test",
      model: "repetitive-model",
      async stream(request, onChunk) {
        calls++
        if (request.tools?.length) return { content: "", toolCalls: [{ id: `repeat-${calls}`, name: "sigmaforge_simplify", arguments: calls % 2 ? '{"expression":"x+x"}' : '{ "expression": "x+x" }' }] }
        onChunk("依据缓存结果，答案为 $2x$。")
        return { content: "依据缓存结果，答案为 $2x$。", toolCalls: [] }
      },
    }
    const kernel = new ServerKernel()
    server = startSigmaForgeServer({ port: 0, mockProvider: false, provider: repetitiveProvider, kernel })
    const origin = `http://${server.hostname}:${server.port}`
    const created = await fetch(`${origin}/sessions`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })
    const session = (await created.json()) as { id: string }
    const events = fetch(`${origin}/sessions/${session.id}/events`)
    await Bun.sleep(10)
    await fetch(`${origin}/sessions/${session.id}/messages`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: "化简" }) })
    const stream = await (await events).text()
    expect(kernel.calls.filter((code) => code.includes("simplify_full"))).toHaveLength(1)
    expect(calls).toBe(5)
    expect(stream).toContain("依据缓存结果")
  })

  test("stops an active provider request and interrupts its kernel", async () => {
    let interrupted = 0
    const waitingProvider: ChatProvider = {
      id: "test",
      model: "waiting-model",
      async stream(request) {
        await new Promise<void>((_resolve, reject) => request.signal?.addEventListener("abort", () => reject(request.signal?.reason), { once: true }))
        return { content: "", toolCalls: [] }
      },
    }
    const kernel: KernelExecutor = {
      async execute() { return { text: "", images: [] } },
      async interrupt() { interrupted++ },
    }
    server = startSigmaForgeServer({ port: 0, mockProvider: false, provider: waitingProvider, kernel })
    const origin = `http://${server.hostname}:${server.port}`
    const created = await fetch(`${origin}/sessions`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })
    const session = (await created.json()) as { id: string }
    const events = fetch(`${origin}/sessions/${session.id}/events`)
    await Bun.sleep(10)
    await fetch(`${origin}/sessions/${session.id}/messages`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: "等待" }) })
    const stopped = await fetch(`${origin}/sessions/${session.id}/stop`, { method: "POST" })
    expect(await stopped.json()).toEqual({ stopped: true })
    const stream = await (await events).text()
    expect(interrupted).toBe(1)
    expect(stream).toContain("用户已停止生成")
    expect(stream).toContain('"type":"done"')
  })

})
