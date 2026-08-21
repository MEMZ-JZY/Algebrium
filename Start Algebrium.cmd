@echo off
setlocal
cd /d "%~dp0"

"%~dp0scripts\start-algebrium.cmd" %*
if errorlevel 1 (
  echo.
  echo Algebrium failed to start. Review the message above.
  pause
)

endlocal
