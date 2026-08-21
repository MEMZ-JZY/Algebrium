# Scripts

存放可复现的 Windows PowerShell 验证与维护脚本。脚本应避免依赖 Linux 命令，并记录退出码和结构化结果。
# 本地调试脚本

推荐通过 PowerShell 7 启动完整 Algebrium 调试环境：

```bat
.\scripts\start-algebrium.cmd
```

也可以直接双击仓库根目录的 `Start Algebrium.cmd`（一键入口，内部转发到上面的命令并支持 `-SkipDocker` 等参数）。

## 环境变量与 .env

启动脚本会在启动前自动加载仓库根目录的 `.env`（不存在则跳过），用于在新设备上一次性配置密钥：复制 `.env.example` 为 `.env` 并填入对应 Provider 的 API Key 即可，无需每次手动输入。Shell 中已存在的环境变量优先于 `.env` 中的值；交互式提示在密钥已配置时会自动跳过。若所选 Provider 的密钥仍未配置，启动会继续但打印黄色警告，模型请求会失败。不要把真实密钥提交到 Git（`.env` 已被 `.gitignore` 忽略）。

新设备首次启动时脚本还会：自动安装 Bun（优先官方安装脚本，失败时回退 `npm install -g bun`）、在 `packages/desktop` 与 `packages/opencode` 缺少 `node_modules` 时执行 `bun install`、检测到 Docker 引擎未运行时自动拉起 Docker Desktop 并等待就绪（最多 5 分钟）。Docker Desktop 或 PowerShell 7 未安装时脚本会给出明确的安装指引后退出。

该入口固定使用 `pwsh.exe`，随后通过两个独立的 CMD 调试窗口运行后端和前端，避免 Windows PowerShell 5.1 及子 PowerShell 动态命令触发第三方 AMSI 模块崩溃。

脚本会先显示 `config.json` 中的 Provider 列表和 `custom` 选项（并标注哪些已配置密钥），可使用上下方向键选择、按 Enter 确认，然后安全输入（隐藏回显）该 Provider 的 API Key：已配置时按 Enter 保留或输入新密钥替换，新输入的密钥可按提示保存到仓库根目录 `.env`（已被 Git 忽略）供以后启动自动使用，同时记录所选 Provider。选择 `custom` 时还会输入 OpenAI-compatible API base URL 和模型 ID，同样支持保留与保存。选择和密钥不会写回 `config.json`。脚本随后启动 SageMath 与 Qdrant Docker 服务，停止占用 Algebrium 调试端口的旧进程，并分别打开后端与前端终端窗口。前端地址为 `http://127.0.0.1:5173/`，后端健康检查为 `http://127.0.0.1:4097/health`，Qdrant 为 `http://127.0.0.1:17333/healthz`（7333 落在 Windows/Hyper-V 常见保留端口段内，故宿主端口使用 17333）。

首次使用 Phase 4 前，在 `packages/curator` 执行 `bun run curator collect`，建立 SQLite 元数据并写入 Qdrant 种子索引。

## 真实模型 Provider

根目录 `config.json` 提供 Provider 和模型列表。启动 `start-algebrium.ps1` 时可交互选择 Provider，API Key 由所选配置中的 `apiKeyEnv` 指向环境变量。也可以手动设置该环境变量后直接启动开发脚本：

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
