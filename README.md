# Algebrium 项目介绍
 `本项目使用人工智能辅助编码 （GPT-5.6 Codex）`

Algebrium 是一个面向数学学习与科学计算的本地化、可验证数学智能体平台。项目结合大语言模型、计算机代数系统和交互式图形技术，为用户提供连续对话、数学推导、符号计算、步骤验证以及二维、三维和解析几何可视化能力。

## 核心特点

- 支持 DeepSeek、Kimi、Xiaomi MiMo、火山引擎、OpenRouter、硅基流动等 OpenAI 兼容模型服务。
- 使用 SageMath 执行积分、求导、方程求解、极限、化简、级数、矩阵和因式分解等数学运算。
- 对数学推导步骤进行符号验证，降低模型计算错误。
- 支持 Markdown 与 LaTeX 公式渲染。
- 支持可交互的二维函数图像、带 X-Y-Z 三轴的三维曲面图，以及平面几何图形。
- 支持流式输出、连续对话、历史会话保存、会话删除和文件上传。
- 通过 TheoryTree 记录题目、推导步骤、验证状态、CAS 证据和关联图形。
- 通过工具白名单和安全表达式校验限制文件、终端、Git 和任意网络操作。
- 支持网页端、Tauri 桌面端和命令行前端。

## 项目架构

- `packages/desktop`：React、Vite 与 Tauri 2 前端。
- `packages/opencode`：OpenCode 衍生后端及 Algebrium 数学智能体服务。
- `docker/sagemath`：SageMath CAS 沙箱与 Kernel Gateway。
- `docker/qdrant`：可选的向量数据库服务。
- `packages/curator`：知识库内容采集与索引工具。
- `scripts`：Windows PowerShell 启动、验证和发布脚本。
- `config.json`：Provider、模型和运行参数配置。

## 项目状态

Algebrium 当前处于开发原型阶段，默认仅监听 `127.0.0.1`，适合本地开发、研究和人工验收，不建议直接部署到公网或用于多用户生产环境。

项目自有代码采用 Apache-2.0 许可证。项目包含源自 OpenCode 的修改组件，其原有 MIT 许可证和版权声明保留在 `packages/opencode/LICENSE` 中。第三方组件遵循各自许可证。

---

# Algebrium Project Introduction

Algebrium is a local, verifiable mathematics-agent platform for mathematical learning and scientific computing. It combines large language models, computer algebra systems, and interactive visualization technologies to provide conversational problem solving, mathematical derivations, symbolic computation, step verification, and interactive graphics.

## Key Features

- Supports OpenAI-compatible providers such as DeepSeek, Kimi, Xiaomi MiMo, Volcengine, OpenRouter, and SiliconFlow.
- Uses SageMath for integration, differentiation, equation solving, limits, simplification, series expansion, matrix operations, and factorization.
- Verifies mathematical derivation steps symbolically to reduce model-generated calculation errors.
- Renders Markdown and LaTeX mathematical expressions.
- Provides interactive 2D function plots, 3D surfaces with X-Y-Z axes, and plane-geometry visualizations.
- Supports streaming responses, multi-turn conversations, saved sessions, session deletion, and file uploads.
- Uses TheoryTree to record problems, derivation steps, verification states, CAS evidence, and related artifacts.
- Applies tool allowlists and safe-expression validation to restrict file access, shell commands, Git operations, and arbitrary network requests.
- Provides web, Tauri desktop, and command-line frontends.

## Architecture

- `packages/desktop`: React, Vite, and Tauri 2 frontend.
- `packages/opencode`: OpenCode-derived backend and Algebrium mathematics-agent services.
- `docker/sagemath`: SageMath CAS sandbox and Kernel Gateway.
- `docker/qdrant`: Optional vector database service.
- `packages/curator`: Knowledge-base collection and indexing utilities.
- `scripts`: Windows PowerShell startup, validation, and release scripts.
- `config.json`: Provider, model, and runtime configuration.

## Project Status

Algebrium is currently an active development prototype. It binds to `127.0.0.1` by default and is intended for local development, research, and manual acceptance testing. It should not be exposed directly to the public Internet or used as a production multi-user service without additional hardening.

