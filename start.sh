#!/bin/bash

echo "================================================"
echo "   OpenClaw Dashboard Starting..."
echo "================================================"
echo ""

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo "[0/4] Installing dependencies..."
    npm install
    if [ $? -ne 0 ]; then
        echo "[ERROR] Failed to install dependencies!"
        read -p "Press Enter to exit..."
        exit 1
    fi
fi

# Kill existing processes on ports 31001 and 31002
echo "[1/4] Checking and freeing ports..."

# Windows (Git Bash / MSYS): use netstat + taskkill
# macOS/Linux: use lsof + kill
if [[ "$OSTYPE" == "msys" || "$OSTYPE" == "cygwin" ]]; then
    for port in 31001 31002; do
        PIDS=$(netstat -ano 2>/dev/null | grep ":$port " | grep LISTENING | awk '{print $5}')
        if [ -n "$PIDS" ]; then
            echo "  Port $port in use, killing..."
            for pid in $PIDS; do
                taskkill //PID "$pid" //F 2>/dev/null && echo "    Killed PID $pid" || echo "    Failed to kill PID $pid"
            done
        else
            echo "  Port $port is free"
        fi
    done
else
    for port in 31001 31002; do
        PIDS=$(lsof -ti:$port 2>/dev/null)
        if [ -n "$PIDS" ]; then
            echo "  Port $port in use, killing..."
            echo "$PIDS" | xargs kill -9 2>/dev/null
        else
            echo "  Port $port is free"
        fi
    done
fi

sleep 2

# Start unified service
echo "[2/4] Starting unified service (port 31002)..."
node scripts/unified-service.js &
sleep 2

# Start frontend
echo "[3/4] Starting frontend (port 31001)..."
npm run dev &
sleep 4

# Open browser
echo "[4/4] Opening browser..."
if [[ "$OSTYPE" == "msys" || "$OSTYPE" == "cygwin" ]]; then
    start http://localhost:31001
else
    open http://localhost:31001
fi

echo ""
echo "================================================"
echo "   Done! URL: http://localhost:31001"
echo "================================================"
read -p "Press Enter to exit..."
