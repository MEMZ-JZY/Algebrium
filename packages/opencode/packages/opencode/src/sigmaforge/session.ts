import { createSubjectRegistry, type SubjectRegistry } from "./subject"
import { ContextBuilder, type ContextSnapshot, type TokenCounter } from "./context"
import { TheoryTreeStore } from "./theory"
import type { TheoryTree } from "./theory"
import type { PlotArtifact } from "./plot"
import type { WebSearchResult } from "./web-search"
import type { CASResult } from "./cas"
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"

export type SigmaForgeMessage = { role: "user" | "assistant"; content: string; createdAt: number }

export type ProcessHistoryEvent =
  | { type: "chunk"; text: string }
  | { type: "reasoning.chunk"; text: string }
  | { type: "answer"; text: string }
  | { type: "tool.start"; tool: string; input?: unknown }
  | { type: "tool.result"; tool: string; result: CASResult }
  | { type: "tool.error"; tool: string; message: string }
  | { type: "tool.complete"; tool: string }

export type ProcessHistoryRun = {
  id: string
  userMessageCreatedAt: number
  events: ProcessHistoryEvent[]
  completed: boolean
}

export type SigmaForgeSession = {
  id: string
  subject: string
  systemPrompt: string
  createdAt: number
  updatedAt: number
  messages: SigmaForgeMessage[]
  theory: TheoryTreeStore
  artifacts: PlotArtifact[]
  webResults: WebSearchResult[]
  processRuns: ProcessHistoryRun[]
  context?: ContextSnapshot
  busy: boolean
}

export class SigmaForgeSessions {
  private readonly sessions = new Map<string, SigmaForgeSession>()

  private readonly contexts: ContextBuilder

  constructor(private readonly subjects: SubjectRegistry = createSubjectRegistry(), tokenCounter?: TokenCounter, budget?: number, private readonly storagePath?: string) {
    this.contexts = new ContextBuilder(tokenCounter, budget)
    this.restore()
  }

  create(input: { subject?: string } = {}) {
    const id = crypto.randomUUID()
    const subject = this.subjects.resolve(input.subject)
    const theory = new TheoryTreeStore(id)
    theory.add({ id: "session-root", kind: "problem", title: "会话", content: "数学解题会话" })
    const session = {
      id,
      subject: subject.id,
      systemPrompt: subject.systemPrompt({ sessionID: id, subject: subject.id }),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: [],
      theory,
      artifacts: [],
      webResults: [],
      processRuns: [],
      busy: false,
    }
    this.sessions.set(id, session)
    this.persist()
    return session
  }

  list() {
    return [...this.sessions.values()].sort((left, right) => right.updatedAt - left.updatedAt)
  }

  get(id: string) {
    const session = this.sessions.get(id)
    if (!session) throw new Error(`Session not found: ${id}`)
    return session
  }

  subject(id: string) {
    return this.subjects.resolve(this.get(id).subject)
  }

  append(id: string, role: SigmaForgeMessage["role"], content: string) {
    const session = this.get(id)
    const message = { role, content, createdAt: Date.now() }
    session.messages.push(message)
    session.updatedAt = Date.now()
    this.persist()
    return message
  }

  startProcess(id: string, userMessageCreatedAt: number) {
    const session = this.get(id)
    const run = { id: crypto.randomUUID(), userMessageCreatedAt, events: [], completed: false }
    session.processRuns.push(run)
    return run
  }

  recordProcessEvent(id: string, event: ProcessHistoryEvent) {
    const run = findActiveProcessRun(this.get(id).processRuns)
    if (run) run.events.push(event)
  }

  finishProcess(id: string) {
    const session = this.get(id)
    const run = findActiveProcessRun(session.processRuns)
    if (!run) return
    run.completed = true
    session.updatedAt = Date.now()
    this.persist()
  }

  addArtifact(id: string, artifact: PlotArtifact) {
    const session = this.get(id)
    session.artifacts = [...session.artifacts.filter((item) => item.id !== artifact.id), artifact]
    session.updatedAt = Date.now()
    this.persist()
  }

  addWebResult(id: string, result: WebSearchResult) {
    const session = this.get(id)
    session.webResults = [...session.webResults, result]
    session.updatedAt = Date.now()
    this.persist()
  }

  save(id: string) {
    this.get(id)
    this.persist()
  }

  context(id: string) {
    const session = this.get(id)
    const context = this.contexts.build(session)
    session.context = context
    return context
  }

  begin(id: string) {
    const session = this.get(id)
    if (session.busy) throw new Error("Session is already processing a message")
    session.busy = true
  }

  end(id: string) {
    this.get(id).busy = false
  }

  delete(id: string) {
    const session = this.get(id)
    if (session.busy) throw new Error("Session is already processing a message")
    this.sessions.delete(id)
    this.persist()
  }

