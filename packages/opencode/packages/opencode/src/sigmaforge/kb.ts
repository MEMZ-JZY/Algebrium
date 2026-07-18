import { Database } from "bun:sqlite"
import { z } from "zod"
import { LocalHashEmbedder, type Embedder } from "./embedding"
import { createHash } from "node:crypto"

export const KBEntrySchema = z.object({
  id: z.string().min(1),
  subject: z.string().min(1),
  grade: z.string().min(1),
  type: z.enum(["theorem", "example", "formula", "concept"]),
  title: z.string().min(1),
  contentMd: z.string().min(1),
  sourceUrl: z.string().url().nullable().optional(),
  sourceType: z.enum(["textbook", "exam", "wiki", "manual"]).nullable().optional(),
  fingerprint: z.string().nullable().optional(),
  difficulty: z.number().min(0).max(1).default(0.5),
  prerequisites: z.array(z.string()).default([]),
  qualityScore: z.number().min(0).max(1).default(1),
})

export type KBEntry = z.infer<typeof KBEntrySchema>
export type KBSearchResult = KBEntry & { score: number }

export interface KnowledgeBaseReader {
  get(id: string): KBEntry | undefined
  search(query: string, input: { subject: string; limit?: number }): Promise<KBSearchResult[]>
  similar(fingerprint: string, subject: string, limit?: number): Promise<KBEntry[]>
}

export interface MistakeSink {
  enqueue(input: { sessionID: string; entryID?: string; attribution: string; pattern: string }): string
}

export class MistakeInbox implements MistakeSink {
  readonly database: Database

  constructor(path: string) {
    this.database = new Database(path)
  }

  enqueue(input: { sessionID: string; entryID?: string; attribution: string; pattern: string }) {
    const id = crypto.randomUUID()
    this.database.query("INSERT INTO pending_mistakes (id, session_id, entry_id, attribution, pattern, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(id, input.sessionID, input.entryID ?? null, input.attribution, input.pattern, Date.now())
    return id
  }

  close() {
    this.database.close()
  }
}

export class QdrantClient {
  constructor(
    readonly url = process.env.QDRANT_URL ?? "http://127.0.0.1:7333",
    readonly collection = process.env.QDRANT_COLLECTION ?? "kb_math_v1",
  ) {}

  async ensureCollection(dimensions: number) {
    const current = await fetch(`${this.url}/collections/${this.collection}`)
    if (current.ok) return
    const response = await fetch(`${this.url}/collections/${this.collection}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ vectors: { size: dimensions, distance: "Cosine" } }),
    })
    if (!response.ok) throw new Error(`Qdrant collection creation failed: ${response.status}`)
  }

  async upsert(entry: KBEntry, vector: number[]) {
    const response = await fetch(`${this.url}/collections/${this.collection}/points?wait=true`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        points: [{ id: qdrantPointID(entry.id), vector, payload: { entry_id: entry.id, subject: entry.subject, grade: entry.grade, type: entry.type, title: entry.title, difficulty: entry.difficulty, fingerprint: entry.fingerprint } }],
      }),
    })
    if (!response.ok) throw new Error(`Qdrant upsert failed: ${response.status}`)
  }

  async search(vector: number[], subject: string, limit: number) {
    const response = await fetch(`${this.url}/collections/${this.collection}/points/query`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: vector, filter: { must: [{ key: "subject", match: { value: subject } }] }, limit, with_payload: true }),
    })
    if (!response.ok) throw new Error(`Qdrant search failed: ${response.status}`)
    const body = (await response.json()) as { result?: { points?: Array<{ score: number; payload?: { entry_id?: string } }> } }
    return (body.result?.points ?? []).flatMap((point) => point.payload?.entry_id ? [{ id: point.payload.entry_id, score: point.score }] : [])
  }

  async findByFingerprint(fingerprint: string, subject: string, limit: number) {
    const response = await fetch(`${this.url}/collections/${this.collection}/points/scroll`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ filter: { must: [{ key: "subject", match: { value: subject } }, { key: "fingerprint", match: { value: fingerprint } }] }, limit, with_payload: true, with_vector: false }),
    })
    if (!response.ok) throw new Error(`Qdrant fingerprint lookup failed: ${response.status}`)
    const body = (await response.json()) as { result?: { points?: Array<{ payload?: { entry_id?: string } }> } }
    return (body.result?.points ?? []).flatMap((point) => point.payload?.entry_id ? [{ id: point.payload.entry_id }] : [])
  }
}

export class KnowledgeBase {
  readonly database: Database

  constructor(
    path = process.env.ALGEBRIUM_KB_PATH ?? process.env.SIGMAFORGE_KB_PATH ?? "data/algebrium.db",
    readonly qdrant = new QdrantClient(),
    readonly embedder: Embedder = new LocalHashEmbedder(),
    readonly writable = false,
  ) {
    this.database = new Database(path, { create: writable, readonly: !writable })
    if (writable) this.migrate()
  }

  migrate() {
    if (!this.writable) throw new Error("Knowledge base is read-only")
    this.database.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS entries (
        id TEXT PRIMARY KEY, subject TEXT NOT NULL, grade TEXT NOT NULL, type TEXT NOT NULL,
        title TEXT NOT NULL, content_md TEXT NOT NULL, source_url TEXT, source_type TEXT,
        fingerprint TEXT, difficulty REAL NOT NULL DEFAULT 0.5, prerequisites TEXT NOT NULL DEFAULT '[]',
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, quality_score REAL NOT NULL DEFAULT 1
      );
      CREATE TABLE IF NOT EXISTS mistakes (
        id TEXT PRIMARY KEY, entry_id TEXT REFERENCES entries(id), attribution TEXT NOT NULL,
        pattern TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 1
      );
      CREATE TABLE IF NOT EXISTS links (
        src TEXT NOT NULL REFERENCES entries(id), dst TEXT NOT NULL REFERENCES entries(id), relation TEXT NOT NULL,
        PRIMARY KEY (src, dst, relation)
      );
      CREATE TABLE IF NOT EXISTS pending_mistakes (
        id TEXT PRIMARY KEY, session_id TEXT NOT NULL, entry_id TEXT, attribution TEXT NOT NULL,
        pattern TEXT NOT NULL, created_at INTEGER NOT NULL, processed_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS entries_fingerprint_idx ON entries(fingerprint);
    `)
  }

