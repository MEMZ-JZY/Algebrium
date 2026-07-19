import DOMPurify from "dompurify"
import katex from "katex"
import { marked } from "marked"
import type Plotly from "plotly.js-dist-min"
import { FormEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react"
import { askSigmaForge, createSession, deleteSession, getSession, getTheory, listSessions, stopSigmaForge, uploadSessionFile, type CASResult, type ContextSnapshot, type PlotArtifact, type Session, type SessionMessage, type StreamEvent, type TheoryNode, type VerificationResult } from "./api"
import "katex/dist/katex.min.css"

type ArtifactState = { id: string; title: string; status: "pending" | "ready" | "error"; artifact?: PlotArtifact; error?: string }
type ToolActivity = { id: string; tool: string; status: "running" | "complete" | "error"; startedAt: number; result?: CASResult; error?: string }

export function App() {
  const session = useRef<string | undefined>(undefined)
  const [question, setQuestion] = useState("")
  const [answer, setAnswer] = useState("")
  const [tools, setTools] = useState<ToolActivity[]>([])
  const [verifications, setVerifications] = useState<VerificationResult[]>([])
  const [artifacts, setArtifacts] = useState<ArtifactState[]>([])
  const [theory, setTheory] = useState<Record<string, TheoryNode>>({})
  const [selected, setSelected] = useState<string>()
  const [context, setContext] = useState<ContextSnapshot>()
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)
  const [sessions, setSessions] = useState<Session[]>([])
  const [history, setHistory] = useState<SessionMessage[]>([])
  const [uploading, setUploading] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [leftCollapsed, setLeftCollapsed] = useState(false)
  const [rightCollapsed, setRightCollapsed] = useState(false)
  const messagesEnd = useRef<HTMLDivElement>(null)

  useEffect(() => { void refreshSessions() }, [])
  useEffect(() => { if (!loading) setStopping(false) }, [loading])
  useEffect(() => { messagesEnd.current?.scrollIntoView({ behavior: loading ? "auto" : "smooth" }) }, [history, answer, loading])

  async function refreshSessions() {
    try { setSessions(await listSessions()) } catch { /* backend status is reported when sending */ }
  }

  async function selectSession(id: string) {
    if (loading) return
    session.current = id
    resetTransientState()
    const detail = await getSession(id)
    setHistory(detail.messages)
    setTheory((await getTheory(id)).nodes)
  }

  function newSession() {
    if (loading) return
    session.current = undefined
    setQuestion("")
    setHistory([])
    setTheory({})
    resetTransientState()
  }

  function resetTransientState() {
    setAnswer("")
    setTools([])
    setVerifications([])
    setArtifacts([])
    setSelected(undefined)
    setContext(undefined)
    setError("")
    setStopping(false)
  }

  async function removeSession(id: string) {
    if (loading || !window.confirm("确定删除这个历史会话吗？此操作不可撤销。")) return
    try {
      await deleteSession(id)
      if (session.current === id) newSession()
      await refreshSessions()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!question.trim() || loading) return
    setAnswer("")
    setTools([])
    setVerifications([])
    setContext(undefined)
    setError("")
    setLoading(true)
    try {
      session.current ??= (await createSession()).id
      setHistory((current) => [...current, { role: "user", content: question, createdAt: Date.now() }])
      await askSigmaForge(session.current, question, applyEvent)
      setTheory((await getTheory(session.current)).nodes)
      setHistory((await getSession(session.current)).messages)
      setAnswer("")
      await refreshSessions()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setLoading(false)
    }
  }

  async function upload(file?: File) {
    if (!file) return
    setUploading(true)
    setError("")
    try {
      session.current ??= (await createSession()).id
      await uploadSessionFile(session.current, file)
      setHistory((await getSession(session.current)).messages)
      await refreshSessions()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setUploading(false)
    }
  }

  async function stop() {
    if (!session.current || !loading || stopping) return
    setStopping(true)
    try {
      const result = await stopSigmaForge(session.current)
      if (!result.stopped) setError("当前没有可停止的生成任务。")
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      setStopping(false)
    }
  }

  function applyEvent(event: StreamEvent) {
    if (event.type === "chunk") setAnswer((current) => current + event.text)
    if (event.type === "tool.start") setTools((current) => [...current, { id: crypto.randomUUID(), tool: event.tool, status: "running", startedAt: Date.now() }])
    if (event.type === "tool.result") setTools((current) => completeTool(current, event.tool, event.result))
    if (event.type === "tool.error") {
      setTools((current) => completeTool(current, event.tool, undefined, event.message))
      if (event.tool.startsWith("plot.")) setArtifacts((current) => current.map((item) => item.status === "pending" ? { ...item, status: "error", error: event.message } : item))
    }
    if (event.type === "verification") {
      setVerifications((current) => [...current, event.result])
      setTools((current) => completeTool(current, "verify"))
    }
    if (event.type === "artifact.pending") setArtifacts((current) => [...current.filter((item) => item.id !== event.artifact.id), { ...event.artifact, status: "pending" }])
    if (event.type === "artifact") {
      setArtifacts((current) => [...current.filter((item) => item.id !== event.artifact.id), { id: event.artifact.id, title: String(event.artifact.meta.expression ?? "交互图形"), status: "ready", artifact: event.artifact }])
      setTools((current) => completeTool(current, artifactTool(event.artifact)))
    }
    if (event.type === "theory.updated") {
      setTheory((current) => ({ ...current, [event.node.id]: event.node }))
      if (event.node.kind !== "problem" || event.node.id === "session-root") return
      setSelected(event.node.id)
    }
    if (event.type === "error") {
      setError(event.message)
      setTools((current) => current.map((item) => item.status === "running" ? { ...item, status: "complete" } : item))
      setArtifacts((current) => current.map((item) => item.status === "pending" ? { ...item, status: "error", error: event.message } : item))
    }
    if (event.type === "done") setContext(event.context)
  }

  return <main className={`app-shell ${leftCollapsed ? "left-collapsed" : ""} ${rightCollapsed ? "right-collapsed" : ""}`}>
    <aside className="history-sidebar">
      <div className="sidebar-brand"><div className="brand-mark"><img src="/icon-192.png" alt="Algebrium" /></div>{!leftCollapsed && <strong>Algebrium</strong>}<button type="button" className="icon-button collapse-left" onClick={() => setLeftCollapsed((value) => !value)} aria-label={leftCollapsed ? "展开历史会话" : "折叠历史会话"}>{leftCollapsed ? "›" : "‹"}</button></div>
      {!leftCollapsed && <>
        <button type="button" className="new-chat" onClick={newSession}><span>＋</span>新建对话</button>
        <div className="sidebar-label">历史会话</div>
        <div className="session-list">{sessions.map((item) => <div className={`session-item ${session.current === item.id ? "selected" : ""}`} key={item.id}><button type="button" className="session-open" onClick={() => void selectSession(item.id)}><strong>{item.title}</strong><small>{item.updatedAt ? new Date(item.updatedAt).toLocaleString() : ""}</small></button><button type="button" className="session-delete" aria-label={`删除会话 ${item.title}`} title="删除会话" onClick={() => void removeSession(item.id)}>×</button></div>)}</div>
      </>}
      <div className="sidebar-foot"><span className="status-dot" />{!leftCollapsed && "本地服务已连接"}</div>
    </aside>

    <section className="chat-column">
      <header className="chat-header">
        <div><h1>可验证数学智能体</h1><p>真实模型 · SageMath CAS · LaTeX</p></div>
        <div className="system-status"><span />在线</div>
      </header>
      <article className="conversation" aria-live="polite">
        {!history.length && !answer && <div className="empty-state"><div className="empty-sigma"><img src="/icon-192.png" alt="Algebrium" /></div><h2>从一个数学问题开始</h2><p>支持符号计算、步骤验证、二维与三维交互绘图。</p></div>}
        {history.map((message, index) => <div className={`message-row ${message.role}`} key={`${message.createdAt}-${index}`}><div className="avatar">{message.role === "user" ? "你" : "A"}</div><div className="message"><span>{message.role === "user" ? "你" : "Algebrium"}</span><RenderBuffer content={message.content} /></div></div>)}
        {answer && <div className="message-row assistant"><div className="avatar">A</div><div className="message streaming"><span>Algebrium</span><RenderBuffer content={answer} /></div></div>}
        <div className="activity-stack">{tools.map((tool) => <ToolCard key={tool.id} activity={tool} />)}{verifications.map((verification, index) => <VerificationCard key={index} verification={verification} />)}{error && <p className="error">{error}</p>}{context && <small className="context">上下文 {context.estimatedTokens}/{context.budget} tokens{context.compressed ? " · 已压缩" : ""}</small>}</div>
        <div ref={messagesEnd} />
      </article>
      <form className="composer" onSubmit={submit}>
        <textarea id="question" rows={2} value={question} onChange={(event) => setQuestion(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit() } }} disabled={loading} placeholder="向 Algebrium 提问，Shift + Enter 换行" />
        <div className="composer-actions">
          <label className="upload-button" title="上传文本文件">＋<input type="file" accept=".txt,.md,.csv,.json" disabled={loading || uploading} onChange={(event) => { void upload(event.target.files?.[0]); event.target.value = "" }} /></label>
          <span>{uploading ? "正在上传…" : "支持 LaTeX、CAS 与绘图"}</span>
          {loading ? <button className="stop-button" type="button" disabled={stopping} onClick={() => void stop()}>{stopping ? "正在停止…" : "■ 停止"}</button> : <button className="send-button" disabled={!question.trim()} aria-label="发送问题">↑</button>}
        </div>
      </form>
    </section>

    <aside className="render-sidebar">
      <header className="render-header"><div><h2>函数图像</h2>{!rightCollapsed && <span>{artifacts.length} 个产物</span>}</div><button type="button" className="icon-button" onClick={() => setRightCollapsed((value) => !value)} aria-label={rightCollapsed ? "展开函数图像" : "折叠函数图像"}>{rightCollapsed ? "‹" : "›"}</button></header>
      {!rightCollapsed && <div className="render-content">
        <div className="plot-gallery">{artifacts.length ? <ArtifactGallery items={artifacts} /> : <div className="render-empty"><span>⌁</span><strong>暂无函数图像</strong><p>在对话中要求绘制函数、曲面或几何图。</p></div>}</div>
        <details className="theory-drawer"><summary>验证路径</summary><TheoryTree nodes={theory} selected={selected} onSelect={setSelected} /></details>
      </div>}
    </aside>
  </main>
}

