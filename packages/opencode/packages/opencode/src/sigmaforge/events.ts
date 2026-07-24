import type { CASResult } from "./cas"
import type { PlotArtifact } from "./plot"
import type { VerificationResult } from "./verifier"
import type { ContextSnapshot } from "./context"
import type { TheoryNode } from "./theory"
import type { KBSearchResult } from "./kb"
import type { MistakeAttribution } from "./attribution"
import type { LearningPathNode } from "./learning-path"
import type { WebSearchResult } from "./web-search"

export type StreamEvent =
  | { type: "chunk"; text: string }
  | { type: "reasoning.chunk"; text: string }
  | { type: "answer"; text: string }
  | { type: "tool.start"; tool: string; input?: unknown }
  | { type: "tool.result"; tool: string; result: CASResult }
  | { type: "tool.error"; tool: string; message: string }
  | { type: "artifact"; artifact: PlotArtifact }
  | { type: "artifact.pending"; artifact: { id: string; kind: PlotArtifact["kind"]; title: string } }
  | { type: "verification"; result: VerificationResult }
  | { type: "theory.updated"; node: TheoryNode; version: number }
  | { type: "kb.result"; entries: KBSearchResult[] }
  | { type: "mistake.attributed"; attribution: MistakeAttribution }
  | { type: "learning.path"; nodes: LearningPathNode[] }
  | { type: "web.result"; result: WebSearchResult }
  | { type: "error"; message: string }
  | { type: "done"; context: ContextSnapshot }

export * as SigmaForgeEvents from "./events"
