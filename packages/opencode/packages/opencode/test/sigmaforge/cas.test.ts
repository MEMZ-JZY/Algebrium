import { describe, expect, test } from "bun:test"
import { CASToolbox } from "@/sigmaforge/cas"
import type { KernelExecutor } from "@/sigmaforge/kernel"
import { geometrySample, surface3DSample } from "@/sigmaforge/plot"
import { mathModule, physicsModule } from "@/sigmaforge/subject"
import { verifyStep } from "@/sigmaforge/verifier"
import { normalizeMathExpression } from "@/sigmaforge/expression"

class RecordingKernel implements KernelExecutor {
  readonly codes: string[] = []
  output = "result"

  async execute(_sessionID: string, code: string) {
    this.codes.push(code)
    return { text: this.output, images: [] }
  }
}

describe("SigmaForge CAS tools", () => {
  test("builds constrained Sage calls for all ten tools", async () => {
    const kernel = new RecordingKernel()
    const cas = new CASToolbox(kernel)
    const requests = [
      { tool: "solve", equation: "x^2=1", variable: "x" },
      { tool: "integrate", expression: "x*e^x", variable: "x" },
      { tool: "diff", expression: "x^2", variable: "x", order: 1 },
      { tool: "limit", expression: "sin(x)/x", variable: "x", point: "0" },
      { tool: "simplify", expression: "x+x" },
      { tool: "series", expression: "e^x", variable: "x", point: "0", order: 4 },
      { tool: "matrix", rows: [["1", "2"], ["3", "4"]], operation: "rref" },
      { tool: "factor", expression: "x^2-1" },
      { tool: "assume", assumption: "x>0" },
      { tool: "eval", expression: "2+2" },
    ]
    for (const request of requests) expect((await cas.execute("session", mathModule, request)).text).toBe("result")
    expect(kernel.codes).toHaveLength(10)
  })

  test("rejects injection and cross-subject access", async () => {
    const cas = new CASToolbox(new RecordingKernel())
    expect(cas.execute("session", mathModule, { tool: "eval", expression: "__import__(os)" })).rejects.toThrow("unsafe")
    expect(cas.execute("session", physicsModule, { tool: "eval", expression: "2+2" })).rejects.toThrow("disabled")
  })

  test("normalizes double-equals equations and declares symbolic parameters", async () => {
    const kernel = new RecordingKernel()
    const cas = new CASToolbox(kernel)
    await cas.execute("session", mathModule, { tool: "solve", equation: "x^3 - 3*a*x + 2*a == 0", variable: "x" })
    expect(kernel.codes[0]).toContain("var('x a')")
    expect(kernel.codes[0]).toContain('SR("x^3 - 3*a*x + 2*a") == SR("0")')
    expect(kernel.codes[0]).not.toContain('SR("x^3 - 3*a*x + 2*a == 0")')
  })

  test("normalizes common LaTeX and Unicode notation before safe Sage encoding", async () => {
    const kernel = new RecordingKernel()
    const cas = new CASToolbox(kernel)
    const latex = "$\\frac{\\pi \u00d7 x}{2} \u2212 \\sqrt{x}$"
    expect(normalizeMathExpression(latex)).toBe("((pi * x)/(2)) - sqrt(x)")
    await cas.execute("session", mathModule, { tool: "simplify", expression: latex })
    expect(kernel.codes[0]).toContain('SR("((pi * x)/(2)) - sqrt(x)")')
    await expect(cas.execute("session", mathModule, { tool: "eval", expression: String.raw`\unknown{x}` })).rejects.toThrow("unsafe")
  })

  test("normalizes safe subtraction and substitution aliases from providers", async () => {
    const kernel = new RecordingKernel()
    const cas = new CASToolbox(kernel)
    await cas.execute("session", mathModule, { tool: "simplify", expression: "sub(diff(x^2,x),2*x)" })
    await cas.execute("session", mathModule, { tool: "simplify", expression: "subs(x^2+1,x,2)" })
    expect(kernel.codes[0]).toContain("diff(x^2,x))-(2*x)")
    expect(kernel.codes[1]).toContain(".subs(x=2)")
  })

  test("verifies symbolic equivalence and exposes render contracts", async () => {
    const kernel = new RecordingKernel()
    kernel.output = "0\nTrue"
    expect((await verifyStep(kernel, "session", mathModule, { lhs: "x+x", rhs: "2*x" })).verified).toBe(true)
    const surface = surface3DSample(mathModule)
    expect(surface.kind).toBe("plotly3d")
    expect((surface.data as { data: unknown[] }).data).toHaveLength(5)
    expect(surface.meta.coordinateSystem).toBe("cartesian-xyz")
    expect(geometrySample(mathModule).kind).toBe("jsxgraph")
  })
})
