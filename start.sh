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
lsof -ti:31001 | xargs kill -9 2>/dev/null
lsof -ti:31002 | xargs kill -9 2>/dev/null
sleep 1

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
open http://localhost:31001

echo ""
echo "================================================"
echo "   Done! URL: http://localhost:31001"
echo "================================================"
read -p "Press Enter to exit..."
