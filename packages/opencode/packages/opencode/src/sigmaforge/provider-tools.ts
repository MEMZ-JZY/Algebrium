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
  tool("sigmaforge_eval", "计算受限数学表达式，支持初等函数、常用数论、特殊函数、正交多项式、复数函数和有限求和/求积；矩阵运算仍须使用 sigmaforge_matrix。禁止 Python 语句、导入、文件、进程和网络。表达式只填右侧公式，例如填 `sin(x)`，不要填 `f(x)=sin(x)`。", { expression }, ["expression"]),
  tool("sigmaforge_numeric", "以指定十进制有效数字近似计算安全数学表达式。只有用户需要小数、近似值或数值 p 值时才调用。", { expression, digits: { type: "integer", minimum: 2, maximum: 100 } }, ["expression"]),
  tool("sigmaforge_statistics", "计算数值样本的描述统计、中心矩、协方差/相关系数或一元线性回归。默认方差、标准差、协方差采用样本定义；quantile 使用 0 到 1 的最近秩位置。", { operation: { type: "string", enum: ["sum", "min", "max", "mean", "variance", "std", "median", "mode", "quantile", "moment", "covariance", "correlation", "linear_regression"] }, values: { type: "array", minItems: 1, maxItems: 1000, items: expression }, otherValues: { type: "array", minItems: 1, maxItems: 1000, items: expression }, quantile: { type: "number", minimum: 0, maximum: 1 }, order: { type: "integer", minimum: 1, maximum: 20 }, sample: { type: "boolean" } }, ["operation", "values"]),
  tool("sigmaforge_distribution", "计算正态、二项、泊松、指数或均匀分布的 pmf/pdf、cdf、期望和方差。parameters 顺序：normal=[均值,标准差]，binomial=[试验次数,成功概率]，poisson=[lambda]，exponential=[lambda]，uniform=[下界,上界]。", { distribution: { type: "string", enum: ["normal", "binomial", "poisson", "exponential", "uniform"] }, operation: { type: "string", enum: ["pdf", "pmf", "cdf", "mean", "variance"] }, parameters: { type: "array", minItems: 1, maxItems: 3, items: expression }, value: expression }, ["distribution", "operation", "parameters"]),
  tool("sigmaforge_hypothesis", "执行常用统计检验并返回检验统计量、双侧或单侧 p 值及可用的自由度：单样本 t、独立样本 t、配对 t、卡方拟合优度、Pearson 相关性检验。values 和 otherValues 是数值样本；卡方检验使用 expected。", { test: { type: "string", enum: ["one_sample_t", "independent_t", "paired_t", "chi_square", "pearson_correlation"] }, values: { type: "array", minItems: 1, maxItems: 1000, items: expression }, otherValues: { type: "array", minItems: 1, maxItems: 1000, items: expression }, expected: { type: "array", minItems: 1, maxItems: 1000, items: expression }, populationMean: expression, equalVariance: { type: "boolean" }, alternative: { type: "string", enum: ["two-sided", "less", "greater"] } }, ["test", "values"]),
  tool("sigmaforge_verify", "验证两个表达式符号等价。给出已验证结论前必须调用。", { lhs: expression, rhs: expression, domain: { type: "string", maxLength: 200 } }, ["lhs", "rhs"]),
  tool("sigmaforge_plot_function2d", "用 SageMath 采样并生成可拖拽、缩放的二维图。coordinateSystem 为 cartesian（默认）时绘制 y=f(x)；polar 时 expression 是 r(variable)；implicit 时 expression 是 F(x,y)=0，并使用 xVariable、yVariable。单个函数使用 expression；同一坐标系比较多个函数（含隐函数）使用 expressions。", { coordinateSystem: { type: "string", enum: ["cartesian", "polar", "implicit"] }, expression, expressions: { type: "array", minItems: 1, maxItems: 8, items: expression }, variable, xVariable: variable, yVariable: variable, min: { type: "number", minimum: -10000, maximum: 10000 }, max: { type: "number", minimum: -10000, maximum: 10000 }, width: { type: "integer", minimum: 320, maximum: 1600 } }, ["min", "max"]),
  tool("sigmaforge_plot_surface3d", "绘制可旋转、缩放的三维函数曲面。", { expression, xVariable: variable, yVariable: variable, xMin: { type: "number", minimum: -100, maximum: 100 }, xMax: { type: "number", minimum: -100, maximum: 100 }, yMin: { type: "number", minimum: -100, maximum: 100 }, yMax: { type: "number", minimum: -100, maximum: 100 } }, ["expression", "xVariable", "yVariable", "xMin", "xMax", "yMin", "yMax"]),
  tool("sigmaforge_geometry", "绘制可拖拽的平面几何图，支持点、线段和圆；可与二维函数叠加。画圆时直接使用 circles，不要用折线近似。", { points: { type: "array", maxItems: 30, items: { type: "object", properties: { id: { type: "string", pattern: "^[A-Za-z][A-Za-z0-9_]*$" }, x: { type: "number" }, y: { type: "number" } }, required: ["id", "x", "y"], additionalProperties: false } }, segments: { type: "array", maxItems: 60, items: { type: "array", minItems: 2, maxItems: 2, items: { type: "string" } } }, circles: { type: "array", maxItems: 20, items: { type: "object", properties: { id: { type: "string", pattern: "^[A-Za-z][A-Za-z0-9_]*$" }, centerX: { type: "number", minimum: -10000, maximum: 10000 }, centerY: { type: "number", minimum: -10000, maximum: 10000 }, radius: { type: "number", exclusiveMinimum: 0, maximum: 10000 } }, required: ["id", "centerX", "centerY", "radius"], additionalProperties: false } } }, []),
  tool("sigmaforge_web_search", "搜索任意公开网络来源，用于最新资料、事实核查、出处或补充背景。结果仅作引用资料，不能代替 CAS 验证。", { query: { type: "string", minLength: 1, maxLength: 200 }, limit: { type: "integer", minimum: 1, maximum: 5 } }, ["query"]),
]

function tool(name: string, description: string, properties: Record<string, unknown>, required: string[]): ProviderTool {
  return { type: "function", function: { name, description, parameters: { type: "object", properties, required, additionalProperties: false } } }
}

export * as ProviderTools from "./provider-tools"
