import { createHash } from "node:crypto"

export function fingerprintProblem(problem: string) {
  const normalized = problem
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[，。！？、；：]/g, "")
    .replace(/\b[a-z]\b/g, "v")
  return createHash("sha256").update(normalized).digest("hex")
}

export * as Fingerprint from "./fingerprint"
