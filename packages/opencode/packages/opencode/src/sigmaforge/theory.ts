import type { VerificationResult } from "./verifier"

export type TheoryNodeKind = "problem" | "step" | "claim" | "result"
export type TheoryNodeStatus = "pending" | "verified" | "rejected" | "error"

export type TheoryNode = {
  id: string
  parentID?: string
  kind: TheoryNodeKind
  title: string
  content: string
  expression?: string
  rule?: string
  status: TheoryNodeStatus
  verification?: VerificationResult
  artifactIDs: string[]
  children: string[]
}

export type TheoryTree = {
  sessionID: string
  rootID?: string
  version: number
  nodes: Record<string, TheoryNode>
}

export class TheoryTreeStore {
  private readonly tree: TheoryTree

  constructor(sessionID: string) {
    this.tree = { sessionID, version: 0, nodes: {} }
  }

  snapshot(): TheoryTree {
    return structuredClone(this.tree)
  }

  add(input: Omit<TheoryNode, "id" | "status" | "artifactIDs" | "children"> & { id?: string }) {
    if (input.parentID && !this.tree.nodes[input.parentID]) throw new Error(`Theory parent not found: ${input.parentID}`)
    const node: TheoryNode = {
      ...input,
      id: input.id ?? crypto.randomUUID(),
      status: "pending",
      artifactIDs: [],
      children: [],
    }
    if (this.tree.nodes[node.id]) throw new Error(`Theory node already exists: ${node.id}`)
    this.tree.nodes[node.id] = node
    if (input.parentID) this.tree.nodes[input.parentID]!.children.push(node.id)
    if (!input.parentID) {
      if (this.tree.rootID) throw new Error("Theory tree already has a root")
      this.tree.rootID = node.id
    }
    this.tree.version++
    return structuredClone(node)
  }

  complete(id: string, input: { status: Exclude<TheoryNodeStatus, "pending">; verification?: VerificationResult; artifactID?: string }) {
    const node = this.tree.nodes[id]
    if (!node) throw new Error(`Theory node not found: ${id}`)
    if (node.status !== "pending") throw new Error(`Theory node is already complete: ${id}`)
    node.status = input.status
    node.verification = input.verification
    if (input.artifactID) node.artifactIDs.push(input.artifactID)
    this.tree.version++
    return structuredClone(node)
  }

  attachArtifact(id: string, artifactID: string) {
    const node = this.tree.nodes[id]
    if (!node) throw new Error(`Theory node not found: ${id}`)
    if (!node.artifactIDs.includes(artifactID)) node.artifactIDs.push(artifactID)
    this.tree.version++
    return structuredClone(node)
  }

  outline() {
    return Object.values(this.tree.nodes)
      .map((node) => `${"  ".repeat(depth(this.tree.nodes, node))}- [${node.status}] ${node.title}: ${node.content}`)
      .join("\n")
  }
}

function depth(nodes: Record<string, TheoryNode>, node: TheoryNode): number {
  if (!node.parentID) return 0
  const parent = nodes[node.parentID]
  return parent ? 1 + depth(nodes, parent) : 0
}

export * as SigmaForgeTheory from "./theory"
