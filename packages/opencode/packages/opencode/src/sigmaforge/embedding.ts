import { createHash } from "node:crypto"

export interface Embedder {
  readonly dimensions: number
  embed(text: string): Promise<number[]>
}

export class LocalHashEmbedder implements Embedder {
  readonly dimensions = 1024

  async embed(text: string) {
    const vector = Array.from({ length: this.dimensions }, () => 0)
    const normalized = text.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim()
    const terms = [...normalized].flatMap((character, index) => [character, normalized.slice(index, index + 2)]).filter(Boolean)
    for (const term of terms) {
      const digest = createHash("sha256").update(term).digest()
      const index = digest.readUInt16BE(0) % this.dimensions
      vector[index] += digest[2]! % 2 === 0 ? 1 : -1
    }
    const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1
    return vector.map((value) => value / norm)
  }
}

export * as Embedding from "./embedding"
