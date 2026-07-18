import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { attributeMistake } from "@/sigmaforge/attribution"
import { LocalHashEmbedder } from "@/sigmaforge/embedding"
import { fingerprintProblem } from "@/sigmaforge/fingerprint"
import { KnowledgeBase, MistakeInbox, QdrantClient, type KBEntry } from "@/sigmaforge/kb"
import { buildLearningPath } from "@/sigmaforge/learning-path"

class MemoryQdrant extends QdrantClient {
  readonly entries = new Map<string, { entry: KBEntry; vector: number[] }>()

  override async ensureCollection(_dimensions: number) {}
  override async upsert(entry: KBEntry, vector: number[]) { this.entries.set(entry.id, { entry, vector }) }
  override async search(_vector: number[], subject: string, limit: number) {
    return [...this.entries.values()].filter((item) => item.entry.subject === subject).slice(0, limit).map((item, index) => ({ id: item.entry.id, score: 1 - index / 10 }))
  }
  override async findByFingerprint(fingerprint: string, subject: string, limit: number) {
    return [...this.entries.values()].filter((item) => item.entry.subject === subject && item.entry.fingerprint === fingerprint).slice(0, limit).map((item) => ({ id: item.entry.id }))
  }
}

const directories: string[] = []
afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })))

describe("SigmaForge knowledge base", () => {
  test("stores metadata, searches vectors, and enforces read-only writes", async () => {
    const directory = mkdtempSync(join(tmpdir(), "sigmaforge-kb-"))
    directories.push(directory)
    const path = join(directory, "kb.sqlite")
    const qdrant = new MemoryQdrant()
    const writer = new KnowledgeBase(path, qdrant, new LocalHashEmbedder(), true)
    const fingerprint = fingerprintProblem("求 ∫ x e^x dx")
    await writer.upsert(entry({ fingerprint }))
    expect((await writer.search("分部积分", { subject: "math" }))[0]?.title).toBe("分部积分")
    expect((await writer.similar(fingerprint, "math"))[0]?.id).toBe("integration-by-parts")
    writer.close()

    const reader = new KnowledgeBase(path, qdrant)
    expect(reader.get("integration-by-parts")?.prerequisites).toEqual(["product-rule"])
    expect(reader.upsert(entry({ fingerprint }))).rejects.toThrow("read-only")
    reader.close()
    const inbox = new MistakeInbox(path)
    expect(inbox.enqueue({ sessionID: "session", attribution: "rule", pattern: "公式用错" })).toBeString()
    expect((inbox.database.query("SELECT COUNT(*) AS count FROM pending_mistakes").get() as { count: number }).count).toBe(1)
    inbox.close()
  })

  test("attributes mistakes and orders prerequisites before the target", () => {
    const attribution = attributeMistake({ message: "我在分部积分公式这里用错了" })
    const path = buildLearningPath(attribution, [entry({ id: "product-rule", prerequisites: [] }), entry({ prerequisites: ["product-rule"] })])
    expect(attribution.category).toBe("rule")
    expect(path.map((item) => item.entryID)).toEqual(["product-rule", "integration-by-parts"])
  })
})

function entry(input: Partial<KBEntry> = {}): KBEntry {
  return { id: "integration-by-parts", subject: "math", grade: "高三", type: "theorem", title: "分部积分", contentMd: "积分公式", difficulty: 0.6, prerequisites: ["product-rule"], qualityScore: 1, ...input }
}