function artifactTool(artifact: PlotArtifact) {
  if (artifact.kind === "image2d" || artifact.kind === "plotly2d") return "plot.function2d"
  if (artifact.kind === "plotly3d") return "plot.surface3d"
  return "geometry.construct"
}

function completeTool(current: ToolActivity[], tool: string, result?: CASResult, error?: string): ToolActivity[] {
  const reverseIndex = [...current].reverse().findIndex((item) => item.tool === tool && item.status === "running")
  const index = reverseIndex < 0 ? -1 : current.length - reverseIndex - 1
  const status = error ? "error" as const : "complete" as const
  if (index < 0) return [...current, { id: crypto.randomUUID(), tool, status, startedAt: Date.now(), result, error }]
  return current.map((item, itemIndex): ToolActivity => itemIndex === index ? { ...item, status, result, error } : item)
}

function ToolCard({ activity }: { activity: ToolActivity }) {
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    if (activity.status !== "running") return
    const update = () => setElapsed(Math.floor((Date.now() - activity.startedAt) / 1000))
    update()
    const timer = setInterval(update, 1000)
    return () => clearInterval(timer)
  }, [activity.startedAt, activity.status])
  return <details className={`tool ${activity.status}`} open={activity.status === "running"}>
    <summary>{activity.status === "running" ? `执行中 · ${elapsed}s` : activity.status === "error" ? "执行失败" : "已完成"} · {activity.tool}{activity.result ? ` · ${activity.result.durationMs}ms` : ""}</summary>
    {activity.status === "running" && <div className="tool-running"><span className="spinner" />{elapsed >= 30 ? "计算较复杂；可点击下方停止按钮终止。" : "等待安全工具返回…"}</div>}
    {activity.result && <pre>{activity.result.text}</pre>}
    {activity.error && <pre>{activity.error}</pre>}
  </details>
}

