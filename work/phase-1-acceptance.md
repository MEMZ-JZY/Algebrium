# Phase 1 Acceptance Record

## Scope

Phase 1 adds the SigmaForge subject-module boundary, an allowlist-only tool policy, an offline mock streaming service, and a separate Tauri 2 + React desktop shell. Existing OpenCode editor modules remain present but are not exposed by the SigmaForge entrypoint.

The untouched upstream baseline remains in `downloads/opencode`. All OpenCode-derived changes are limited to the working copy under `packages/opencode`.

## Commands

Run from `packages/opencode/packages/opencode`:

```powershell
bun test --timeout 30000 test/sigmaforge
bun typecheck
bun run sigmaforge --mock-provider
```

Run from `packages/desktop`:

```powershell
bun install --registry https://registry.npmjs.org
bun run build
cargo check --manifest-path src-tauri\Cargo.toml
bun run tauri dev
```

## Results

- SigmaForge unit/integration tests: 6 passed, 0 failed.
- OpenCode core typecheck: passed.
- React production build: passed.
- The streaming integration test creates a math session, posts `什么是导数`, verifies ordered SSE chunks, and observes the terminal `done` event.
- Rust/Tauri check: passed after the initial crates.io dependency download; subsequent verification runs offline.

## Known Limits

- Session state is process-local during Phase 1. Durable persistence will be connected to the retained OpenCode Session subsystem when real providers are enabled.
- The mock provider is the Phase 1 acceptance provider. Real-provider configuration is intentionally deferred.
- CAS, rendering, knowledge retrieval, TheoryTree, and Curator are outside Phase 1.

## Phase 2 Readiness Check (2026-07-16)

- Phase 1 regression: 6 SigmaForge tests passed; core typecheck, React build, and Tauri `cargo check --offline` passed.
- Docker readiness: blocked because Docker Desktop Linux engine is not running (`docker info` cannot connect to `dockerDesktopLinuxEngine`).
- Phase 2 implementation status: CAS kernel bridge, CAS tools, plotting tools, and render dependencies have not yet been added; this is expected before Phase 2 development, not a Phase 1 failure.
- Decision: approved to start Phase 2 implementation after starting Docker Desktop. CAS/Qdrant integration acceptance must wait until the daemon is available.
