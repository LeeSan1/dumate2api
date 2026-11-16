@echo off
setlocal
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 18 or newer is required. Install it from https://nodejs.org/ and try again.
  exit /b 1
)
node "%~dp0server.js" %*
