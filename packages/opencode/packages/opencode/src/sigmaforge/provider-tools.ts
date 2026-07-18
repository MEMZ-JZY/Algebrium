import type { ProviderTool } from "./provider"

const expression = { type: "string", minLength: 1, maxLength: 500 }
const variable = { type: "string", pattern: "^[A-Za-z][A-Za-z0-9_]*$" }

export const mathProviderTools: ProviderTool[] = [
  tool("sigmaforge_solve", "用 SageMath 解方程。表达式优先使用 Sage 语法（如 x^2=1、x*e^x），不要附带解释文字。", { equation: expression, variable }, ["equation", "variable"]),
  tool("sigmaforge_integrate", "用 SageMath 计算积分。需要积分计算时必须调用。", { expression, variable, lower: expression, upper: expression }, ["expression", "variable"]),
  tool("sigmaforge_diff", "用 SageMath 求导。", { expression, variable, order: { type: "integer", minimum: 1, maximum: 10 } }, ["expression", "variable"]),
  tool("sigmaforge_limit", "用 SageMath 求极限。", { expression, variable, point: expression, direction: { type: "string", enum: ["plus", "minus"] } }, ["expression", "variable", "point"]),
  tool("sigmaforge_simplify", "用 SageMath 化简表达式。", { expression }, ["expression"]),
  tool("sigmaforge_series", "用 SageMath 求级数展开。", { expression, variable, point: expression, order: { type: "integer", minimum: 1, maximum: 30 } }, ["expression", "variable", "point", "order"]),
  tool("sigmaforge_matrix", "用 SageMath 计算矩阵的行阶梯形、行列式或逆矩阵。", { rows: { type: "array", minItems: 1, maxItems: 12, items: { type: "array", minItems: 1, items: expression } }, operation: { type: "string", enum: ["rref", "det", "inverse"] } }, ["rows", "operation"]),
  tool("sigmaforge_factor", "用 SageMath 因式分解。", { expression }, ["expression"]),
  tool("sigmaforge_assume", "为当前会话设置数学符号假设。", { assumption: expression }, ["assumption"]),
  tool("sigmaforge_eval", "计算受限数学表达式，禁止 Python 语句、导入、文件、进程和网络。", { expression }, ["expression"]),
  tool("sigmaforge_verify", "验证两个表达式符号等价。给出已验证结论前必须调用。", { lhs: expression, rhs: expression, domain: { type: "string", maxLength: 200 } }, ["lhs", "rhs"]),
  tool("sigmaforge_plot_function2d", "用 SageMath 采样并生成可拖拽、缩放的二维函数图。用户要求绘图时必须调用。", { expression, variable, min: { type: "number", minimum: -10000, maximum: 10000 }, max: { type: "number", minimum: -10000, maximum: 10000 }, width: { type: "integer", minimum: 320, maximum: 1600 } }, ["expression", "variable", "min", "max"]),
  tool("sigmaforge_plot_surface3d", "绘制可旋转、缩放的三维函数曲面。", { expression, xVariable: variable, yVariable: variable, xMin: { type: "number", minimum: -100, maximum: 100 }, xMax: { type: "number", minimum: -100, maximum: 100 }, yMin: { type: "number", minimum: -100, maximum: 100 }, yMax: { type: "number", minimum: -100, maximum: 100 } }, ["expression", "xVariable", "yVariable", "xMin", "xMax", "yMin", "yMax"]),
  tool("sigmaforge_geometry", "绘制可拖拽顶点的平面几何图。", { points: { type: "array", minItems: 2, maxItems: 30, items: { type: "object", properties: { id: { type: "string" }, x: { type: "number" }, y: { type: "number" } }, required: ["id", "x", "y"], additionalProperties: false } }, segments: { type: "array", maxItems: 60, items: { type: "array", minItems: 2, maxItems: 2, items: { type: "string" } } } }, ["points", "segments"]),
]

function tool(name: string, description: string, properties: Record<string, unknown>, required: string[]): ProviderTool {
  return { type: "function", function: { name, description, parameters: { type: "object", properties, required, additionalProperties: false } } }
}

export * as ProviderTools from "./provider-tools"
