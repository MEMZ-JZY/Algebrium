# Scripts

存放可复现的 Windows PowerShell 验证与维护脚本。脚本应避免依赖 Linux 命令，并记录退出码和结构化结果。
# 本地调试脚本

在 Windows PowerShell 中启动完整 Algebrium 调试环境：

```powershell
.\scripts\start-algebrium-dev.ps1
```

脚本会启动 SageMath 与 Qdrant Docker 服务，停止占用 Algebrium 调试端口的旧进程，并分别打开后端与前端终端窗口。前端地址为 `http://127.0.0.1:5173/`，后端健康检查为 `http://127.0.0.1:4097/health`，Qdrant 为 `http://127.0.0.1:7333/healthz`。

首次使用 Phase 4 前，在 `packages/curator` 执行 `bun run curator collect`，建立 SQLite 元数据并写入 Qdrant 种子索引。

## 真实模型 Provider

根目录 `config.json` 选择当前 Provider 和模型，API Key 由配置中的 `apiKeyEnv` 指向环境变量。例如使用 DeepSeek：

```powershell
$env:DEEPSEEK_API_KEY = "your-key"
.\scripts\start-algebrium-dev.ps1
```

支持 DeepSeek、Xiaomi MiMo、Kimi、火山方舟、OpenRouter、硅基流动及自定义 OpenAI-compatible 服务。不要把 API Key 写入 `config.json` 或提交到 Git。

## CLI 前端

在后端已经运行时，从 `packages/opencode/packages/opencode` 执行：

```powershell
bun run algebrium:cli
bun run algebrium:cli -- --question "求 ∫ x e^x dx"
```

CLI 仅调用 Algebrium 的本地 HTTP/SSE 服务，不启用 OpenCode 的项目、文件、Git 或终端工具。

单次 SageMath 执行默认最多使用 45 秒；超时后会销毁对应 kernel，避免后台继续占用 CPU 和内存。需要临时调整时，在启动后端前设置 `ALGEBRIUM_CAS_TIMEOUT_MS`（有效范围为 1000–300000）。
