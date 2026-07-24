[CmdletBinding()]
param(
  [switch]$SkipDocker,
  [string]$Provider
)

$root = Split-Path -Parent $PSScriptRoot
$bun = @(
  (Join-Path $env:LOCALAPPDATA "npm\node_modules\bun\bin\bun.exe"),
  (Get-Command bun.exe -ErrorAction SilentlyContinue).Source,
  (Get-Command bun.cmd -ErrorAction SilentlyContinue).Source
) | Where-Object { $_ -and (Test-Path -LiteralPath $_) -and [IO.Path]::GetExtension($_) -in ".exe", ".cmd" } | Select-Object -First 1

if (-not $bun) { throw "Bun was not found. Install Bun or add bun.exe to PATH." }

if (-not $SkipDocker) {
  $sageCompose = Join-Path $root "docker\sagemath\compose.yaml"
  docker image inspect algebrium/sagemath-kernel:10.9 *> $null
  if ($LASTEXITCODE -ne 0) {
    Write-Host "Building the local Algebrium SageMath image (first run or after an image change)..."
    & docker compose -f $sageCompose build
    if ($LASTEXITCODE -ne 0) { throw "SageMath Docker image build failed." }
  }
  & docker compose -f $sageCompose up -d --no-build --remove-orphans
  if ($LASTEXITCODE -ne 0) { throw "SageMath Docker startup failed." }
  & docker compose -f (Join-Path $root "docker\qdrant\compose.yaml") up -d --no-build
  if ($LASTEXITCODE -ne 0) { throw "Qdrant Docker startup failed." }
  & docker compose -f (Join-Path $root "docker\searxng\compose.yaml") up -d
  if ($LASTEXITCODE -ne 0) { throw "Local SearXNG startup failed." }
}

function Stop-Listener([int]$Port) {
  Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
    ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
}

Stop-Listener 4097
Stop-Listener 5173

$backendLauncher = Join-Path $PSScriptRoot "run-algebrium-backend.cmd"
$frontendLauncher = Join-Path $PSScriptRoot "run-algebrium-frontend.cmd"
$providerArgument = if ($Provider) { $Provider } else { "-" }
Start-Process -FilePath $backendLauncher -ArgumentList @("`"$providerArgument`"", "`"$bun`"")
Start-Process -FilePath $frontendLauncher -ArgumentList "`"$bun`""

Write-Host "Backend:  http://127.0.0.1:4097/health"
Write-Host "Frontend: http://127.0.0.1:5173/"
Write-Host "Qdrant:  http://127.0.0.1:7333/healthz"
Write-Host "Search:   http://127.0.0.1:8088/search?format=json"
Write-Host "Keep both Algebrium debug windows open. Closing a window stops its service."
