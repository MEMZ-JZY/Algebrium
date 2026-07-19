import { z } from "zod"
import { quoteSageString, requireIdentifier } from "./expression"
import type { KernelExecutor } from "./kernel"
import { assertToolAllowed } from "./policy"
import type { SubjectModule } from "./subject"

export type PlotArtifact = {
  id: string
  kind: "image2d" | "plotly2d" | "plotly3d" | "jsxgraph"
  mime: string
  data: string | Record<string, unknown>
  meta: Record<string, string | number>
}

const function2dSchema = z.object({ id: z.string().uuid().optional(), expression: z.string().min(1).max(500), variable: z.string().default("x"), min: z.number().finite().min(-1e4).max(1e4), max: z.number().finite().min(-1e4).max(1e4), width: z.number().int().min(320).max(1600).default(800) })

export async function plotFunction2D(
  kernel: KernelExecutor,
  sessionID: string,
  subject: SubjectModule,
  input: unknown,
): Promise<PlotArtifact> {
  assertToolAllowed(subject, "plot.function2d")
  const request = function2dSchema.parse(input)
  if (request.min >= request.max) throw new Error("Plot range must be increasing")
  const variable = requireIdentifier(request.variable)
  const output = await kernel.execute(sessionID, `import json, math
var('${variable}'); f=SR(${quoteSageString(request.expression)})
try:
    sf_fast=fast_callable(f, vars=[${variable}], domain=RDF)
except Exception:
    sf_fast=None
def sf_value(v):
    try:
        n=float(sf_fast(v) if sf_fast is not None else f.subs({${variable}:v}).n())
        return n if math.isfinite(n) else None
    except Exception:
        return None
xs=[float(${request.min}+(${request.max}-${request.min})*i/160) for i in range(161)]
ys=[sf_value(v) for v in xs]
print(json.dumps({'x':xs,'y':ys}))`)
  const points = parseJSON<{ x: number[]; y: Array<number | null> }>(output.text)
  return { id: request.id ?? crypto.randomUUID(), kind: "plotly2d", mime: "application/vnd.plotly.v1+json", data: { data: [{ type: "scatter", mode: "lines", x: points.x, y: points.y, name: request.expression }], layout: { title: request.expression, xaxis: { title: variable, zeroline: true }, yaxis: { zeroline: true }, dragmode: "pan" } }, meta: { expression: request.expression, min: request.min, max: request.max } }
}

const surface3dSchema = z.object({ expression: z.string().min(1).max(500), xVariable: z.string().default("x"), yVariable: z.string().default("y"), xMin: z.number().min(-100).max(100), xMax: z.number().min(-100).max(100), yMin: z.number().min(-100).max(100), yMax: z.number().min(-100).max(100) })

export async function plotSurface3D(kernel: KernelExecutor, sessionID: string, subject: SubjectModule, input: unknown): Promise<PlotArtifact> {
  assertToolAllowed(subject, "plot.surface3d")
  const request = surface3dSchema.parse(input)
  if (request.xMin >= request.xMax || request.yMin >= request.yMax) throw new Error("3D plot ranges must be increasing")
  const x = requireIdentifier(request.xVariable)
  const y = requireIdentifier(request.yVariable)
  const output = await kernel.execute(sessionID, `import json, math
var('${x} ${y}'); f=SR(${quoteSageString(request.expression)})
try:
    sf_fast=fast_callable(f, vars=[${x},${y}], domain=RDF)
except Exception:
    sf_fast=None
def sf_value(a,b):
    try:
        n=float(sf_fast(a,b) if sf_fast is not None else f.subs({${x}:a,${y}:b}).n())
        return n if math.isfinite(n) else None
    except Exception:
        return None
xs=[float(${request.xMin}+(${request.xMax}-${request.xMin})*i/20) for i in range(21)]
ys=[float(${request.yMin}+(${request.yMax}-${request.yMin})*i/20) for i in range(21)]
zs=[[sf_value(a,b) for a in xs] for b in ys]
print(json.dumps({'x':xs,'y':ys,'z':zs}))`)
  const grid = parseJSON<{ x: number[]; y: number[]; z: Array<Array<number | null>> }>(output.text)
  return cartesianSurface(grid, request.expression)
}

