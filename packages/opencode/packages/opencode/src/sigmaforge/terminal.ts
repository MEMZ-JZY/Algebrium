import type { StreamEvent } from "./events"

export type SigmaForgeTerminalSession = { id: string }

export function parseSSE(buffer: string) {
  const frames = buffer.split(/\r?\n\r?\n/)
  const remainder = frames.pop() ?? ""
  const events = frames.flatMap((frame) => {
    const data = frame.split(/\r?\n/).find((line) => line.startsWith("data: "))?.slice(6)
    return data ? [JSON.parse(data) as StreamEvent] : []
  })
  return { events, remainder }
}

export async function createTerminalSession(origin: string) {
  const response = await fetch(`${origin}/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ subject: "math" }),
  })
  return requireResponse<SigmaForgeTerminalSession>(response)
}

export async function sendTerminalMessage(
  origin: string,
  sessionID: string,
  message: string,
  onEvent: (event: StreamEvent) => void,
) {
  const events = await fetch(`${origin}/sessions/${sessionID}/events`)
  if (!events.ok || !events.body) throw new Error(`Unable to open SigmaForge event stream: ${events.status}`)
  const sent = await fetch(`${origin}/sessions/${sessionID}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message }),
  })
  await requireResponse(sent)
  await consumeSSE(events.body, onEvent)
}

async function consumeSSE(body: ReadableStream<Uint8Array>, onEvent: (event: StreamEvent) => void) {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  while (true) {
    const next = await reader.read()
    const parsed = parseSSE(buffer + decoder.decode(next.value ?? new Uint8Array(), { stream: !next.done }))
    buffer = parsed.remainder
    parsed.events.forEach(onEvent)
    if (parsed.events.some((event) => event.type === "done")) return
    if (next.done) throw new Error("SigmaForge event stream ended before completion")
  }
}

async function requireResponse<T = undefined>(response: Response): Promise<T> {
  if (response.ok) return response.status === 204 ? undefined as T : await response.json() as T
  const body = await response.json().catch(() => ({})) as { error?: string }
  throw new Error(body.error ?? `SigmaForge request failed: ${response.status}`)
}

export * as SigmaForgeTerminal from "./terminal"
