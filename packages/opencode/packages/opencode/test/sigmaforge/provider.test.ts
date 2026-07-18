import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { createConfiguredProvider, loadSigmaForgeConfig } from "@/sigmaforge/provider-config"
import { OpenAICompatibleProvider, consumeOpenAIStream } from "@/sigmaforge/provider"

const directories: string[] = []
let server: ReturnType<typeof Bun.serve> | undefined
afterEach(() => {
  void server?.stop(true)
  server = undefined
  directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true }))
})

describe("SigmaForge provider configuration", () => {
  test("loads the active profile and resolves its key only from the environment", async () => {
    const directory = mkdtempSync(join(tmpdir(), "sigmaforge-provider-"))
    directories.push(directory)
    const path = join(directory, "config.json")
    await Bun.write(path, JSON.stringify({ provider: { mode: "real", active: "local", profiles: { local: { provider: "custom", model: "math-model", baseURL: "http://127.0.0.1:9999/v1", apiKeyEnv: "LOCAL_API_KEY" } } } }))
    const config = await loadSigmaForgeConfig(path)
    expect(() => createConfiguredProvider(config, {})).toThrow("LOCAL_API_KEY")
    expect(createConfiguredProvider(config, { LOCAL_API_KEY: "secret" })?.model).toBe("math-model")
  })

  test("rejects literal authorization headers and missing active profiles", async () => {
    const directory = mkdtempSync(join(tmpdir(), "sigmaforge-provider-"))
    directories.push(directory)
    const unsafe = join(directory, "unsafe.json")
    await Bun.write(unsafe, JSON.stringify({ provider: { mode: "real", active: "bad", profiles: { bad: { provider: "deepseek", model: "model", apiKeyEnv: "KEY", headers: { Authorization: "secret" } } } } }))
    expect(loadSigmaForgeConfig(unsafe)).rejects.toThrow("Authorization")
  })
})

test("streams OpenAI-compatible chunks and sends the configured model", async () => {
  let authorization = ""
  let requestBody: { model?: string; stream?: boolean } = {}
  server = Bun.serve({
    port: 0,
    async fetch(request) {
      authorization = request.headers.get("authorization") ?? ""
      requestBody = await request.json() as typeof requestBody
      return new Response('data: {"choices":[{"delta":{"content":"你"}}]}\n\ndata: {"choices":[{"delta":{"content":"好"}}]}\n\ndata: [DONE]\n\n', { headers: { "content-type": "text/event-stream" } })
    },
  })
  const provider = new OpenAICompatibleProvider({ provider: "custom", model: "math-model", baseURL: `http://${server.hostname}:${server.port}/v1`, apiKeyEnv: "TEST_KEY", maxTokens: 32, timeoutMs: 5000, headers: {}, extraBody: {} }, { TEST_KEY: "token" })
  const chunks: string[] = []
  const result = await provider.stream({ context: { prompt: "问题", budget: 100, estimatedTokens: 2, compressed: false, retainedTurns: 1, treeVersion: 0 } }, (text) => chunks.push(text))
  expect(result).toEqual({ content: "你好", toolCalls: [] })
  expect(chunks).toEqual(["你", "好"])
  expect(authorization).toBe("Bearer token")
  expect(requestBody).toMatchObject({ model: "math-model", stream: true })
})

test("parses chunks split across transport boundaries", async () => {
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"con'))
      controller.enqueue(encoder.encode('tent":"完成"}}]}\r\n\r\ndata: [DONE]\r\n\r\n'))
      controller.close()
    },
  })
  expect(await consumeOpenAIStream(body, () => {})).toEqual({ content: "完成", toolCalls: [] })
})

test("assembles streamed tool call arguments", async () => {
  const body = new Response([
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"sigmaforge_integrate","arguments":"{\\\"expression\\\":\\\"x*"}}]}}]}',
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"e^x\\\",\\\"variable\\\":\\\"x\\\"}"}}]}}]}',
    "data: [DONE]",
    "",
  ].join("\n\n")).body!
  expect(await consumeOpenAIStream(body, () => {})).toEqual({ content: "", toolCalls: [{ id: "call_1", name: "sigmaforge_integrate", arguments: '{"expression":"x*e^x","variable":"x"}' }] })
})

test("accepts empty usage chunks and a final event without a newline", async () => {
  const body = new Response([
    'data: {"choices":[]}',
    'data: {"choices":[{"delta":{"content":"完成"}}]}',
  ].join("\n\n")).body!
  expect(await consumeOpenAIStream(body, () => {})).toEqual({ content: "完成", toolCalls: [] })
})
