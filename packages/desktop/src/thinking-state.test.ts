// @ts-expect-error Bun provides this module when running the focused regression test.
import { expect, test } from "bun:test"
import { applyThinkingSummaries, appendReasoningChunk, markReasoningStage, shouldApplyThinkingSnapshot, type ReasoningStep } from "./thinking-state"
import type { ThinkingSummary } from "./api"

const summary = (input: Partial<ThinkingSummary> & Pick<ThinkingSummary, "id" | "order" | "method" | "reason" | "caution" | "createdAt" | "updatedAt">): ThinkingSummary => input

test("reasoning chunks use the server stage identity and marker hides raw content", () => {
  let steps: ReasoningStep[] = []
  steps = appendReasoningChunk(steps, { stageID: "stage-1", runID: "run-1", text: "private reasoning" }, "fallback")
  steps = markReasoningStage(steps, { stageID: "stage-1", runID: "run-1", summaryID: "summary-1" }, "fallback")
  expect(steps).toEqual([{ id: "stage-1", kind: "reasoning", content: "", pending: true, stageID: "stage-1", runID: "run-1", summaryID: "summary-1" }])
})

test("late summary replaces its pending process block and right-panel summary data", () => {
  const pending = markReasoningStage<ReasoningStep>([], { stageID: "stage-1", runID: "run-1", summaryID: "summary-1" }, "fallback")
  const resolved = applyThinkingSummaries(pending, [summary({ id: "summary-1", order: 1, method: "分解", reason: "提取条件", caution: "检查边界", createdAt: 1, updatedAt: 2, stageID: "stage-1", runID: "run-1", status: "ready" })])
  expect(resolved[0]).toMatchObject({ content: "分解 · 提取条件（注意：检查边界）", pending: false, summaryID: "summary-1" })
})

test("a ready snapshot received before its marker remains resolved", () => {
  const ready = [summary({ id: "summary-1", order: 1, method: "归纳", reason: "识别模式", caution: "", createdAt: 1, updatedAt: 2, stageID: "stage-1", runID: "run-1", status: "ready" })]
  const alreadyResolved = applyThinkingSummaries([{ id: "stage-1", kind: "reasoning", content: "raw", stageID: "stage-1", runID: "run-1" }], ready)
  const afterMarker = markReasoningStage(alreadyResolved, { stageID: "stage-1", runID: "run-1", summaryID: "summary-1" }, "fallback")
  expect(applyThinkingSummaries(afterMarker, ready)[0]).toMatchObject({ content: "归纳 · 识别模式", pending: false })
})

test("a deleted summary removes its bound block instead of exposing reasoning again", () => {
  const original = [{ id: "stage-1", kind: "reasoning", content: "must not reappear", pending: false, stageID: "stage-1", summaryID: "summary-1" }]
  expect(applyThinkingSummaries(original, [])).toEqual([])
})

test("snapshot acceptance rejects stale versions and updates from another session", () => {
  const current = { sessionID: "session-1", version: 4 }
  expect(shouldApplyThinkingSnapshot(current, { sessionID: "session-1", version: 4 })).toBe(false)
  expect(shouldApplyThinkingSnapshot(current, { sessionID: "session-1", version: 3 })).toBe(false)
  expect(shouldApplyThinkingSnapshot(current, { sessionID: "session-2", version: 5 })).toBe(false)
  expect(shouldApplyThinkingSnapshot(current, { sessionID: "session-1", version: 5 })).toBe(true)
})
