import { afterEach, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { KnowledgeBase, MistakeInbox, QdrantClient, type KBEntry } from "../../opencode/packages/opencode/src/sigmaforge/kb"
import { Curator } from "../src/curator"

class MemoryQdrant extends QdrantClient {
  override async ensureCollection(_dimensions: number) {}
  override async upsert(_entry: KBEntry, _vector: number[]) {}
}

const directories: string[] = []
afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })))

test("Curator rebuilds prerequisite links and consumes the mistake inbox", async () => {
  const directory = mkdtempSync(join(tmpdir(), "sigmaforge-curator-"))
  directories.push(directory)
  const path = join(directory, "kb.sqlite")
  const kb = new KnowledgeBase(path, new MemoryQdrant(), undefined, true)
  await kb.upsert(entry({ id: "prerequisite", prerequisites: [] }))
  await kb.upsert(entry({ id: "target", prerequisites: ["prerequisite"] }))
  const inbox = new MistakeInbox(path)
  inbox.enqueue({ sessionID: "session", entryID: "target", attribution: "rule", pattern: "公式错误" })
  inbox.close()

  const curator = new Curator(kb)
  expect(curator.rebuildTheoryGraph()).toEqual({ links: 1 })
  expect(curator.processPendingMistakes()).toEqual({ processed: 1 })
  expect((kb.database.query("SELECT COUNT(*) AS count FROM mistakes").get() as { count: number }).count).toBe(1)
  expect((kb.database.query("SELECT COUNT(*) AS count FROM pending_mistakes WHERE processed_at IS NULL").get() as { count: number }).count).toBe(0)
  kb.close()
})

function entry(input: Partial<KBEntry>): KBEntry {
  return { id: "entry", subject: "math", grade: "高三", type: "theorem", title: "知识点", contentMd: "内容", difficulty: 0.5, prerequisites: [], qualityScore: 1, ...input }
}
