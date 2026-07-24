export type WebSearchSource = { title: string; url: string; domain: string; snippet: string }
export type WebSearchResult = { query: string; sources: WebSearchSource[] }

export function citationURL(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : undefined
  } catch {
    return undefined
  }
}
