export type KernelOutput = { text: string; images: string[] }

export interface KernelExecutor {
  execute(sessionID: string, code: string): Promise<KernelOutput>
  interrupt?(sessionID: string): Promise<void>
  reset?(sessionID: string): Promise<void>
  dispose?(): Promise<void>
}

type Pending = {
  text: string[]
  images: string[]
  resolve(value: KernelOutput): void
  reject(error: Error): void
  timer: ReturnType<typeof setTimeout>
}

type Kernel = { id: string; socket: WebSocket; pending: Map<string, Pending>; queue: Promise<unknown> }

export class KernelGatewayClient implements KernelExecutor {
  private readonly kernels = new Map<string, Promise<Kernel>>()

  constructor(
    private readonly endpoint = process.env.ALGEBRIUM_CAS_URL ?? process.env.SIGMAFORGE_CAS_URL ?? "http://127.0.0.1:8888",
    private readonly timeout = timeoutFromEnvironment(),
  ) {}

  execute(sessionID: string, code: string) {
    const operation = this.kernels.get(sessionID) ?? this.createKernel()
    this.kernels.set(sessionID, operation)
    return operation.then((kernel) => {
      const result = kernel.queue.then(() => this.send(sessionID, kernel, code))
      kernel.queue = result.catch(() => undefined)
      return result
    })
  }

  async interrupt(sessionID: string) {
    const kernel = await this.kernels.get(sessionID)?.catch(() => undefined)
    if (!kernel) return
    await fetch(`${this.endpoint}/api/kernels/${kernel.id}/interrupt`, { method: "POST" }).catch(() => undefined)
  }

  async reset(sessionID: string) {
    const kernel = await this.kernels.get(sessionID)?.catch(() => undefined)
    if (!kernel) return
    this.kernels.delete(sessionID)
    kernel.pending.forEach((pending) => {
      clearTimeout(pending.timer)
      pending.reject(new Error("CAS execution was stopped"))
    })
    kernel.pending.clear()
    kernel.socket.close()
    await fetch(`${this.endpoint}/api/kernels/${kernel.id}`, { method: "DELETE" }).catch(() => undefined)
  }

  async dispose() {
    await Promise.all(
      [...this.kernels.values()].map(async (kernelPromise) => {
        const kernel = await kernelPromise.catch(() => undefined)
        if (!kernel) return
        kernel.socket.close()
        await fetch(`${this.endpoint}/api/kernels/${kernel.id}`, { method: "DELETE" }).catch(() => undefined)
      }),
    )
    this.kernels.clear()
  }

  private async createKernel() {
    const response = await fetch(`${this.endpoint}/api/kernels`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "sagemath" }),
    })
    if (!response.ok) throw new Error(`CAS kernel creation failed: ${response.status}`)
    const body = (await response.json()) as { id: string }
    const socketURL = `${this.endpoint.replace(/^http/, "ws")}/api/kernels/${body.id}/channels`
    const socket = new WebSocket(socketURL)
    const kernel: Kernel = { id: body.id, socket, pending: new Map(), queue: Promise.resolve() }
    socket.onmessage = (event) => this.receive(kernel, String(event.data))
    socket.onerror = () => kernel.pending.forEach((item) => item.reject(new Error("CAS kernel connection failed")))
    await new Promise<void>((resolve, reject) => {
      socket.onopen = () => resolve()
      socket.onerror = () => reject(new Error("CAS kernel connection failed"))
    })
    socket.onerror = () => kernel.pending.forEach((item) => item.reject(new Error("CAS kernel connection failed")))
    return kernel
  }

  private send(sessionID: string, kernel: Kernel, code: string) {
    const id = crypto.randomUUID()
    return new Promise<KernelOutput>((resolve, reject) => {
      const timer = setTimeout(() => {
        kernel.pending.delete(id)
        void this.reset(sessionID)
        reject(new Error("CAS execution timed out"))
      }, this.timeout)
      kernel.pending.set(id, { text: [], images: [], resolve, reject, timer })
      kernel.socket.send(
        JSON.stringify({
          header: { msg_id: id, username: "sigmaforge", session: id, msg_type: "execute_request", version: "5.3" },
          parent_header: {},
          metadata: {},
          content: { code, silent: false, store_history: true, user_expressions: {}, allow_stdin: false, stop_on_error: true },
          channel: "shell",
        }),
      )
    })
  }

  private receive(kernel: Kernel, raw: string) {
    const message = JSON.parse(raw) as {
      header?: { msg_type?: string }
      parent_header?: { msg_id?: string }
      content?: { text?: string; traceback?: string[]; execution_state?: string; data?: Record<string, string> }
    }
    const pending = kernel.pending.get(message.parent_header?.msg_id ?? "")
    if (!pending) return
    const type = message.header?.msg_type
    if (type === "stream" && message.content?.text) pending.text.push(message.content.text)
    if ((type === "execute_result" || type === "display_data") && message.content?.data?.["text/plain"])
      pending.text.push(message.content.data["text/plain"])
    if ((type === "execute_result" || type === "display_data") && message.content?.data?.["image/png"])
      pending.images.push(message.content.data["image/png"])
    if (type === "error") {
      clearTimeout(pending.timer)
      kernel.pending.delete(message.parent_header?.msg_id ?? "")
      pending.reject(new Error(summarizeCASError(message.content?.traceback)))
    }
    if (type !== "status" || message.content?.execution_state !== "idle") return
    clearTimeout(pending.timer)
    kernel.pending.delete(message.parent_header?.msg_id ?? "")
    pending.resolve({ text: pending.text.join("").trim(), images: pending.images })
  }
}

export function summarizeCASError(traceback?: string[]) {
  if (!traceback?.length) return "CAS execution failed"
  const clean = traceback.map((line) => line.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, "").trim()).filter(Boolean)
  const specific = [...clean].reverse().find((line) => /(?:SyntaxError|TypeError|ValueError|NameError|ZeroDivisionError|ArithmeticError):/.test(line))
  return `CAS execution failed: ${(specific ?? clean.at(-1) ?? "unknown error").slice(0, 500)}`
}

function timeoutFromEnvironment() {
  const value = Number(process.env.ALGEBRIUM_CAS_TIMEOUT_MS ?? process.env.SIGMAFORGE_CAS_TIMEOUT_MS ?? "45000")
  if (!Number.isFinite(value) || value < 1_000 || value > 300_000) return 90_000
  return value
}

export * as SigmaForgeKernel from "./kernel"
