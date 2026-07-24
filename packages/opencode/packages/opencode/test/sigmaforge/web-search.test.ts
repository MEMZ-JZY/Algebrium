import { describe, expect, test } from "bun:test"
import { SearXNGWebSearch } from "@/sigmaforge/web-search"

describe("SearXNGWebSearch", () => {
  test("uses only the local JSON endpoint and returns HTTP and HTTPS citations from any domain", async () => {
    let requested: URL | undefined
    const search = new SearXNGWebSearch("http://127.0.0.1:8088", async (input) => {
      requested = new URL(input)
      return Response.json({ results: [
        { title: "DLMF", url: "https://dlmf.nist.gov/5.2", content: " Gamma function " },
        { title: "HTTP source", url: "http://example.org/gamma" },
        { title: "Any domain", url: "https://dlmf.nist.gov.example.com/5.2" },
        { title: "Unsupported protocol", url: "ftp://example.org/gamma" },
      ] })
    })

    await expect(search.search({ query: "gamma function", limit: 5 })).resolves.toEqual({
      query: "gamma function",
      diagnostics: { attempts: 1, rawResults: 4 },
      sources: [
        { title: "DLMF", url: "https://dlmf.nist.gov/5.2", domain: "dlmf.nist.gov", snippet: "Gamma function" },
        { title: "HTTP source", url: "http://example.org/gamma", domain: "example.org", snippet: "" },
        { title: "Any domain", url: "https://dlmf.nist.gov.example.com/5.2", domain: "dlmf.nist.gov.example.com", snippet: "" },
      ],
    })
    expect(requested?.origin).toBe("http://127.0.0.1:8088")
    expect(requested?.pathname).toBe("/search")
    expect(requested?.searchParams.get("format")).toBe("json")
  })

  test("retries with Bing when SearXNG returns no usable default results", async () => {
    const requested: URL[] = []
    let calls = 0
    const search = new SearXNGWebSearch("http://127.0.0.1:8088", async (input) => {
      requested.push(new URL(input))
      calls += 1
      if (calls === 1) return Response.json({ results: [] })
      return Response.json({ results: [{ title: "Euler", url: "https://example.org/euler", content: "Euler identity" }] })
    })

    await expect(search.search({ query: "Euler identity" })).resolves.toEqual({
      query: "Euler identity",
      diagnostics: { attempts: 2, rawResults: 1, fallbackEngine: "bing" },
      sources: [{ title: "Euler", url: "https://example.org/euler", domain: "example.org", snippet: "Euler identity" }],
    })
    expect(requested).toHaveLength(2)
    expect(requested[1]?.searchParams.get("engines")).toBe("bing")
  })

  test("retries with Bing when the default SearXNG request fails", async () => {
    let calls = 0
    const search = new SearXNGWebSearch("http://127.0.0.1:8088", async () => {
      calls += 1
      if (calls === 1) return new Response("unavailable", { status: 503 })
      return Response.json({ results: [{ title: "Euler", url: "https://example.org/euler" }] })
    })

    await expect(search.search({ query: "Euler identity" })).resolves.toEqual({
      query: "Euler identity",
      diagnostics: { attempts: 2, rawResults: 1, fallbackEngine: "bing" },
      sources: [{ title: "Euler", url: "https://example.org/euler", domain: "example.org", snippet: "" }],
    })
  })

  test("fails explicitly when both default and Bing return no usable results", async () => {
    const search = new SearXNGWebSearch("http://127.0.0.1:8088", async () => Response.json({ results: [] }))
    await expect(search.search({ query: "Euler identity" })).rejects.toThrow("returned no usable results")
  })

  test("rejects a non-local SearXNG endpoint and propagates search failures", async () => {
    expect(() => new SearXNGWebSearch("https://search.example.com")).toThrow("local HTTP endpoint")
    const search = new SearXNGWebSearch("http://localhost:8088", async () => new Response("unavailable", { status: 503 }))
    await expect(search.search({ query: "integral" })).rejects.toThrow("503")
  })
})
