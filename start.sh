#!/usr/bin/env bash
# =========================================================
#    OpenClaw Dashboard — macOS / Linux 启动脚本
# =========================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG_DIR="${SCRIPT_DIR}/logs"
PROJECT_DIR="${SCRIPT_DIR}"

# ---- 颜色输出 ----
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

info()  { echo -e "${CYAN}[信息]${NC} $*"; }
ok()    { echo -e "${GREEN}[成功]${NC} $*"; }
warn()  { echo -e "${YELLOW}[提示]${NC} $*"; }
error() { echo -e "${RED}[错误]${NC} $*"; }

echo "========================================"
echo "   OpenClaw Dashboard 服务启动脚本"
echo "========================================"
echo

# ---- 1. 检查 Node.js ----
if ! command -v node &>/dev/null; then
    error "未检测到 Node.js，请先安装 Node.js (>=18)"
    exit 1
fi
info "Node.js 版本: $(node -v)"
echo

# ---- 2. 检查 npm ----
if ! command -v npm &>/dev/null; then
    error "未检测到 npm，请确保 Node.js 安装完整"
    exit 1
fi

# ---- 3. 检查前端依赖 ----
if [ ! -d "${PROJECT_DIR}/node_modules" ]; then
    warn "检测到未安装前端依赖，开始安装..."
    cd "${PROJECT_DIR}"
    npm install
    if [ $? -ne 0 ]; then
        error "前端依赖安装失败"
        exit 1
    fi
    ok "前端依赖安装完成"
    echo
fi

# ---- 4. 检查后端依赖 ----
if [ ! -d "${PROJECT_DIR}/backend/node_modules" ]; then
    warn "检测到未安装后端依赖，开始安装..."
    cd "${PROJECT_DIR}/backend"
    npm install
    if [ $? -ne 0 ]; then
        error "后端依赖安装失败"
        exit 1
    fi
    ok "后端依赖安装完成"
    echo
fi

# ---- 5. 创建 logs 目录 ----
mkdir -p "${LOG_DIR}"

# ---- 6. 清理残留的 PID 文件 ----
rm -f "${LOG_DIR}"/*.pid

# ---- 7. 启动后端服务 ----
cd "${PROJECT_DIR}"
echo "========================================"
echo "[1/3] 正在启动 Dashboard Backend..."
echo "========================================"

cd "${PROJECT_DIR}/backend"
nohup npm run start:dev > "${LOG_DIR}/backend.log" 2>&1 &
echo $! > "${LOG_DIR}/backend.pid"
sleep 2
ok "Dashboard Backend 已启动（端口 31004，日志: ${LOG_DIR}/backend.log）"
echo

# ---- 8. 启动 Agent Service（如果存在且独立于后端）----
if [ -f "${PROJECT_DIR}/scripts/agent-service.js" ]; then
    echo "========================================"
    echo "[2/3] 正在启动 Agent Service..."
    echo "========================================"

    cd "${PROJECT_DIR}"
    nohup node scripts/agent-service.js > "${LOG_DIR}/agent-service.log" 2>&1 &
    echo $! > "${LOG_DIR}/agent-service.pid"
    sleep 1
    ok "Agent Service 已启动（日志: ${LOG_DIR}/agent-service.log）"
    echo
else
    warn "scripts/agent-service.js 不存在，跳过 Agent Service 启动（可能已合并到后端）"
    echo
fi

# ---- 9. 启动 Dashboard 前端 ----
echo "========================================"
echo "[3/3] 正在启动 Dashboard 前端..."
echo "========================================"
warn "Dashboard 前端在前台运行，按 Ctrl+C 可停止"
warn "停止后将自动关闭所有后台服务"
echo

# 定义清理函数
cleanup() {
    echo ""
    echo "========================================"
    echo "正在停止所有服务..."
    echo "========================================"

    for pidfile in "${LOG_DIR}"/*.pid; do
        if [ -f "$pidfile" ]; then
            local pid
            pid=$(cat "$pidfile")
            if kill -0 "$pid" 2>/dev/null; then
                kill "$pid" 2>/dev/null && ok "已停止 PID $pid ($(basename "$pidfile" .pid))"
            fi
        fi
    done

    # 清理 PID 文件
    rm -f "${LOG_DIR}"/*.pid
    echo "所有服务已停止"
}

# 注册退出信号
trap cleanup EXIT INT TERM

# 前台启动前端（带日志重定向）
cd "${PROJECT_DIR}"
npm run dev 2>&1 | tee "${LOG_DIR}/frontend.log" &
FRONTEND_PID=$!

# 等待前端进程
wait $FRONTEND_PID