function VerificationCard({ verification }: { verification: VerificationResult }) {
  return <details className={`verification ${verification.verified ? "verified" : "rejected"}`} open>
    <summary>{verification.verified ? "✓ 符号验证通过" : "✗ 符号验证未通过"}</summary>
    <pre>{verification.evidence}</pre>
    <small>{verification.domainNote}</small>
  </details>
}

export function splitRenderBuffer(content: string) {
  const block = content.lastIndexOf("$$")
  if ((content.match(/\$\$/g)?.length ?? 0) % 2) return { stable: content.slice(0, block), pending: content.slice(block) }
  const inline = content.lastIndexOf("$")
  if ((content.match(/(?<!\$)\$(?!\$)/g)?.length ?? 0) % 2) return { stable: content.slice(0, inline), pending: content.slice(inline) }
  return { stable: content, pending: "" }
}

export function normalizeLatexDelimiters(content: string) {
  return content
    .replace(/\\\[/g, "$$")
    .replace(/\\\]/g, "$$")
    .replace(/\\\(/g, "$")
    .replace(/\\\)/g, "$")
}

function RenderBuffer({ content }: { content: string }) {
  const buffer = splitRenderBuffer(normalizeLatexDelimiters(content))
  return <><Markdown content={buffer.stable} />{buffer.pending && <pre className="formula-pending">{buffer.pending}</pre>}</>
}

