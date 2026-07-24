import { z } from "zod"
import type { ProviderContext } from "./context"

export const ProviderIDSchema = z.enum(["deepseek", "mimo", "kimi", "volcengine", "openrouter", "siliconflow", "custom"])

export const ProviderConfigSchema = z.object({
  provider: ProviderIDSchema,
  model: z.string().min(1),
  apiKeyEnv: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
  baseURL: z.string().url().optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().positive().max(200000).default(4096),
  timeoutMs: z.number().int().min(1000).max(600000).default(120000),
  headers: z.record(z.string(), z.string()).default({}),
  extraBody: z.record(z.string(), z.unknown()).default({}),
}).superRefine((config, context) => {
  if (Object.keys(config.headers).some((name) => name.toLowerCase() === "authorization")) {
    context.addIssue({ code: "custom", message: "Authorization headers must come from apiKeyEnv", path: ["headers"] })
  }
  if (config.provider === "custom" && !config.baseURL) {
    context.addIssue({ code: "custom", message: "Custom providers require baseURL", path: ["baseURL"] })
  }
})

export type ProviderConfig = z.infer<typeof ProviderConfigSchema>
export type ProviderTool = { type: "function"; function: { name: string; description: string; parameters: Record<string, unknown> } }
export type ProviderToolCall = { id: string; name: string; arguments: string }
export type ProviderMessage =
  | { role: "user" | "system"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }> }
  | { role: "tool"; tool_call_id: string; content: string }
export type ProviderRequest = { context: ProviderContext; messages?: ProviderMessage[]; tools?: ProviderTool[]; signal?: AbortSignal }
export type ProviderTurn = { content: string; toolCalls: ProviderToolCall[] }

export interface ChatProvider {
  readonly id: string
  readonly model: string
  stream(request: ProviderRequest, onChunk: (text: string) => void, onReasoning?: (text: string) => void): Promise<ProviderTurn>
}

const baseURLs: Record<z.infer<typeof ProviderIDSchema>, string | undefined> = {
  deepseek: "https://api.deepseek.com/v1",
  mimo: "https://api.xiaomimimo.com/v1",
  kimi: "https://api.moonshot.ai/v1",
  volcengine: "https://ark.cn-beijing.volces.com/api/v3",
  openrouter: "https://openrouter.ai/api/v1",
  siliconflow: "https://api.siliconflow.com/v1",
  custom: undefined,
}

export class OpenAICompatibleProvider implements ChatProvider {
  readonly id: string
  readonly model: string
  private readonly apiKey: string
  private readonly baseURL: string

  constructor(readonly config: ProviderConfig, environment: Record<string, string | undefined> = process.env) {
    this.id = config.provider
    this.model = config.model
    this.apiKey = environment[config.apiKeyEnv]?.trim() ?? ""
    if (!this.apiKey) throw new Error(`Provider API key is missing: set ${config.apiKeyEnv}`)
    this.baseURL = (config.baseURL ?? baseURLs[config.provider])!.replace(/\/$/, "")
  }

  async stream(request: ProviderRequest, onChunk: (text: string) => void, onReasoning?: (text: string) => void) {
    const response = await fetch(`${this.baseURL}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}`, ...this.config.headers },
      body: JSON.stringify({
        ...this.config.extraBody,
        model: this.config.model,
        messages: request.messages ?? [{ role: "user", content: request.context.prompt }],
        stream: true,
        ...(request.tools?.length ? { tools: request.tools, tool_choice: "auto" } : {}),
        max_tokens: this.config.maxTokens,
        ...(this.config.temperature === undefined ? {} : { temperature: this.config.temperature }),
      }),
      signal: request.signal
        ? AbortSignal.any([request.signal, AbortSignal.timeout(this.config.timeoutMs)])
        : AbortSignal.timeout(this.config.timeoutMs),
    })
    if (!response.ok) throw await providerError(response, this.id)
    if (!response.body) throw new Error(`${this.id} returned an empty response stream`)
    return consumeOpenAIStream(response.body, onChunk, onReasoning)
  }
}

