@echo off
setlocal
title Algebrium Frontend
set "ALGEBRIUM_ROOT=%~dp0.."
set "ALGEBRIUM_BUN=%~1"

if not exist "%ALGEBRIUM_BUN%" (
  echo Bun was not found at "%ALGEBRIUM_BUN%".
  exit /b 1
)

cd /d "%ALGEBRIUM_ROOT%\packages\desktop"
"%ALGEBRIUM_BUN%" run dev