function Markdown({ content }: { content: string }) {
  const html = useMemo(() => {
    const formulas: string[] = []
    const source = content.replace(/\$\$([\s\S]*?)\$\$|\$([^$\n]+)\$/g, (_match, block, inline) => {
      try {
        formulas.push(katex.renderToString(block ?? inline, { displayMode: block !== undefined, throwOnError: true }))
        return `SIGMAFORMULA${formulas.length - 1}TOKEN`
      } catch {
        return _match
      }
    })
    const rendered = DOMPurify.sanitize(marked.parse(source) as string, { FORBID_TAGS: ["img"] })
    return formulas.reduce((result, formula, index) => result.replace(`SIGMAFORMULA${index}TOKEN`, formula), rendered)
  }, [content])
  return <div className="markdown" dangerouslySetInnerHTML={{ __html: html }} />
}

function ArtifactSlot({ item }: { item: ArtifactState }) {
  if (item.status === "pending") return <div className="artifact-pending"><span className="spinner" />{item.title}</div>
  if (item.status === "error") return <p className="error">{item.error}</p>
  return item.artifact ? <Artifact artifact={item.artifact} /> : null
}

function ArtifactGallery({ items }: { items: ArtifactState[] }) {
  const combined = items.filter((item) => item.status === "ready" && (item.artifact?.kind === "plotly2d" || item.artifact?.kind === "jsxgraph"))
  const separate = items.filter((item) => !combined.includes(item))
  return <>
    {combined.length > 0 && <CombinedPlane artifacts={combined.map((item) => item.artifact!)} />}
    {separate.map((item) => <ArtifactSlot key={item.id} item={item} />)}
  </>
}

