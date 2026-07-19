import { resolve } from "node:path"
import { z } from "zod"
import { OpenAICompatibleProvider, ProviderConfigSchema, type ChatProvider } from "./provider"

export const SigmaForgeConfigSchema = z.object({
  provider: z.object({
    mode: z.enum(["real", "mock"]).default("real"),
    active: z.string().min(1),
    profiles: z.record(z.string(), ProviderConfigSchema),
  }),
})

export type SigmaForgeConfig = z.infer<typeof SigmaForgeConfigSchema>

export async function loadSigmaForgeConfig(path = defaultConfigPath()) {
  if (!await Bun.file(path).exists()) throw new Error(`SigmaForge config not found: ${path}`)
  const config = SigmaForgeConfigSchema.parse(await Bun.file(path).json())
  const customBaseURL = process.env.ALGEBRIUM_CUSTOM_BASE_URL?.trim()
  const customModel = process.env.ALGEBRIUM_CUSTOM_MODEL?.trim()
  const profiles = customBaseURL && customModel
    ? { ...config.provider.profiles, custom: ProviderConfigSchema.parse({ provider: "custom", baseURL: customBaseURL, model: customModel, apiKeyEnv: "ALGEBRIUM_CUSTOM_API_KEY" }) }
    : config.provider.profiles
  const active = process.env.ALGEBRIUM_PROVIDER?.trim() || config.provider.active
  if (!profiles[active]) throw new Error(`Provider profile not found: ${active}`)
  return { ...config, provider: { ...config.provider, active, profiles } }
}

export function createConfiguredProvider(config: SigmaForgeConfig, environment?: Record<string, string | undefined>): ChatProvider | undefined {
  if (config.provider.mode === "mock") return undefined
  return new OpenAICompatibleProvider(config.provider.profiles[config.provider.active]!, environment)
}

export function defaultConfigPath() {
  return process.env.ALGEBRIUM_CONFIG ?? process.env.SIGMAFORGE_CONFIG ?? resolve(import.meta.dir, "../../../../../..", "config.json")
}

export * as ProviderConfiguration from "./provider-config"
