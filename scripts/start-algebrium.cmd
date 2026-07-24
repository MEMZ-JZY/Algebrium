@echo off
setlocal
where pwsh.exe >nul 2>nul
if errorlevel 1 (
  echo PowerShell 7 was not found. Install PowerShell 7 or run start-algebrium.ps1 from an existing pwsh session.
  exit /b 1
)

pwsh.exe -NoLogo -NoProfile -File "%~dp0start-algebrium.ps1" %*
