[CmdletBinding()]
param(
  [switch]$SkipDocker
)

$root = Split-Path -Parent $PSScriptRoot
$configPath = Join-Path $root "config.json"
if (-not (Test-Path -LiteralPath $configPath)) { throw "config.json was not found." }

$config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
$profileName = $config.provider.active
$profile = $config.provider.profiles.$profileName
if (-not $profile) { throw "Active provider profile was not found: $profileName" }

$keyName = $profile.apiKeyEnv
$existing = [Environment]::GetEnvironmentVariable($keyName, "Process")
if (-not $existing) {
  Write-Host "Provider: $profileName / $($profile.model)"
  $secureKey = Read-Host "Enter $keyName (session only)" -AsSecureString
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureKey)
  try {
    $plainKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    if (-not $plainKey) { throw "API key cannot be empty." }
    [Environment]::SetEnvironmentVariable($keyName, $plainKey, "Process")
  } finally {
    if ($pointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
    $plainKey = $null
  }
}

& (Join-Path $PSScriptRoot "start-algebrium-dev.ps1") -SkipDocker:$SkipDocker
