import type { SubjectModule } from "./subject"

const blocked = new Set([
  "apply_patch",
  "bash",
  "edit",
  "glob",
  "grep",
  "lsp",
  "read",
  "shell",
  "webfetch",
  "websearch",
  "write",
])

export function allowedToolIDs(subject: SubjectModule) {
  return subject.tools.map((tool) => tool.id).filter((id) => !blocked.has(id.toLowerCase()))
}

export function assertToolAllowed(subject: SubjectModule, toolID: string) {
  if (!allowedToolIDs(subject).includes(toolID)) throw new Error(`Tool is disabled for ${subject.id}: ${toolID}`)
}

export * as SigmaForgePolicy from "./policy"
