# Provider configuration

Edit the repository-root `config.json` to choose a provider profile and model. `provider.mode` is `real` for an external API and `mock` only for deterministic local tests. Set `provider.active` to one key under `provider.profiles`.

Each profile supports:

- `provider`: `deepseek`, `mimo`, `kimi`, `volcengine`, `openrouter`, `siliconflow`, or `custom`.
- `model`: the exact model or Ark endpoint ID shown by the provider console.
- `apiKeyEnv`: environment-variable name containing the key.
- `baseURL`: optional override; required for `custom`.
- `temperature`, `maxTokens`, `timeoutMs`, `headers`, and `extraBody`: optional request settings.

Do not place a key in `config.json`. In PowerShell, set only the active provider key before starting Algebrium:

```powershell
$env:DEEPSEEK_API_KEY = "your-key"
.\scripts\start-algebrium-dev.ps1
```

To test without external API billing, either set `provider.mode` to `mock` or start the backend with `--mock-provider`. A different config file can be selected with `--config C:\path\to\config.json` or `ALGEBRIUM_CONFIG`.

Provider presets use OpenAI-compatible endpoints. Model IDs change over time; copy the exact current ID from the corresponding provider console when a preset model is unavailable.
