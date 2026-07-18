# Third-Party Notices

This file records the direct third-party components used by Algebrium at the
time of publication. Complete JavaScript dependency resolution is recorded in
the Bun lockfiles; Rust resolution is recorded in `packages/desktop/src-tauri/Cargo.lock`.
Do not remove upstream license files when redistributing source or binaries.

| Component | Version used or declared | Source | License |
| --- | --- | --- | --- |
| OpenCode | 1.18.2 | https://github.com/anomalyco/opencode | MIT; preserved in `packages/opencode/LICENSE` |
| SageMath | 10.9 derived image | https://www.sagemath.org/ | GPLv3+; run as an external Docker service |
| Qdrant | Docker image selected by `docker/qdrant/compose.yaml` | https://github.com/qdrant/qdrant | Apache-2.0 |
| React | 18.3.1 | https://github.com/facebook/react | MIT |
| Vite | 6.0.5 | https://github.com/vitejs/vite | MIT |
| KaTeX | 0.16.22 | https://github.com/KaTeX/KaTeX | MIT |
| Plotly.js | 3.0.1 | https://github.com/plotly/plotly.js | MIT |
| JSXGraph | 1.11.1 | https://github.com/jsxgraph/jsxgraph | MIT or LGPL-3.0-or-later |
| Tauri | 2.x | https://github.com/tauri-apps/tauri | MIT or Apache-2.0 |
| Bun | 1.2+ runtime requirement | https://github.com/oven-sh/bun | MIT |

Docker images are pulled separately and are not included in the Git repository.
Before distributing a binary or image, record the exact image digest and review
the component licenses shipped in that distribution. This notice is an
engineering record, not legal advice.
