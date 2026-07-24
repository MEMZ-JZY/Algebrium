import { describe, expect, test } from "bun:test"
import { CASToolbox, type CASRequest } from "@/sigmaforge/cas"
import type { KernelExecutor } from "@/sigmaforge/kernel"
import { plotGeometry } from "@/sigmaforge/plot"
import { mathModule } from "@/sigmaforge/subject"

type CasCase = {
  id: string
  domain: "algebra" | "calculus" | "linear-algebra"
  request: CASRequest
  expectedNormalized: string
  codeIncludes: string
  requiresVerification: boolean
}

const cases: readonly CasCase[] = [
  { id: "algebra.solve-quadratic", domain: "algebra", request: { tool: "solve", equation: "x^2=1", variable: "x" }, expectedNormalized: "[x == -1, x == 1]", codeIncludes: "solve(", requiresVerification: true },
  { id: "algebra.simplify-like-terms", domain: "algebra", request: { tool: "simplify", expression: "x+x" }, expectedNormalized: "2*x", codeIncludes: "simplify_full", requiresVerification: true },
  { id: "algebra.factor-difference-squares", domain: "algebra", request: { tool: "factor", expression: "x^2-1" }, expectedNormalized: "(x - 1)*(x + 1)", codeIncludes: "factor(", requiresVerification: true },
  { id: "calculus.integrate-by-parts", domain: "calculus", request: { tool: "integrate", expression: "x*e^x", variable: "x" }, expectedNormalized: "(x - 1)*e^x", codeIncludes: "SR(\"x*e^x\")", requiresVerification: true },
  { id: "calculus.definite-integral", domain: "calculus", request: { tool: "integrate", expression: "x", variable: "x", lower: "0", upper: "1" }, expectedNormalized: "1/2", codeIncludes: "SR(\"0\"), SR(\"1\")", requiresVerification: false },
  { id: "calculus.differentiate-polynomial", domain: "calculus", request: { tool: "diff", expression: "x^3", variable: "x", order: 1 }, expectedNormalized: "3*x^2", codeIncludes: "diff(", requiresVerification: false },
  { id: "calculus.limit-sine-ratio", domain: "calculus", request: { tool: "limit", expression: "sin(x)/x", variable: "x", point: "0" }, expectedNormalized: "1", codeIncludes: "limit(", requiresVerification: false },
  { id: "calculus.series-exponential", domain: "calculus", request: { tool: "series", expression: "e^x", variable: "x", point: "0", order: 3 }, expectedNormalized: "1 + x + 1/2*x^2 + 1/6*x^3 + Order(x^4)", codeIncludes: "taylor(", requiresVerification: false },
  { id: "linear-algebra.matrix-determinant", domain: "linear-algebra", request: { tool: "matrix", rows: [["1", "2"], ["3", "4"]], operation: "det" }, expectedNormalized: "-2", codeIncludes: ".det()", requiresVerification: false },
  { id: "linear-algebra.matrix-rref", domain: "linear-algebra", request: { tool: "matrix", rows: [["1", "2"], ["3", "4"]], operation: "rref" }, expectedNormalized: "[1 0] [0 1]", codeIncludes: ".echelon_form()", requiresVerification: false },
  { id: "linear-algebra.matrix-inverse", domain: "linear-algebra", request: { tool: "matrix", rows: [["1", "2"], ["3", "4"]], operation: "inverse" }, expectedNormalized: "[-2 1] [3/2 -1/2]", codeIncludes: ".inverse()", requiresVerification: true },
]

const geometryCase = {
  id: "geometry.circle",
  domain: "geometry",
  input: { circles: [{ id: "c1", centerX: 1, centerY: -2, radius: 3 }] },
  requiresVerification: false,
} as const

class FixtureKernel implements KernelExecutor {
  readonly codes: string[] = []

  async execute(_sessionID: string, code: string) {
    this.codes.push(code)
    const item = cases.find((candidate) => code.includes(candidate.codeIncludes))
    if (!item) throw new Error(`No fixture result for ${code}`)
    return { text: item.expectedNormalized, images: [] }
  }
}

describe("SigmaForge mathematical evaluation baseline", () => {
  for (const item of cases) {
    test(item.id, async () => {
      const kernel = new FixtureKernel()
      const result = await new CASToolbox(kernel).execute(`eval-${item.id}`, mathModule, item.request)
      expect(result.normalized).toBe(item.expectedNormalized)
      expect(kernel.codes[0]).toContain(item.codeIncludes)
    })
  }

  test(geometryCase.id, () => {
    const artifact = plotGeometry(mathModule, geometryCase.input)
    const data = artifact.data as { circles: Array<{ id: string; centerX: number; centerY: number; radius: number }> }
    expect(data.circles).toEqual([{ id: "c1", centerX: 1, centerY: -2, radius: 3 }])
  })
})
