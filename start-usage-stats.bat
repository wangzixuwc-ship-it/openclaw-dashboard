@echo off
chcp 65001 >nul
echo ========================================
echo    OpenClaw Usage Stats Service
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

echo [启动] 正在启动 Usage Stats Service...
echo [端口] 3001
echo [数据目录] %USERPROFILE%\.openclaw\agents
echo.
echo [提示] 按 Ctrl+C 可停止服务
echo.

node scripts/usage-stats.js

pause
