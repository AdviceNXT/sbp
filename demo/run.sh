#!/bin/bash
# Quick demo script for SBP

set -e

echo "╔════════════════════════════════════════════════════════════╗"
echo "║                 SBP Quick Demo                             ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""

# Check if server is built
if [ ! -d "packages/server/dist" ]; then
    echo "Building server..."
    cd packages/server && npm install && npm run build
    cd ../..
fi

# Check Python client
if ! python3 -c "import sbp" 2>/dev/null; then
    echo "Installing Python client..."
    cd packages/client-python && pip install -e . && cd ../..
fi

echo ""
echo "Starting SBP server in background..."
node packages/server/dist/cli.js &
SERVER_PID=$!

# Wait for server to start
sleep 2

echo "Server running (PID: $SERVER_PID)"
echo ""
echo "Running demo..."
echo ""

# Run the demo
python3 demo/pipeline.py

# Cleanup
kill $SERVER_PID 2>/dev/null || true
