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
