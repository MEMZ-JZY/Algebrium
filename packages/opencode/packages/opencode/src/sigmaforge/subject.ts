export type SubjectContext = {
  sessionID: string
  subject: string
}

export type SubjectTool = {
  id: string
  description: string
}

export type SubjectModule = {
  id: string
  displayName: string
  gradeRange: readonly [string, string]
  tools: readonly SubjectTool[]
  systemPrompt(ctx: SubjectContext): string
}

export class UnknownSubjectError extends Error {
  constructor(readonly subject: string) {
    super(`Unknown subject: ${subject}`)
    this.name = "UnknownSubjectError"
  }
}

export class SubjectRegistry {
  private readonly modules = new Map<string, SubjectModule>()

  register(module: SubjectModule) {
    if (this.modules.has(module.id)) throw new Error(`Subject already registered: ${module.id}`)
    this.modules.set(module.id, module)
  }

  resolve(subject = "math") {
    const module = this.modules.get(subject)
    if (!module) throw new UnknownSubjectError(subject)
    return module
  }
}

export const mathModule: SubjectModule = {
  id: "math",
  displayName: "数学",
  gradeRange: ["高一", "本科二年级"],
  tools: [
    "solve",
    "integrate",
    "diff",
    "limit",
    "simplify",
    "series",
    "matrix",
    "factor",
    "assume",
    "eval",
    "verify",
    "plot.function2d",
    "plot.surface3d",
    "geometry.construct",
    "kb.search",
    "kb.get",
    "kb.similar",
    "mistake.attribute",
    "learning.path",
  ].map((id) => ({ id, description: `SigmaForge mathematics tool: ${id}` })),
  systemPrompt: () => "你是 Algebrium 数学助教。请使用中文给出清晰、准确且可验证的解释。",
}

export const physicsModule: SubjectModule = {
  id: "physics",
  displayName: "物理",
  gradeRange: ["高一", "本科二年级"],
  tools: [],
  systemPrompt: () => "你是 Algebrium 物理模块占位实现。",
}

export function createSubjectRegistry() {
  const registry = new SubjectRegistry()
  registry.register(mathModule)
  registry.register(physicsModule)
  return registry
}

export * as Subject from "./subject"
