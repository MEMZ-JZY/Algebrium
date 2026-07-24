import DOMPurify from "dompurify"
import katex from "katex"
import { marked } from "marked"
import type Plotly from "plotly.js-basic-dist-min"
import { type CSSProperties, FormEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react"
import { askSigmaForge, createSession, deleteSession, getHealth, getProviderSettings, getSession, getTheory, listSessions, stopSigmaForge, updateProviderSettings, uploadSessionFile, type CASResult, type ContextSnapshot, type PlotArtifact, type ProcessHistoryEvent, type ProcessHistoryRun, type ProviderSettings, type Session, type SessionMessage, type StreamEvent, type TheoryNode, type VerificationResult, type WebSearchResult } from "./api"
import { citationURL } from "./web-sources"
import "katex/dist/katex.min.css"

type ArtifactState = { id: string; title: string; status: "pending" | "ready" | "error"; artifact?: PlotArtifact; error?: string }
type ToolActivity = { id: string; tool: string; status: "running" | "complete" | "error"; startedAt: number; input?: unknown; result?: CASResult; error?: string }
type ProcessStep =
  | { id: string; kind: "assistant"; lines: string[] }
  | { id: string; kind: "reasoning"; content: string }
  | { id: string; kind: "tools"; activities: ToolActivity[] }
type ProcessRun = { id: string; userMessageCreatedAt: number; steps: ProcessStep[]; completed: boolean; finalAnswer?: string }
type ColorScheme = "light" | "dark"
type ThemePreference = "system" | ColorScheme
type Language = "zh" | "en"
type ConnectionStatus = "checking" | "connected" | "disconnected"

const quickPrompts = [
  { label: "求解方程", prompt: "求解方程 x^3 - 6x^2 + 11x - 6 = 0，并验证所有解。" },
  { label: "绘制函数", prompt: "绘制函数 y = x^3 - 3x，并标出极值点。" },
  { label: "验证推导", prompt: "验证恒等式 (x + 1)^3 - (x - 1)^3 = 6x^2 + 2，并给出推导步骤。" },
]
const quickPromptsEn = [
  { label: "Solve equation", prompt: "Solve x^3 - 6x^2 + 11x - 6 = 0 and verify every solution." },
  { label: "Plot function", prompt: "Plot y = x^3 - 3x and mark its extrema." },
  { label: "Verify derivation", prompt: "Verify (x + 1)^3 - (x - 1)^3 = 6x^2 + 2 and show the derivation." },
]

const uiText = {
  zh: { newChat: "新建对话", history: "历史会话", connected: "本地服务已连接", title: "可验证数学智能体", subtitle: "真实模型 · SageMath CAS · LaTeX", settings: "设置", emptyTitle: "有什么数学问题？", emptyBody: "支持符号计算、步骤验证、二维与三维交互绘图。", examples: "问题示例", placeholder: "向 Algebrium 提问，Shift + Enter 换行", uploading: "正在上传…", upload: "上传文本文件", composerHint: "支持 LaTeX、CAS 与绘图", stopping: "正在停止…", stop: "■ 停止", send: "发送问题", you: "你", context: "上下文", compressed: "已压缩", plots: "函数图像", artifacts: "个产物", expandPlots: "展开函数图像", collapsePlots: "折叠函数图像", noPlots: "暂无函数图像", noPlotsBody: "在对话中要求绘制函数、曲面或几何图。", deleteConfirm: "确定删除这个历史会话吗？此操作不可撤销。", appearance: "外观", theme: "主题", system: "跟随系统", light: "浅色", dark: "深色", language: "语言", provider: "Provider", providerDescription: "切换模型服务，配置会立即同步到本地后端。", model: "模型", baseURL: "基础 URL", apiKey: "API Key", apiKeyHint: "留空则继续使用当前进程中的密钥", save: "保存更改", saving: "正在保存…", saved: "已生效", close: "关闭设置", general: "通用", connection: "模型服务", loadError: "无法读取 Provider 配置", saveError: "Provider 配置保存失败", custom: "自定义 Provider" },
  en: { newChat: "New chat", history: "History", connected: "Local service connected", title: "Verifiable Math Agent", subtitle: "Real model · SageMath CAS · LaTeX", settings: "Settings", emptyTitle: "What would you like to solve?", emptyBody: "Symbolic computation, verified steps, and interactive 2D or 3D plots.", examples: "Examples", placeholder: "Ask Algebrium, Shift + Enter for a new line", uploading: "Uploading…", upload: "Upload text file", composerHint: "LaTeX, CAS, and plotting supported", stopping: "Stopping…", stop: "■ Stop", send: "Send question", you: "You", context: "Context", compressed: "compressed", plots: "Plots", artifacts: "artifacts", expandPlots: "Expand plots", collapsePlots: "Collapse plots", noPlots: "No plots yet", noPlotsBody: "Ask for a function, surface, or geometry plot in the conversation.", deleteConfirm: "Delete this conversation? This cannot be undone.", appearance: "Appearance", theme: "Theme", system: "System", light: "Light", dark: "Dark", language: "Language", provider: "Provider", providerDescription: "Switch model services. Changes are applied to the local backend immediately.", model: "Model", baseURL: "Base URL", apiKey: "API Key", apiKeyHint: "Leave blank to keep the key currently loaded by the process", save: "Save changes", saving: "Saving…", saved: "Applied", close: "Close settings", general: "General", connection: "Model service", loadError: "Unable to load Provider settings", saveError: "Unable to save Provider settings", custom: "Custom Provider" },
} as const

export function App() {
  const session = useRef<string | undefined>(undefined)
  const [question, setQuestion] = useState("")
  const [answer, setAnswer] = useState("")
  const [processRuns, setProcessRuns] = useState<ProcessRun[]>([])
  const [verifications, setVerifications] = useState<VerificationResult[]>([])
  const [artifacts, setArtifacts] = useState<ArtifactState[]>([])
  const [webResults, setWebResults] = useState<WebSearchResult[]>([])
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
  const [newMessageAt, setNewMessageAt] = useState<number>()
  const [revealingRunID, setRevealingRunID] = useState<string>()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [connection, setConnection] = useState<ConnectionStatus>("checking")
  const [theme, setTheme] = useState<ThemePreference>(() => readPreference("algebrium-theme", "system"))
  const [language, setLanguage] = useState<Language>(() => readPreference("algebrium-language", "zh"))
  const colorScheme = useColorScheme(theme)
  const text = uiText[language]
  const messagesEnd = useRef<HTMLDivElement>(null)
  const conversation = useRef<HTMLElement>(null)
  const stickToBottom = useRef(true)
  const [showScrollToBottom, setShowScrollToBottom] = useState(false)
  const questionInput = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    let active = true
    const checkConnection = async () => {
      try {
        await getHealth()
        if (active) setConnection("connected")
      } catch {
        if (active) setConnection("disconnected")
      }
    }
    void checkConnection()
    const interval = window.setInterval(() => void checkConnection(), 10_000)
    return () => { active = false; window.clearInterval(interval) }
  }, [])
  useEffect(() => { void refreshSessions() }, [])
  useEffect(() => { localStorage.setItem("algebrium-theme", theme); document.documentElement.dataset.theme = theme === "system" ? "" : theme }, [theme])
  useEffect(() => { localStorage.setItem("algebrium-language", language); document.documentElement.lang = language === "zh" ? "zh-CN" : "en" }, [language])
  useEffect(() => { if (!loading) setStopping(false) }, [loading])
  useEffect(() => { if (stickToBottom.current) messagesEnd.current?.scrollIntoView({ behavior: loading ? "auto" : "smooth" }) }, [history, answer, loading, processRuns])

  async function refreshSessions() {
    try {
      setSessions(await listSessions())
      setConnection("connected")
    } catch {
      setConnection("disconnected")
    }
  }

  async function selectSession(id: string) {
    if (loading) return
    session.current = id
    resetTransientState()
    const detail = await getSession(id)
    setHistory(detail.messages)
    setProcessRuns(restoreProcessRuns(detail.processRuns))
    setArtifacts(detail.artifacts.map((artifact) => ({ id: artifact.id, title: String(artifact.meta.expression ?? "交互图形"), status: "ready", artifact })))
    setWebResults(detail.webResults)
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
    setProcessRuns([])
    setVerifications([])
    setArtifacts([])
    setWebResults([])
    setSelected(undefined)
    setContext(undefined)
    setError("")
    setStopping(false)
    setNewMessageAt(undefined)
    setRevealingRunID(undefined)
  }

  function useQuickPrompt(prompt: string) {
    setQuestion(prompt)
    requestAnimationFrame(() => questionInput.current?.focus())
  }

  async function removeSession(id: string) {
    if (loading || !window.confirm(text.deleteConfirm)) return
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
    const message = question.trim()
    if (!message || loading || connection !== "connected") return
    setAnswer("")
    setVerifications([])
    setContext(undefined)
    setError("")
    setLoading(true)
    setQuestion("")
    try {
      session.current ??= (await createSession()).id
      const createdAt = Date.now()
      const processID = crypto.randomUUID()
      setNewMessageAt(createdAt)
      setRevealingRunID(processID)
      setHistory((current) => [...current, { role: "user", content: message, createdAt }])
      setProcessRuns((current) => [...current, { id: processID, userMessageCreatedAt: createdAt, steps: [], completed: false }])
      stickToBottom.current = true
      setShowScrollToBottom(false)
      await askSigmaForge(session.current, message, applyEvent)
      setTheory((await getTheory(session.current)).nodes)
      const detail = await getSession(session.current)
      setHistory(detail.messages)
      setProcessRuns((current) => reconcileProcessRuns(current, detail.processRuns))
      setAnswer("")
      await refreshSessions()
    } catch (cause) {
      setQuestion(message)
      setError(cause instanceof Error ? cause.message : String(cause))
      setProcessRuns((current) => completeActiveProcessRun(current))
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
    if (event.type === "chunk") {
      setAnswer((current) => current + event.text)
      setProcessRuns((current) => updateActiveProcessRun(current, (steps) => appendProcessText(steps, "assistant", event.text)))
    }
    if (event.type === "reasoning.chunk") setProcessRuns((current) => updateActiveProcessRun(current, (steps) => appendProcessText(steps, "reasoning", event.text)))
    if (event.type === "answer") setProcessRuns((current) => updateActiveProcessAnswer(current, event.text))
    if (event.type === "tool.start") {
      const activity: ToolActivity = { id: crypto.randomUUID(), tool: event.tool, status: "running", startedAt: Date.now(), input: event.input }
      setProcessRuns((current) => updateActiveProcessRun(current, (steps) => appendProcessTool(steps, activity)))
    }
    if (event.type === "tool.result") {
      setProcessRuns((current) => updateActiveProcessRun(current, (steps) => completeProcessTool(steps, event.tool, event.result)))
    }
    if (event.type === "tool.error") {
      setProcessRuns((current) => updateActiveProcessRun(current, (steps) => completeProcessTool(steps, event.tool, undefined, event.message)))
      if (event.tool.startsWith("plot.")) setArtifacts((current) => current.map((item) => item.status === "pending" ? { ...item, status: "error", error: event.message } : item))
    }
    if (event.type === "verification") {
      setVerifications((current) => [...current, event.result])
      setProcessRuns((current) => updateActiveProcessRun(current, (steps) => completeProcessTool(steps, "verify")))
    }
    if (event.type === "artifact.pending") setArtifacts((current) => [...current.filter((item) => item.id !== event.artifact.id), { ...event.artifact, status: "pending" }])
    if (event.type === "artifact") {
      setArtifacts((current) => [...current.filter((item) => item.id !== event.artifact.id), { id: event.artifact.id, title: String(event.artifact.meta.expression ?? "交互图形"), status: "ready", artifact: event.artifact }])
      setProcessRuns((current) => updateActiveProcessRun(current, (steps) => completeProcessTool(steps, artifactTool(event.artifact))))
    }
    if (event.type === "web.result") {
      setWebResults((current) => [...current, event.result])
      setProcessRuns((current) => updateActiveProcessRun(current, (steps) => completeProcessTool(steps, "web.search")))
    }
    if (event.type === "theory.updated") {
      setTheory((current) => ({ ...current, [event.node.id]: event.node }))
      if (event.node.kind !== "problem" || event.node.id === "session-root") return
      setSelected(event.node.id)
    }
    if (event.type === "error") {
      setError(event.message)
      setProcessRuns((current) => updateActiveProcessRun(current, (steps) => steps.map((step) => step.kind === "tools" ? { ...step, activities: step.activities.map((item) => item.status === "running" ? { ...item, status: "complete" } : item) } : step)))
      setArtifacts((current) => current.map((item) => item.status === "pending" ? { ...item, status: "error", error: event.message } : item))
    }
    if (event.type === "done") {
      setContext(event.context)
      setProcessRuns((current) => completeActiveProcessRun(current))
    }
  }

  function handleConversationScroll() {
    const element = conversation.current
    if (!element) return
    const awayFromBottom = element.scrollHeight - element.scrollTop - element.clientHeight > 120
    stickToBottom.current = !awayFromBottom
    setShowScrollToBottom(awayFromBottom)
  }

  function scrollToBottom() {
    stickToBottom.current = true
    setShowScrollToBottom(false)
    messagesEnd.current?.scrollIntoView({ behavior: "smooth" })
  }

  return <main className={`app-shell ${leftCollapsed ? "left-collapsed" : ""} ${rightCollapsed ? "right-collapsed" : ""}`}>
    <aside className="history-sidebar">
      <div className="sidebar-brand"><div className="brand-mark"><img src="/icon-192.png" alt="Algebrium" /></div><strong>Algebrium</strong><button type="button" className="icon-button collapse-left" onClick={() => setLeftCollapsed((value) => !value)} aria-label={leftCollapsed ? "展开历史会话" : "折叠历史会话"}>{leftCollapsed ? "›" : "‹"}</button></div>
      <div className="sidebar-content" aria-hidden={leftCollapsed}>
        <button type="button" className="new-chat" onClick={newSession}><span>＋</span>{text.newChat}</button>
        <div className="sidebar-label">{text.history}</div>
        <div className="session-list">{sessions.map((item) => <div className={`session-item ${session.current === item.id ? "selected" : ""}`} key={item.id}><button type="button" className="session-open" onClick={() => void selectSession(item.id)}><strong>{item.title}</strong><small>{item.updatedAt ? new Date(item.updatedAt).toLocaleString() : ""}</small></button><button type="button" className="session-delete" aria-label={`删除会话 ${item.title}`} title="删除会话" onClick={() => void removeSession(item.id)}>×</button></div>)}</div>
      </div>
      <div className={`sidebar-foot ${connection}`}><span className="status-dot" /><span className="sidebar-status-label">{connection === "connected" ? text.connected : connection === "checking" ? (language === "zh" ? "正在连接本地服务" : "Connecting to local service") : (language === "zh" ? "本地服务未连接" : "Local service disconnected")}</span></div>
    </aside>

    <section className="chat-column">
      <header className="chat-header">
        <div><h1>{text.title}</h1><p>{text.subtitle}</p></div>
        <button type="button" className="settings-button" onClick={() => setSettingsOpen(true)} aria-label={text.settings} title={text.settings}><SettingsGlyph /></button>
      </header>
      <article ref={conversation} className="conversation" aria-live="polite" onScroll={handleConversationScroll}>
        {!history.length && !answer && <div className="empty-state"><div className="empty-sigma"><img src="/icon-192.png" alt="Algebrium" /></div><h2>{text.emptyTitle}</h2><p>{text.emptyBody}</p><div className="prompt-suggestions" aria-label={text.examples}>{quickPrompts.map((item, index) => <button type="button" key={item.label} onClick={() => useQuickPrompt(language === "zh" ? item.prompt : quickPromptsEn[index]!.prompt)}>{language === "zh" ? item.label : quickPromptsEn[index]!.label}<span aria-hidden="true">↗</span></button>)}</div></div>}
        {history.map((message, index) => {
          const run = message.role === "assistant" ? processRunForAssistant(history, index, processRuns) : undefined
          if (run) return <ProcessTurn key={run.id} run={run} fallbackAnswer={message.content} language={language} animateAnswer={run.id === revealingRunID} />
          return <div className={`message-row ${message.role} ${message.createdAt === newMessageAt ? "message-entering" : ""}`} key={`${message.createdAt}-${index}`}><div className="avatar">{message.role === "user" ? text.you.slice(0, 1) : "A"}</div><div className="message"><span>{message.role === "user" ? text.you : "Algebrium"}</span><RenderBuffer content={message.content} /></div></div>
        })}
        {processRuns.filter((run) => !processRunHasAssistant(history, run)).map((run) => <ProcessTurn key={run.id} run={run} language={language} animateAnswer={run.id === revealingRunID} />)}
        <div className="activity-stack">{verifications.map((verification, index) => <VerificationCard key={index} verification={verification} language={language} />)}{webResults.map((result, index) => <WebSearchCard key={`${result.query}-${index}`} result={result} language={language} />)}{error && <p className="error">{error}</p>}{context && <small className="context">{text.context} {context.estimatedTokens}/{context.budget} tokens{context.compressed ? ` · ${text.compressed}` : ""}</small>}</div>
        <div ref={messagesEnd} />
      </article>
      {showScrollToBottom && <button type="button" className="scroll-to-bottom" onClick={scrollToBottom} aria-label={language === "zh" ? "回到底部" : "Back to bottom"} title={language === "zh" ? "回到底部" : "Back to bottom"}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v15m0 0 6-6m-6 6-6-6" /></svg></button>}
      <form className="composer" onSubmit={submit}>
        <textarea ref={questionInput} id="question" rows={2} value={question} onChange={(event) => setQuestion(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit() } }} disabled={loading} placeholder={text.placeholder} />
        <div className="composer-actions">
          <label className="upload-button" title={text.upload}>＋<input type="file" accept=".txt,.md,.csv,.json" disabled={loading || uploading || connection !== "connected"} onChange={(event) => { void upload(event.target.files?.[0]); event.target.value = "" }} /></label>
          <span>{uploading ? text.uploading : text.composerHint}</span>
          {loading ? <button className="stop-button" type="button" disabled={stopping} onClick={() => void stop()}>{stopping ? text.stopping : text.stop}</button> : <button className="send-button" disabled={!question.trim() || connection !== "connected"} aria-label={text.send}>↑</button>}
        </div>
      </form>
    </section>

    <aside className="render-sidebar">
      <header className="render-header"><div className="render-heading"><h2>{text.plots}</h2><span>{artifacts.length} {text.artifacts}</span></div><button type="button" className="icon-button" onClick={() => setRightCollapsed((value) => !value)} aria-label={rightCollapsed ? text.expandPlots : text.collapsePlots}>{rightCollapsed ? "‹" : "›"}</button></header>
      <div className="render-content" aria-hidden={rightCollapsed}>
        <div className="plot-gallery">{artifacts.length ? <ArtifactGallery items={artifacts} colorScheme={colorScheme} language={language} /> : <div className="render-empty"><span>⌁</span><strong>{text.noPlots}</strong><p>{text.noPlotsBody}</p></div>}</div>
        <details className="theory-drawer"><summary>验证路径</summary><TheoryTree nodes={theory} selected={selected} onSelect={setSelected} /></details>
      </div>
    </aside>
    {settingsOpen && <SettingsPanel language={language} theme={theme} text={text} onLanguage={setLanguage} onTheme={setTheme} onClose={() => setSettingsOpen(false)} />}
  </main>
}

