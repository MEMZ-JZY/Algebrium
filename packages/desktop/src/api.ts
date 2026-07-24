const origin = "http://127.0.0.1:4097"

export type Session = { id: string; subject?: string; createdAt?: number; updatedAt?: number; title?: string }
export type SessionMessage = { role: "user" | "assistant"; content: string; createdAt: number }
export type ProcessHistoryEvent =
  | { type: "chunk"; text: string }
  | { type: "reasoning.chunk"; text: string }
  | { type: "answer"; text: string }
  | { type: "tool.start"; tool: string; input?: unknown }
  | { type: "tool.result"; tool: string; result: CASResult }
  | { type: "tool.error"; tool: string; message: string }
  | { type: "tool.complete"; tool: string }
export type ProcessHistoryRun = { id: string; userMessageCreatedAt: number; events: ProcessHistoryEvent[]; completed: boolean }
export type SessionDetail = Session & { messages: SessionMessage[]; artifacts: PlotArtifact[]; webResults: WebSearchResult[]; processRuns: ProcessHistoryRun[] }
export type CASResult = { tool: string; text: string; normalized: string; durationMs: number }
export type VerificationResult = { verified: boolean; normalized: string; evidence: string; domainNote: string }
export type ContextSnapshot = { budget: number; estimatedTokens: number; compressed: boolean; retainedTurns: number; treeVersion: number }
export type PlotArtifact = {
  id: string
  kind: "image2d" | "plotly2d" | "plotly3d" | "jsxgraph"
  mime: string
  data: string | Record<string, unknown>
  meta: Record<string, string | number>
}
export type WebSearchSource = { title: string; url: string; domain: string; snippet: string }
export type WebSearchDiagnostics = { attempts: number; rawResults: number; fallbackEngine?: string }
export type WebSearchResult = { query: string; sources: WebSearchSource[]; diagnostics?: WebSearchDiagnostics }
export type TheoryNode = {
  id: string
  parentID?: string
  kind: "problem" | "step" | "claim" | "result"
  title: string
  content: string
  expression?: string
  rule?: string
  status: "pending" | "verified" | "rejected" | "error"
  verification?: VerificationResult
  artifactIDs: string[]
  children: string[]
}
export type TheoryTree = { sessionID: string; rootID?: string; version: number; nodes: Record<string, TheoryNode> }
export type ProviderProfile = { id: string; provider: string; model: string; baseURL?: string; apiKeyEnv: string; hasApiKey: boolean }
export type ProviderSettings = { active: string; profiles: Record<string, ProviderProfile> }
export type ProviderSettingsInput = { id: string; provider: string; model: string; baseURL?: string; apiKey?: string }
export type StreamEvent =
  | { type: "chunk"; text: string }
  | { type: "reasoning.chunk"; text: string }
  | { type: "answer"; text: string }
  | { type: "tool.start"; tool: string; input?: unknown }
  | { type: "tool.result"; tool: string; result: CASResult }
  | { type: "tool.error"; tool: string; message: string }
  | { type: "artifact.pending"; artifact: { id: string; kind: PlotArtifact["kind"]; title: string } }
  | { type: "artifact"; artifact: PlotArtifact }
  | { type: "verification"; result: VerificationResult }
  | { type: "theory.updated"; node: TheoryNode; version: number }
  | { type: "web.result"; result: WebSearchResult }
  | { type: "error"; message: string }
  | { type: "done"; context: ContextSnapshot }

export function createSession() {
  return request<Session>("/sessions", { method: "POST", body: JSON.stringify({ subject: "math" }) })
}

export function getTheory(sessionID: string) {
  return request<TheoryTree>(`/sessions/${sessionID}/theory`)
}

export function listSessions() {
  return request<Session[]>("/sessions")
}

export function getHealth() {
  return request<{ ok: boolean; provider: { mode: "mock" | "real"; id?: string; model?: string } }>("/health")
}

export function getSession(sessionID: string) {
  return request<SessionDetail>(`/sessions/${sessionID}`)
}

export function deleteSession(sessionID: string) {
  return request<{ deleted: boolean }>(`/sessions/${sessionID}`, { method: "DELETE" })
}

export async function uploadSessionFile(sessionID: string, file: File) {
  const form = new FormData()
  form.append("file", file)
  const response = await fetch(`${origin}/sessions/${sessionID}/files`, { method: "POST", body: form })
  const body = await response.json() as { name?: string; size?: number; error?: string }
  if (!response.ok) throw new Error(body.error ?? `上传失败：${response.status}`)
  return body
}

export function stopSigmaForge(sessionID: string) {
  return request<{ stopped: boolean }>(`/sessions/${sessionID}/stop`, { method: "POST" })
}

export function getProviderSettings() {
  return request<ProviderSettings>("/settings/provider")
}

export function updateProviderSettings(input: ProviderSettingsInput) {
  return request<ProviderSettings>("/settings/provider", { method: "PUT", body: JSON.stringify(input) })
}

export async function askSigmaForge(sessionID: string, message: string, onEvent: (event: StreamEvent) => void) {
  const events = new EventSource(`${origin}/sessions/${sessionID}/events`)
  await new Promise<void>((resolve, reject) => {
    events.onopen = () => resolve()
    events.onerror = () => reject(new Error("无法连接 Algebrium 流式服务。"))
  })
  let backendError = ""
  const done = new Promise<void>((resolve, reject) => {
    events.onmessage = (messageEvent) => {
      const event = JSON.parse(messageEvent.data) as StreamEvent
      onEvent(event)
      if (event.type === "error") backendError = event.message
      if (event.type !== "done") return
      events.close()
      resolve()
    }
    events.onerror = () => {
      events.close()
      reject(new Error(backendError || "Algebrium 流式连接意外关闭，请检查后端窗口。"))
    }
  })
  try {
    await request(`/sessions/${sessionID}/messages`, { method: "POST", body: JSON.stringify({ message }) })
  } catch (error) {
    events.close()
    throw error
  }
  await done
}

async function request<T = unknown>(path: string, init?: RequestInit) {
  const response = await fetch(origin + path, { ...init, headers: { "content-type": "application/json", ...init?.headers } })
  const body = (await response.json()) as T | { error: string }
  if (!response.ok) {
    const message = typeof body === "object" && body !== null && "error" in body ? String(body.error) : `请求失败：${response.status}`
    throw new Error(message)
  }
  return body as T
}
