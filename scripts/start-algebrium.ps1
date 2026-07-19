[CmdletBinding()]
param(
  [switch]$SkipDocker
)

$root = Split-Path -Parent $PSScriptRoot
$configPath = Join-Path $root "config.json"
if (-not (Test-Path -LiteralPath $configPath)) { throw "config.json was not found." }

$config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json

function Select-Provider($ProviderConfig) {
  $profiles = @($ProviderConfig.profiles.PSObject.Properties | ForEach-Object { $_.Name })
  $profiles += "__custom__"

  $selected = 0
  while ($true) {
    Clear-Host
    Write-Host "Select a provider (Up/Down, Enter to confirm):" -ForegroundColor Cyan
    for ($index = 0; $index -lt $profiles.Count; $index++) {
      $marker = if ($index -eq $selected) { ">" } else { " " }
      if ($profiles[$index] -eq "__custom__") {
        Write-Host "$marker custom / OpenAI-compatible API"
      } else {
        $profile = $ProviderConfig.profiles.PSObject.Properties[$profiles[$index]].Value
        Write-Host "$marker $($profiles[$index]) / $($profile.model)"
      }
    }

    $key = [Console]::ReadKey($true)
    switch ($key.Key) {
      "UpArrow" { $selected = ($selected - 1 + $profiles.Count) % $profiles.Count }
      "DownArrow" { $selected = ($selected + 1) % $profiles.Count }
      "Enter" { return [pscustomobject]@{ Name = $profiles[$selected]; IsCustom = ($profiles[$selected] -eq "__custom__") } }
    }
  }
}

$selection = Select-Provider $config.provider
$profileName = if ($selection.IsCustom) { "custom" } else { $selection.Name }

function Set-SessionApiKey([string]$EnvironmentName, [string]$Prompt) {
  $secureKey = Read-Host $Prompt -AsSecureString
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureKey)
  try {
    $plainKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    if (-not $plainKey) { throw "API key cannot be empty." }
    [Environment]::SetEnvironmentVariable($EnvironmentName, $plainKey, "Process")
  } finally {
    if ($pointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
    $plainKey = $null
  }
}

if ($selection.IsCustom) {
  $customBaseURL = Read-Host "Custom API base URL (for example https://api.example.com/v1)"
  $customUri = $null
  if (-not [Uri]::TryCreate($customBaseURL, [UriKind]::Absolute, [ref]$customUri) -or $customUri.Scheme -notin @("http", "https")) {
    throw "Custom API base URL must be an absolute http or https URL."
  }
  $customModel = Read-Host "Custom model ID"
  if (-not $customModel.Trim()) { throw "Custom model ID cannot be empty." }
  [Environment]::SetEnvironmentVariable("ALGEBRIUM_CUSTOM_BASE_URL", $customBaseURL.Trim(), "Process")
  [Environment]::SetEnvironmentVariable("ALGEBRIUM_CUSTOM_MODEL", $customModel.Trim(), "Process")
  Set-SessionApiKey "ALGEBRIUM_CUSTOM_API_KEY" "Custom Provider API key (session only)"
} else {
  $profile = $config.provider.profiles.PSObject.Properties[$profileName].Value
  if (-not $profile) { throw "Provider profile was not found: $profileName" }
  if ($profileName -notmatch '^[A-Za-z0-9_-]+$') { throw "Provider profile name contains unsupported characters: $profileName" }
  Set-SessionApiKey $profile.apiKeyEnv "Provider $profileName / $($profile.model)`nEnter $($profile.apiKeyEnv) (session only)"
}

& (Join-Path $PSScriptRoot "start-algebrium-dev.ps1") -SkipDocker:$SkipDocker -Provider $profileName