function SettingsPanel({ language, theme, text, onLanguage, onTheme, onClose }: { language: Language; theme: ThemePreference; text: typeof uiText[Language]; onLanguage: (value: Language) => void; onTheme: (value: ThemePreference) => void; onClose: () => void }) {
  const [settings, setSettings] = useState<ProviderSettings>()
  const [profileID, setProfileID] = useState("")
  const [customID, setCustomID] = useState("custom")
  const [provider, setProvider] = useState("custom")
  const [model, setModel] = useState("")
  const [baseURL, setBaseURL] = useState("")
  const [apiKey, setApiKey] = useState("")
  const [status, setStatus] = useState<"" | "saving" | "saved" | "error">("")
  const [message, setMessage] = useState("")
  const closeButton = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    closeButton.current?.focus()
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose() }
    window.addEventListener("keydown", escape)
    void getProviderSettings().then((value) => {
      setSettings(value)
      selectProfile(value.active, value)
    }).catch((cause) => { setStatus("error"); setMessage(cause instanceof Error ? cause.message : text.loadError) })
    return () => window.removeEventListener("keydown", escape)
  }, [])

  function selectProfile(id: string, source = settings) {
    setProfileID(id)
    const profile = source?.profiles[id]
    if (!profile) { setProvider("custom"); setModel(""); setBaseURL(""); return }
    setProvider(profile.provider)
    setModel(profile.model)
    setBaseURL(profile.baseURL ?? "")
    setApiKey("")
  }

  async function saveProvider(event: FormEvent) {
    event.preventDefault()
    setStatus("saving")
    setMessage("")
    try {
      const id = profileID === "custom" ? customID.trim() : profileID.trim()
      const next = await updateProviderSettings({ id, provider, model: model.trim(), baseURL: baseURL.trim() || undefined, apiKey: apiKey.trim() || undefined })
      setSettings(next)
      setApiKey("")
      setStatus("saved")
    } catch (cause) {
      setStatus("error")
      setMessage(cause instanceof Error ? cause.message : text.saveError)
    }
  }

  return <div className="settings-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section className="settings-panel" role="dialog" aria-modal="true" aria-labelledby="settings-title">
      <header className="settings-header"><div><span>{text.general}</span><h2 id="settings-title">{text.settings}</h2></div><button ref={closeButton} type="button" className="settings-close" onClick={onClose} aria-label={text.close}>×</button></header>
      <div className="settings-scroll">
        <section className="settings-section"><h3>{text.appearance}</h3><div className="settings-card">
          <div className="setting-row"><label>{text.theme}</label><div className="segmented-control">{(["system", "light", "dark"] as const).map((value) => <button type="button" className={theme === value ? "selected" : ""} key={value} onClick={() => onTheme(value)}>{text[value]}</button>)}</div></div>
          <div className="setting-row"><label>{text.language}</label><div className="segmented-control"><button type="button" className={language === "zh" ? "selected" : ""} onClick={() => onLanguage("zh")}>中文</button><button type="button" className={language === "en" ? "selected" : ""} onClick={() => onLanguage("en")}>English</button></div></div>
        </div></section>
        <section className="settings-section"><h3>{text.connection}</h3><form className="settings-card provider-form" onSubmit={saveProvider}>
          <p>{text.providerDescription}</p>
          <label><span>{text.provider}</span><select value={profileID} onChange={(event) => selectProfile(event.target.value)} disabled={!settings}>{settings && Object.values(settings.profiles).map((item) => <option key={item.id} value={item.id}>{item.id} · {item.model}</option>)}<option value="custom">{text.custom}</option></select></label>
          {profileID === "custom" && <label><span>ID</span><input value={customID} onChange={(event) => setCustomID(event.target.value)} placeholder="my-provider" required /></label>}
          <label><span>{text.model}</span><input value={model} onChange={(event) => setModel(event.target.value)} placeholder="model-name" required /></label>
          {(provider === "custom" || baseURL) && <label><span>{text.baseURL}</span><input type="url" value={baseURL} onChange={(event) => setBaseURL(event.target.value)} placeholder="https://api.example.com/v1" required={provider === "custom"} /></label>}
          <label><span>{text.apiKey}</span><input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="••••••••••••" autoComplete="off" /><small>{text.apiKeyHint}</small></label>
          <div className="settings-save-row"><span className={status === "error" ? "settings-error" : "settings-success"}>{status === "saved" ? text.saved : message}</span><button type="submit" className="settings-save" disabled={status === "saving" || !(profileID === "custom" ? customID : profileID).trim() || !model.trim()}>{status === "saving" ? text.saving : text.save}</button></div>
        </form></section>
      </div>
    </section>
  </div>
}

