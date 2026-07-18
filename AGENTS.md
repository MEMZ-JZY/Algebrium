# Repository Guidelines

## Project Structure

SigmaForge is a verifiable mathematics-agent framework. The repository is currently a Windows-first skeleton:

- `packages/` — future OpenCode-derived core, desktop UI, and Curator packages.
- `downloads/` — untouched upstream downloads; do not modify them in place.
- `docker/` — SageMath and Qdrant container definitions and operational notes.
- `data/` — local runtime data; keep generated contents untracked.
- `cron/` — heartbeat specifications and scheduling notes.
- `scripts/` — setup, validation, and maintenance scripts.
- `config/.env.example` — safe configuration template; never commit secrets.
- `提示词文件/` — prompt and agent-instruction materials.

## Build, Test, and Development

No build or test command is available yet: the repository has no package manifests or test runner configuration. During setup, verify tools with `node --version`, `npm --version`, `cargo --version`, `python --version`, and `docker version`. Use PowerShell, Docker Desktop, npm/Bun, and Cargo on Windows; avoid Linux-only package or scheduler commands. Document future commands in each package README.

## Coding Style and Naming

Use Markdown for documentation and Chinese for user-facing content. Keep TypeScript, Rust, and Python identifiers in English. Use two spaces for JSON/YAML/Markdown indentation unless a formatter says otherwise. Name TypeScript components in `PascalCase`, functions and variables in `camelCase`, Rust items and Python modules in `snake_case`. Prefer each package's configured formatter and linter.

## Testing Guidelines

Add a regression test before changing behavior. Keep tests beside the package they verify and use descriptive behavior-based names. Each phase must verify its acceptance gate, including module registration, CAS correctness, rendering fallbacks, and permission boundaries. Record the command and result.

## Commits and Pull Requests

The repository has no commit history yet, so no convention exists. Use concise imperative messages, for example `Add SubjectModule registry`. Keep commits small and phase-aligned. Pull requests should explain the goal, list changed paths, include verification results, note environment assumptions, and attach UI screenshots when relevant. Never include API keys, private paths, downloaded archives, or generated caches.

## Architecture and Security

Keep the main Agent offline and read-only against the knowledge base; only the Curator may write or access approved network resources. Run CAS workloads in a sandbox, preferably SageMath in Docker. Subject-specific behavior must enter through the `SubjectModule` contract rather than leaking into the core.
