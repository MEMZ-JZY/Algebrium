import type { ChatProvider } from "./provider"
import type { SigmaForgeSessions } from "./session"
import type { ThinkingSummaryInput } from "./thinking"

type Stage = { sessionID: string; runID: string; stageID: string; text: string; provider?: ChatProvider; cancelled: boolean }
type Job = Stage & { summaryID: string; controller: AbortController }
type Marker = { type: "thinking.marker"; runID: string; stageID: string; summaryID: string }

/** Owns summary jobs independently of browser connections and main reply completion. */
export class ThinkingJobs {
  private readonly stages = new Map<string, Stage>()
  private readonly jobs = new Set<Job>()
  private readonly queue: Job[] = []
  private readonly waiters = new Set<() => void>()
  private active = 0

  constructor(private readonly sessions: SigmaForgeSessions, private readonly changed: (sessionID: string) => void, private readonly timeoutMs = 30000) {}

  begin(sessionID: string, runID: string, provider?: ChatProvider) {
    this.stages.set(sessionID, { sessionID, runID, stageID: crypto.randomUUID(), text: "", provider, cancelled: false })
  }

  reasoning(sessionID: string, text: string) {
    const stage = this.stages.get(sessionID)
    if (!stage) return { type: "reasoning.chunk" as const, text }
    stage.text += text
    return { type: "reasoning.chunk" as const, text, runID: stage.runID, stageID: stage.stageID }
  }

  close(sessionID: string): Marker | undefined {
    const stage = this.stages.get(sessionID)
    if (!stage?.text.trim()) return
    const summary = this.sessions.addThinking(sessionID, {
      ...fallbackThinkingSummary(stage.text), runID: stage.runID, stageID: stage.stageID,
      status: stage.cancelled ? "degraded" : "pending",
    })
    const job = { ...stage, summaryID: summary.id, controller: new AbortController() }
    stage.stageID = crypto.randomUUID()
    stage.text = ""
    this.changed(sessionID)
    if (!job.cancelled) {
      this.jobs.add(job)
      this.queue.push(job)
      this.drain()
    }
    return { type: "thinking.marker", runID: job.runID, stageID: job.stageID, summaryID: summary.id }
  }

  cancel(sessionID: string) {
    const stage = this.stages.get(sessionID)
    if (stage) stage.cancelled = true
    const marker = this.close(sessionID)
    for (const job of this.jobs) {
      if (job.sessionID !== sessionID) continue
      job.controller.abort()
      this.finish(job, fallbackThinkingSummary(job.text), true)
    }
    this.drain()
    return marker
  }

  end(sessionID: string) {
    this.stages.delete(sessionID)
  }

  invalidate(sessionID: string) {
    for (const job of this.jobs) {
      if (job.sessionID === sessionID && !this.pending(job)) job.controller.abort()
    }
    this.drain()
  }

  wait(sessionID: string, remaining = 0) {
    return new Promise<void>((resolve) => {
      const check = () => {
        if ([...this.jobs].filter((job) => job.sessionID === sessionID).length > remaining) return
        this.waiters.delete(check)
        resolve()
      }
      this.waiters.add(check)
      check()
    })
  }

  private pending(job: Job) {
    try {
      return this.sessions.get(job.sessionID).thinking.snapshot().summaries.some((summary) => summary.id === job.summaryID && summary.status === "pending")
    } catch { return false }
  }

  private finish(job: Job, summary: ThinkingSummaryInput, degraded: boolean) {
    if (!this.pending(job)) return
    this.sessions.get(job.sessionID).thinking.complete(job.summaryID, summary, degraded)
    this.sessions.save(job.sessionID)
    this.changed(job.sessionID)
  }

  private drain() {
    while (this.active < 2 && this.queue.length) {
      const job = this.queue.shift()!
      if (job.controller.signal.aborted || !this.pending(job)) {
        this.jobs.delete(job)
        for (const notify of this.waiters) notify()
        continue
      }
      this.active++
      void summarizeThinking(job.text, job.provider, job.controller.signal, this.timeoutMs)
        .then((result) => this.finish(job, result.summary, result.degraded))
        .catch(() => this.finish(job, fallbackThinkingSummary(job.text), true))
        .finally(() => {
          this.active--
          this.jobs.delete(job)
          this.drain()
          for (const notify of this.waiters) notify()
        })
    }
  }
}

const guidelines = `你是 Algebrium 的思考摘要器。将输入的数学推理片段压缩成一条阶段摘要。
只输出 JSON：{"method":"正在做什么（不超过20字）","reason":"为什么这样做（不超过60字）","caution":"注意事项（不超过40字，没有则空字符串）"}。
只概括片段中已有信息，不新增结论、不评价对错、不使用 Markdown。`

export async function summarizeThinking(text: string, provider?: ChatProvider, signal?: AbortSignal, timeoutMs = 30000) {
  const draft = fallbackThinkingSummary(text)
  if (!provider) return { summary: draft, degraded: true }
  const controller = new AbortController()
  const abort = () => controller.abort()
  if (signal?.aborted) controller.abort()
  signal?.addEventListener("abort", abort, { once: true })
  const timer = setTimeout(abort, timeoutMs)
  let rejectAbort: (() => void) | undefined
  try {
    let reply = ""
    await Promise.race([
      new Promise<never>((_resolve, reject) => {
        rejectAbort = () => reject(new Error("Summary interrupted"))
        controller.signal.addEventListener("abort", rejectAbort, { once: true })
        if (controller.signal.aborted) rejectAbort()
      }),
      provider.stream({
        context: { prompt: text, budget: 0, estimatedTokens: 0, compressed: false, retainedTurns: 0, treeVersion: 0 },
        messages: [{ role: "system", content: guidelines }, { role: "user", content: `思考片段：\n${text.trim().slice(-12000)}` }],
        reasoning: "none", maxTokens: 600, signal: controller.signal,
      }, (chunk) => { reply += chunk }),
    ])
    const cleaned = reply.replace(/```json/gi, "").replace(/```/g, "").trim()
    const value = JSON.parse(cleaned.slice(cleaned.indexOf("{"), cleaned.lastIndexOf("}") + 1)) as Record<string, unknown>
    const clamp = (input: unknown, limit: number) => typeof input === "string" ? input.replace(/\s+/g, " ").trim().slice(0, limit) : ""
    const method = clamp(value.method, 120)
    const reason = clamp(value.reason, 300)
    if (!method || !reason) return { summary: draft, degraded: true }
    return { summary: { method, reason, caution: clamp(value.caution, 300) }, degraded: false }
  } catch {
    return { summary: draft, degraded: true }
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener("abort", abort)
    if (rejectAbort) controller.signal.removeEventListener("abort", rejectAbort)
  }
}

export function fallbackThinkingSummary(text: string) {
  const normalized = text.replace(/\s+/g, " ").trim()
  return { method: "思考阶段", reason: (normalized.split(/(?<=[。！？.!?])/)[0] ?? normalized).slice(0, 160) || "该阶段没有可用的思考摘要", caution: "" }
}

export * as SigmaForgeThinkingJobs from "./thinking-jobs"