function SettingsGlyph() {
  return <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4M7 8a1 1 0 1 1 2 0 1 1 0 0 1-2 0m3.618-3.602a.71.71 0 0 1-.824-.567l-.26-1.416a.35.35 0 0 0-.275-.282 6.1 6.1 0 0 0-2.519 0 .35.35 0 0 0-.275.282l-.259 1.416a.71.71 0 0 1-.936.538l-1.359-.484a.36.36 0 0 0-.382.095 6 6 0 0 0-1.262 2.173.35.35 0 0 0 .108.378l1.102.931q.045.037.081.081a.704.704 0 0 1-.081.995l-1.102.931a.35.35 0 0 0-.108.378A6 6 0 0 0 3.53 12.02a.36.36 0 0 0 .382.095l1.36-.484a.708.708 0 0 1 .936.538l.258 1.416c.026.14.135.252.275.281a6.1 6.1 0 0 0 2.52 0 .35.35 0 0 0 .274-.281l.26-1.416a.71.71 0 0 1 .936-.538l1.359.484c.135.048.286.01.382-.095a6 6 0 0 0 1.262-2.173.35.35 0 0 0-.108-.378l-1.102-.931a.703.703 0 0 1 0-1.076l1.102-.931a.35.35 0 0 0 .108-.378A6 6 0 0 0 12.47 3.98a.36.36 0 0 0-.382-.095l-1.36.484a1 1 0 0 1-.111.03m-6.62.58.937.333a1.71 1.71 0 0 0 2.255-1.3l.177-.97a5 5 0 0 1 1.265 0l.178.97a1.708 1.708 0 0 0 2.255 1.3L12 4.977q.384.503.63 1.084l-.754.637a1.704 1.704 0 0 0 0 2.604l.755.637a5 5 0 0 1-.63 1.084l-.937-.334a1.71 1.71 0 0 0-2.255 1.3l-.178.97a5 5 0 0 1-1.265 0l-.177-.97a1.708 1.708 0 0 0-2.255-1.3L4 11.023a5 5 0 0 1-.63-1.084l.754-.638a1.704 1.704 0 0 0 0-2.603l-.755-.637q.248-.581.63-1.084" /></svg>
}

