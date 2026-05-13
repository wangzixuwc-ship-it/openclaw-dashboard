@echo off
chcp 65001 > nul
title OpenClaw Dashboard

echo ================================================
echo    OpenClaw Dashboard Starting...
echo ================================================
echo.

REM Check if node_modules exists
if exist "node_modules" goto :skip_install
echo [0/5] Installing dependencies...
call npm install
if errorlevel 1 goto :error

:skip_install
REM Kill existing processes on ports 31001 and 31002
echo [1/5] Checking and freeing ports...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0kill-port.ps1"
timeout /t 1 > nul

REM Check for updates from Gitee
echo [2/5] Checking for updates...
curl -s "https://gitee.com/yaconit/openclaw-dashboard/raw/master/package.json" -o "%TEMP%\package_remote.json" 2>nul
if exist "%TEMP%\package_remote.json" (
    findstr /C:"\"version\"" package.json > "%TEMP%\package_local.txt"
    findstr /C:"\"version\"" "%TEMP%\package_remote.json" > "%TEMP%\package_remote.txt"
    fc /q "%TEMP%\package_local.txt" "%TEMP%\package_remote.txt" >nul 2>&1
    if errorlevel 1 (
        echo [WARNING] A newer version may be available!
        echo [TIP] Visit: https://gitee.com/yaconit/openclaw-dashboard
    )
    del "%TEMP%\package_remote.json" >nul 2>&1
    del "%TEMP%\package_local.txt" >nul 2>&1
    del "%TEMP%\package_remote.txt" >nul 2>&1
)
echo [2/5] Done.

REM Start unified service
echo [3/5] Starting unified service (port 31002)...
start "Unified-Service" /min cmd /k "node scripts\unified-service.js"

REM Wait
timeout /t 2 > nul

REM Start frontend
echo [4/5] Starting frontend (port 31001)...
start "Frontend" /min cmd /k "npx vite"

REM Wait and open browser
timeout /t 4 > nul
echo [5/5] Opening browser...
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
