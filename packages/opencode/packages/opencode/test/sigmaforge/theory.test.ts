import { describe, expect, test } from "bun:test"
import { ContextBuilder, type TokenCounter } from "@/sigmaforge/context"
import type { SigmaForgeMessage } from "@/sigmaforge/session"
import { SigmaForgeSessions } from "@/sigmaforge/session"
import { TheoryTreeStore } from "@/sigmaforge/theory"
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

class CharacterCounter implements TokenCounter {
  count(value: string) {
    return value.length
  }
}

describe("SigmaForge TheoryTree", () => {
  test("preserves hierarchy and only completes pending nodes once", () => {
    const theory = new TheoryTreeStore("session")
    const root = theory.add({ kind: "problem", title: "积分", content: "求积分" })
    const step = theory.add({ parentID: root.id, kind: "step", title: "分部积分", content: "选择公式" })
    const completed = theory.complete(step.id, { status: "verified" })
    expect(theory.snapshot().nodes[root.id]?.children).toEqual([step.id])
    expect(completed.status).toBe("verified")
    expect(() => theory.complete(step.id, { status: "error" })).toThrow("already complete")
  })
})

describe("SigmaForge context compaction", () => {
  test("keeps the tree and four recent turns without deleting history", () => {
    const theory = new TheoryTreeStore("session")
    theory.add({ kind: "problem", title: "关键公式", content: "(x-1)e^x" })
    const messages: SigmaForgeMessage[] = Array.from({ length: 51 }, (_, index) => [
      { role: "user" as const, content: `问题 ${index} ${"x".repeat(12)}`, createdAt: index },
      { role: "assistant" as const, content: `回答 ${index} ${"y".repeat(12)}`, createdAt: index },
    ]).flat()
    const context = new ContextBuilder(new CharacterCounter(), 600, 4).build({ systemPrompt: "数学系统提示", messages, theory })
    expect(context.compressed).toBe(true)
    expect(context.estimatedTokens).toBeLessThanOrEqual(360)
    expect(context.retainedTurns).toBe(4)
    expect(context.prompt).toContain("关键公式")
    expect(context.prompt).toContain("问题 50")
    expect(context.prompt).not.toContain("问题 0 ")
    expect(messages).toHaveLength(102)
  })
})

test("serializes messages within one session", () => {
  const sessions = new SigmaForgeSessions()
  const session = sessions.create()
  sessions.begin(session.id)
  expect(() => sessions.begin(session.id)).toThrow("already processing")
  sessions.end(session.id)
  expect(() => sessions.begin(session.id)).not.toThrow()
})

test("restores persisted session history", () => {
  const path = join(mkdtempSync(join(tmpdir(), "sigmaforge-sessions-")), "sessions.json")
  const first = new SigmaForgeSessions(undefined, undefined, undefined, path)
  const session = first.create()
  first.append(session.id, "user", "连续对话问题")
  first.append(session.id, "assistant", "连续对话回答")
  const user = first.append(session.id, "user", "需要保留过程的问题")
  first.startProcess(session.id, user.createdAt)
  first.recordProcessEvent(session.id, { type: "reasoning.chunk", text: "先分析条件。" })
  first.recordProcessEvent(session.id, { type: "tool.start", tool: "cas.simplify", input: { expression: "x+x" } })
  first.recordProcessEvent(session.id, { type: "tool.complete", tool: "cas.simplify" })
  first.recordProcessEvent(session.id, { type: "answer", text: "完整解答" })
  first.finishProcess(session.id)
  const step = session.theory.add({ parentID: "session-root", kind: "step", title: "验证步骤", content: "验证内容" })
  session.theory.complete(step.id, { status: "verified" })
  first.save(session.id)
  first.addArtifact(session.id, { id: "plot", kind: "plotly2d", mime: "application/json", data: {}, meta: { expression: "x" } })
  const restored = new SigmaForgeSessions(undefined, undefined, undefined, path)
  expect(restored.get(session.id).messages.map((message) => message.content)).toEqual(["连续对话问题", "连续对话回答", "需要保留过程的问题"])
  expect(restored.get(session.id).processRuns).toEqual([expect.objectContaining({
    userMessageCreatedAt: user.createdAt,
    completed: true,
    events: [
      { type: "reasoning.chunk", text: "先分析条件。" },
      { type: "tool.start", tool: "cas.simplify", input: { expression: "x+x" } },
      { type: "tool.complete", tool: "cas.simplify" },
      { type: "answer", text: "完整解答" },
    ],
  })])
  expect(restored.get(session.id).theory.snapshot().nodes[step.id]?.status).toBe("verified")
  expect(restored.get(session.id).artifacts.map((artifact) => artifact.id)).toEqual(["plot"])
  expect(restored.list()[0]?.id).toBe(session.id)
})

test("backs up damaged session history and starts empty", () => {
  const directory = mkdtempSync(join(tmpdir(), "sigmaforge-corrupt-"))
  const path = join(directory, "sessions.json")
  writeFileSync(path, "{not-json", "utf8")
  const sessions = new SigmaForgeSessions(undefined, undefined, undefined, path)
  expect(sessions.list()).toHaveLength(0)
  expect(readdirSync(directory).some((name) => name.startsWith("sessions.json.corrupt-"))).toBe(true)
})

test("ignores malformed persisted artifacts and web results", () => {
  const path = join(mkdtempSync(join(tmpdir(), "sigmaforge-invalid-artifacts-")), "sessions.json")
  const first = new SigmaForgeSessions(undefined, undefined, undefined, path)
  const session = first.create()
  first.addArtifact(session.id, { id: "plot", kind: "plotly2d", mime: "application/json", data: {}, meta: { expression: "x" } })
  first.addWebResult(session.id, { query: "gamma", sources: [{ title: "DLMF", url: "https://dlmf.nist.gov/5.2", domain: "dlmf.nist.gov", snippet: "Definition" }] })
  const persisted = JSON.parse(readFileSync(path, "utf8")) as Array<Record<string, unknown>>
  persisted[0]!.artifacts = [{ id: "broken" }]
  persisted[0]!.webResults = [{ query: "gamma", sources: [{}] }]
  writeFileSync(path, JSON.stringify(persisted), "utf8")

  const restored = new SigmaForgeSessions(undefined, undefined, undefined, path)
  expect(restored.get(session.id).artifacts).toEqual([])
  expect(restored.get(session.id).webResults).toEqual([])
})

test("deletes persisted session history", () => {
  const path = join(mkdtempSync(join(tmpdir(), "sigmaforge-delete-")), "sessions.json")
  const sessions = new SigmaForgeSessions(undefined, undefined, undefined, path)
  const session = sessions.create()
  sessions.delete(session.id)
  expect(() => sessions.get(session.id)).toThrow("Session not found")
  expect(new SigmaForgeSessions(undefined, undefined, undefined, path).list()).toHaveLength(0)
})
