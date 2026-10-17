export type ThinkingSummary = {
  id: string
  order: number
  method: string
  reason: string
  caution: string
  createdAt: number
  updatedAt: number
}

export type ThinkingSummarySnapshot = {
  version: number
  summaries: ThinkingSummary[]
}

export type ThinkingSummaryInput = {
  method: string
  reason: string
  caution?: string
}

/**
 * Marker the model emits in its **content** stream when one thinking stage is
 * over (typically right before a tool call). The server strips it from the
 * visible answer and emits `thinking.marker`; the client then trims the raw
 * reasoning of that stage and asks a separate model session for a short
 * summary, so the main conversation never pays for summarizing.
 *
 * The content channel is used instead of the reasoning channel because models
 * reliably follow output-format rules there, while `reasoning_content` tends to
 * only *discuss* an instruction instead of emitting the token.
 */
export const stageMarker = "[[STAGE]]"

const markerCandidates = [stageMarker, "<<<STAGE>>>"]
const markerPattern = /\[\[STAGE\]\]|<<<STAGE>>>/gi

/**
 * Splits streamed text into visible text and marker hits while tolerating
 * markers that are split across chunk boundaries.
 */
export class ThinkingMarkerReader {
  private buffer = ""
  private pendingLineBreak = false
  private emitted = false

  push(chunk: string): { text: string; markers: number } {
    this.buffer += chunk
    const hold = pendingMarkerLength(this.buffer)
    const emit = hold > 0 ? this.buffer.slice(0, this.buffer.length - hold) : this.buffer
    this.buffer = hold > 0 ? this.buffer.slice(this.buffer.length - hold) : ""
    return this.consume(emit)
  }

  flush(): { text: string; markers: number } {
    const rest = this.buffer
    this.buffer = ""
    this.pendingLineBreak = false
    return this.consume(rest)
  }

  private consume(value: string) {
    // A marker owns its whole line: the line break that opened it and the one
    // that closes it go away with it, and a single newline is kept in their
    // place so the surrounding paragraphs stay separated.
    let source = value
    if (this.pendingLineBreak) {
      const lead = /^(?:\r?\n)+/.exec(source)
      if (lead) source = source.slice(lead[0].length)
      if (source.trim()) this.pendingLineBreak = false
    }
    let index = 0
    let text = ""
    let markers = 0
    const pattern = new RegExp(markerPattern.source, markerPattern.flags)
    let match: RegExpExecArray | null
    while ((match = pattern.exec(source))) {
      text += source.slice(index, match.index)
      text = text.replace(/(?:\r?\n)+$/, "")
      markers++
      index = match.index + match[0].length
      const trailing = /^\r?\n/.exec(source.slice(index))
      if (trailing) index += trailing[0].length
      else this.pendingLineBreak = true
      if (this.emitted || text.trim()) text += "\n"
    }
    text += source.slice(index)
    if (text.trim()) this.emitted = true
    if (markers > 0 && !text.trim()) this.pendingLineBreak = true
    return { text, markers }
  }
}

export function stripStageMarkers(value: string) {
  return value
    .split(/\r?\n/)
    .filter((line) => {
      const trimmed = line.trim().toUpperCase()
      return trimmed !== stageMarker && trimmed !== "<<<STAGE>>>"
    })
    .join("\n")
    .replace(/\[\[STAGE\]\]|<<<STAGE>>>/gi, "")
    .replace(/^(?:\r?\n)+/, "")
    .replace(/(?:\r?\n)+$/, "")
}

function pendingMarkerLength(value: string) {
  const limit = Math.min(value.length, Math.max(...markerCandidates.map((item) => item.length)))
  for (let length = limit; length > 0; length--) {
    const tail = value.slice(value.length - length).toUpperCase()
    if (markerCandidates.some((item) => item.toUpperCase().startsWith(tail))) return length
  }
  return 0
}

export class ThinkingSummaryStore {
  private readonly summaries: ThinkingSummary[]
  private version: number

  constructor(snapshot?: ThinkingSummarySnapshot) {
    this.summaries = snapshot?.summaries ? structuredClone(snapshot.summaries) : []
    this.version = snapshot?.version ?? 0
  }

  snapshot(): ThinkingSummarySnapshot {
    return structuredClone({ version: this.version, summaries: this.summaries })
  }

  add(input: ThinkingSummaryInput & { id?: string }): ThinkingSummary {
    const now = Date.now()
    const summary: ThinkingSummary = {
      id: input.id ?? crypto.randomUUID(),
      order: this.summaries.length ? Math.max(...this.summaries.map((item) => item.order)) + 1 : 1,
      method: requireSummaryText(input.method, "method", 120),
      reason: requireSummaryText(input.reason, "reason", 300),
      caution: optionalSummaryText(input.caution ?? "", "caution", 300),
      createdAt: now,
      updatedAt: now,
    }
    this.summaries.push(summary)
    this.version++
    return structuredClone(summary)
  }

  update(id: string, input: Partial<ThinkingSummaryInput>): ThinkingSummary {
    const index = this.summaries.findIndex((item) => item.id === id)
    if (index < 0) throw new Error(`Thinking summary not found: ${id}`)
    const current = this.summaries[index]!
    const next: ThinkingSummary = {
      ...current,
      method: input.method === undefined ? current.method : requireSummaryText(input.method, "method", 120),
      reason: input.reason === undefined ? current.reason : requireSummaryText(input.reason, "reason", 300),
      caution: input.caution === undefined ? current.caution : optionalSummaryText(input.caution, "caution", 300),
      updatedAt: Date.now(),
    }
    this.summaries[index] = next
    this.version++
    return structuredClone(next)
  }

  remove(id: string): { removed: ThinkingSummary; summaries: ThinkingSummary[] } {
    const index = this.summaries.findIndex((item) => item.id === id)
    if (index < 0) throw new Error(`Thinking summary not found: ${id}`)
    const [removed] = this.summaries.splice(index, 1)
    this.version++
    return { removed: structuredClone(removed!), summaries: this.snapshot().summaries }
  }

  rollbackTo(id?: string): { removed: ThinkingSummary[]; summaries: ThinkingSummary[] } {
    const index = id ? this.summaries.findIndex((item) => item.id === id) : this.summaries.length - 1
    if (index < 0) throw new Error(id ? `Thinking summary not found: ${id}` : "There are no thinking summaries to roll back")
    const removed = this.summaries.splice(index)
    this.version++
    return { removed: structuredClone(removed), summaries: this.snapshot().summaries }
  }
}

function requireSummaryText(value: string, field: string, maxLength: number) {
  const normalized = value.trim()
  if (!normalized) throw new Error(`Thinking summary ${field} is required`)
  if (normalized.length > maxLength) throw new Error(`Thinking summary ${field} must be ${maxLength} characters or fewer`)
  return normalized
}

function optionalSummaryText(value: string, field: string, maxLength: number) {
  const normalized = value.trim()
  if (normalized.length > maxLength) throw new Error(`Thinking summary ${field} must be ${maxLength} characters or fewer`)
  return normalized
}

export * as SigmaForgeThinking from "./thinking"
