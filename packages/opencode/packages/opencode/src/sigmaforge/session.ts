import { createSubjectRegistry, type SubjectRegistry } from "./subject"
import { ContextBuilder, type ContextSnapshot, type TokenCounter } from "./context"
import { TheoryTreeStore } from "./theory"
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"

export type SigmaForgeMessage = { role: "user" | "assistant"; content: string; createdAt: number }

export type SigmaForgeSession = {
  id: string
  subject: string
  systemPrompt: string
  createdAt: number
  updatedAt: number
  messages: SigmaForgeMessage[]
  theory: TheoryTreeStore
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
    session.messages.push({ role, content, createdAt: Date.now() })
    session.updatedAt = Date.now()
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
      const records = JSON.parse(readFileSync(this.storagePath, "utf8")) as Array<Pick<SigmaForgeSession, "id" | "subject" | "systemPrompt" | "createdAt" | "updatedAt" | "messages">>
      for (const record of records) {
        const theory = new TheoryTreeStore(record.id)
        theory.add({ id: "session-root", kind: "problem", title: "会话", content: "数学解题会话" })
        this.sessions.set(record.id, { ...record, theory, busy: false })
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error(`Session history could not be loaded: ${error}`)
    }
  }

  private persist() {
    if (!this.storagePath) return
    mkdirSync(dirname(this.storagePath), { recursive: true })
    const records = this.list().map(({ id, subject, systemPrompt, createdAt, updatedAt, messages }) => ({ id, subject, systemPrompt, createdAt, updatedAt, messages }))
    const temporary = `${this.storagePath}.tmp`
    writeFileSync(temporary, JSON.stringify(records, null, 2), "utf8")
    renameSync(temporary, this.storagePath)
  }
}

export * as SigmaForgeSessionStore from "./session"
