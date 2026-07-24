import { describe, expect, test } from "bun:test"
import { CASToolbox } from "@/sigmaforge/cas"
import type { KernelExecutor } from "@/sigmaforge/kernel"
import { geometrySample, plotFunction2D, plotGeometry, surface3DSample } from "@/sigmaforge/plot"
import { mathModule, physicsModule } from "@/sigmaforge/subject"
import { verifyStep } from "@/sigmaforge/verifier"
import { normalizeMathExpression, requireEvaluableMathExpression, requireMathExpression } from "@/sigmaforge/expression"

class RecordingKernel implements KernelExecutor {
  readonly codes: string[] = []
  output = "result"

  async execute(_sessionID: string, code: string) {
    this.codes.push(code)
    return { text: this.output, images: [] }
  }
}

describe("SigmaForge CAS tools", () => {
  test("builds constrained Sage calls for all CAS tools", async () => {
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
      { tool: "numeric", expression: "pi", digits: 30 },
      { tool: "statistics", operation: "correlation", values: ["1", "2", "3"], otherValues: ["2", "4", "6"] },
      { tool: "distribution", distribution: "normal", operation: "cdf", parameters: ["0", "1"], value: "1.96" },
      { tool: "hypothesis", test: "one_sample_t", values: ["1", "2", "3", "4", "5"], populationMean: "3" },
    ]
    for (const request of requests) expect((await cas.execute("session", mathModule, request)).text).toBe("result")
    expect(kernel.codes).toHaveLength(14)
  })

  test("builds dedicated statistics, distribution, and numeric computations", async () => {
    const kernel = new RecordingKernel()
    const cas = new CASToolbox(kernel)
    await cas.execute("session", mathModule, { tool: "statistics", operation: "linear_regression", values: ["1", "2", "3"], otherValues: ["2", "4", "6"] })
    await cas.execute("session", mathModule, { tool: "statistics", operation: "quantile", values: ["1", "2", "3", "4"], quantile: 0.25 })
    await cas.execute("session", mathModule, { tool: "distribution", distribution: "binomial", operation: "pmf", parameters: ["10", "0.5"], value: "3" })
    await cas.execute("session", mathModule, { tool: "numeric", expression: "erf(1.96/sqrt(2))", digits: 20 })
    expect(kernel.codes[0]).toContain("'slope'")
    expect(kernel.codes[1]).toContain("ceil((0.25)*len(values))-1")
    expect(kernel.codes[2]).toContain("binomial")
    expect(kernel.codes[3]).toContain("digits=20")
  })

  test("builds bounded hypothesis tests through the trusted SciPy runtime", async () => {
    const kernel = new RecordingKernel()
    const cas = new CASToolbox(kernel)
    await cas.execute("session", mathModule, { tool: "hypothesis", test: "independent_t", values: ["1", "2", "3"], otherValues: ["4", "5", "6"], alternative: "less" })
    await cas.execute("session", mathModule, { tool: "hypothesis", test: "chi_square", values: ["10", "20"], expected: ["15", "15"] })
    await cas.execute("session", mathModule, { tool: "hypothesis", test: "one_sample_t", values: ["1", "2", "3"], populationMean: "2" })
    expect(kernel.codes[0]).toContain("stats.ttest_ind")
    expect(kernel.codes[1]).toContain("stats.chisquare")
    expect(kernel.codes[2]).toContain("'degreesOfFreedom':int(")
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

  test("accepts hyperbolic functions and removes a function label for eval", async () => {
    const kernel = new RecordingKernel()
    const cas = new CASToolbox(kernel)
    expect(requireMathExpression("sinh(x)+cosh(x)+tanh(x)")).toBe("sinh(x)+cosh(x)+tanh(x)")
    expect(requireEvaluableMathExpression("f(x) = sinh(x)")).toBe("sinh(x)")
    await cas.execute("session", mathModule, { tool: "eval", expression: "f(x) = sinh(x)" })
    expect(kernel.codes[0]).toContain('sage_eval("sinh(x)"')
  })

  test("accepts safe advanced mathematical functions in eval", async () => {
    const kernel = new RecordingKernel()
    const cas = new CASToolbox(kernel)
    expect(requireMathExpression("factorial(5)+gamma(5)+conjugate(3+4*I)")).toBe("factorial(5)+gamma(5)+conjugate(3+4*I)")
    expect(requireMathExpression("sum(k,k,1,3)")).toBe("sum(k,k,1,3)")
    await cas.execute("session", mathModule, { tool: "eval", expression: "sum(k,k,1,3)" })
    expect(kernel.codes[0]).toContain("var('k')")
    expect(kernel.codes[0]).toContain("sage_eval")
    await expect(cas.execute("session", mathModule, { tool: "eval", expression: "var('x')" })).rejects.toThrow("unsafe")
    await expect(cas.execute("session", mathModule, { tool: "eval", expression: "matrix([[1]])" })).rejects.toThrow("Unsafe mathematical function")
  })

  test("accepts the remaining safe special-function families in eval", async () => {
    const kernel = new RecordingKernel()
    const cas = new CASToolbox(kernel)
    const expression = "hypergeometric([1,1],[2],0.5)+polylog(2,0.5)+gamma_inc(2,1)+exp_integral_e(1,2)"
    expect(requireMathExpression(expression)).toBe(expression)
    expect(requireMathExpression("dirac_delta(0)+heaviside(0)+log_gamma(5)+dickman_rho(0.5)")).toContain("dickman_rho")
    await cas.execute("session", mathModule, { tool: "eval", expression })
    expect(kernel.codes[0]).toContain("sage_eval")
    await expect(cas.execute("session", mathModule, { tool: "eval", expression: "__import__('os')" })).rejects.toThrow("unsafe")
  })

  test("accepts statistical and integral special-function aliases in eval", () => {
    expect(requireMathExpression("erfc(1)+elliptic_kc(0.5)+jacobi_P(2,0,0,x)+sin_integral(1)+cos_integral(1)+fresnel_sin(1)+kronecker_delta(1,1)+mod(17,5)")).toContain("erfc")
    expect(requireMathExpression("lngamma(5)")).toBe("log_gamma(5)")
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

  test("creates circle-only geometry and rejects invalid radii", () => {
    const artifact = plotGeometry(mathModule, { circles: [{ id: "c1", centerX: 1, centerY: -2, radius: 3 }] })
    const data = artifact.data as { circles: Array<{ radius: number }>; points: unknown[]; segments: unknown[] }
    expect(artifact.kind).toBe("jsxgraph")
    expect(data.circles[0]?.radius).toBe(3)
    expect(data.points).toEqual([])
    expect(data.segments).toEqual([])
    expect(() => plotGeometry(mathModule, { circles: [{ id: "c1", centerX: 0, centerY: 0, radius: 0 }] })).toThrow()
    expect(() => plotGeometry(mathModule, {})).toThrow("at least one point or circle")
  })

  test("draws multiple functions as separate traces in one artifact", async () => {
    const kernel = new RecordingKernel()
    kernel.output = '{"x":[-1,0,1],"y":[1,0,1]}'
    const artifact = await plotFunction2D(kernel, "session", mathModule, { expressions: ["x^2", "-x^2"], variable: "x", min: -1, max: 1 })
    const spec = artifact.data as { data: Array<{ name: string }> }
    expect(spec.data.map((trace) => trace.name)).toEqual(["x^2", "-x^2"])
    expect(kernel.codes).toHaveLength(2)
    expect(artifact.meta.functions).toBe(2)
  })

  test("samples polar and implicit curves with their native coordinates", async () => {
    const kernel = new RecordingKernel()
    kernel.output = '{"x":[-1,0,1],"y":[0,1,0]}'
    const polar = await plotFunction2D(kernel, "session", mathModule, { coordinateSystem: "polar", expression: "1+cos(theta)", variable: "theta", min: 0, max: 6.283 })
    expect(polar.meta.coordinateSystem).toBe("polar")
    expect(kernel.codes[0]).toContain("math.cos(t)")

    kernel.output = '{"x":[-1,0,1],"y":[-1,0,1],"z":[[2,1,2],[1,0,1],[2,1,2]]}'
    const implicit = await plotFunction2D(kernel, "session", mathModule, { coordinateSystem: "implicit", expressions: ["x^2+y^2=1", "x^2-y^2=0"], xVariable: "x", yVariable: "y", min: -2, max: 2 })
    expect(implicit.meta.coordinateSystem).toBe("implicit")
    expect((implicit.data as { data: Array<{ type: string }> }).data).toHaveLength(2)
    expect((implicit.data as { data: Array<{ type: string }> }).data[0]?.type).toBe("scatter")
    expect(kernel.codes[1]).toContain('SR("(x^2+y^2)-(1)")')
    expect(kernel.codes[2]).toContain('SR("(x^2-y^2)-(0)")')
  })
})