  get(id: string) {
    const row = this.database.query("SELECT * FROM entries WHERE id = ?").get(id) as EntryRow | null
    return row ? fromRow(row) : undefined
  }

  async search(query: string, input: { subject: string; limit?: number }) {
    const matches = await this.qdrant.search(await this.embedder.embed(query), input.subject, Math.min(input.limit ?? 5, 10))
    return matches.flatMap((match) => {
      const entry = this.get(String(match.id))
      return entry ? [{ ...entry, score: match.score }] : []
    })
  }

  async similar(fingerprint: string, subject: string, limit = 5) {
    const matches = await this.qdrant.findByFingerprint(fingerprint, subject, Math.min(limit, 10))
    return matches.flatMap((match) => {
      const entry = this.get(String(match.id))
      return entry ? [entry] : []
    })
  }

  async upsert(input: KBEntry) {
    if (!this.writable) throw new Error("Knowledge base is read-only")
    const entry = KBEntrySchema.parse(input)
    const now = Date.now()
    this.database.query(`
      INSERT INTO entries (id, subject, grade, type, title, content_md, source_url, source_type, fingerprint, difficulty, prerequisites, created_at, updated_at, quality_score)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET subject=excluded.subject, grade=excluded.grade, type=excluded.type, title=excluded.title,
        content_md=excluded.content_md, source_url=excluded.source_url, source_type=excluded.source_type,
        fingerprint=excluded.fingerprint, difficulty=excluded.difficulty, prerequisites=excluded.prerequisites,
        updated_at=excluded.updated_at, quality_score=excluded.quality_score
    `).run(entry.id, entry.subject, entry.grade, entry.type, entry.title, entry.contentMd, entry.sourceUrl ?? null, entry.sourceType ?? null, entry.fingerprint ?? null, entry.difficulty, JSON.stringify(entry.prerequisites), now, now, entry.qualityScore)
    await this.qdrant.upsert(entry, await this.embedder.embed(`${entry.title}\n${entry.contentMd}`))
    return entry
  }

  all(subject?: string) {
    const rows = (subject
      ? this.database.query("SELECT * FROM entries WHERE subject = ? ORDER BY id").all(subject)
      : this.database.query("SELECT * FROM entries ORDER BY id").all()) as EntryRow[]
    return rows.map(fromRow)
  }

  close() {
    this.database.close()
  }
}

type EntryRow = {
  id: string; subject: string; grade: string; type: KBEntry["type"]; title: string; content_md: string
  source_url: string | null; source_type: KBEntry["sourceType"] | null; fingerprint: string | null
  difficulty: number; prerequisites: string; quality_score: number
}

function fromRow(row: EntryRow): KBEntry {
  return KBEntrySchema.parse({ id: row.id, subject: row.subject, grade: row.grade, type: row.type, title: row.title, contentMd: row.content_md, sourceUrl: row.source_url, sourceType: row.source_type, fingerprint: row.fingerprint, difficulty: row.difficulty, prerequisites: JSON.parse(row.prerequisites), qualityScore: row.quality_score })
}

function qdrantPointID(id: string) {
  const value = createHash("sha256").update(id).digest("hex").slice(0, 32)
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`
}

export * as KB from "./kb"
