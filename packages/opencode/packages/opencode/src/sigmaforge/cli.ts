import { parseArgs } from "util"
import { startSigmaForgeServer } from "./server"
import { KnowledgeBase, MistakeInbox } from "./kb"
import { resolve } from "node:path"
import { createConfiguredProvider, loadSigmaForgeConfig } from "./provider-config"

const args = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    hostname: { type: "string", default: "127.0.0.1" },
    port: { type: "string", default: "4097" },
    "mock-provider": { type: "boolean" },
    config: { type: "string" },
  },
})
const port = Number(args.values.port)
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error(`Invalid port: ${args.values.port}`)

const storage = await openKnowledgeBase()
const config = await loadSigmaForgeConfig(args.values.config)
const forceMock = args.values["mock-provider"] === true
const provider = forceMock ? undefined : createConfiguredProvider(config)
const server = startSigmaForgeServer({
  hostname: args.values.hostname,
  port,
  mockProvider: forceMock || config.provider.mode === "mock",
  provider,
  knowledgeBase: storage?.knowledgeBase,
  mistakeSink: storage?.mistakeSink,
  sessionStoragePath: process.env.ALGEBRIUM_SESSION_PATH ?? process.env.SIGMAFORGE_SESSION_PATH ?? resolve(import.meta.dir, "../../../../../..", "data/algebrium-sessions.json"),
})
console.log(`Algebrium server listening on http://${server.hostname}:${server.port}`)
console.log(forceMock || config.provider.mode === "mock" ? "Provider: mock" : `Provider: ${provider!.id}/${provider!.model}`)

async function openKnowledgeBase() {
  const path = process.env.ALGEBRIUM_KB_PATH ?? process.env.SIGMAFORGE_KB_PATH ?? resolve(import.meta.dir, "../../../../../..", "data/algebrium.db")
  if (!await Bun.file(path).exists()) return undefined
  return { knowledgeBase: new KnowledgeBase(path), mistakeSink: new MistakeInbox(path) }
}
