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
echo 请选择要执行的操作:
echo ========================================
echo [1] 启动开发服务器 (npm run dev)
echo [2] 构建项目 (npm run build)
echo [3] 预览构建结果 (npm run preview)
echo [4] 运行代码检查 (npm run lint)
echo [5] 重新安装依赖 (npm install)
echo [0] 退出
echo ========================================
echo.

set /p choice=请输入选项 (0-5): 

if "%choice%"=="1" goto dev
if "%choice%"=="2" goto build
if "%choice%"=="3" goto preview
if "%choice%"=="4" goto lint
if "%choice%"=="5" goto reinstall
if "%choice%"=="0" goto end
goto invalid

:dev
echo.
echo [启动] 正在启动开发服务器...
echo [提示] 按 Ctrl+C 可停止服务器
echo.
call npm run dev
goto end

:build
echo.
echo [构建] 正在构建项目...
echo.
call npm run build
if %errorlevel% equ 0 (
    echo.
    echo [成功] 构建完成！
) else (
    echo.
    echo [错误] 构建失败
)
pause
goto end

:preview
echo.
echo [预览] 检查构建文件是否存在...
if not exist "dist" (
    echo [提示] 未找到 dist 目录，先执行构建...
    call npm run build
    if %errorlevel% neq 0 (
        echo [错误] 构建失败
        pause
        goto end
    )
)
echo.
echo [启动] 正在启动预览服务器...
echo.
call npm run preview
goto end

:lint
echo.
echo [检查] 正在运行代码检查...
echo.
call npm run lint:check
if %errorlevel% equ 0 (
    echo.
    echo [成功] 代码检查通过！
) else (
    echo.
    echo [警告] 发现代码问题，建议运行 'npm run lint' 自动修复
)
pause
goto end

:reinstall
echo.
echo [安装] 正在重新安装依赖...
echo.
if exist "node_modules" (
    echo [清理] 删除现有 node_modules...
    rmdir /s /q node_modules
)
call npm install
if %errorlevel% equ 0 (
    echo.
    echo [成功] 依赖安装完成！
) else (
    echo.
    echo [错误] 依赖安装失败
)
pause
goto end

:invalid
echo.
echo [错误] 无效的选项，请重新运行脚本
echo.
pause
goto end

:end
echo.
echo [完成] 脚本执行完毕
endlocal
