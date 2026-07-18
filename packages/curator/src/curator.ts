import { resolve } from "node:path"
import { KnowledgeBase, type KBEntry } from "../../opencode/packages/opencode/src/sigmaforge/kb"
import { fingerprintProblem } from "../../opencode/packages/opencode/src/sigmaforge/fingerprint"

export const defaultDatabasePath = process.env.ALGEBRIUM_KB_PATH ?? process.env.SIGMAFORGE_KB_PATH ?? resolve(import.meta.dir, "../../../data/algebrium.db")

export class Curator {
  constructor(readonly kb = new KnowledgeBase(defaultDatabasePath, undefined, undefined, true)) {}

  async collect() {
    await this.kb.qdrant.ensureCollection(this.kb.embedder.dimensions)
    const entries = seedEntries()
    for (const entry of entries) await this.kb.upsert(entry)
    return { inserted: entries.length }
  }

  async refreshIndex() {
    await this.kb.qdrant.ensureCollection(this.kb.embedder.dimensions)
    const entries = this.kb.all()
    for (const entry of entries) await this.kb.qdrant.upsert(entry, await this.kb.embedder.embed(`${entry.title}\n${entry.contentMd}`))
    return { indexed: entries.length }
  }

  cleanup() {
    const duplicates = this.kb.database.query(`
      SELECT fingerprint FROM entries WHERE fingerprint IS NOT NULL GROUP BY fingerprint HAVING COUNT(*) > 1
    `).all() as Array<{ fingerprint: string }>
    const update = this.kb.database.query("UPDATE entries SET quality_score = 0.5 WHERE fingerprint = ?")
    this.kb.database.transaction(() => duplicates.forEach((item) => update.run(item.fingerprint)))()
    return { duplicateFingerprints: duplicates.length }
  }

  recalibrateDifficulty() {
    this.kb.database.exec(`
      UPDATE entries SET difficulty = MIN(1, MAX(0, difficulty + COALESCE((
        SELECT SUM(count) * 0.02 FROM mistakes WHERE mistakes.entry_id = entries.id
      ), 0)))
    `)
    return { updated: this.kb.all().length }
  }

  async health() {
    const response = await fetch(`${this.kb.qdrant.url}/healthz`)
    if (!response.ok) throw new Error(`Qdrant health check failed: ${response.status}`)
    const entries = (this.kb.database.query("SELECT COUNT(*) AS count FROM entries").get() as { count: number }).count
    const pending = (this.kb.database.query("SELECT COUNT(*) AS count FROM pending_mistakes WHERE processed_at IS NULL").get() as { count: number }).count
    return { qdrant: "ok", sqlite: "ok", entries, pendingMistakes: pending }
  }

  rebuildTheoryGraph() {
    const entries = this.kb.all()
    const ids = new Set(entries.map((entry) => entry.id))
    const links = entries.flatMap((entry) => entry.prerequisites.filter((id) => ids.has(id)).map((id) => [id, entry.id, "implies"] as const))
    this.kb.database.transaction(() => {
      this.kb.database.exec("DELETE FROM links")
      const insert = this.kb.database.query("INSERT INTO links (src, dst, relation) VALUES (?, ?, ?)")
      links.forEach((link) => insert.run(...link))
    })()
    return { links: links.length }
  }

  processPendingMistakes() {
    const pending = this.kb.database.query("SELECT * FROM pending_mistakes WHERE processed_at IS NULL ORDER BY created_at").all() as Array<{ id: string; entry_id: string | null; attribution: string; pattern: string }>
    const upsert = this.kb.database.query(`
      INSERT INTO mistakes (id, entry_id, attribution, pattern, count) VALUES (?, ?, ?, ?, 1)
      ON CONFLICT(id) DO UPDATE SET count = count + 1
    `)
    const done = this.kb.database.query("UPDATE pending_mistakes SET processed_at = ? WHERE id = ?")
    this.kb.database.transaction(() => pending.forEach((item) => {
      upsert.run(item.id, item.entry_id, item.attribution, item.pattern)
      done.run(Date.now(), item.id)
    }))()
    return { processed: pending.length }
  }
}

function seedEntries(): KBEntry[] {
  return [
    { id: "math-derivative-concept", subject: "math", grade: "高二", type: "concept", title: "导数与瞬时变化率", contentMd: "导数描述函数在一点的瞬时变化率，也等于曲线在该点切线的斜率。", sourceType: "manual", difficulty: 0.3, prerequisites: [], qualityScore: 1 },
    { id: "math-product-rule", subject: "math", grade: "高二", type: "theorem", title: "导数乘法法则", contentMd: "$$(uv)'=u'v+uv'$$。使用前先识别两个相乘的函数。", sourceType: "manual", difficulty: 0.4, prerequisites: ["math-derivative-concept"], qualityScore: 1 },
    { id: "math-basic-integrals", subject: "math", grade: "高二", type: "formula", title: "基本积分表", contentMd: "例如 $\\int e^x\\,dx=e^x+C$，可通过求导回代验证。", sourceType: "manual", difficulty: 0.4, prerequisites: ["math-derivative-concept"], qualityScore: 1 },
    { id: "math-integration-by-parts", subject: "math", grade: "高三", type: "theorem", title: "分部积分", contentMd: "$\\int u\\,dv=uv-\\int v\\,du$。通常令代数因子为 $u$。", sourceType: "manual", difficulty: 0.6, prerequisites: ["math-product-rule", "math-basic-integrals"], qualityScore: 1 },
    { id: "math-integral-x-exp-x", subject: "math", grade: "高三", type: "example", title: "求 x e^x 的不定积分", contentMd: "令 $u=x,dv=e^x dx$，得到 $\\int xe^x dx=(x-1)e^x+C$。", sourceType: "manual", fingerprint: fingerprintProblem("求 ∫ x e^x dx"), difficulty: 0.6, prerequisites: ["math-integration-by-parts"], qualityScore: 1 },
  ]
}

export * as CuratorService from "./curator"
