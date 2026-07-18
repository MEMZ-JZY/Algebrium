# Algebrium Desktop

Tauri 2 + React desktop shell for Algebrium. It connects only to the local Algebrium service at `127.0.0.1:4097` and renders Markdown, KaTeX, CAS evidence, plot artifacts, and TheoryTree data. Development uses `http://localhost:5173` because port 1420 is reserved on the target Windows environment.

Start the sandbox from the repository root first:

```powershell
docker compose -f docker\sagemath\compose.yaml up -d --no-build
```

```powershell
bun install
bun run build
bun run tauri dev
```

`tauri dev` starts and stops the deterministic headless service with the application. Run `bun run algebrium --mock-provider` from `packages/opencode/packages/opencode` when developing the frontend without Tauri.
