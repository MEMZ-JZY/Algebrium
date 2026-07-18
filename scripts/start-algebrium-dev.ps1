[CmdletBinding()]
param(
  [switch]$SkipDocker
)

$root = Split-Path -Parent $PSScriptRoot
$bun = @(
  (Get-Command bun -ErrorAction SilentlyContinue).Source,
  (Join-Path $env:LOCALAPPDATA "npm\node_modules\bun\bin\bun.exe")
) | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1

if (-not $bun) { throw "Bun was not found. Install Bun or add bun.exe to PATH." }

if (-not $SkipDocker) {
  & docker compose -f (Join-Path $root "docker\sagemath\compose.yaml") up -d --no-build
  if ($LASTEXITCODE -ne 0) { throw "SageMath Docker startup failed." }
  & docker compose -f (Join-Path $root "docker\qdrant\compose.yaml") up -d --no-build
  if ($LASTEXITCODE -ne 0) { throw "Qdrant Docker startup failed." }
}

function Stop-Listener([int]$Port) {
  Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
    ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
}

function Start-AlgebriumTerminal([string]$Title, [string]$Directory, [string]$Command) {
  Start-Process powershell -WorkingDirectory $Directory -ArgumentList @(
    "-NoExit", "-Command", "`$Host.UI.RawUI.WindowTitle = '$Title'; $Command"
  )
}

Stop-Listener 4097
Stop-Listener 5173

$database = Join-Path $root "data\algebrium.db"
$providerConfig = Join-Path $root "config.json"
$backend = "`$env:ALGEBRIUM_KB_PATH = '$database'; `$env:QDRANT_URL = 'http://127.0.0.1:7333'; & '$bun' run algebrium -- --port 4097 --config '$providerConfig'"
Start-AlgebriumTerminal "Algebrium Backend" (Join-Path $root "packages\opencode\packages\opencode") $backend
Start-AlgebriumTerminal "Algebrium Frontend" (Join-Path $root "packages\desktop") "& '$bun' run dev"

Write-Host "Backend:  http://127.0.0.1:4097/health"
Write-Host "Frontend: http://127.0.0.1:5173/"
Write-Host "Qdrant:  http://127.0.0.1:7333/healthz"
Write-Host "Keep both Algebrium debug windows open. Closing a window stops its service."
