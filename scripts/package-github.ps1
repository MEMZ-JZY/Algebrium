[CmdletBinding()]
param(
  [string]$Destination = (Join-Path (Split-Path -Parent $PSScriptRoot) "output")
)

$root = Split-Path -Parent $PSScriptRoot
$resolvedRoot = (Resolve-Path -LiteralPath $root).Path
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$archive = Join-Path $Destination "Algebrium-github-source-$timestamp.zip"

if (-not (Get-Command tar.exe -ErrorAction SilentlyContinue)) {
  throw "tar.exe was not found. Use a current Windows installation with bsdtar available."
}

New-Item -ItemType Directory -Path $Destination -Force | Out-Null
if (Test-Path -LiteralPath $archive) { throw "Archive already exists: $archive" }

$excluded = @(
  "./.git", "./.git/*",
  "./.playwright-cli", "./.playwright-cli/*",
  "./node_modules", "./node_modules/*",
  "./packages/opencode/node_modules", "./packages/opencode/node_modules/*",
  "./packages/desktop/node_modules", "./packages/desktop/node_modules/*",
  "./packages/curator/node_modules", "./packages/curator/node_modules/*",
  "./.venv", "./.venv/*",
  "./dist", "./dist/*",
  "./target", "./target/*",
  "./packages/desktop/dist", "./packages/desktop/dist/*",
  "./packages/desktop/src-tauri/target", "./packages/desktop/src-tauri/target/*",
  "./output", "./output/*",
  "./outputs", "./outputs/*",
  "./release", "./release/*",
  "./提示词文件", "./提示词文件/*",
  "./data", "./data/*",
  "./downloads", "./downloads/*",
  "*.log",
  "*.zip",
  "*/.env",
  "*/.env.*"
) | ForEach-Object { "--exclude=$_" }

Push-Location $resolvedRoot
try {
  & tar.exe -a -c -f $archive @excluded .
  if ($LASTEXITCODE -ne 0) { throw "tar.exe failed while creating the release archive (exit code $LASTEXITCODE)." }
} finally {
  Pop-Location
}

$size = (Get-Item -LiteralPath $archive).Length
Write-Host "Algebrium GitHub source archive created: $archive"
Write-Host "Size: $([math]::Round($size / 1MB, 2)) MB"