Algebrium-owned code is licensed under Apache-2.0. The project includes modified components derived from OpenCode; the original MIT license and copyright notices are preserved in `packages/opencode/LICENSE`. Third-party components remain subject to their respective licenses.
# Algebrium 使用说明

Algebrium 是一个 Windows 优先的本地数学智能体。它将 React 网页/桌面界面、OpenCode 衍生的 HTTP/SSE 后端、Docker 中隔离运行的 SageMath，以及可选的大模型 Provider 组合在一起。它可进行受限 CAS 计算、符号步骤验证，以及二维、三维和解析几何图形渲染。

> 当前为开发原型，仅监听本机 `127.0.0.1`，不应直接暴露到公网或作为多用户服务使用。

## 项目组成

| 模块 | 位置 | 作用 |
| --- | --- | --- |
| 网页与桌面界面 | `packages/desktop` | React/Vite 聊天界面、KaTeX、Plotly、JSXGraph、会话与图形展示。 |
| 智能体后端 | `packages/opencode/packages/opencode/src/sigmaforge` | Algebrium 的本地 HTTP/SSE 服务、模型编排、权限、TheoryTree、会话保存和 CAS 调度。 |
| CAS 沙箱 | `docker/sagemath` | SageMath Kernel Gateway，仅通过本机回环地址提供服务。 |
| 知识库工具 | `packages/curator` | 可选的本地 SQLite/Qdrant 内容采集与索引。 |

## 所需环境

