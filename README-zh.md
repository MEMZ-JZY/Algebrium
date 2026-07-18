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

- Windows 10/11、PowerShell 5.1 或更高版本。
- [Docker Desktop](https://www.docker.com/products/docker-desktop/)（Linux containers 模式），建议至少预留 4 GB 内存。
- [Bun](https://bun.sh/) 1.2 或更高版本；启动脚本也会检测 npm 标准目录中的 Bun。
- Git；建议安装 Node.js 20+ 以满足周边工具需求。
- 只有运行 Tauri 桌面壳时才需要 Rust stable 与 Microsoft C++ Build Tools。
- 一个已配置 Provider 的 API Key；也可用 mock 模式离线验收。

## 快速启动（网页端）

```powershell
git clone <你的_GitHub_仓库地址> Algebrium
Set-Location Algebrium
docker compose -f docker\sagemath\compose.yaml build
.\scripts\start-algebrium.ps1
```

首次启动脚本会安全地提示输入当前 Provider 的 API Key，仅写入本次 PowerShell 进程，不会写入 `config.json`。脚本会启动 Docker 服务，以及独立的后端和前端终端窗口。

打开 `http://127.0.0.1:5173/`，确认 `http://127.0.0.1:4097/health` 返回 `{"ok":true}`，然后可输入 `求 ∫ x e^x dx` 进行验收。Docker 已健康时可使用 `.\scripts\start-algebrium.ps1 -SkipDocker`。关闭任一启动的终端窗口会停止相应开发服务。

停止容器：

```powershell
docker compose -f docker\sagemath\compose.yaml down
docker compose -f docker\qdrant\compose.yaml down
```

## 模型 Provider 配置

只修改根目录 `config.json` 的非敏感字段：设置 `provider.active`，再填写该平台控制台中显示的准确模型 ID。内置 DeepSeek、小米 MiMo、Kimi、火山方舟、OpenRouter、硅基流动的预设。

```powershell
$env:DEEPSEEK_API_KEY = "your-key"
.\scripts\start-algebrium-dev.ps1
```

也可将 `provider.mode` 设为 `mock`，或后端加 `--mock-provider`，用于不消耗 API 额度的固定流程测试。完整字段说明见 [config/README.md](config/README.md)。绝不要提交 `.env`、API Key、本地数据库或会话文件。

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