function artifactTool(artifact: PlotArtifact) {
  if (artifact.kind === "image2d" || artifact.kind === "plotly2d") return "plot.function2d"
  if (artifact.kind === "plotly3d") return "plot.surface3d"
  return "geometry.construct"
}

function restoreProcessRuns(runs: ProcessHistoryRun[]): ProcessRun[] {
  return runs.map((run) => {
    let steps: ProcessStep[] = []
    let finalAnswer: string | undefined
    for (const event of run.events) {
      if (event.type === "answer") finalAnswer = event.text
      else steps = applyProcessHistoryEvent(steps, event)
    }
    return { id: run.id, userMessageCreatedAt: run.userMessageCreatedAt, completed: run.completed, steps, finalAnswer }
  })
}

function reconcileProcessRuns(current: ProcessRun[], persisted: ProcessHistoryRun[]) {
  const restored = restoreProcessRuns(persisted)
  const live = current.at(-1)
  const saved = restored.at(-1)
  if (!live || !saved) return restored
  return [...restored.slice(0, -1), { ...live, userMessageCreatedAt: saved.userMessageCreatedAt, completed: saved.completed, finalAnswer: saved.finalAnswer ?? live.finalAnswer }]
}

function applyProcessHistoryEvent(steps: ProcessStep[], event: ProcessHistoryEvent): ProcessStep[] {
  if (event.type === "chunk") return appendProcessText(steps, "assistant", event.text)
  if (event.type === "reasoning.chunk") return appendProcessText(steps, "reasoning", event.text)
  if (event.type === "answer") return steps
  if (event.type === "tool.start") return appendProcessTool(steps, { id: crypto.randomUUID(), tool: event.tool, status: "running", startedAt: Date.now(), input: event.input })
  if (event.type === "tool.result") return completeProcessTool(steps, event.tool, event.result)
  if (event.type === "tool.error") return completeProcessTool(steps, event.tool, undefined, event.message)
  return completeProcessTool(steps, event.tool)
}