- Windows 10/11、PowerShell 7（pwsh）；未安装时执行 `winget install --id Microsoft.PowerShell --source winget`。
- [Docker Desktop](https://www.docker.com/products/docker-desktop/)（Linux containers 模式），建议至少预留 4 GB 内存；Docker 引擎未运行时启动脚本会自动拉起 Docker Desktop 并等待就绪。
- [Bun](https://bun.sh/) 1.2 或更高版本；未安装时启动脚本会自动安装（官方安装脚本失败时回退 `npm install -g bun`）。
- Git；建议安装 Node.js 20+ 以满足周边工具需求。
- 只有运行 Tauri 桌面壳时才需要 Rust stable 与 Microsoft C++ Build Tools。
- 一个已配置 Provider 的 API Key；也可用 mock 模式离线验收。

## 快速启动（网页端）

```powershell
git clone https://github.com/MEMZ-JZY/Algebrium.git Algebrium
Set-Location Algebrium
.\scripts\start-algebrium.cmd
```

也可以直接双击仓库根目录的 `Start Algebrium.cmd`。首次启动时脚本会自动安装 Bun、安装前后端依赖、构建并启动 SageMath/Qdrant/SearXNG Docker 服务（首次构建镜像耗时较长），然后显示 Provider 选择菜单：用方向键选择服务商，按提示输入 API Key（输入内容隐藏）。可选择将密钥保存到仓库根目录的 `.env`（已被 Git 忽略），下次启动自动使用、无需重输；已保存时按 Enter 即可保留，也可输入新密钥替换。

打开 `http://127.0.0.1:5173/`，确认 `http://127.0.0.1:4097/health` 返回 `{"ok":true}`，然后可输入 `求 ∫ x e^x dx` 进行验收。Docker 已健康时可使用 `.\scripts\start-algebrium-dev.ps1 -SkipDocker`。关闭任一启动的终端窗口会停止相应开发服务。

停止容器：

```powershell
docker compose -f docker\sagemath\compose.yaml down
docker compose -f docker\qdrant\compose.yaml down
```

## 模型 Provider 配置

只修改根目录 `config.json` 的非敏感字段：设置 `provider.active`，再填写该平台控制台中显示的准确模型 ID。内置 DeepSeek、小米 MiMo、Kimi、火山方舟、OpenRouter、硅基流动的预设。

API Key 有三种配置方式：启动时交互输入并按提示保存到本地 `.env`；或手动复制 `.env.example` 为 `.env` 并填入对应变量（如 `DEEPSEEK_API_KEY=...`）；或仅在当前会话设置环境变量：

```powershell
$env:DEEPSEEK_API_KEY = "your-key"
.\scripts\start-algebrium-dev.ps1
```

Shell 环境变量优先于 `.env` 文件。若所选 Provider 的密钥缺失，启动脚本会直接报错并给出修复指引，而不会拉起注定失败的后端窗口。也可将 `provider.mode` 设为 `mock`，或后端加 `--mock-provider`，用于不消耗 API 额度的固定流程测试。完整字段说明见 [config/README.md](config/README.md)。绝不要提交 `.env`、API Key、本地数据库或会话文件。

## 单独运行各部分

仅启动后端（进入 `packages/opencode/packages/opencode`）：

```powershell
bun install
bun run algebrium -- --port 4097 --config ..\..\..\..\config.json
```

仅启动网页前端（进入 `packages/desktop`）：

```powershell
bun install
bun run dev
```

后端运行后可使用 CLI：

```powershell
Set-Location packages\opencode\packages\opencode
bun run algebrium:cli -- --question "求 ∫ x e^x dx"
```

如需 Tauri 桌面端，先启动 Docker 沙箱，再在 `packages/desktop` 中执行 `bun install`、`bun run tauri dev`。

## 检查、调试与测试

```powershell
Invoke-WebRequest http://127.0.0.1:4097/health
docker compose -f docker\sagemath\compose.yaml ps
docker stats algebrium-cas algebrium-cas-gateway
```

源码修改后，需重启后端与前端。单次 CAS 默认最多 45 秒，超时会销毁 Sage kernel，避免继续占用 CPU/内存。图形任务卡住时，可执行 `docker compose -f docker\sagemath\compose.yaml restart`，再用更小的定义域重试。

发布前建议运行：

```powershell
Set-Location packages\opencode\packages\opencode; bun run typecheck; bun test
Set-Location ..\..\..\desktop; bun run build
Set-Location src-tauri; cargo check
```

## GitHub 发布

`downloads/opencode` 是上游参考副本，保持不改动；Algebrium 的 OpenCode 衍生扩展位于 `packages/opencode`。根目录 [LICENSE](LICENSE) 仅将 Apache-2.0 用于 Algebrium 自有内容；OpenCode 仍采用 MIT，详见 [NOTICE.md](NOTICE.md)、[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) 与 [packages/opencode/LICENSE](packages/opencode/LICENSE)。Algebrium 并非 OpenCode 官方项目。

使用以下命令生成可发布的源码压缩包：

```powershell
.\scripts\package-github.ps1
```

脚本会在 `output/` 生成带时间戳的 Algebrium ZIP，自动排除 Git 元数据、`node_modules`、构建缓存、Docker/运行数据、下载压缩包、日志及本地环境文件。发布前请按 [SECURITY.md](SECURITY.md) 在 GitHub 开启 Secret Scanning、Push Protection 与 Dependabot Alerts。

# Algebrium

Algebrium is a Windows-first, local mathematics agent. It combines a React web/desktop interface, an OpenCode-derived HTTP/SSE backend, SageMath in Docker for verifiable symbolic computation, and optional OpenAI-compatible model providers. It can explain calculations, call constrained CAS tools, verify symbolic steps, and render 2D, 3D, and plane-geometry artifacts.

> Status: an active development prototype. Keep it on `127.0.0.1`; it is not a multi-user or Internet-facing service.

## Architecture

| Part | Path | Responsibility |
| --- | --- | --- |
| Web and desktop UI | `packages/desktop` | React/Vite chat UI, KaTeX, Plotly, JSXGraph, sessions, and artifacts. |
| Agent backend | `packages/opencode/packages/opencode/src/sigmaforge` | Algebrium's local HTTP/SSE server, provider orchestration, permissions, TheoryTree, persistence, and CAS requests. |
| CAS sandbox | `docker/sagemath` | SageMath Kernel Gateway, isolated in Docker and published only on loopback. |
| Knowledge tooling | `packages/curator` | Optional local SQLite/Qdrant content collection. |

## Requirements

- Windows 10/11 and PowerShell 7 (pwsh); install with `winget install --id Microsoft.PowerShell --source winget` if missing.
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) using Linux containers, with at least 4 GB RAM available; the launcher starts Docker Desktop automatically when the engine is not running.
- [Bun](https://bun.sh/) 1.2+; the launcher installs it automatically when missing (falling back to `npm install -g bun`).
- Git for source control. Node.js 20+ is recommended for tooling.
- Rust stable plus Microsoft C++ Build Tools only when running the Tauri desktop shell.
- An API key for one configured provider, or mock mode for offline testing.

## Quick start (web UI)

```powershell
git clone https://github.com/MEMZ-JZY/Algebrium.git Algebrium
Set-Location Algebrium
.\scripts\start-algebrium.cmd
```

Double-clicking `Start Algebrium.cmd` in the repository root works as well. On first launch the script installs Bun, installs frontend and backend dependencies, builds and starts the SageMath/Qdrant/SearXNG Docker services (the first image build takes a while), then shows the provider menu: pick a provider with the arrow keys and enter its API key (input hidden). You can save the key to the git-ignored root `.env` so later starts pick it up automatically; when a key is already configured, press Enter to keep it or type a replacement.

Open `http://127.0.0.1:5173/`, wait for `http://127.0.0.1:4097/health` to return `{"ok":true}`, then ask a question such as `求 ∫ x e^x dx`.

Use `.\scripts\start-algebrium-dev.ps1 -SkipDocker` after Docker is already healthy. Closing either spawned terminal stops that development service. Stop containers with:

```powershell
docker compose -f docker\sagemath\compose.yaml down
docker compose -f docker\qdrant\compose.yaml down
```

## Provider configuration

Edit only the non-secret fields in root `config.json`: select `provider.active`, then set the provider model ID. Presets are included for DeepSeek, Xiaomi MiMo, Kimi, Volcengine Ark, OpenRouter, and SiliconFlow.

Configure the API key in one of three ways: enter it at startup and accept the prompt to save it to the local `.env`; copy `.env.example` to `.env` and fill in the matching variable (for example `DEEPSEEK_API_KEY=...`); or set it for the current session only:

```powershell
$env:DEEPSEEK_API_KEY = "your-key"
.\scripts\start-algebrium-dev.ps1
```

Shell environment variables take precedence over `.env`. When the selected provider has no key, the launcher fails fast with instructions instead of spawning a backend window that dies instantly. For deterministic local testing, set `provider.mode` to `mock`, or start the backend with `--mock-provider`. See [config/README.md](config/README.md) for every profile field. Do not commit `.env`, API keys, local databases, or session files.

## Other ways to run

Run only the backend (from `packages/opencode/packages/opencode`):

```powershell
bun install
bun run algebrium -- --port 4097 --config ..\..\..\..\config.json
```

Run only the browser UI (from `packages/desktop`):

```powershell
bun install
bun run dev
```

Use the terminal client while the backend is running:

```powershell
Set-Location packages\opencode\packages\opencode
bun run algebrium:cli -- --question "求 ∫ x e^x dx"
```

For the Tauri shell, first start the Docker sandbox, then run `bun install` and `bun run tauri dev` in `packages/desktop`.

## Verification and troubleshooting

```powershell
Invoke-WebRequest http://127.0.0.1:4097/health
docker compose -f docker\sagemath\compose.yaml ps
docker stats algebrium-cas algebrium-cas-gateway
```

The backend and frontend must be restarted after source changes. A CAS task is limited to 45 seconds; on timeout its Sage kernel is destroyed so it cannot retain CPU or memory. If a plot remains slow, restart the Sage stack with `docker compose -f docker\sagemath\compose.yaml restart` and retry a simpler range.

Run checks before contributing:

```powershell
Set-Location packages\opencode\packages\opencode; bun run typecheck; bun test
Set-Location ..\..\..\desktop; bun run build
Set-Location src-tauri; cargo check
```

## Repository and release hygiene

`downloads/opencode` is an untouched upstream reference; Algebrium's OpenCode-derived work lives under `packages/opencode`. The root [LICENSE](LICENSE) applies Apache-2.0 to Algebrium-owned code only. OpenCode remains MIT-licensed; see [NOTICE.md](NOTICE.md), [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md), and [packages/opencode/LICENSE](packages/opencode/LICENSE). Algebrium is independent and is not an official OpenCode project.

Create a GitHub-safe source archive with:

```powershell
.\scripts\package-github.ps1
```

It writes a timestamped Algebrium ZIP to `output/` and excludes Git metadata, dependency folders, build output, Docker/runtime data, downloaded archives, logs, and local environment files. Before publishing, enable GitHub secret scanning, push protection, and Dependabot alerts as described in [SECURITY.md](SECURITY.md).
