import { parseArgs } from "util"
import { createInterface } from "node:readline/promises"
import { stdin, stdout } from "node:process"
import { createTerminalSession, sendTerminalMessage } from "./terminal"
import type { StreamEvent } from "./events"

const args = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    question: { type: "string", short: "q" },
    url: { type: "string", default: process.env.ALGEBRIUM_URL ?? process.env.SIGMAFORGE_URL ?? "http://127.0.0.1:4097" },
  },
})
const origin = args.values.url!.replace(/\/$/, "")
const session = await createTerminalSession(origin)

if (args.values.question) {
  await ask(args.values.question)
  process.exit(0)
}

console.log(`Algebrium CLI connected to ${origin}. Type /exit to quit.`)
const prompt = createInterface({ input: stdin, output: stdout })
while (true) {
  const question = (await prompt.question("\n数学问题> ")).trim()
  if (!question || question === "/exit") break
  await ask(question).catch((error) => console.error(`\n错误: ${error instanceof Error ? error.message : String(error)}`))
}
prompt.close()

async function ask(question: string) {
  process.stdout.write("\n")
  await sendTerminalMessage(origin, session.id, question, printEvent)
}

function printEvent(event: StreamEvent) {
  if (event.type === "chunk") return process.stdout.write(event.text)
  if (event.type === "tool.start") return console.log(`\n[工具开始] ${event.tool}`)
  if (event.type === "tool.result") return console.log(`[CAS 结果] ${event.result.tool}: ${event.result.text}`)
  if (event.type === "verification") return console.log(`[验证] ${event.result.verified ? "通过" : "未通过"}: ${event.result.evidence}`)
  if (event.type === "artifact.pending") return console.log(`[图形] ${event.artifact.title}`)
  if (event.type === "artifact") return console.log(`[图形就绪] ${event.artifact.kind}: ${event.artifact.id}`)
  if (event.type === "theory.updated") return console.log(`[定理树] ${event.node.status}: ${event.node.title}`)
  if (event.type === "mistake.attributed") return console.log(`[错因] ${event.attribution.category}: ${event.attribution.explanation}`)
  if (event.type === "kb.result") return console.log(`[知识库] 命中 ${event.entries.length} 条`)
  if (event.type === "learning.path") return console.log(`[学习路径] ${event.nodes.map((node) => node.title).join(" -> ") || "暂无"}`)
  if (event.type === "error") return console.error(`\n[错误] ${event.message}`)
  if (event.type === "done") console.log(`\n[完成] ${event.context.estimatedTokens}/${event.context.budget} tokens${event.context.compressed ? "，已压缩" : ""}`)
}
