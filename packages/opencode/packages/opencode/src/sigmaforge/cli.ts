import { parseArgs } from "util"
import { startSigmaForgeServer } from "./server"
import { KnowledgeBase, MistakeInbox } from "./kb"
import { resolve } from "node:path"
import { createConfiguredProvider, defaultConfigPath, loadSigmaForgeConfig, SigmaForgeConfigSchema } from "./provider-config"
import { ProviderConfigSchema } from "./provider"

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
const configPath = args.values.config ?? defaultConfigPath()
let config = await loadSigmaForgeConfig(configPath)
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
  providerSettings: forceMock ? undefined : {
    get: () => ({
      active: config.provider.active,
      profiles: Object.fromEntries(Object.entries(config.provider.profiles).map(([id, profile]) => [id, {
        id,
        provider: profile.provider,
        model: profile.model,
        baseURL: profile.baseURL,
        apiKeyEnv: profile.apiKeyEnv,
        hasApiKey: Boolean(process.env[profile.apiKeyEnv]?.trim()),
      }])),
    }),
    update: async (input) => {
      const body = input as { id?: string; provider?: string; model?: string; baseURL?: string; apiKey?: string }
      const id = body.id?.trim()
      if (!id || !/^[A-Za-z0-9_-]+$/.test(id)) throw new SyntaxError("Provider ID contains unsupported characters")
      const previous = config.provider.profiles[id]
      const apiKeyEnv = previous?.apiKeyEnv ?? `ALGEBRIUM_${id.toUpperCase().replace(/-/g, "_")}_API_KEY`
      const profile = ProviderConfigSchema.parse({
        ...previous,
        provider: body.provider,
        model: body.model?.trim(),
        baseURL: body.baseURL?.trim() || undefined,
        apiKeyEnv,
      })
      const apiKey = body.apiKey?.trim()
      if (apiKey) process.env[apiKeyEnv] = apiKey
      const next = SigmaForgeConfigSchema.parse({ provider: { ...config.provider, mode: "real", active: id, profiles: { ...config.provider.profiles, [id]: profile } } })
      const nextProvider = createConfiguredProvider(next)
      if (!nextProvider) throw new Error("A real provider is required")
      await Bun.write(configPath, `${JSON.stringify(next, null, 2)}\n`)
      config = next
      return nextProvider
    },
  },
})
console.log(`Algebrium server listening on http://${server.hostname}:${server.port}`)
console.log(forceMock || config.provider.mode === "mock" ? "Provider: mock" : `Provider: ${provider!.id}/${provider!.model}`)

async function openKnowledgeBase() {
  const path = process.env.ALGEBRIUM_KB_PATH ?? process.env.SIGMAFORGE_KB_PATH ?? resolve(import.meta.dir, "../../../../../..", "data/algebrium.db")
  if (!await Bun.file(path).exists()) return undefined
  return { knowledgeBase: new KnowledgeBase(path), mistakeSink: new MistakeInbox(path) }
}
