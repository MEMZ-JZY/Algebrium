import { z } from "zod"
import { quoteSageString, requireEvaluableMathExpression, requireIdentifier, requireMathExpression, symbolsInMathExpression } from "./expression"
import type { KernelExecutor } from "./kernel"
import { assertToolAllowed } from "./policy"
import type { SubjectModule } from "./subject"

const expression = z.string().min(1).max(500)
const symbol = z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/).max(32)
const valueList = z.array(expression).min(1).max(1_000)
const requestSchema = z.discriminatedUnion("tool", [
  z.object({ tool: z.literal("solve"), equation: expression, variable: symbol }),
  z.object({ tool: z.literal("integrate"), expression, variable: symbol, lower: expression.optional(), upper: expression.optional() }),
  z.object({ tool: z.literal("diff"), expression, variable: symbol, order: z.number().int().min(1).max(10).default(1) }),
  z.object({ tool: z.literal("limit"), expression, variable: symbol, point: expression, direction: z.enum(["plus", "minus"]).optional() }),
  z.object({ tool: z.literal("simplify"), expression }),
  z.object({ tool: z.literal("series"), expression, variable: symbol, point: expression, order: z.number().int().min(1).max(30) }),
  z.object({ tool: z.literal("matrix"), rows: z.array(z.array(expression).min(1)).min(1).max(12), operation: z.enum(["rref", "det", "inverse"]) }),
  z.object({ tool: z.literal("factor"), expression }),
  z.object({ tool: z.literal("assume"), assumption: expression }),
  z.object({ tool: z.literal("eval"), expression }),
  z.object({ tool: z.literal("numeric"), expression, digits: z.number().int().min(2).max(100).default(20) }),
  z.object({ tool: z.literal("statistics"), operation: z.enum(["sum", "min", "max", "mean", "variance", "std", "median", "mode", "quantile", "moment", "covariance", "correlation", "linear_regression"]), values: valueList, otherValues: valueList.optional(), quantile: z.number().min(0).max(1).optional(), order: z.number().int().min(1).max(20).optional(), sample: z.boolean().default(true) }),
  z.object({ tool: z.literal("distribution"), distribution: z.enum(["normal", "binomial", "poisson", "exponential", "uniform"]), operation: z.enum(["pdf", "pmf", "cdf", "mean", "variance"]), parameters: z.array(expression).min(1).max(3), value: expression.optional() }),
  z.object({ tool: z.literal("hypothesis"), test: z.enum(["one_sample_t", "independent_t", "paired_t", "chi_square", "pearson_correlation"]), values: valueList, otherValues: valueList.optional(), expected: valueList.optional(), populationMean: expression.optional(), equalVariance: z.boolean().default(false), alternative: z.enum(["two-sided", "less", "greater"]).default("two-sided") }),
])

export type CASRequest = z.infer<typeof requestSchema>
export type CASResult = { tool: CASRequest["tool"]; text: string; normalized: string; durationMs: number; artifacts?: string[] }

export class CASToolbox {
  constructor(private readonly kernel: KernelExecutor) {}

  async execute(sessionID: string, subject: SubjectModule, input: unknown): Promise<CASResult> {
    const request = requestSchema.parse(input)
    assertToolAllowed(subject, request.tool)
    const started = performance.now()
    const output = await this.kernel.execute(sessionID, buildCode(request))
    return {
      tool: request.tool,
      text: output.text,
      normalized: output.text.replace(/\s+/g, " ").trim(),
      durationMs: Math.round(performance.now() - started),
      artifacts: output.images.length ? output.images : undefined,
    }
  }
}

