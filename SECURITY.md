# Security Policy

## Supported scope

Algebrium is a development prototype intended to bind only to `127.0.0.1`.
Do not expose its backend, SageMath gateway, Qdrant, or development server to a
public network.

## Reporting a vulnerability

Please use a private GitHub Security Advisory for this repository. Include a
clear reproduction, affected version or commit, expected impact, and any safe
mitigation. Do not publish credentials, private user data, or a working exploit
in a public issue.

If private reporting is unavailable, open a minimal public issue asking for a
private contact channel without including the vulnerability details.

## Maintainer release checklist

- Enable GitHub secret scanning, push protection, and Dependabot alerts in the
  repository Security settings.
- Confirm `config.json` contains only environment-variable names, never keys.
- Do not commit `.env`, runtime databases, session files, Docker volumes, logs,
  archives, `node_modules`, `target`, or build output.
- Review the source archive produced by `scripts/package-github.ps1` before
  publishing a release.