  private restore() {
    if (!this.storagePath) return
    try {
      const records = JSON.parse(readFileSync(this.storagePath, "utf8")) as Array<Pick<SigmaForgeSession, "id" | "subject" | "systemPrompt" | "createdAt" | "updatedAt" | "messages"> & { theory?: TheoryTree; artifacts?: PlotArtifact[]; webResults?: WebSearchResult[]; processRuns?: ProcessHistoryRun[] }>
      if (!Array.isArray(records)) throw new Error("Session history must be an array")
      for (const record of records) {
        const theory = new TheoryTreeStore(record.id, record.theory)
        if (!record.theory) theory.add({ id: "session-root", kind: "problem", title: "会话", content: "数学解题会话" })
        this.sessions.set(record.id, {
          ...record,
          theory,
          artifacts: Array.isArray(record.artifacts) ? record.artifacts.filter(isPlotArtifact) : [],
          webResults: Array.isArray(record.webResults) ? record.webResults.filter(isWebSearchResult) : [],
          processRuns: Array.isArray(record.processRuns) ? record.processRuns.filter(isProcessHistoryRun) : [],
          busy: false,
        })
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return
      try {
        renameSync(this.storagePath, `${this.storagePath}.corrupt-${Date.now()}`)
      } catch { /* Keep startup available even when the damaged file cannot be renamed. */ }
      console.warn(`Session history was damaged and has been ignored: ${error}`)
    }
  }

  private persist() {
    if (!this.storagePath) return
    mkdirSync(dirname(this.storagePath), { recursive: true })
    const records = this.list().map(({ id, subject, systemPrompt, createdAt, updatedAt, messages, theory, artifacts, webResults, processRuns }) => ({ id, subject, systemPrompt, createdAt, updatedAt, messages, theory: theory.snapshot(), artifacts, webResults, processRuns }))
    const temporary = `${this.storagePath}.tmp`
    writeFileSync(temporary, JSON.stringify(records, null, 2), "utf8")
    renameSync(temporary, this.storagePath)
  }
}

function isPlotArtifact(value: unknown): value is PlotArtifact {
  if (!value || typeof value !== "object") return false
  const artifact = value as Record<string, unknown>
  return typeof artifact.id === "string"
    && ["image2d", "plotly2d", "plotly3d", "jsxgraph"].includes(String(artifact.kind))
    && typeof artifact.mime === "string"
    && (typeof artifact.data === "string" || (artifact.data !== null && typeof artifact.data === "object" && !Array.isArray(artifact.data)))
    && artifact.meta !== null
    && typeof artifact.meta === "object"
    && !Array.isArray(artifact.meta)
    && Object.values(artifact.meta).every((item) => typeof item === "string" || typeof item === "number")
}

function isWebSearchResult(value: unknown): value is WebSearchResult {
  if (!value || typeof value !== "object") return false
  const result = value as Record<string, unknown>
  return typeof result.query === "string"
    && Array.isArray(result.sources)
    && result.sources.every((source) => {
      if (!source || typeof source !== "object") return false
      const item = source as Record<string, unknown>
      return typeof item.title === "string"
        && typeof item.url === "string"
        && typeof item.domain === "string"
        && typeof item.snippet === "string"
    })
}

function isProcessHistoryRun(value: unknown): value is ProcessHistoryRun {
  if (!value || typeof value !== "object") return false
  const run = value as Record<string, unknown>
  return typeof run.id === "string"
    && typeof run.userMessageCreatedAt === "number"
    && typeof run.completed === "boolean"
    && Array.isArray(run.events)
    && run.events.every(isProcessHistoryEvent)
}

function isProcessHistoryEvent(value: unknown): value is ProcessHistoryEvent {
  if (!value || typeof value !== "object") return false
  const event = value as Record<string, unknown>
  if (event.type === "chunk" || event.type === "reasoning.chunk" || event.type === "answer") return typeof event.text === "string"
  if (event.type === "tool.start") return typeof event.tool === "string"
  if (event.type === "tool.complete") return typeof event.tool === "string"
  if (event.type === "tool.error") return typeof event.tool === "string" && typeof event.message === "string"
  if (event.type !== "tool.result" || typeof event.tool !== "string" || !event.result || typeof event.result !== "object") return false
  const result = event.result as Record<string, unknown>
  return typeof result.tool === "string" && typeof result.text === "string" && typeof result.normalized === "string" && typeof result.durationMs === "number"
}

function findActiveProcessRun(runs: ProcessHistoryRun[]) {
  for (let index = runs.length - 1; index >= 0; index--) {
    if (!runs[index]?.completed) return runs[index]
  }
  return undefined
}

export * as SigmaForgeSessionStore from "./session"
