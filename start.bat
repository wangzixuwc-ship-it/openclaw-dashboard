@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

echo ========================================
echo    OpenClaw Dashboard 服务启动脚本
echo ========================================
echo.

REM 检查 Node.js 是否安装
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [错误] 未检测到 Node.js，请先安装 Node.js
    pause
    exit /b 1
)

echo [信息] Node.js 版本:
node -v
echo.

REM 检查依赖是否已安装
if not exist "node_modules" (
    echo [提示] 检测到未安装依赖，开始安装...
    call npm install
    if %errorlevel% neq 0 (
        echo [错误] 依赖安装失败
        pause
        exit /b 1
    )
    echo [成功] 依赖安装完成
    echo.
)

echo ========================================
echo [1/2] 正在启动 Agent Service...
echo ========================================
echo.

REM 启动 Agent Service（后台运行）
start "Agent Service" /min node scripts/agent-service.js
timeout /t 2 /nobreak >nul
echo [成功] Agent Service 已启动（端口 3001）
echo.

echo ========================================
echo [2/2] 正在启动 Dashboard...
echo ========================================
echo [提示] 按 Ctrl+C 可停止 Dashboard
echo.

call npm run dev