function CombinedPlane({ artifacts }: { artifacts: PlotArtifact[] }) {
  const ref = useRef<HTMLDivElement>(null)
  const [coordinates, setCoordinates] = useState("")
  const [reset, setReset] = useState(0)
  useEffect(() => {
    if (!ref.current) return
    const element = ref.current
    let release = () => {}
    void import("jsxgraph").then(({ default: JXG }) => {
      if (!element.isConnected) return
      const geometry = artifacts.filter((artifact) => artifact.kind === "jsxgraph").map((artifact) => artifact.data as GeometrySpec)
      const curves = artifacts.filter((artifact) => artifact.kind === "plotly2d").flatMap((artifact) => {
        const spec = artifact.data as { data?: Array<{ x?: number[]; y?: Array<number | null>; name?: string }> }
        return (spec.data ?? []).filter((trace) => Array.isArray(trace.x) && Array.isArray(trace.y))
      })
      const values = [
        ...geometry.flatMap((spec) => spec.points.flatMap((point) => [point.x, point.y])),
        ...geometry.flatMap((spec) => (spec.circles ?? []).flatMap((circle) => [Math.abs(circle.centerX) + circle.radius, Math.abs(circle.centerY) + circle.radius])),
        ...curves.flatMap((trace) => [...(trace.x ?? []), ...(trace.y ?? []).filter((value): value is number => typeof value === "number" && Number.isFinite(value))]),
      ]
      const extent = Math.max(5, ...values.map((value) => Math.abs(value))) * 1.1
      const board = JXG.JSXGraph.initBoard(element, { boundingbox: [-extent, extent, extent, -extent], axis: true, pan: { enabled: true }, zoom: { wheel: true, needShift: false } })
      curves.forEach((trace) => board.create("curve", [trace.x, trace.y], { name: trace.name ?? "函数", strokeWidth: 2.5, strokeColor: "#176b58" }))
      geometry.forEach((spec) => {
        const points = new Map(spec.points.map((point) => {
          const value = board.create("point", [point.x, point.y], { name: point.id })
          value.on("drag", () => setCoordinates(`${point.id}: (${value.X().toFixed(2)}, ${value.Y().toFixed(2)})`))
          return [point.id, value]
        }))
        spec.segments.forEach(([from, to]) => board.create("segment", [points.get(from), points.get(to)], { strokeColor: "#9a5b2f", strokeWidth: 2 }))
        ;(spec.circles ?? []).forEach((circle) => {
          const center = board.create("point", [circle.centerX, circle.centerY], { name: `O_${circle.id}`, size: 2, strokeColor: "#9a5b2f", fillColor: "#fff" })
          center.on("drag", () => setCoordinates(`${circle.id} 圆心: (${center.X().toFixed(2)}, ${center.Y().toFixed(2)})`))
          board.create("circle", [center, circle.radius], { name: circle.id, withLabel: true, strokeColor: "#c66a2b", strokeWidth: 2 })
        })
      })
      release = () => JXG.JSXGraph.freeBoard(board)
    })
    return () => release()
  }, [artifacts, reset])
  return <figure className="interactive combined-plane"><figcaption>二维函数与平面几何联合画布</figcaption><div className="plot-toolbar"><button type="button" onClick={() => setReset((value) => value + 1)}>重置视角</button><button type="button" onClick={() => void ref.current?.requestFullscreen()}>全屏</button>{coordinates && <output>{coordinates}</output>}</div><div className="interactive-plot" ref={ref} /></figure>
}

type GeometrySpec = { boundingBox: [number, number, number, number]; points: { id: string; x: number; y: number }[]; segments: [string, string][]; circles?: { id: string; centerX: number; centerY: number; radius: number }[] }

