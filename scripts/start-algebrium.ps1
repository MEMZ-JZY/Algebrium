[CmdletBinding()]
param(
  [switch]$SkipDocker
)

$root = Split-Path -Parent $PSScriptRoot
$configPath = Join-Path $root "config.json"
if (-not (Test-Path -LiteralPath $configPath)) { throw "config.json was not found." }

$config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json

& (Join-Path $PSScriptRoot "load-algebrium-env.ps1")

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
        $customReady = $env:ALGEBRIUM_CUSTOM_BASE_URL -and $env:ALGEBRIUM_CUSTOM_MODEL -and $env:ALGEBRIUM_CUSTOM_API_KEY
        Write-Host "$marker custom / OpenAI-compatible API$(if ($customReady) { ' / configured' })"
      } else {
        $profile = $ProviderConfig.profiles.PSObject.Properties[$profiles[$index]].Value
        $keyState = if ([Environment]::GetEnvironmentVariable($profile.apiKeyEnv, "Process")) { " / key configured" } else { "" }
        Write-Host "$marker $($profiles[$index]) / $($profile.model)$keyState"
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

function Read-NewApiKey([string]$Prompt) {
  $secureKey = Read-Host $Prompt -AsSecureString
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureKey)
  try {
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  } finally {
    if ($pointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
  }
}

function Save-DotEnvValue([string]$Name, [string]$Value) {
  & (Join-Path $PSScriptRoot "load-algebrium-env.ps1") -SetName $Name -Value $Value
}

function Offer-SaveToDotEnv([string]$Name, [string]$Value) {
  $answer = Read-Host "Save $Name to the local git-ignored .env for future starts? (Y/n)"
  if ($answer -notmatch '^[nN]') { Save-DotEnvValue $Name $Value }
}

if ($selection.IsCustom) {
  $previousBaseURL = $env:ALGEBRIUM_CUSTOM_BASE_URL
  $prompt = "Custom API base URL (for example https://api.example.com/v1)"
  if ($previousBaseURL) { $prompt += " [Enter = keep current]" }
  $customBaseURL = Read-Host $prompt
  if (-not $customBaseURL) { $customBaseURL = $previousBaseURL }
  $customUri = $null
  if (-not [Uri]::TryCreate($customBaseURL, [UriKind]::Absolute, [ref]$customUri) -or $customUri.Scheme -notin @("http", "https")) {
    throw "Custom API base URL must be an absolute http or https URL."
  }

  $previousModel = $env:ALGEBRIUM_CUSTOM_MODEL
  $prompt = "Custom model ID"
  if ($previousModel) { $prompt += " [Enter = keep current]" }
  $customModel = Read-Host $prompt
  if (-not $customModel) { $customModel = $previousModel }
  if (-not $customModel.Trim()) { throw "Custom model ID cannot be empty." }

  [Environment]::SetEnvironmentVariable("ALGEBRIUM_CUSTOM_BASE_URL", $customBaseURL.Trim(), "Process")
  [Environment]::SetEnvironmentVariable("ALGEBRIUM_CUSTOM_MODEL", $customModel.Trim(), "Process")

  $existingKey = [Environment]::GetEnvironmentVariable("ALGEBRIUM_CUSTOM_API_KEY", "Process")
  $keyHint = if ($existingKey) { " (input hidden; Enter = keep current)" } else { " (input hidden)" }
  $newKey = Read-NewApiKey "Custom Provider API key$keyHint"
  if ($newKey) {
    [Environment]::SetEnvironmentVariable("ALGEBRIUM_CUSTOM_API_KEY", $newKey.Trim(), "Process")
  } elseif (-not $existingKey) {
    throw "API key cannot be empty."
  }

  if ($customBaseURL.Trim() -ne $previousBaseURL -or $customModel.Trim() -ne $previousModel -or $newKey) {
    $answer = Read-Host "Save the custom provider settings to the local git-ignored .env for future starts? (Y/n)"
    if ($answer -notmatch '^[nN]') {
      Save-DotEnvValue "ALGEBRIUM_PROVIDER" "custom"
      Save-DotEnvValue "ALGEBRIUM_CUSTOM_BASE_URL" $customBaseURL.Trim()
      Save-DotEnvValue "ALGEBRIUM_CUSTOM_MODEL" $customModel.Trim()
      if ($newKey) { Save-DotEnvValue "ALGEBRIUM_CUSTOM_API_KEY" $newKey.Trim() }
    }
  }
} else {
  $profile = $config.provider.profiles.PSObject.Properties[$profileName].Value
  if (-not $profile) { throw "Provider profile was not found: $profileName" }
  if ($profileName -notmatch '^[A-Za-z0-9_-]+$') { throw "Provider profile name contains unsupported characters: $profileName" }
  $keyEnv = $profile.apiKeyEnv
  $existingKey = [Environment]::GetEnvironmentVariable($keyEnv, "Process")
  if ($existingKey) {
    Write-Host "Provider ${profileName}: $($keyEnv) is already configured from environment or .env."
    $newKey = Read-NewApiKey "Press Enter to keep it, or type a replacement key (input hidden)"
  } else {
    $newKey = Read-NewApiKey "Provider $profileName / $($profile.model)`nEnter $($keyEnv) (input hidden)"
    if (-not $newKey.Trim()) { throw "API key cannot be empty." }
  }
  if ($newKey) {
    [Environment]::SetEnvironmentVariable($keyEnv, $newKey.Trim(), "Process")
    Offer-SaveToDotEnv $keyEnv $newKey.Trim()
    Save-DotEnvValue "ALGEBRIUM_PROVIDER" $profileName
  }
}

& (Join-Path $PSScriptRoot "start-algebrium-dev.ps1") -SkipDocker:$SkipDocker -Provider $profileName
