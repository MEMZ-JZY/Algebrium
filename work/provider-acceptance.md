# Real Provider Acceptance

Date: 2026-07-16

## Delivered

- Repository-root `config.json` with selectable profiles for DeepSeek, Xiaomi MiMo, Kimi, Volcengine Ark, OpenRouter, SiliconFlow, and custom OpenAI-compatible APIs.
- Strict configuration validation for provider, model, base URL, token limits, timeout, headers, and extra request fields.
- API keys are resolved only through the configured environment-variable name. Literal `Authorization` headers are rejected.
- OpenAI-compatible Chat Completions streaming adapter with partial transport-frame handling, provider HTTP errors, request timeout, empty-response detection, and ordered SigmaForge SSE forwarding.
- Health output reports mock/real mode plus active provider and model without exposing credentials.
- `--mock-provider` remains an explicit offline test override.

## Verification

- SigmaForge suite: 24 passed, 2 Docker-gated tests skipped, 0 failed.
- OpenCode core type check: passed.
- Local OpenAI-compatible test server verified model, Bearer authentication, streaming chunks, and split-frame parsing.
- SigmaForge service test verified real-provider chunks reach the session SSE stream and are saved as the assistant response.
- Offline startup with `--mock-provider`: passed; CLI question completed.
- Real startup without the active key: failed immediately with `Provider API key is missing: set DEEPSEEK_API_KEY`, as intended.

## External acceptance pending

No paid external request was sent because no provider credential was supplied. Final provider-specific acceptance requires the user to select a profile, set its environment variable, start the service, and send one low-cost CLI prompt.

## Tool orchestration extension

- OpenAI-compatible streamed `tool_calls` are assembled across transport chunks.
- The real Provider receives only the active SubjectModule's approved tools. Mathematics exposes 10 constrained CAS tools, symbolic verification, and 2D PNG plotting; the physics stub exposes none.
- Tool arguments are parsed as JSON and then pass through the existing Zod schemas, expression safety checks, and SubjectModule policy.
- Tool outputs are returned with OpenAI `role: tool` messages for the next model turn while ordered SSE events update the CLI and desktop.
- A maximum of six tool rounds prevents unbounded Provider loops; unknown and disabled tools fail explicitly.
- Automated orchestration tests cover CAS, verification, plotting, final response, split tool-call arguments, and rejection of a fabricated Bash tool.
- Regression: 27 passed, 2 Docker-gated tests skipped, 0 failed; core type check passed. Docker integration: 2 passed, 0 failed.
