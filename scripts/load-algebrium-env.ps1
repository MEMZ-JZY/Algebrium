param(
  [string]$SetName,
  [string]$Value
)

# Load mode (no arguments): loads the repository-root .env file into the
# current process environment. Variables that already exist in the environment
# win and are not overwritten. Safe to call repeatedly; silent when .env is absent.
#
# Upsert mode (-SetName X -Value Y): writes one KEY=VALUE entry into .env,
# replacing an existing uncommented entry for that key, and mirrors it into the
# current process environment.

$root = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $root ".env"

if ($SetName) {
  if ($SetName -notmatch '^[A-Za-z_][A-Za-z0-9_]*$') { throw "Unsupported environment variable name: $SetName" }
  $entry = "$SetName=$Value"
  if (Test-Path -LiteralPath $envFile) {
    $lines = [System.Collections.Generic.List[string]](Get-Content -LiteralPath $envFile -Encoding UTF8)
    $index = -1
    for ($i = 0; $i -lt $lines.Count; $i++) {
      $candidate = $lines[$i].TrimStart()
      if (-not $candidate.StartsWith("#") -and $candidate -match "^$([regex]::Escape($SetName))\s*=") { $index = $i; break }
    }
    if ($index -ge 0) { $lines[$index] = $entry } else { $lines.Add($entry) }
    Set-Content -LiteralPath $envFile -Value $lines -Encoding UTF8
  } else {
    Set-Content -LiteralPath $envFile -Value @("# Algebrium local secrets (git-ignored). See .env.example.", $entry) -Encoding UTF8
  }
  [Environment]::SetEnvironmentVariable($SetName, $Value, "Process")
  Write-Host "Saved $SetName to .env"
  return
}

if (-not (Test-Path -LiteralPath $envFile)) { return }

$loaded = 0
foreach ($line in Get-Content -LiteralPath $envFile -Encoding UTF8) {
  $trimmed = $line.Trim()
  if (-not $trimmed -or $trimmed.StartsWith("#")) { continue }
  if ($trimmed.StartsWith("export ", [StringComparison]::OrdinalIgnoreCase)) { $trimmed = $trimmed.Substring(7).TrimStart() }
  $separator = $trimmed.IndexOf("=")
  if ($separator -lt 1) { continue }
  $name = $trimmed.Substring(0, $separator).Trim()
  $value = $trimmed.Substring($separator + 1).Trim()
  if ($name -notmatch '^[A-Za-z_][A-Za-z0-9_]*$') { continue }
  if ($value.Length -ge 2 -and (
      ($value.StartsWith('"') -and $value.EndsWith('"')) -or
      ($value.StartsWith("'") -and $value.EndsWith("'")))) {
    $value = $value.Substring(1, $value.Length - 2)
  }
  if ([Environment]::GetEnvironmentVariable($name, "Process")) { continue }
  [Environment]::SetEnvironmentVariable($name, $value, "Process")
  $loaded++
}
if ($loaded -gt 0) { Write-Host "Loaded $loaded environment variable(s) from .env" }
