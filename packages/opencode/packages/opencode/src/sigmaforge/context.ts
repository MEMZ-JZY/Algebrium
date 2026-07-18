import type { SigmaForgeMessage } from "./session"
import type { TheoryTreeStore } from "./theory"

export type TokenCounter = { count(value: string): number }

export type ContextSnapshot = {
  budget: number
  estimatedTokens: number
  compressed: boolean
  retainedTurns: number
  treeVersion: number
}

export type ProviderContext = ContextSnapshot & { prompt: string }

export class ConservativeTokenCounter implements TokenCounter {
  count(value: string) {
    return Math.ceil([...value].reduce((total, char) => total + (/[^\x00-\xff]/.test(char) ? 1 : 0.35), 0))
  }
}

export class ContextBuilder {
  constructor(
    private readonly counter: TokenCounter = new ConservativeTokenCounter(),
    private readonly budget = 8192,
    private readonly recentTurns = 4,
  ) {}

  build(input: { systemPrompt: string; messages: SigmaForgeMessage[]; theory: TheoryTreeStore }): ProviderContext {
    const full = render(input.systemPrompt, input.messages)
    const trigger = Math.floor(this.budget * 0.75)
    if (this.counter.count(full) < trigger) return this.result(full, false, countTurns(input.messages), input.theory)

    const recent = input.messages.slice(-(this.recentTurns * 2 + 1))
    const target = Math.floor(this.budget * 0.6)
    const prefix = `${input.systemPrompt}\n\n[定理树摘要]\n`
    const suffix = `\n\n[最近对话]\n${renderMessages(recent)}`
    const prompt = fitOutline(prefix, input.theory.outline() || "（暂无）", suffix, target, this.counter)
    return this.result(prompt, true, Math.min(this.recentTurns, countTurns(recent)), input.theory)
  }

  private result(prompt: string, compressed: boolean, retainedTurns: number, theory: TheoryTreeStore): ProviderContext {
    return {
      prompt,
      budget: this.budget,
      estimatedTokens: this.counter.count(prompt),
      compressed,
      retainedTurns,
      treeVersion: theory.snapshot().version,
    }
  }
}

function render(systemPrompt: string, messages: SigmaForgeMessage[]) {
  return `${systemPrompt}\n\n${renderMessages(messages)}`
}

function renderMessages(messages: SigmaForgeMessage[]) {
  return messages.map((message) => `${message.role === "user" ? "用户" : "助手"}: ${message.content}`).join("\n")
}

function countTurns(messages: SigmaForgeMessage[]) {
  return messages.filter((message) => message.role === "user").length
}

function fitOutline(prefix: string, outline: string, suffix: string, budget: number, counter: TokenCounter) {
  if (counter.count(prefix + outline + suffix) <= budget) return prefix + outline + suffix
  const chars = [...outline]
  const omitted = "\n[较早的定理树内容因上下文预算省略]"
  while (chars.length && counter.count(prefix + chars.join("") + omitted + suffix) > budget) chars.splice(Math.max(0, chars.length - 256), 256)
  return prefix + chars.join("") + omitted + suffix
}

export * as SigmaForgeContext from "./context"
