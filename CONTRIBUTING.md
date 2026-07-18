# Contributing to Algebrium

## Development

Use Windows PowerShell, Bun, and Docker Desktop. Start the local stack with
`./scripts/start-algebrium.ps1`; see `README.md` for prerequisites and provider
configuration. Keep all services bound to `127.0.0.1`.

Run the relevant checks before opening a pull request:

```powershell
Set-Location packages\opencode\packages\opencode; bun run typecheck; bun test
Set-Location ..\..\..\desktop; bun run build
Set-Location src-tauri; cargo check
```

## Changes and pull requests

- Add a regression test before changing behaviour.
- Keep `downloads/opencode` unchanged. Keep upstream notices and the MIT license
  in `packages/opencode` intact.
- Use concise imperative commits, for example `Add geometry artifact fallback`.
- Describe the user-visible effect, changed paths, verification commands, and
  environment assumptions. Attach screenshots for UI changes.
- Never include secrets, personal paths, runtime data, dependency folders, or
  generated archives.

Contributions to Algebrium are submitted under the Apache-2.0 terms in the root
`LICENSE`, unless a third-party component's license requires otherwise.
