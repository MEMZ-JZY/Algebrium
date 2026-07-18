# Phase 0 Environment Record

Date: 2026-07-15
Platform: Windows

## Verified

- Working directory: `C:\Users\memzb\Documents\AIgebra Agent`
- Node.js: `v24.13.0`
- npm: `11.6.2`
- Bun: `1.3.14` (installed under the user npm prefix)
- Rust/Cargo: `1.96.0`
- Python: `3.12.8`
- Git: `2.53.0.windows.2`
- uv: `0.11.28`
- Docker Desktop: installed and running; Docker Engine `29.6.1`
- Docker smoke test: `docker run --rm hello-world` passed
- Repository skeleton: `config/`, `cron/`, `data/`, `docker/`, `downloads/`, `outputs/`, `packages/`, `scripts/`, and `work/` present

## Source Baseline

- SageMath and Qdrant images were pulled and passed minimal container checks.
- The initial OpenCode download was incomplete and was removed after the verified replacement succeeded.
- The user-provided `提示词文件/opencode-dev.zip` has replaced the Gitee mirror fallback in `downloads/opencode/`.
- The ZIP archive passed a full listing check and extraction. The extracted source has 6,278 files, `bun.lock`, all declared Bun workspace paths, and the key SDK, Slack, Stats, console, and asset paths.
- GitHub ZIP archives intentionally contain no `.git` metadata, so this source baseline cannot be identified by a local commit hash without separately initializing or fetching Git metadata.

## Phase 0 Acceptance Checks

- Docker client and server both report `29.6.1`.
- SageMath passed `integrate(x^2, x)` with result `1/3*x^3`.
- Qdrant passed `GET /healthz`.
- OpenCode dependency installation was attempted with `bun install --frozen-lockfile` against both the configured mirror and the official npm registry. The official registry resolved 35 packages, then failed because the GitHub tarball dependency `ghostty-web@github:anomalyco/ghostty-web#513463a6f1190253057e8a3f0dac8f6ee8393553` was refused.
- This dependency initially blocked Phase 0; the verified local copy and completion results are recorded below.

## Phase 0 Completion

- The user-provided Ghostty ZIP was verified, extracted to `packages/opencode/vendor/ghostty-web/`, and used only by the Phase 1 work copy.
- `downloads/opencode/` remains the untouched GitHub ZIP source baseline.
- `packages/opencode/` is a working copy. Its `packages/app/package.json` resolves `ghostty-web` through `file:../../vendor/ghostty-web`; `bun install` completed with 4,763 packages and updated the work-copy `bun.lock`.
- `bun run --cwd packages/opencode --conditions=browser src/index.ts --version` completed successfully and returned `local`.
- Phase 0 acceptance gates are complete. Phase 1 may begin from `packages/opencode/`.

## Next Verification Commands

```powershell
$env:Path = "C:\Program Files\Docker\Docker\resources\bin;$env:Path"
docker image ls sagemath/sagemath qdrant/qdrant
docker run --rm sagemath/sagemath:latest sage -c "print(2+2)"
docker run --rm qdrant/qdrant:latest --version
```
