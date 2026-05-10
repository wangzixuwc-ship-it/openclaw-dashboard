@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

echo ========================================
echo    OpenClaw Gateway 重启脚本
echo ========================================
echo.

echo [步骤 1] 停止现有的 Gateway 进程...
taskkill /F /IM node.exe /FI "WINDOWTITLE eq *openclaw*" 2>nul
timeout /t 2 /nobreak >nul
echo.

echo [步骤 2] 验证配置文件...
if exist "%USERPROFILE%\.openclaw\openclaw.json" (
    echo [✓] 配置文件存在
) else (
    echo [✗] 配置文件不存在
    pause
    exit /b 1
)
echo.

echo [步骤 3] 启动 Gateway...
echo [提示] 按 Ctrl+C 可停止 Gateway
echo ========================================
echo.

REM 启动 Gateway
openclaw gateway

pause
