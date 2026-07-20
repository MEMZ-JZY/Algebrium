@echo off
setlocal
cd /d "%~dp0"

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-algebrium.ps1"
if errorlevel 1 (
  echo.
  echo Algebrium failed to start. Review the message above.
  pause
)

endlocal
