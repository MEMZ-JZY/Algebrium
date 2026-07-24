import { z } from "zod"

export const WebSearchRequestSchema = z.object({
  query: z.string().min(1).max(200),
  limit: z.number().int().min(1).max(5).default(5),
})

export type WebSearchRequest = z.infer<typeof WebSearchRequestSchema>
export type WebSearchSource = { title: string; url: string; domain: string; snippet: string }
export type WebSearchDiagnostics = { attempts: number; rawResults: number; fallbackEngine?: string }
export type WebSearchResult = { query: string; sources: WebSearchSource[]; diagnostics?: WebSearchDiagnostics }

export interface WebSearchClient {
  search(input: unknown): Promise<WebSearchResult>
}

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>

const responseSchema = z.object({
  results: z.array(z.object({ title: z.string().optional(), url: z.string().optional(), content: z.string().optional() }).passthrough()).default([]),
}).passthrough()

export class SearXNGWebSearch implements WebSearchClient {
  private readonly baseURL: URL

  constructor(baseURL = process.env.ALGEBRIUM_SEARXNG_URL ?? "http://127.0.0.1:8088", private readonly fetcher: FetchLike = fetch) {
    this.baseURL = localSearXNGURL(baseURL)
  }

  async search(input: unknown): Promise<WebSearchResult> {
    const request = WebSearchRequestSchema.parse(input)
    let firstResults: Array<{ title?: string; url?: string; content?: string }> = []
    let primaryFailure: string | undefined
    try {
      firstResults = (await this.request(request)).results
    } catch (error) {
      primaryFailure = messageFrom(error)
    }
    const sources = sourcesFrom(firstResults, request.limit)
    if (sources.length) return { query: request.query, sources, diagnostics: { attempts: 1, rawResults: firstResults.length } }

    const fallbackEngine = "bing"
    let fallbackResults: Array<{ title?: string; url?: string; content?: string }>
    try {
      fallbackResults = (await this.request(request, fallbackEngine)).results
    } catch (error) {
      const fallbackFailure = messageFrom(error)
      throw new Error(`Local SearXNG search failed after Bing fallback (primary=${primaryFailure ?? "no usable results"}; fallback=${fallbackFailure})`)
    }
    const fallbackSources = sourcesFrom(fallbackResults, request.limit)
    if (!fallbackSources.length)
      throw new Error(`Local SearXNG returned no usable results (attempts=2, rawResults=${firstResults.length + fallbackResults.length}, fallback=${fallbackEngine}${primaryFailure ? `, primary=${primaryFailure}` : ""})`)
    return { query: request.query, sources: fallbackSources, diagnostics: { attempts: 2, rawResults: firstResults.length + fallbackResults.length, fallbackEngine } }
  }

  private async request(request: WebSearchRequest, engine?: string) {
    const url = new URL("search", this.baseURL)
    url.searchParams.set("q", request.query)
    url.searchParams.set("format", "json")
    url.searchParams.set("safesearch", "2")
    if (engine) url.searchParams.set("engines", engine)
    const response = await this.fetcher(url, { headers: { accept: "application/json" }, redirect: "error", signal: AbortSignal.timeout(10_000) })
    if (!response.ok) throw new Error(`Local SearXNG search failed: ${response.status}${engine ? ` (${engine})` : ""}`)
    return responseSchema.parse(await response.json())
  }
}

function messageFrom(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function sourcesFrom(results: Array<{ title?: string; url?: string; content?: string }>, limit: number) {
  const sources: WebSearchSource[] = []
  const seen = new Set<string>()
  for (const item of results) {
    const source = toWebSource(item)
    if (!source || seen.has(source.url)) continue
    seen.add(source.url)
    sources.push(source)
    if (sources.length === limit) break
  }
  return sources
}

function localSearXNGURL(value: string) {
  const url = new URL(value)
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) throw new Error("SearXNG must use a local HTTP endpoint")
  return url.toString().endsWith("/") ? url : new URL(`${url.toString()}/`)
}

function toWebSource(input: { title?: string; url?: string; content?: string }): WebSearchSource | undefined {
  if (!input.url) return undefined
  try {
    const url = new URL(input.url)
    const domain = normalizeDomain(url.hostname)
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined
    return {
      title: input.title?.trim().slice(0, 200) || domain,
      url: url.toString(),
      domain,
      snippet: input.content?.replace(/\s+/g, " ").trim().slice(0, 1200) || "",
    }
  } catch {
    return undefined
  }
}

function normalizeDomain(value: string) {
  return value.toLowerCase().replace(/^www\./, "")
}

export * as SigmaForgeWebSearch from "./web-search"
