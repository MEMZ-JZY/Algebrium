@echo off
setlocal
title Algebrium Backend
set "ALGEBRIUM_ROOT=%~dp0.."
set "ALGEBRIUM_PROVIDER_NAME=%~1"
set "ALGEBRIUM_BUN=%~2"

if not exist "%ALGEBRIUM_BUN%" (
  echo Bun was not found at "%ALGEBRIUM_BUN%".
  exit /b 1
)

set "ALGEBRIUM_KB_PATH=%ALGEBRIUM_ROOT%\data\algebrium.db"
set "QDRANT_URL=http://127.0.0.1:7333"
if not "%ALGEBRIUM_PROVIDER_NAME%"=="-" set "ALGEBRIUM_PROVIDER=%ALGEBRIUM_PROVIDER_NAME%"

cd /d "%ALGEBRIUM_ROOT%\packages\opencode\packages\opencode"
"%ALGEBRIUM_BUN%" run algebrium -- --port 4097 --config "%ALGEBRIUM_ROOT%\config.json"
