import { expect, test } from "bun:test"
import { summarizeCASError } from "@/sigmaforge/kernel"

test("removes ANSI codes and hides CAS tracebacks from user errors", () => {
  const result = summarizeCASError([
    "\u001b[31mTraceback (most recent call last)\u001b[39m",
    "  File sage/misc/parser.pyx:1047, in parse_error",
    "\u001b[31mSyntaxError\u001b[39m: Malformed expression",
  ])
  expect(result).toBe("CAS execution failed: SyntaxError: Malformed expression")
  expect(result).not.toContain("Traceback")
  expect(result).not.toContain("\u001b")
})
