const forbidden = /(?:__|\b(?:import|exec|eval|open|compile|globals|locals|os|sys|subprocess|socket|requests|urllib|pathlib|shutil|builtins)\b|[;{}`'"\\])/i
const allowed = /^[\p{L}\p{N}\s_+\-*/^().,=<>!\[\]]+$/u
const allowedFunctions = new Set([
  "abs", "acosh", "arccos", "arcsin", "arctan", "arg", "atanh", "airy_ai", "airy_bi", "beta", "bernoulli", "bessel_J", "binomial", "ceil", "chebyshev_T", "Ci", "conjugate", "cos", "cosh", "cos_integral", "cot", "csc", "dickman_rho", "diff", "dilog", "dirac_delta", "divisors", "elliptic_kc", "euler_phi", "Ei", "elliptic_k", "erf", "erfc", "exp", "exp_integral_e", "factor", "factorial", "fibonacci", "floor", "fresnel_sin", "gamma", "gamma_inc", "gcd", "heaviside", "hermite", "hypergeometric", "imag", "integral", "is_prime", "jacobi_P", "kronecker_delta", "laguerre", "lambert_w", "legendre_P", "lcm", "limit", "log", "log10", "log_gamma", "max", "min", "moebius", "mod", "next_prime", "polylog", "prime_pi", "product", "real", "round", "sec", "Si", "sign", "sigma", "sin", "sin_integral", "sinh", "sqrt", "subs", "sum", "tan", "tanh", "trunc", "zeta",
])
const sageConstants = new Set(["catalan", "e", "euler_gamma", "golden_ratio", "I", "infinity", "NaN", "oo", "pi"])

export function requireMathExpression(value: string) {
  const expression = normalizeMathExpression(value)
  if (!expression || expression.length > 500 || forbidden.test(expression) || !allowed.test(expression)) {
    throw new Error("Invalid or unsafe mathematical expression")
  }
  for (const match of expression.matchAll(/([A-Za-z][A-Za-z0-9_]*)\s*\(/g)) {
    if (!allowedFunctions.has(match[1]!)) throw new Error(`Unsafe mathematical function: ${match[1]}`)
  }
  return expression
}

export function normalizeMathExpression(value: string) {
  let expression = value.trim()
  if ((expression.startsWith("$$") && expression.endsWith("$$")) || (expression.startsWith("\\[") && expression.endsWith("\\]"))) {
    expression = expression.slice(2, -2).trim()
  } else if ((expression.startsWith("$") && expression.endsWith("$")) || (expression.startsWith("\\(") && expression.endsWith("\\)"))) {
    expression = expression.slice(1, -1).trim()
  }
  const characters: Record<number, string> = {
    0x2212: "-", 0x2013: "-", 0x2014: "-",
    0x00d7: "*", 0x00b7: "*", 0x22c5: "*",
    0x00f7: "/", 0x221e: "infinity", 0x03c0: "pi",
  }
  expression = [...expression].map((character) => characters[character.codePointAt(0)!] ?? character).join("")
  expression = expression
    .replace(/\\(?:left|right)\b/g, "")
    .replace(/\\(?:cdot|times)\b/g, "*")
    .replace(/\\div\b/g, "/")
    .replace(/\\pi\b/g, "pi")
    .replace(/\\infty\b/g, "infinity")
    .replace(/\\(sin|cos|tan|log|exp)\b/g, "$1")
    .replace(/\bln\s*\(/g, "log(")
    .replace(/\\sqrt\s*\{([^{}]+)\}/g, "sqrt($1)")
  for (let index = 0; index < 4; index++) {
    const next = expression.replace(/\\frac\s*\{([^{}]+)\}\s*\{([^{}]+)\}/g, "(($1)/($2))")
    if (next === expression) break
    expression = next
  }
  expression = expression.replace(/\{/g, "(").replace(/\}/g, ")").trim()
  return rewriteFunctionAlias(expression)
    .replace(/\bAiryAi\s*\(/g, "airy_ai(")
    .replace(/\bAiryBi\s*\(/g, "airy_bi(")
    .replace(/\blngamma\s*\(/g, "log_gamma(")
}

export function requireEvaluableMathExpression(value: string) {
  const expression = normalizeMathExpression(value)
  const definition = expression.match(/^[A-Za-z][A-Za-z0-9_]*\s*\(\s*[A-Za-z][A-Za-z0-9_]*\s*\)\s*=\s*(.+)$/)
  return requireMathExpression(definition?.[1] ?? expression)
}

function rewriteFunctionAlias(expression: string): string {
  const match = expression.match(/^(sub|subs)\s*\(([\s\S]*)\)$/)
  if (!match) return expression
  const args = splitTopLevelArguments(match[2]!)
  if (match[1] === "sub" && args.length === 2) return `((${rewriteFunctionAlias(args[0]!)})-(${rewriteFunctionAlias(args[1]!)}))`
  if (match[1] === "subs" && args.length === 3 && /^[A-Za-z][A-Za-z0-9_]*$/.test(args[1]!))
    return `((${rewriteFunctionAlias(args[0]!)}).subs(${args[1]}=${rewriteFunctionAlias(args[2]!)}))`
  return expression
}

function splitTopLevelArguments(value: string) {
  const result: string[] = []
  let depth = 0
  let start = 0
  for (let index = 0; index < value.length; index++) {
    if (value[index] === "(") depth++
    if (value[index] === ")") depth--
    if (value[index] !== "," || depth !== 0) continue
    result.push(value.slice(start, index).trim())
    start = index + 1
  }
  result.push(value.slice(start).trim())
  return result
}

export function quoteSageString(value: string) {
  return JSON.stringify(requireMathExpression(value))
}

export function requireIdentifier(value: string) {
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(value) || value.length > 32) throw new Error("Invalid symbol name")
  return value
}

export function symbolsInMathExpression(value: string) {
  const expression = requireMathExpression(value)
  return [...new Set([...expression.matchAll(/\b([A-Za-z][A-Za-z0-9_]*)\b/g)].map((match) => match[1]!).filter((name) => !allowedFunctions.has(name) && !sageConstants.has(name)))]
}

export * as SigmaForgeExpression from "./expression"
