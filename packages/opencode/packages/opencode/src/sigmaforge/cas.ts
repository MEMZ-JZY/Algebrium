import { z } from "zod"
import { quoteSageString, requireIdentifier, requireMathExpression, symbolsInMathExpression } from "./expression"
import type { KernelExecutor } from "./kernel"
import { assertToolAllowed } from "./policy"
import type { SubjectModule } from "./subject"

const expression = z.string().min(1).max(500)
const symbol = z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/).max(32)
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
  return `print(SR(${quoteSageString(request.expression)}))`
}

export * as SigmaForgeCAS from "./cas"