function updateActiveProcessAnswer(current: ProcessRun[], answer: string): ProcessRun[] {
  const index = lastIncompleteProcessRunIndex(current)
  if (index < 0) return current
  return current.map((run, runIndex) => runIndex === index ? { ...run, finalAnswer: answer } : run)
}

function updateActiveProcessRun(current: ProcessRun[], update: (steps: ProcessStep[]) => ProcessStep[]): ProcessRun[] {
  const index = lastIncompleteProcessRunIndex(current)
  if (index < 0) return current
  return current.map((run, runIndex) => runIndex === index ? { ...run, steps: update(run.steps) } : run)
}

function completeActiveProcessRun(current: ProcessRun[]): ProcessRun[] {
  const index = lastIncompleteProcessRunIndex(current)
  if (index < 0) return current
  return current.map((run, runIndex) => runIndex === index ? { ...run, completed: true } : run)
}

function lastIncompleteProcessRunIndex(runs: ProcessRun[]) {
  for (let index = runs.length - 1; index >= 0; index--) {
    if (!runs[index]?.completed) return index
  }
  return -1
}

function processRunForAssistant(messages: SessionMessage[], assistantIndex: number, runs: ProcessRun[]) {
  for (let index = assistantIndex - 1; index >= 0; index--) {
    const message = messages[index]
    if (message?.role === "user") return runs.find((run) => run.userMessageCreatedAt === message.createdAt)
  }
  return undefined
}

function processRunHasAssistant(messages: SessionMessage[], run: ProcessRun) {
  const userIndex = messages.findIndex((message) => message.role === "user" && message.createdAt === run.userMessageCreatedAt)
  if (userIndex < 0) return false
  for (let index = userIndex + 1; index < messages.length; index++) {
    if (messages[index]?.role === "user") return false
    if (messages[index]?.role === "assistant") return true
  }
  return false
}

function appendProcessText(current: ProcessStep[], kind: "assistant" | "reasoning", text: string): ProcessStep[] {
  const last = current.at(-1)
  if (kind === "assistant") {
    if (last?.kind === "assistant") return [...current.slice(0, -1), { ...last, lines: [...last.lines, text] }]
    return [...current, { id: crypto.randomUUID(), kind, lines: [text] }]
  }
  if (last?.kind === "reasoning") return [...current.slice(0, -1), { ...last, content: last.content + text }]
  return [...current, { id: crypto.randomUUID(), kind, content: text }]
}

function appendProcessTool(current: ProcessStep[], activity: ToolActivity): ProcessStep[] {
  const last = current.at(-1)
  if (last?.kind === "tools") return [...current.slice(0, -1), { ...last, activities: [...last.activities, activity] }]
  return [...current, { id: crypto.randomUUID(), kind: "tools", activities: [activity] }]
}

function completeProcessTool(current: ProcessStep[], tool: string, result?: CASResult, error?: string): ProcessStep[] {
  for (let index = current.length - 1; index >= 0; index--) {
    const step = current[index]
    if (step?.kind !== "tools" || !step.activities.some((item) => item.tool === tool && item.status === "running")) continue
    return current.map((item, itemIndex) => itemIndex === index ? { ...step, activities: completeTool(step.activities, tool, result, error) } : item)
  }
  const status = error ? "error" as const : "complete" as const
  return appendProcessTool(current, { id: crypto.randomUUID(), tool, status, startedAt: Date.now(), result, error })
}

function completeTool(current: ToolActivity[], tool: string, result?: CASResult, error?: string): ToolActivity[] {
  const reverseIndex = [...current].reverse().findIndex((item) => item.tool === tool && item.status === "running")
  const index = reverseIndex < 0 ? -1 : current.length - reverseIndex - 1
  const status = error ? "error" as const : "complete" as const
  if (index < 0) return [...current, { id: crypto.randomUUID(), tool, status, startedAt: Date.now(), result, error }]
  return current.map((item, itemIndex): ToolActivity => itemIndex === index ? { ...item, status, result, error } : item)
}

function ProcessTurn({ run, fallbackAnswer, language, animateAnswer }: { run: ProcessRun; fallbackAnswer?: string; language: Language; animateAnswer: boolean }) {
  const answer = run.finalAnswer ?? (run.completed ? fallbackAnswer : undefined)
  const hasProcess = run.steps.some((step) => step.kind !== "assistant")
  return <>
    {hasProcess && <ProcessFlow steps={run.steps} language={language} loading={!run.completed} />}
    {run.completed && answer && <FinalAnswer content={answer} animate={animateAnswer} />}
  </>
}

function ProcessFlow({ steps, language, loading }: { steps: ProcessStep[]; language: Language; loading: boolean }) {
  return <div className="message-row assistant message-entering process-flow-row">
    <div className="avatar">A</div>
    <div className="message process-flow"><span>Algebrium</span>
      {steps.map((step) => {
        if (step.kind === "assistant") return null
        if (step.kind === "reasoning") return <ReasoningBlock key={step.id} content={step.content} language={language} active={loading && step === steps.at(-1)} />
        return <ToolActivityGroup key={step.id} activities={step.activities} language={language} />
      })}
    </div>
  </div>
}

function FinalAnswer({ content, animate }: { content: string; animate: boolean }) {
  const bufferedLines = content.match(/[^\n]*\n|[^\n]+$/g) ?? [content]
  const lines = renderableAssistantLines(bufferedLines, true)
  return <div className={`message-row assistant final-answer-row ${animate ? "is-revealing" : "is-settled"}`}>
    <div className="avatar">A</div>
    <div className="message final-answer-stage">
      <span>Algebrium</span>
      <div className="final-answer-lines">
        {lines.map((line, index) => {
          const progress = lines.length <= 1 ? 0 : index / (lines.length - 1)
          const lineStyle = {
            "--answer-line-delay": `${280 + index * 78}ms`,
            "--answer-line-rise": `${18 - progress * 10}px`,
            "--answer-line-rebound": `${-(2.2 - progress * 1.35)}px`,
          } as CSSProperties
          return <div className="final-answer-line" style={lineStyle} key={index}><RenderBuffer content={line} /></div>
        })}
      </div>
    </div>
  </div>
}

