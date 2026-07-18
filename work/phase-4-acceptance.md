# Phase 4 Acceptance

Date: 2026-07-16

## Delivered

- SQLite metadata schema for entries, mistakes, dependency links, and the pending-mistake inbox.
- Qdrant collection `kb_math_v1` with 1024-dimensional deterministic development embeddings.
- Read-only main-Agent operations: `kb.search`, `kb.get`, and `kb.similar`.
- Mathematics problem fingerprints, deterministic mistake attribution, prerequisite-ordered learning paths, and KB citations.
- Dedicated Curator CLI with collection, index refresh, cleanup, difficulty calibration, health, theory-graph rebuild, and pending-mistake processing commands.
- Six Windows Task Scheduler-ready Heartbeat specifications under `cron/`.
- Qdrant Docker Compose bound only to `127.0.0.1:7333`. Port 6333 is unavailable on this Windows host because it lies in an excluded port range.

## Verification

- `bun test --timeout 30000 test\sigmaforge`: 19 passed, 2 Docker-gated tests skipped, 0 failed.
- `bun run typecheck` in the OpenCode core package: passed.
- `bun test --timeout 30000` in `packages/curator`: 1 passed, 0 failed.
- Curator type check with the OpenCode workspace `tsgo`: passed.
- Qdrant `/healthz`: passed; seed collection inserted and indexed 5 entries.
- `curator health`: SQLite and Qdrant healthy, 5 entries.
- `curator graph-rebuild`: 5 dependency links generated.
- Real CLI prompt `这道题我为什么错，分部积分公式用错了`: emitted attribution, 5 KB matches, an ordered five-node learning path, and `KB:<entry-id>` citations.
- The real prompt queued one pending mistake; `curator process-mistakes` processed it and returned the pending count to zero.

## Known limits

- The offline hash embedder is deterministic and adequate for integration tests, but production retrieval requires bge-m3 or another reviewed 1024-dimensional embedding provider followed by a full index rebuild.
- Curator network collection remains intentionally disabled until source-domain allowlists and provenance review are approved.
- Heartbeat tasks are implemented as manual CLI commands but are not registered in Windows Task Scheduler yet.
- Phase 4 was accepted through the CLI because browser/Tauri debugging is deferred. Phase 5 and Phase 6 remain untouched.
