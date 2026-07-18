import type { KBEntry } from "./kb"
import type { MistakeAttribution } from "./attribution"

export type LearningPathNode = {
  entryID: string
  title: string
  reason: string
  order: number
  contentMd: string
}

export function buildLearningPath(attribution: MistakeAttribution, entries: KBEntry[]) {
  const ordered = topological(entries)
  return ordered.slice(0, 5).map((entry, index): LearningPathNode => ({
    entryID: entry.id,
    title: entry.title,
    reason: index === ordered.length - 1 ? `针对本次 ${attribution.category} 类错误进行巩固。` : "这是后续知识点的先修内容。",
    order: index + 1,
    contentMd: entry.contentMd,
  }))
}

function topological(entries: KBEntry[]) {
  const byID = new Map(entries.map((entry) => [entry.id, entry]))
  const visited = new Set<string>()
  const result: KBEntry[] = []
  const visit = (entry: KBEntry) => {
    if (visited.has(entry.id)) return
    visited.add(entry.id)
    entry.prerequisites.map((id) => byID.get(id)).filter((item): item is KBEntry => Boolean(item)).forEach(visit)
    result.push(entry)
  }
  entries.forEach(visit)
  return result
}

export * as LearningPath from "./learning-path"
