import type { ThinkingSummary } from "./api"

export type ReasoningStep = {
  id: string
  kind: "reasoning"
  content: string
  pending?: boolean
  stageID?: string
  runID?: string
  summaryID?: string
}

export function appendReasoningChunk<T extends { id: string; kind: string; content?: string; pending?: boolean; stageID?: string; runID?: string; summaryID?: string }>(
  steps: T[],
  event: { text: string; stageID?: string; runID?: string },
  fallbackStageID: string,
): T[] {
  const stageID = event.stageID ?? fallbackStageID
  const index = steps.findIndex((step) => step.kind === "reasoning" && (step.stageID ?? step.id) === stageID)
  if (index < 0) return [...steps, { id: stageID, kind: "reasoning", content: event.text, stageID, ...(event.runID ? { runID: event.runID } : {}) } as T]
  const existing = steps[index]
  if (!existing) return steps
  return steps.map((step, stepIndex) => stepIndex === index
    ? { ...step, id: stageID, stageID, ...(event.runID ? { runID: event.runID } : {}), content: `${step.content ?? ""}${event.text}` } as T
    : step)
}

export function markReasoningStage<T extends { id: string; kind: string; content?: string; pending?: boolean; stageID?: string; runID?: string; summaryID?: string }>(
  steps: T[],
  event: { stageID?: string; runID?: string; summaryID?: string },
  fallbackStageID: string,
): T[] {
  const stageID = event.stageID ?? fallbackStageID
  const index = steps.findIndex((step) => step.kind === "reasoning" && (step.stageID ?? step.id) === stageID)
  if (index < 0) return [...steps, {
    id: stageID,
    kind: "reasoning",
    content: "",
    pending: true,
    stageID,
    ...(event.runID ? { runID: event.runID } : {}),
    ...(event.summaryID ? { summaryID: event.summaryID } : {}),
  } as T]
  return steps.map((step, stepIndex) => stepIndex === index ? {
    ...step,
    // Once the marker arrives, raw reasoning is never shown as a summary.
    content: "",
    pending: true,
    stageID,
    ...(event.runID ? { runID: event.runID } : {}),
    ...(event.summaryID ? { summaryID: event.summaryID } : {}),
  } as T : step)
}

export function applyThinkingSummaries<T extends { id: string; kind: string; content?: string; pending?: boolean; stageID?: string; runID?: string; summaryID?: string }>(
  steps: T[],
  summaries: ThinkingSummary[],
): T[] {
  return steps.flatMap((step) => {
    if (step.kind !== "reasoning" || (!step.summaryID && !step.stageID)) return [step]
    const summary = summaries.find((item) =>
      (step.summaryID && item.id === step.summaryID) ||
      (step.stageID && item.stageID === step.stageID && (!step.runID || !item.runID || item.runID === step.runID)))
    if (!summary) return step.summaryID ? [] : [step]
    if (summary.status === "pending") return [{ ...step, summaryID: summary.id, pending: true, content: "" } as T]
    return [{ ...step, summaryID: summary.id, pending: false, content: formatThinkingSummary(summary) } as T]
  })
}

export function formatThinkingSummary(summary: ThinkingSummary) {
  const label = [summary.method, summary.reason].filter(Boolean).join(" · ")
  return summary.caution ? `${label}（注意：${summary.caution}）` : label
}

export function shouldApplyThinkingSnapshot(
  current: { sessionID?: string; version: number },
  incoming: { sessionID: string; version: number },
) {
  if (current.sessionID !== incoming.sessionID) return false
  return incoming.version > current.version
}
