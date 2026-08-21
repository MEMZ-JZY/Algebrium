[CmdletBinding()]
param(
  [switch]$SkipDocker,
  [string]$Provider
)

$root = Split-Path -Parent $PSScriptRoot

& (Join-Path $PSScriptRoot "load-algebrium-env.ps1")

$configPath = Join-Path $root "config.json"
if (-not (Test-Path -LiteralPath $configPath)) { throw "config.json was not found at $configPath." }
try {
  $config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
} catch {
  throw "config.json is not valid JSON: $($_.Exception.Message)"
}

# The backend refuses to boot without the selected provider's API key, so fail
# here with instructions instead of launching a debug window that dies instantly.
$activeProvider = if ($Provider) { $Provider } elseif ($env:ALGEBRIUM_PROVIDER) { $env:ALGEBRIUM_PROVIDER } else { $config.provider.active }
if ($config.provider.mode -ne "mock") {
  if ($activeProvider -eq "custom") {
    $missingCustom = @("ALGEBRIUM_CUSTOM_BASE_URL", "ALGEBRIUM_CUSTOM_MODEL", "ALGEBRIUM_CUSTOM_API_KEY") | Where-Object { -not [Environment]::GetEnvironmentVariable($_, "Process") }
    if ($missingCustom) {
      throw "Provider 'custom' is missing environment variables: $($missingCustom -join ', '). Copy .env.example to .env in the repository root and fill them in, or start via Start Algebrium.cmd to enter them interactively."
    }
  } else {
    $profile = $config.provider.profiles.PSObject.Properties[$activeProvider].Value
    if (-not $profile) { throw "Provider '$activeProvider' was not found in config.json." }
    $keyEnv = $profile.apiKeyEnv
    if ($keyEnv -and -not [Environment]::GetEnvironmentVariable($keyEnv, "Process")) {
      throw "Provider '$activeProvider' has no API key. Copy .env.example to .env in the repository root and set $keyEnv=<your-key>, or start via Start Algebrium.cmd to enter the key interactively."
    }
  }
}

function Find-Bun {
  @(
    (Join-Path $env:USERPROFILE ".bun\bin\bun.exe"),
    (Join-Path $env:LOCALAPPDATA "npm\node_modules\bun\bin\bun.exe"),
    (Get-Command bun.exe -ErrorAction SilentlyContinue).Source,
    (Get-Command bun.cmd -ErrorAction SilentlyContinue).Source
  ) | Where-Object { $_ -and (Test-Path -LiteralPath $_) -and [IO.Path]::GetExtension($_) -in ".exe", ".cmd" } | Select-Object -First 1
}

$bun = Find-Bun
if (-not $bun) {
  Write-Host "Bun was not found. Installing Bun..."
  $bunInstalled = $false
  try {
    if ($PSVersionTable.PSVersion.Major -lt 6) {
      [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    }
    $bunInstaller = Join-Path $env:TEMP "bun-install.ps1"
    Invoke-WebRequest -Uri "https://bun.sh/install.ps1" -OutFile $bunInstaller -UseBasicParsing -TimeoutSec 60
    & powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File $bunInstaller
    $bunInstalled = ($LASTEXITCODE -eq 0)
  } catch {
    Write-Host "Direct download failed: $($_.Exception.Message)"
    Write-Host "Falling back to npm..."
  }
  if (-not $bunInstalled -and (Get-Command npm.exe -ErrorAction SilentlyContinue)) {
    & npm.exe install -g bun
    $bunInstalled = ($LASTEXITCODE -eq 0)
  }
  $bun = Find-Bun
  if (-not $bun) { throw "Bun installation failed. Install Bun from https://bun.sh (or run 'npm install -g bun'), then rerun." }
}

function Ensure-DockerEngine {
  if (-not (Get-Command docker.exe -ErrorAction SilentlyContinue)) {
    throw "Docker was not found. Install Docker Desktop (https://www.docker.com/products/docker-desktop/), start it once, and rerun."
  }
  docker version --format "{{.Server.Version}}" *> $null
  if ($LASTEXITCODE -eq 0) { return }
  $dockerDesktop = @(
    (Join-Path $env:ProgramFiles "Docker\Docker\Docker Desktop.exe"),
    (Join-Path ${env:ProgramFiles(x86)} "Docker\Docker\Docker Desktop.exe"),
    (Join-Path $env:LOCALAPPDATA "Docker\Docker Desktop.exe")
  ) | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1
  if (-not $dockerDesktop) {
    throw "The Docker engine is not running and Docker Desktop was not found. Start Docker Desktop, then rerun."
  }
  Write-Host "Starting Docker Desktop and waiting for the Docker engine (up to 5 minutes)..."
  Start-Process -FilePath $dockerDesktop
  $deadline = (Get-Date).AddMinutes(5)
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 5
    docker version --format "{{.Server.Version}}" *> $null
    if ($LASTEXITCODE -eq 0) { break }
  }
  docker version --format "{{.Server.Version}}" *> $null
  if ($LASTEXITCODE -ne 0) { throw "The Docker engine did not become ready within 5 minutes. Start Docker Desktop, then rerun." }
}

foreach ($packageDir in @(
    (Join-Path $root "packages\desktop"),
    (Join-Path $root "packages\opencode")
  )) {
  if (-not (Test-Path -LiteralPath (Join-Path $packageDir "node_modules"))) {
    Write-Host "Installing dependencies in $packageDir (first run)..."
    Push-Location -LiteralPath $packageDir
    try {
      & $bun install
      if ($LASTEXITCODE -ne 0) { throw "bun install failed in $packageDir." }
    } finally {
      Pop-Location
    }
  }
}

if (-not $SkipDocker) {
  Ensure-DockerEngine
  # Windows/Hyper-V reserves dynamic port ranges (netsh interface ipv4 show
  # excludedportrange protocol=tcp); a compose port inside one fails to bind.
  function Throw-DockerStartupFailure([string]$Service) {
    throw "$Service Docker startup failed. If the error above says 'ports are not available', the host port is inside a Windows reserved range: pick another host port in docker/<service>/compose.yaml and update the matching URL in scripts/run-algebrium-backend.cmd."
  }
  $sageCompose = Join-Path $root "docker\sagemath\compose.yaml"
  docker image inspect algebrium/sagemath-kernel:10.9 *> $null
  if ($LASTEXITCODE -ne 0) {
    Write-Host "Building the local Algebrium SageMath image (first run or after an image change)..."
    & docker compose -f $sageCompose build
    if ($LASTEXITCODE -ne 0) { throw "SageMath Docker image build failed." }
  }
  & docker compose -f $sageCompose up -d --no-build --remove-orphans
  if ($LASTEXITCODE -ne 0) { Throw-DockerStartupFailure "SageMath" }
  & docker compose -f (Join-Path $root "docker\qdrant\compose.yaml") up -d --no-build
  if ($LASTEXITCODE -ne 0) { Throw-DockerStartupFailure "Qdrant" }
  & docker compose -f (Join-Path $root "docker\searxng\compose.yaml") up -d
  if ($LASTEXITCODE -ne 0) { Throw-DockerStartupFailure "Local SearXNG" }
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
Write-Host "Qdrant:   http://127.0.0.1:17333/healthz"
Write-Host "Search:   http://127.0.0.1:8088/search?format=json"
Write-Host "Keep both Algebrium debug windows open. Closing a window stops its service."