function cartesianSurface(grid: { x: number[]; y: number[]; z: Array<Array<number | null>> }, title: string): PlotArtifact {
  const zValues = grid.z.flat().filter((value): value is number => typeof value === "number" && Number.isFinite(value))
  const xRange: [number, number] = [Math.min(0, ...grid.x), Math.max(0, ...grid.x)]
  const yRange: [number, number] = [Math.min(0, ...grid.y), Math.max(0, ...grid.y)]
  const zMinimum = Math.min(0, ...zValues)
  const zMaximum = Math.max(0, ...zValues)
  const zExtent = zMinimum === zMaximum ? 1 : Math.max(Math.abs(zMinimum), Math.abs(zMaximum))
  const zRange: [number, number] = [Math.min(zMinimum, -zExtent * 0.08), Math.max(zMaximum, zExtent * 0.08)]
  const axis = (name: string, x: number[], y: number[], z: number[], color: string) => ({
    type: "scatter3d", mode: "lines+text", x, y, z, text: ["", name], textposition: "top center",
    line: { color, width: 7 }, textfont: { color, size: 13 }, hoverinfo: "skip", showlegend: false,
  })
  return {
    id: crypto.randomUUID(), kind: "plotly3d", mime: "application/vnd.plotly.v1+json",
    data: {
      data: [
        { type: "surface", ...grid, name: title, colorscale: "Viridis", opacity: 0.9, showscale: true },
        axis("X", xRange, [0, 0], [0, 0], "#c23b32"),
        axis("Y", [0, 0], yRange, [0, 0], "#25804f"),
        axis("Z", [0, 0], [0, 0], zRange, "#315fa8"),
        { type: "scatter3d", mode: "markers+text", x: [0], y: [0], z: [0], text: ["O"], textposition: "bottom right", marker: { color: "#17211d", size: 4 }, hoverinfo: "skip", showlegend: false },
      ],
      layout: {
        title,
        scene: {
          xaxis: { title: "X", range: xRange, zeroline: true, showspikes: false },
          yaxis: { title: "Y", range: yRange, zeroline: true, showspikes: false },
          zaxis: { title: "Z", range: zRange, zeroline: true, showspikes: false },
          aspectmode: "cube",
          camera: { eye: { x: 1.45, y: 1.45, z: 1.15 } },
        },
        margin: { l: 0, r: 0, b: 0, t: 48 },
      },
    },
    meta: { expression: title, coordinateSystem: "cartesian-xyz" },
  }
}

const geometryID = z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/)
const geometrySchema = z.object({
  points: z.array(z.object({ id: geometryID, x: z.number().finite(), y: z.number().finite() })).max(30).default([]),
  segments: z.array(z.tuple([z.string(), z.string()])).max(60).default([]),
  circles: z.array(z.object({ id: geometryID, centerX: z.number().finite().min(-1e4).max(1e4), centerY: z.number().finite().min(-1e4).max(1e4), radius: z.number().finite().positive().max(1e4) })).max(20).default([]),
}).refine((value) => value.points.length > 0 || value.circles.length > 0, "Geometry requires at least one point or circle")

export function plotGeometry(subject: SubjectModule, input: unknown): PlotArtifact {
  assertToolAllowed(subject, "geometry.construct")
  const request = geometrySchema.parse(input)
  const ids = new Set(request.points.map((point) => point.id))
  if (request.segments.some(([from, to]) => !ids.has(from) || !ids.has(to))) throw new Error("Geometry segment references an unknown point")
  const extent = Math.max(
    5,
    ...request.points.flatMap((point) => [Math.abs(point.x), Math.abs(point.y)]),
    ...request.circles.flatMap((circle) => [Math.abs(circle.centerX) + circle.radius, Math.abs(circle.centerY) + circle.radius]),
  ) + 1
  return { id: crypto.randomUUID(), kind: "jsxgraph", mime: "application/vnd.jsxgraph+json", data: { boundingBox: [-extent, extent, extent, -extent], ...request }, meta: { points: request.points.length, circles: request.circles.length } }
}

function parseJSON<T>(text: string): T {
  for (const line of text.trim().split(/\r?\n/).reverse()) {
    try { return JSON.parse(line) as T } catch { /* Sage may emit warnings around the JSON line */ }
  }
  throw new Error("CAS returned invalid plot data")
}

export function surface3DSample(subject: SubjectModule): PlotArtifact {
  assertToolAllowed(subject, "plot.surface3d")
  return cartesianSurface({ x: [-1, 0, 1], y: [-1, 0, 1], z: [[0, 1, 0], [1, 2, 1], [0, 1, 0]] }, "3D 曲面契约样例")
}

export function geometrySample(subject: SubjectModule): PlotArtifact {
  assertToolAllowed(subject, "geometry.construct")
  return { id: crypto.randomUUID(), kind: "jsxgraph", mime: "application/vnd.jsxgraph+json", data: { boundingBox: [-5, 5, 5, -5], points: [{ id: "A", x: -2, y: -1 }, { id: "B", x: 2, y: -1 }, { id: "C", x: 0, y: 3 }], segments: [["A", "B"], ["B", "C"], ["C", "A"]], circles: [{ id: "c1", centerX: 0, centerY: 0, radius: 2 }] }, meta: { contract: 1 } }
}

export * as SigmaForgePlot from "./plot"