export async function consumeOpenAIStream(body: ReadableStream<Uint8Array>, onChunk: (text: string) => void, onReasoning: (text: string) => void = () => {}) {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  const toolCalls = new Map<number, ProviderToolCall>()
  let buffer = ""
  let rawResult = ""
  let result = ""
  let visiblePending = ""
  let sawDsmlToolCalls = false
  while (true) {
    const next = await reader.read()
    buffer += decoder.decode(next.value ?? new Uint8Array(), { stream: !next.done })
    const lines = buffer.split(/\r?\n/)
    buffer = lines.pop() ?? ""
    if (next.done && buffer) {
      lines.push(buffer)
      buffer = ""
    }
    for (const line of lines) {
      if (!line.startsWith("data:")) continue
      const data = line.slice(5).trim()
      if (!data || data === "[DONE]") continue
      const chunk = streamChunkSchema.parse(JSON.parse(data))
      const delta = chunk.choices[0]?.delta
      if (!delta) continue
      const reasoning = delta.reasoning_content ?? ""
      if (reasoning) onReasoning(reasoning)
      const text = delta.content ?? ""
      if (text) {
        rawResult += text
        if (!sawDsmlToolCalls) {
          const visible = visiblePending + text
          const marker = "<|DSML|"
          const markerIndex = visible.indexOf(marker)
          if (markerIndex >= 0) {
            const prefix = visible.slice(0, markerIndex)
            if (prefix) {
              result += prefix
              onChunk(prefix)
            }
            visiblePending = ""
            sawDsmlToolCalls = true
          } else {
            const pendingLength = trailingPrefixLength(visible, marker)
            const prefix = visible.slice(0, visible.length - pendingLength)
            if (prefix) {
              result += prefix
              onChunk(prefix)
            }
            visiblePending = visible.slice(visible.length - pendingLength)
          }
        }
      }
      delta.tool_calls?.forEach((call) => {
        const current = toolCalls.get(call.index) ?? { id: "", name: "", arguments: "" }
        toolCalls.set(call.index, {
          id: call.id ?? current.id,
          name: call.function?.name ?? current.name,
          arguments: current.arguments + (call.function?.arguments ?? ""),
        })
      })
    }
    if (next.done) {
      if (visiblePending) {
        result += visiblePending
        onChunk(visiblePending)
      }
      const dsmlToolCalls = sawDsmlToolCalls ? parseDsmlToolCalls(rawResult) : []
      return { content: result, toolCalls: [...toolCalls.entries()].sort(([left], [right]) => left - right).map(([, call]) => call).concat(dsmlToolCalls) }
    }
  }
}

function trailingPrefixLength(value: string, prefix: string) {
  for (let length = Math.min(value.length, prefix.length - 1); length > 0; length--) {
    if (value.endsWith(prefix.slice(0, length))) return length
  }
  return 0
}

function parseDsmlToolCalls(content: string): ProviderToolCall[] {
  const calls: ProviderToolCall[] = []
  const invoke = /<\|DSML\|invoke\s+name="([A-Za-z][A-Za-z0-9_]*)">([\s\S]*?)<\|DSML\|invoke>/g
  for (const match of content.matchAll(invoke)) {
    const parameters: Record<string, string> = {}
    const parameter = /<\|DSML\|parameter\s+name="([A-Za-z][A-Za-z0-9_]*)"(?:\s+string="true")?>([\s\S]*?)<\|DSML\|parameter>/g
    for (const item of match[2]!.matchAll(parameter)) parameters[item[1]!] = decodeDsmlText(item[2]!)
    calls.push({ id: `dsml_${calls.length}`, name: match[1]!, arguments: JSON.stringify(parameters) })
  }
  return calls
}

function decodeDsmlText(value: string) {
  return value.trim().replace(/&(amp|gt|lt|quot|apos);/g, (_match, entity: string) => ({ amp: "&", gt: ">", lt: "<", quot: '"', apos: "'" })[entity]!)
}

const streamChunkSchema = z.object({
  choices: z.array(z.object({
    delta: z.object({
      content: z.string().nullable().optional(),
      reasoning_content: z.string().nullable().optional(),
      tool_calls: z.array(z.object({
        index: z.number().int().nonnegative(),
        id: z.string().optional(),
        function: z.object({ name: z.string().optional(), arguments: z.string().optional() }).optional(),
      })).optional(),
    }).passthrough(),
  })),
}).passthrough()

async function providerError(response: Response, provider: string) {
  const body = await response.text()
  const message = body.slice(0, 1000).replace(/\s+/g, " ")
  return new Error(`${provider} API request failed (${response.status}): ${message || response.statusText}`)
}

export * as SigmaForgeProvider from "./provider"
