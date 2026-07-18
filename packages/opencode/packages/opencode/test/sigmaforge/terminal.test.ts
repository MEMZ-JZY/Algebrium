import { describe, expect, test } from "bun:test"
import { parseSSE } from "@/sigmaforge/terminal"

describe("SigmaForge terminal SSE parser", () => {
  test("parses complete events and retains an incomplete frame", () => {
    const parsed = parseSSE('data: {"type":"chunk","text":"甲"}\n\ndata: {"type":"done","context":')
    expect(parsed.events).toEqual([{ type: "chunk", text: "甲" }])
    expect(parsed.remainder).toBe('data: {"type":"done","context":')
  })

  test("accepts Windows line endings", () => {
    const parsed = parseSSE('data: {"type":"error","message":"失败"}\r\n\r\n')
    expect(parsed.events).toEqual([{ type: "error", message: "失败" }])
    expect(parsed.remainder).toBe("")
  })
})
