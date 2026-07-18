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

- Windows 10/11 and PowerShell 5.1+.
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) using Linux containers, with at least 4 GB RAM available.
- [Bun](https://bun.sh/) 1.2+ (the launch script also detects the standard npm-installed Bun location).
- Git for source control. Node.js 20+ is recommended for tooling.
- Rust stable plus Microsoft C++ Build Tools only when running the Tauri desktop shell.
- An API key for one configured provider, or mock mode for offline testing.

## Quick start (web UI)

```powershell
git clone <YOUR_GITHUB_REPOSITORY_URL> Algebrium
Set-Location Algebrium
docker compose -f docker\sagemath\compose.yaml build
.\scripts\start-algebrium.ps1
```

The launcher securely prompts for the active profile's API key for the current PowerShell session; it never writes the key to `config.json`. It starts Docker services plus separate backend and frontend windows. Open `http://127.0.0.1:5173/`, wait for `http://127.0.0.1:4097/health` to return `{"ok":true}`, then ask a question such as `求 ∫ x e^x dx`.

Use `.\scripts\start-algebrium.ps1 -SkipDocker` after Docker is already healthy. Closing either spawned terminal stops that development service. Stop containers with:

```powershell
docker compose -f docker\sagemath\compose.yaml down
docker compose -f docker\qdrant\compose.yaml down
```

## Provider configuration

Edit only the non-secret fields in root `config.json`: select `provider.active`, then set the provider model ID. Presets are included for DeepSeek, Xiaomi MiMo, Kimi, Volcengine Ark, OpenRouter, and SiliconFlow. Put the matching key only in the current session:

```powershell
$env:DEEPSEEK_API_KEY = "your-key"
.\scripts\start-algebrium-dev.ps1
```

For deterministic local testing, set `provider.mode` to `mock`, or start the backend with `--mock-provider`. See [config/README.md](config/README.md) for every profile field. Do not commit `.env`, API keys, local databases, or session files.

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
