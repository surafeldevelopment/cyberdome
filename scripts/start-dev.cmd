@echo off
setlocal
title CyberDome Command Center (development)
rem Developer launcher: runs the web app from this repository with hot reload.
rem End users should install CyberDome with CyberDome-Setup-x.y.z.exe instead (see docs\INSTALL.md).

cd /d "%~dp0.."
set "LOG=%CD%\dev-launcher.log"
echo ==== CyberDome dev launcher %DATE% %TIME% ==== > "%LOG%"

where node >> "%LOG%" 2>&1
if errorlevel 1 (
  echo.
  echo Node.js was not found. Install Node.js 20 LTS or newer from https://nodejs.org and run this file again.
  pause
  exit /b 1
)
for /f "delims=" %%v in ('node -v') do set "NODEV=%%v"
echo node %NODEV% >> "%LOG%"

node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>18||(a===18&&b>=18)?0:1)"
if errorlevel 1 (
  echo.
  echo CyberDome needs Node.js 18.18 or newer. You have %NODEV%. Update from https://nodejs.org and run this file again.
  pause
  exit /b 1
)

if exist "node_modules\vite\package.json" goto run
echo.
echo Installing dependencies. The first run takes a minute or two...
call npm install >> "%LOG%" 2>&1
if errorlevel 1 (
  echo.
  echo npm install failed. The last lines of the log are below; the full log is %LOG%
  powershell -NoProfile -Command "Get-Content -Path '%LOG%' -Tail 25"
  pause
  exit /b 1
)

:run
echo.
echo Starting CyberDome in development mode...
echo   Web app:  http://127.0.0.1:5173
echo   API:      http://127.0.0.1:4646
echo Close this window to stop the servers.
echo.
start "" /min powershell -NoProfile -Command "Start-Sleep -Seconds 8; Start-Process 'http://127.0.0.1:5173'"
call npm run dev