function renderableAssistantLines(lines: string[], complete: boolean) {
  const result: string[] = []
  let pending = ""
  for (const line of lines) {
    pending += line
    const incompleteFence = (pending.match(/```/g)?.length ?? 0) % 2 === 1
    if (incompleteFence || splitRenderBuffer(pending).pending) continue
    if (!pending.trim() && result.length > 0) result[result.length - 1] += pending
    else result.push(pending)
    pending = ""
  }
  if (complete && pending) result.push(pending)
  return result
}

function ReasoningBlock({ content, language, active }: { content: string; language: Language; active: boolean }) {
  const [open, setOpen] = useState(active)
  useEffect(() => { setOpen(active) }, [active])
  return <details className={`reasoning-block ${active ? "active" : "complete"}`} open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary><span className="reasoning-dot" />{language === "zh" ? (active ? "正在思考" : "模型思考") : (active ? "Thinking" : "Model reasoning")}<span className="tool-group-chevron" aria-hidden="true" /></summary>
    <div className="reasoning-content"><RenderBuffer content={content} /></div>
  </details>
}

function ToolActivityGroup({ activities, language }: { activities: ToolActivity[]; language: Language }) {
  const running = activities.filter((activity) => activity.status === "running").length
  const failed = activities.filter((activity) => activity.status === "error").length
  const [open, setOpen] = useState(running > 0)
  useEffect(() => { setOpen(running > 0) }, [running])
  const label = language === "zh"
    ? running ? `正在调用 ${running} 个工具` : failed ? `${activities.length} 个工具调用完成，${failed} 个失败` : `已调用 ${activities.length} 个工具`
    : running ? `Running ${running} tools` : failed ? `${activities.length} tools completed, ${failed} failed` : `Ran ${activities.length} tools`

  return <details className={`tool-group ${running ? "running" : failed ? "error" : "complete"}`} open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary>
      <span className="tool-group-icon" aria-hidden="true"><ToolGlyph kind="group" /></span>
      <span>{label}</span>
      <span className="tool-group-chevron" aria-hidden="true" />
    </summary>
    <div className="tool-list">
      {activities.map((activity) => <ToolCard key={activity.id} activity={activity} language={language} />)}
    </div>
  </details>
}

function ToolCard({ activity, language }: { activity: ToolActivity; language: Language }) {
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    if (activity.status !== "running") return
    const update = () => setElapsed(Math.floor((Date.now() - activity.startedAt) / 1000))
    update()
    const timer = setInterval(update, 1000)
    return () => clearInterval(timer)
  }, [activity.startedAt, activity.status])
  const state = language === "zh"
    ? activity.status === "running" ? `运行中 ${elapsed}s` : activity.status === "error" ? "运行失败" : "已运行"
    : activity.status === "running" ? `Running ${elapsed}s` : activity.status === "error" ? "Failed" : "Completed"
  return <details className={`tool-row ${activity.status}`}>
    <summary>
      <span className="tool-row-icon" aria-hidden="true"><ToolGlyph kind={toolKind(activity.tool)} /></span>
      <span className="tool-row-title"><strong>{state}</strong><span>{toolLabel(activity.tool, language)}</span></span>
      {activity.result && <span className="tool-row-meta">{activity.result.durationMs}ms</span>}
      <span className="tool-row-chevron" aria-hidden="true" />
    </summary>
    <div className="tool-detail">
      <div className="tool-detail-heading"><span>{language === "zh" ? "调用详情" : "Call details"}</span><code>{activity.tool}</code></div>
      {activity.status === "running" && <div className="tool-running"><span className="spinner" />{language === "zh" ? (elapsed >= 30 ? "计算较复杂；可使用下方停止按钮终止。" : "正在等待安全工具返回…") : (elapsed >= 30 ? "This is taking longer; use Stop below to cancel." : "Waiting for the secure tool response…")}</div>}
      {activity.input !== undefined && <pre className="tool-input">{JSON.stringify(activity.input, null, 2)}</pre>}
      {activity.result && <pre>{activity.result.text}</pre>}
      {activity.error && <pre className="tool-error-message">{activity.error}</pre>}
    </div>
  </details>
}

function toolLabel(tool: string, language: Language) {
  const labelsZh: Record<string, string> = {
    integrate: "计算积分",
    diff: "计算导数",
    solve: "求解方程",
    simplify: "化简表达式",
    factor: "因式分解",
    limit: "计算极限",
    series: "计算级数",
    matrix: "执行矩阵运算",
    assume: "设置数学假设",
    eval: "计算表达式",
    numeric: "数值近似",
    statistics: "计算统计量",
    distribution: "计算概率分布",
    hypothesis: "执行假设检验",
    "plot.function2d": "绘制二维函数",
    "plot.surface3d": "绘制三维曲面",
    "geometry.construct": "构造平面几何图",
    verify: "验证符号等价性",
    "web.search": "搜索数学资料",
  }
  const labelsEn: Record<string, string> = { integrate: "Calculate integral", diff: "Calculate derivative", solve: "Solve equation", simplify: "Simplify expression", factor: "Factor expression", limit: "Calculate limit", series: "Calculate series", matrix: "Run matrix operation", assume: "Set assumptions", eval: "Evaluate expression", numeric: "Numerical approximation", statistics: "Calculate statistics", distribution: "Calculate distribution", hypothesis: "Run hypothesis test", "plot.function2d": "Plot 2D function", "plot.surface3d": "Plot 3D surface", "geometry.construct": "Construct plane geometry", verify: "Verify symbolic equivalence", "web.search": "Search math sources" }
  return (language === "zh" ? labelsZh : labelsEn)[tool] ?? tool
}

function toolKind(tool: string) {
  if (tool === "web.search") return "search"
  if (tool.startsWith("plot.") || tool.startsWith("geometry.")) return "plot"
  if (tool === "verify") return "verify"
  return "terminal"
}

function ToolGlyph({ kind }: { kind: string }) {
  if (kind === "group") return <svg viewBox="0 0 20 20" focusable="false"><path className="glyph-group-line glyph-group-line-one" d="M3.5 5.5h13" /><path className="glyph-group-line glyph-group-line-two" d="M3.5 10h13" /><path className="glyph-group-line glyph-group-line-three" d="M3.5 14.5h8" /></svg>
  if (kind === "plot") return <svg viewBox="0 0 20 20" focusable="false"><path className="glyph-plot-axis" d="M3.5 15.5h13" /><path className="glyph-plot-curve" d="M4.5 14c2.2-1.1 3.1-5.8 5.3-5.8 2.1 0 2.1 3.3 5.7-3.7" /></svg>
  if (kind === "verify") return <svg viewBox="0 0 20 20" focusable="false"><path className="glyph-verify-check" d="m4 10 3.4 3.4L16 5.5" /></svg>
  return <svg viewBox="0 0 20 20" focusable="false"><rect className="glyph-terminal-shell" x="2.75" y="3.75" width="14.5" height="12.5" rx="2" /><path className="glyph-terminal-prompt" d="m5.5 7 2.25 2-2.25 2" /><path className="glyph-terminal-cursor" d="M9.5 12h4" /></svg>
}

function VerificationCard({ verification, language }: { verification: VerificationResult; language: Language }) {
  return <details className={`verification ${verification.verified ? "verified" : "rejected"}`} open>
    <summary>{language === "zh" ? (verification.verified ? "✓ 符号验证通过" : "✗ 符号验证未通过") : (verification.verified ? "✓ Symbolic verification passed" : "✗ Symbolic verification failed")}</summary>
    <pre>{verification.evidence}</pre>
    <small>{verification.domainNote}</small>
  </details>
}

function WebSearchCard({ result, language }: { result: WebSearchResult; language: Language }) {
  return <section className="web-search-card">
    <strong>{language === "zh" ? "网络资料" : "Web sources"}</strong>
    <small>{result.query}</small>
    {result.sources.length === 0 && <p>{language === "zh" ? "没有来自允许数学来源的结果。" : "No results from allowed math sources."}</p>}
    <ol>{result.sources.map((source) => {
      const href = citationURL(source.url)
      return <li key={source.url}><a href={href} target="_blank" rel="noreferrer">{source.title}</a><span>{source.domain}</span>{source.snippet && <p>{source.snippet}</p>}</li>
    })}</ol>
  </section>
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

function ArtifactSlot({ item, colorScheme }: { item: ArtifactState; colorScheme: ColorScheme }) {
  if (item.status === "pending") return <div className="artifact-pending"><span className="spinner" />{item.title}</div>
  if (item.status === "error") return <p className="error">{item.error}</p>
  return item.artifact ? <Artifact artifact={item.artifact} colorScheme={colorScheme} /> : null
}

function ArtifactGallery({ items, colorScheme, language }: { items: ArtifactState[]; colorScheme: ColorScheme; language: Language }) {
  const [layout, setLayout] = useState<"combined" | "separate">("combined")
  const planeItems = items.filter((item) => item.status === "ready" && (item.artifact?.kind === "plotly2d" || item.artifact?.kind === "jsxgraph"))
  const otherItems = items.filter((item) => !planeItems.includes(item))
  return <>
    {planeItems.length > 1 && <div className="plot-layout-switch" role="group" aria-label={language === "zh" ? "二维图像布局" : "2D plot layout"}>
      <button type="button" className={layout === "combined" ? "active" : ""} onClick={() => setLayout("combined")}>{language === "zh" ? "叠加" : "Overlay"}</button>
      <button type="button" className={layout === "separate" ? "active" : ""} onClick={() => setLayout("separate")}>{language === "zh" ? "分图" : "Separate"}</button>
    </div>}
    {planeItems.length > 0 && layout === "combined" && <CombinedPlane artifacts={planeItems.map((item) => item.artifact!)} colorScheme={colorScheme} />}
    {layout === "separate" && planeItems.map((item) => <ArtifactSlot key={item.id} item={item} colorScheme={colorScheme} />)}
    {otherItems.map((item) => <ArtifactSlot key={item.id} item={item} colorScheme={colorScheme} />)}
  </>
}

function CombinedPlane({ artifacts, colorScheme }: { artifacts: PlotArtifact[]; colorScheme: ColorScheme }) {
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
      const palette = graphPalette(colorScheme)
      const board = JXG.JSXGraph.initBoard(element, graphBoardOptions([-extent, extent, extent, -extent], palette, true))
      const curveColors = [palette.curve, "#d14c32", "#8b5cf6", "#0d9488", "#d97706", "#db2777", "#4f46e5", "#65a30d"]
      curves.forEach((trace, index) => board.create("curve", [trace.x, trace.y], { name: trace.name ?? "函数", withLabel: true, strokeWidth: 2.5, strokeColor: curveColors[index % curveColors.length] }))
      geometry.forEach((spec) => {
        const points = new Map(spec.points.map((point) => {
          const value = board.create("point", [point.x, point.y], { name: point.id, strokeColor: palette.point, fillColor: palette.point, label: { color: palette.ink } })
          value.on("drag", () => setCoordinates(`${point.id}: (${value.X().toFixed(2)}, ${value.Y().toFixed(2)})`))
          return [point.id, value]
        }))
        spec.segments.forEach(([from, to]) => board.create("segment", [points.get(from), points.get(to)], { strokeColor: palette.segment, strokeWidth: 2 }))
        ;(spec.circles ?? []).forEach((circle) => {
          const center = board.create("point", [circle.centerX, circle.centerY], { name: `O_${circle.id}`, size: 2, strokeColor: palette.segment, fillColor: palette.canvas, label: { color: palette.ink } })
          center.on("drag", () => setCoordinates(`${circle.id} 圆心: (${center.X().toFixed(2)}, ${center.Y().toFixed(2)})`))
          board.create("circle", [center, circle.radius], { name: circle.id, withLabel: true, strokeColor: palette.circle, strokeWidth: 2, label: { color: palette.ink } })
        })
      })
      release = () => JXG.JSXGraph.freeBoard(board)
    })
    return () => release()
  }, [artifacts, colorScheme, reset])
  return <figure className="interactive combined-plane artifact-ready"><figcaption>二维函数与平面几何联合画布</figcaption><div className="plot-toolbar"><button type="button" onClick={() => setReset((value) => value + 1)}>重置视角</button><button type="button" onClick={() => void ref.current?.requestFullscreen()}>全屏</button>{coordinates && <output>{coordinates}</output>}</div><div className="interactive-plot" ref={ref} /></figure>
}

type GeometrySpec = { boundingBox: [number, number, number, number]; points: { id: string; x: number; y: number }[]; segments: [string, string][]; circles?: { id: string; centerX: number; centerY: number; radius: number }[] }

function Artifact({ artifact, colorScheme }: { artifact: PlotArtifact; colorScheme: ColorScheme }) {
  const ref = useRef<HTMLDivElement>(null)
  const [coordinates, setCoordinates] = useState("")
  const [reset, setReset] = useState(0)
  useEffect(() => {
    if (!ref.current || artifact.kind === "image2d" || typeof artifact.data === "string") return
    if (artifact.kind === "plotly2d" || artifact.kind === "plotly3d") {
      const element = ref.current
      const plotKind = artifact.kind
      void loadPlotly(plotKind).then(({ default: Plotly }) => {
        if (!element.isConnected) return
        const spec = artifact.data as { data: Plotly.Data[]; layout: Partial<Plotly.Layout> }
        return Plotly.newPlot(element, spec.data, themedPlotLayout(spec.layout, colorScheme, plotKind === "plotly3d"), { responsive: true, scrollZoom: true, displaylogo: false, modeBarButtonsToRemove: ["lasso2d", "select2d"] })
      })
      return () => { void loadPlotly(plotKind).then(({ default: Plotly }) => Plotly.purge(element)) }
    }
    const element = ref.current
    let release = () => {}
    void import("jsxgraph").then(({ default: JXG }) => {
      if (!element.isConnected) return
      const spec = artifact.data as GeometrySpec
      const palette = graphPalette(colorScheme)
      const board = JXG.JSXGraph.initBoard(element, graphBoardOptions(spec.boundingBox, palette))
      const points = new Map(spec.points.map((point) => {
        const value = board.create("point", [point.x, point.y], { name: point.id, strokeColor: palette.point, fillColor: palette.point, label: { color: palette.ink } })
        value.on("drag", () => setCoordinates(`${point.id}: (${value.X().toFixed(2)}, ${value.Y().toFixed(2)})`))
        return [point.id, value]
      }))
      spec.segments.forEach(([from, to]) => board.create("segment", [points.get(from), points.get(to)], { strokeColor: palette.segment }))
      ;(spec.circles ?? []).forEach((circle) => {
        const center = board.create("point", [circle.centerX, circle.centerY], { name: `O_${circle.id}`, size: 2, strokeColor: palette.segment, fillColor: palette.canvas, label: { color: palette.ink } })
        center.on("drag", () => setCoordinates(`${circle.id} 圆心: (${center.X().toFixed(2)}, ${center.Y().toFixed(2)})`))
        board.create("circle", [center, circle.radius], { name: circle.id, withLabel: true, strokeColor: palette.circle, strokeWidth: 2, label: { color: palette.ink } })
      })
      release = () => JXG.JSXGraph.freeBoard(board)
    })
    return () => release()
  }, [artifact, colorScheme, reset])
  if (artifact.kind === "image2d" && typeof artifact.data === "string") return <figure className="artifact-ready"><img src={artifact.data} alt="CAS 生成的二维函数图" /><figcaption>{String(artifact.meta.expression ?? "二维函数图")}</figcaption></figure>
  return <figure className="interactive artifact-ready"><div className="plot-toolbar"><button type="button" onClick={() => setReset((value) => value + 1)}>重置视角</button><button type="button" onClick={() => void ref.current?.requestFullscreen()}>全屏</button>{coordinates && <output>{coordinates}</output>}</div><div className="interactive-plot" ref={ref} /></figure>
}

function loadPlotly(kind: "plotly2d" | "plotly3d") {
  return kind === "plotly3d" ? import("plotly.js-gl3d-dist-min") : import("plotly.js-basic-dist-min")
}

function useColorScheme(preference: ThemePreference): ColorScheme {
  const [colorScheme, setColorScheme] = useState<ColorScheme>(() => window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)")
    const update = (event?: MediaQueryListEvent) => setColorScheme(preference === "system" ? ((event?.matches ?? media.matches) ? "dark" : "light") : preference)
    update()
    media.addEventListener("change", update)
    return () => media.removeEventListener("change", update)
  }, [preference])
  return colorScheme
}

function readPreference<T extends string>(key: string, fallback: T): T {
  return (localStorage.getItem(key) as T | null) ?? fallback
}

function themedPlotLayout(layout: Partial<Plotly.Layout>, colorScheme: ColorScheme, threeDimensional: boolean): Partial<Plotly.Layout> {
  const dark = colorScheme === "dark"
  const canvas = dark ? "#1c1c1e" : "#ffffff"
  const ink = dark ? "#f5f5f7" : "#1d1d1f"
  const grid = dark ? "#3a3a3c" : "#e5e5ea"
  const axis = { gridcolor: grid, linecolor: grid, zerolinecolor: dark ? "#545458" : "#c7c7cc", tickfont: { color: ink } }
  const scene = layout.scene ?? (threeDimensional ? {} : undefined)
  return {
    ...layout,
    paper_bgcolor: canvas,
    plot_bgcolor: canvas,
    font: { ...layout.font, color: ink },
    xaxis: { ...layout.xaxis, ...axis },
    yaxis: { ...layout.yaxis, ...axis },
    scene: scene ? {
      ...scene,
      bgcolor: canvas,
      xaxis: { ...scene.xaxis, ...axis },
      yaxis: { ...scene.yaxis, ...axis },
      zaxis: { ...scene.zaxis, ...axis },
    } : scene,
  }
}

function graphPalette(colorScheme: ColorScheme) {
  return colorScheme === "dark"
    ? { canvas: "#1c1c1e", ink: "#f5f5f7", grid: "#3a3a3c", curve: "#62d2a2", point: "#5ac8fa", segment: "#ffb36b", circle: "#ff9f5a" }
    : { canvas: "#ffffff", ink: "#1d1d1f", grid: "#d2d2d7", curve: "#176b58", point: "#0071e3", segment: "#9a5b2f", circle: "#c66a2b" }
}

function graphBoardOptions(boundingbox: [number, number, number, number], palette: ReturnType<typeof graphPalette>, pannable = false) {
  return {
    boundingbox,
    axis: true,
    backgroundColor: palette.canvas,
    pan: { enabled: pannable },
    zoom: { wheel: pannable, needShift: false },
    defaultAxes: {
      x: { strokeColor: palette.grid, ticks: { strokeColor: palette.grid, label: { color: palette.ink } } },
      y: { strokeColor: palette.grid, ticks: { strokeColor: palette.grid, label: { color: palette.ink } } },
    },
  }
}

function TheoryTree({ nodes, selected, onSelect }: { nodes: Record<string, TheoryNode>; selected?: string; onSelect: (id: string) => void }) {
  const root = nodes["session-root"]
  if (!root) return <p className="placeholder">发送问题后生成推导树。</p>
  const children = (node: TheoryNode) => node.children.map((id) => nodes[id]).filter((child): child is TheoryNode => Boolean(child))
  const renderNode = (node: TheoryNode): ReactNode => <li key={node.id}><button className={`theory-node ${node.status} ${selected === node.id ? "selected" : ""}`} onClick={() => onSelect(node.id)}><span>{node.status === "verified" ? "✓" : node.status === "rejected" ? "✗" : node.status === "error" ? "!" : "…"}</span>{node.title}</button>{node.children.length > 0 && <ul>{children(node).map(renderNode)}</ul>}{selected === node.id && <div className="node-detail"><p>{node.content}</p>{node.rule && <p>依据：{node.rule}</p>}{node.expression && <code>{node.expression}</code>}{node.verification && <pre>{node.verification.evidence}</pre>}{node.artifactIDs.length > 0 && <small>产物：{node.artifactIDs.join(", ")}</small>}</div>}</li>
  return <ul className="theory-tree">{children(root).map(renderNode)}</ul>
}