function buildCode(request: CASRequest) {
  if (request.tool === "solve") {
    const source = requireMathExpression(request.equation)
    const equality = source.match(/^(.+?)(?<![<>!])={1,2}(?!=)(.+)$/)
    const equation = equality
      ? `SR(${quoteSageString(equality[1]!)}) == SR(${quoteSageString(equality[2]!)})`
      : `SR(${quoteSageString(source)})`
    const symbols = [...new Set([requireIdentifier(request.variable), ...symbolsInMathExpression(source)])]
    return `var('${symbols.join(" ")}'); print(solve(${equation}, ${request.variable}))`
  }
  if (request.tool === "integrate") {
    const operation = request.lower !== undefined && request.upper !== undefined
      ? `integral(SR(${quoteSageString(request.expression)}), ${requireIdentifier(request.variable)}, SR(${quoteSageString(request.lower)}), SR(${quoteSageString(request.upper)}))`
      : `integral(SR(${quoteSageString(request.expression)}), ${requireIdentifier(request.variable)})`
    return `var('${request.variable}'); print(${operation})`
  }
  if (request.tool === "diff")
    return `var('${request.variable}'); print(diff(SR(${quoteSageString(request.expression)}), ${requireIdentifier(request.variable)}, ${request.order}))`
  if (request.tool === "limit") {
    const direction = request.direction ? `, dir='${request.direction}'` : ""
    return `var('${request.variable}'); print(limit(SR(${quoteSageString(request.expression)}), ${request.variable}=SR(${quoteSageString(request.point)})${direction}))`
  }
  if (request.tool === "simplify") return `print(SR(${quoteSageString(request.expression)}).simplify_full())`
  if (request.tool === "series")
    return `var('${request.variable}'); print(taylor(SR(${quoteSageString(request.expression)}), ${request.variable}, SR(${quoteSageString(request.point)}), ${request.order}))`
  if (request.tool === "matrix") {
    const rows = request.rows.map((row) => `[${row.map((item) => `SR(${quoteSageString(item)})`).join(",")}]`).join(",")
    const operation = request.operation === "rref" ? "echelon_form()" : request.operation === "det" ? "det()" : "inverse()"
    return `print(matrix([${rows}]).${operation})`
  }
  if (request.tool === "factor") return `print(factor(SR(${quoteSageString(request.expression)})))`
  if (request.tool === "assume") {
    const match = requireMathExpression(request.assumption).match(/^([A-Za-z][A-Za-z0-9_]*)\s*(>=|<=|>|<|==|!=)\s*(.+)$/)
    if (!match) throw new Error("Assumption must compare one symbol with a mathematical expression")
    return `var('${requireIdentifier(match[1]!)}'); assume(${match[1]} ${match[2]} SR(${quoteSageString(match[3]!)})); print(assumptions())`
  }
  if (request.tool === "numeric") return `print(N(SR(${quoteSageString(request.expression)}), digits=${request.digits}))`
  if (request.tool === "statistics") return statisticsCode(request)
  if (request.tool === "distribution") return distributionCode(request)
  if (request.tool === "hypothesis") return hypothesisCode(request)
  const expression = requireEvaluableMathExpression(request.expression)
  const symbols = symbolsInMathExpression(expression)
  const declarations = symbols.length ? `var('${symbols.join(" ")}'); ` : ""
  return `${declarations}print(sage_eval(${quoteSageString(expression)}, locals=globals()))`
}

function hypothesisCode(request: Extract<CASRequest, { tool: "hypothesis" }>) {
  const values = `[${request.values.map((value) => `float(SR(${quoteSageString(value)}).n())`).join(",")}]`
  const other = request.otherValues ? `[${request.otherValues.map((value) => `float(SR(${quoteSageString(value)}).n())`).join(",")}]` : undefined
  const expected = request.expected ? `[${request.expected.map((value) => `float(SR(${quoteSageString(value)}).n())`).join(",")}]` : undefined
  const requireOther = () => {
    if (!other || request.otherValues!.length !== request.values.length) throw new Error("Other values must have the same length")
    return other
  }
  const render = (result: string, degreesOfFreedom?: string) => `import json
from scipy import stats
values=${values}
result=${result}
print(json.dumps({'statistic':float(result.statistic),'pValue':float(result.pvalue)${degreesOfFreedom ? `,'degreesOfFreedom':int(${degreesOfFreedom})` : ""}}))`
  if (request.test === "one_sample_t") {
    if (!request.populationMean) throw new Error("One-sample t test requires a population mean")
    return render(`stats.ttest_1samp(values, float(SR(${quoteSageString(request.populationMean)}).n()), alternative='${request.alternative}')`, "len(values)-1")
  }
  if (request.test === "independent_t") {
    const second = requireOther()
    return `import json
from scipy import stats
values=${values}; other_values=${second}
result=stats.ttest_ind(values, other_values, equal_var=${request.equalVariance ? "True" : "False"}, alternative='${request.alternative}')
print(json.dumps({'statistic':float(result.statistic),'pValue':float(result.pvalue)}))`
  }
  if (request.test === "paired_t") return render(`stats.ttest_rel(values, ${requireOther()}, alternative='${request.alternative}')`, "len(values)-1")
  if (request.test === "chi_square") {
    if (!expected || request.expected!.length !== request.values.length) throw new Error("Chi-square test requires matching expected values")
    return render(`stats.chisquare(values, f_exp=${expected})`, "len(values)-1")
  }
  return render(`stats.pearsonr(values, ${requireOther()}, alternative='${request.alternative}')`, "len(values)-2")
}

