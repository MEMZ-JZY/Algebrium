# Phase 2 Acceptance Record

## Scope

Phase 2 adds a sandboxed SageMath 10.9 Kernel Gateway, ten validated CAS tools, symbolic step verification, ordered tool and artifact SSE events, 2D PNG plotting, Plotly/JSXGraph artifact contracts, and KaTeX/Markdown rendering. The untouched baseline under `downloads/opencode` was not modified.

## Deployment

From the repository root:

```powershell
$env:DOCKER_BUILDKIT = "0"
docker build --pull=false -t sigmaforge/sagemath-kernel:10.9 docker\sagemath
docker compose -f docker\sagemath\compose.yaml up -d --no-build
docker compose -f docker\sagemath\compose.yaml ps
```

The CAS container has a read-only root, memory-only Sage/Jupyter directories, CPU and memory limits, and only an internal Docker network. A trusted TCP sidecar publishes `127.0.0.1:8888` without giving CAS code an external route.

## Verification Results

From `packages/opencode/packages/opencode`:

```powershell
bun test --timeout 30000 test\sigmaforge
bun typecheck
$env:SIGMAFORGE_CAS_INTEGRATION = "1"
bun test --timeout 90000 test\sigmaforge\kernel.integration.test.ts
bun test --timeout 90000 test\sigmaforge\server.integration.test.ts
```

- Unit and HTTP tests: 10 passed, 0 failed; 2 Docker tests skip unless explicitly enabled.
- Kernel integration passed `2+2`, state reuse, cross-session isolation, integration, symbolic derivative verification, and PNG output.
- End-to-end integration produced `(x - 1)*e^x`, successful verification, a real `image2d` artifact, and `done` in order.
- OpenCode SigmaForge typecheck passed.

From `packages/desktop`:

```powershell
bun run build
cargo fmt --manifest-path src-tauri\Cargo.toml -- --check
cargo check --offline --manifest-path src-tauri\Cargo.toml
```

- React production build passed.
- Tauri Rust formatting and check passed.

## Known Limits

- Real-provider orchestration remains deferred; the deterministic provider invokes real CAS, verifier, and plot services for the acceptance problem.
- Kernel state is process-local; durable `.sobj` persistence is deferred.
- Plotly and JSXGraph are bundled eagerly, producing a roughly 6.37 MB JavaScript chunk. Lazy loading is a Phase 3 optimization.
- 3D and geometry provide render contracts and desktop renderers; advanced interactions remain Phase 3 work.
- Docker integration tests must run serially under the configured two-CPU CAS limit.
