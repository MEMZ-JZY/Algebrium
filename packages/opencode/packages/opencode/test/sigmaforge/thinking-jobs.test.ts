import { describe, expect, test } from "bun:test"
import { SigmaForgeSessions } from "@/sigmaforge/session"
import { ThinkingJobs } from "@/sigmaforge/thinking-jobs"
import { ThinkingSummaryStore } from "@/sigmaforge/thinking"
import type { ChatProvider } from "@/sigmaforge/provider"

function fixture() {
  const sessions = new SigmaForgeSessions()
  const id = sessions.create().id
  const run = sessions.startProcess(id, Date.now())
  const completions: Array<() => void> = []
  const provider: ChatProvider = {
    id: "controlled", model: "controlled",
    async stream(request, chunk) {
      const text = request.messages?.at(-1)?.content ?? ""
      await new Promise<void>((resolve) => completions.push(resolve))
      chunk(JSON.stringify({ method: text.includes("first") ? "first" : "second", reason: "reason", caution: "" }))
      return { content: "", toolCalls: [] }
    },
  }
  const jobs = new ThinkingJobs(sessions, () => {})
  jobs.begin(id, run.id, provider)
  function stage(text: string) {
    jobs.reasoning(id, text)
    return jobs.close(id)!
  }
  return { sessions, id, run, completions, jobs, provider, stage }
}

describe("server-owned thinking stages", () => {
  test("reserves chronological order before out-of-order completions", async () => {
    const f = fixture()
    const first = f.stage("first")
    f.stage("second")
    f.completions[1]()
    await f.jobs.wait(f.id, 1)
    expect(f.sessions.get(f.id).thinking.snapshot().summaries.map((s) => s.status)).toEqual(["pending", "ready"])
    f.completions[0]()
    await f.jobs.wait(f.id)
    const result = f.sessions.get(f.id).thinking.snapshot().summaries
    expect(result.map((s) => s.method)).toEqual(["first", "second"])
    expect(result.map((s) => s.order)).toEqual([1, 2])
    expect(result[0].stageID).toBe(first.stageID)
  })

  test("limits concurrency to two and does not recreate deleted or rolled back stages", async () => {
    const f = fixture()
    const first = f.stage("first")
    const second = f.stage("second")
    f.stage("third")
    expect(f.completions).toHaveLength(2)
    f.sessions.removeThinking(f.id, first.summaryID!)
    f.sessions.rollbackThinking(f.id, second.summaryID!)
    f.completions[0]()
    f.completions[1]()
    await f.jobs.wait(f.id)
    expect(f.sessions.get(f.id).thinking.snapshot().summaries).toEqual([])
    expect(f.completions).toHaveLength(2)
  })

  test("does not overwrite a user edit with a late model response", async () => {
    const f = fixture()
    const stage = f.stage("first")
    f.sessions.updateThinking(f.id, stage.summaryID!, { method: "manual" })
    f.jobs.invalidate(f.id)
    await f.jobs.wait(f.id)
    expect(f.sessions.get(f.id).thinking.snapshot().summaries[0].method).toBe("manual")
    f.completions[0]()
  })

  test("stop degrades pending stages without waiting for the model", async () => {
    const f = fixture()
    f.stage("first")
    f.jobs.reasoning(f.id, "second unfinished")
    f.jobs.cancel(f.id)
    await f.jobs.wait(f.id)
    expect(f.sessions.get(f.id).thinking.snapshot().summaries.map((s) => s.status)).toEqual(["degraded", "degraded"])
    f.completions[0]()
  })

  test("restart recovers pending snapshots locally and preserves legacy summaries", () => {
    const f = fixture()
    f.stage("first")
    const snapshot = f.sessions.get(f.id).thinking.snapshot()
    const restored = new ThinkingSummaryStore(snapshot)
    expect(restored.snapshot().summaries[0].status).toBe("degraded")
    expect(restored.snapshot().summaries[0].reason).toContain("first")
    const legacy = new ThinkingSummaryStore()
    legacy.add({ method: "legacy", reason: "reason" })
    expect(new ThinkingSummaryStore(legacy.snapshot()).snapshot().summaries[0].method).toBe("legacy")
    f.jobs.cancel(f.id)
    f.completions[0]()
  })

  test("captures the provider at run start and excludes placeholders from context", async () => {
    const f = fixture()
    f.stage("first")
    expect(f.sessions.context(f.id).prompt).not.toContain("first")
    f.jobs.begin(f.id, "another-run", undefined)
    f.completions[0]()
    await f.jobs.wait(f.id)
    expect(f.sessions.get(f.id).thinking.snapshot().summaries[0].status).toBe("ready")
  })
})
