@echo off
chcp 65001 > nul
title OpenClaw Dashboard

echo ================================================
echo    OpenClaw Dashboard Starting...
echo ================================================
echo.

REM Check if node_modules exists
if exist "node_modules" goto :skip_install
echo [0/4] Installing dependencies...
call npm install
if errorlevel 1 goto :error

:skip_install
REM Kill existing processes on ports 31001 and 31002
echo [1/4] Checking and freeing ports...
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 31001 -ErrorAction SilentlyContinue | Stop-Process -Force"
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 31002 -ErrorAction SilentlyContinue | Stop-Process -Force"
timeout /t 1 > nul

REM Start unified service
echo [2/4] Starting unified service (port 31002)...
start "Unified-Service" /min cmd /k "node scripts\unified-service.js"

REM Wait
timeout /t 2 > nul

REM Start frontend
echo [3/4] Starting frontend (port 31001)...
start "Frontend" /min cmd /k "npx vite"

REM Wait and open browser
timeout /t 4 > nul
echo [4/4] Opening browser...
start http://localhost:31001

echo.
echo ================================================
echo    Done! URL: http://localhost:31001
echo ================================================
pause
exit

:error
echo [ERROR] Failed to install dependencies!
pause