function statisticsCode(request: Extract<CASRequest, { tool: "statistics" }>) {
  const values = `[${request.values.map((value) => `SR(${quoteSageString(value)})`).join(",")}]`
  const other = request.otherValues ? `[${request.otherValues.map((value) => `SR(${quoteSageString(value)})`).join(",")}]` : undefined
  const denominator = request.sample ? "len(values)-1" : "len(values)"
  const variance = `sum((value-mean_value)^2 for value in values)/(${denominator})`
  if (["covariance", "correlation", "linear_regression"].includes(request.operation)) {
    if (!other || request.values.length !== request.otherValues!.length) throw new Error("Other values must have the same length")
    const covariance = `sum((a-mean_x)*(b-mean_y) for a,b in zip(values,other_values))/(len(values)-1)`
    const result = request.operation === "covariance" ? covariance : request.operation === "correlation"
      ? `covariance/sqrt(sum((a-mean_x)^2 for a in values)/(len(values)-1)*sum((b-mean_y)^2 for b in other_values)/(len(values)-1))`
      : `{ 'slope': covariance/(sum((a-mean_x)^2 for a in values)/(len(values)-1)), 'intercept': mean_y-covariance/(sum((a-mean_x)^2 for a in values)/(len(values)-1))*mean_x }`
    return `values=${values}; other_values=${other}; mean_x=sum(values)/len(values); mean_y=sum(other_values)/len(other_values); covariance=${covariance}; print(${result})`
  }
  if (request.operation === "sum" || request.operation === "min" || request.operation === "max")
    return `values=${values}; print(${request.operation}(values))`
  if (request.operation === "median") return `values=sorted(${values}); n=len(values); print(values[n//2] if n%2 else (values[n//2-1]+values[n//2])/2)`
  if (request.operation === "mode") return `values=${values}; counts={value:values.count(value) for value in values}; top=max(counts.values()); print([value for value,count in counts.items() if count==top])`
  if (request.operation === "mean") return `values=${values}; print(sum(values)/len(values))`
  if (request.operation === "variance" || request.operation === "std") {
    if (request.sample && request.values.length < 2) throw new Error("Sample variance requires at least two values")
    return `values=${values}; mean_value=sum(values)/len(values); print(${request.operation === "std" ? `sqrt(${variance})` : variance})`
  }
  if (request.operation === "quantile") {
    if (request.quantile === undefined) throw new Error("Quantile requires a quantile value")
    return `values=sorted(${values}); print(values[max(0,ceil((${request.quantile})*len(values))-1)])`
  }
  if (request.order === undefined) throw new Error("Moment requires an order")
  return `values=${values}; mean_value=sum(values)/len(values); print(sum((value-mean_value)^${request.order} for value in values)/len(values))`
}

function distributionCode(request: Extract<CASRequest, { tool: "distribution" }>) {
  const parameters = request.parameters.map((value) => `SR(${quoteSageString(value)})`)
  const value = request.value === undefined ? undefined : `SR(${quoteSageString(request.value)})`
  const requireValue = () => {
    if (!value) throw new Error(`${request.operation} requires a value`)
    return value
  }
  if (request.distribution === "normal") {
    if (parameters.length !== 2) throw new Error("Normal distribution requires mean and standard deviation")
    const [mean, std] = parameters
    if (request.operation === "mean") return `print(${mean})`
    if (request.operation === "variance") return `print((${std})^2)`
    const x = requireValue()
    return request.operation === "pdf" ? `print(exp(-(((${x})-(${mean}))/(${std}))^2/2)/((${std})*sqrt(2*pi)))` : `print((1+erf(((${x})-(${mean}))/(${std})/sqrt(2)))/2)`
  }
  if (request.distribution === "exponential") {
    if (parameters.length !== 1) throw new Error("Exponential distribution requires a rate")
    const [rate] = parameters
    if (request.operation === "mean") return `print(1/(${rate}))`
    if (request.operation === "variance") return `print(1/(${rate})^2)`
    const x = requireValue()
    return request.operation === "pdf" ? `print((${rate})*exp(-(${rate})*(${x})))` : `print(1-exp(-(${rate})*(${x})))`
  }
  if (request.distribution === "poisson") {
    if (parameters.length !== 1) throw new Error("Poisson distribution requires a rate")
    const [rate] = parameters
    if (request.operation === "mean" || request.operation === "variance") return `print(${rate})`
    const k = requireValue()
    return request.operation === "pmf" || request.operation === "pdf" ? `print(exp(-(${rate}))*(${rate})^(${k})/factorial(${k}))` : `var('k'); print(sum(exp(-(${rate}))*(${rate})^k/factorial(k), k, 0, ${k}))`
  }
  if (request.distribution === "binomial") {
    if (parameters.length !== 2) throw new Error("Binomial distribution requires trials and probability")
    const [trials, probability] = parameters
    if (request.operation === "mean") return `print((${trials})*(${probability}))`
    if (request.operation === "variance") return `print((${trials})*(${probability})*(1-(${probability})))`
    const k = requireValue()
    return request.operation === "pmf" || request.operation === "pdf" ? `print(binomial(${trials},${k})*(${probability})^(${k})*(1-(${probability}))^((${trials})-(${k})))` : `var('k'); print(sum(binomial(${trials},k)*(${probability})^k*(1-(${probability}))^((${trials})-k), k, 0, ${k}))`
  }
  if (parameters.length !== 2) throw new Error("Uniform distribution requires lower and upper bounds")
  const [lower, upper] = parameters
  if (request.operation === "mean") return `print(((${lower})+(${upper}))/2)`
  if (request.operation === "variance") return `print(((${upper})-(${lower}))^2/12)`
  const x = requireValue()
  return request.operation === "pdf" ? `print(1/((${upper})-(${lower})))` : `print(((${x})-(${lower}))/((${upper})-(${lower})))`
}

export * as SigmaForgeCAS from "./cas"
