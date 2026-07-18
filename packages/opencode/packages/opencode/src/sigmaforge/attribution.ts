import type { TheoryNode } from "./theory"

export type MistakeCategory = "concept" | "computation" | "domain" | "rule" | "typo"

export type MistakeAttribution = {
  category: MistakeCategory
  confidence: number
  explanation: string
  concepts: string[]
}

export function attributeMistake(input: { message: string; node?: TheoryNode }): MistakeAttribution {
  const text = `${input.message} ${input.node?.content ?? ""} ${input.node?.rule ?? ""}`
  if (/定义域|分母|根号|对数|无定义/.test(text)) return result("domain", "忽略了表达式成立所需的定义域或边界条件。", ["定义域", "边界条件"])
  if (/定理|公式|法则|分部积分|链式/.test(text)) return result("rule", "所选定理或公式的适用条件、方向或代入方式不正确。", [input.node?.rule ?? "公式适用条件"])
  if (/符号|正负|计算|化简|移项/.test(text)) return result("computation", "概念方向基本正确，但符号运算或代数化简出现偏差。", ["符号运算", "代数化简"])
  if (/笔误|抄错|漏写/.test(text)) return result("typo", "错误更像是抄写或漏写，并非知识点理解偏差。", ["规范书写"])
  return result("concept", "当前步骤反映出相关概念及其数学含义尚未建立稳定联系。", [input.node?.title ?? "相关概念"])
}

function result(category: MistakeCategory, explanation: string, concepts: string[]): MistakeAttribution {
  return { category, confidence: 0.7, explanation, concepts }
}

export * as Attribution from "./attribution"