function Artifact({ artifact }: { artifact: PlotArtifact }) {
  const ref = useRef<HTMLDivElement>(null)
  const [coordinates, setCoordinates] = useState("")
  const [reset, setReset] = useState(0)
  useEffect(() => {
    if (!ref.current || artifact.kind === "image2d" || typeof artifact.data === "string") return
    if (artifact.kind === "plotly2d" || artifact.kind === "plotly3d") {
      const element = ref.current
      void import("plotly.js-dist-min").then(({ default: Plotly }) => {
        if (!element.isConnected) return
        const spec = artifact.data as { data: Plotly.Data[]; layout: Partial<Plotly.Layout> }
        return Plotly.newPlot(element, spec.data, spec.layout, { responsive: true, scrollZoom: true, displaylogo: false, modeBarButtonsToRemove: ["lasso2d", "select2d"] })
      })
      return () => { void import("plotly.js-dist-min").then(({ default: Plotly }) => Plotly.purge(element)) }
    }
    const element = ref.current
    let release = () => {}
    void import("jsxgraph").then(({ default: JXG }) => {
      if (!element.isConnected) return
      const spec = artifact.data as GeometrySpec
      const board = JXG.JSXGraph.initBoard(element, { boundingbox: spec.boundingBox, axis: true })
      const points = new Map(spec.points.map((point) => {
        const value = board.create("point", [point.x, point.y], { name: point.id })
        value.on("drag", () => setCoordinates(`${point.id}: (${value.X().toFixed(2)}, ${value.Y().toFixed(2)})`))
        return [point.id, value]
      }))
      spec.segments.forEach(([from, to]) => board.create("segment", [points.get(from), points.get(to)]))
      ;(spec.circles ?? []).forEach((circle) => {
        const center = board.create("point", [circle.centerX, circle.centerY], { name: `O_${circle.id}`, size: 2 })
        center.on("drag", () => setCoordinates(`${circle.id} 圆心: (${center.X().toFixed(2)}, ${center.Y().toFixed(2)})`))
        board.create("circle", [center, circle.radius], { name: circle.id, withLabel: true, strokeColor: "#c66a2b", strokeWidth: 2 })
      })
      release = () => JXG.JSXGraph.freeBoard(board)
    })
    return () => release()
  }, [artifact, reset])
  if (artifact.kind === "image2d" && typeof artifact.data === "string") return <figure><img src={artifact.data} alt="CAS 生成的二维函数图" /><figcaption>{String(artifact.meta.expression ?? "二维函数图")}</figcaption></figure>
  return <figure className="interactive"><div className="plot-toolbar"><button type="button" onClick={() => setReset((value) => value + 1)}>重置视角</button><button type="button" onClick={() => void ref.current?.requestFullscreen()}>全屏</button>{coordinates && <output>{coordinates}</output>}</div><div className="interactive-plot" ref={ref} /></figure>
}

function TheoryTree({ nodes, selected, onSelect }: { nodes: Record<string, TheoryNode>; selected?: string; onSelect: (id: string) => void }) {
  const root = nodes["session-root"]
  if (!root) return <p className="placeholder">发送问题后生成推导树。</p>
  const children = (node: TheoryNode) => node.children.map((id) => nodes[id]).filter((child): child is TheoryNode => Boolean(child))
  const renderNode = (node: TheoryNode): ReactNode => <li key={node.id}><button className={`theory-node ${node.status} ${selected === node.id ? "selected" : ""}`} onClick={() => onSelect(node.id)}><span>{node.status === "verified" ? "✓" : node.status === "rejected" ? "✗" : node.status === "error" ? "!" : "…"}</span>{node.title}</button>{node.children.length > 0 && <ul>{children(node).map(renderNode)}</ul>}{selected === node.id && <div className="node-detail"><p>{node.content}</p>{node.rule && <p>依据：{node.rule}</p>}{node.expression && <code>{node.expression}</code>}{node.verification && <pre>{node.verification.evidence}</pre>}{node.artifactIDs.length > 0 && <small>产物：{node.artifactIDs.join(", ")}</small>}</div>}</li>
  return <ul className="theory-tree">{children(root).map(renderNode)}</ul>
}
