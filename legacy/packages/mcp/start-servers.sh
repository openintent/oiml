#!/bin/sh
# Startup script to run both MCP and Linear servers

echo "🚀 Starting MCP server on port ${PORT:-3111}..."
echo "---"

# Verify files exist
if [ ! -f "dist/server.js" ]; then
  echo "❌ Error: MCP server file not found at dist/server.js"
  exit 1
fi

# Start MCP server in background
echo "Starting MCP server..."
cd /app/packages/mcp
node dist/server.js > /tmp/mcp.log 2>&1 &
MCP_PID=$!
echo "MCP server started with PID: $MCP_PID"

# Give MCP server a moment to start
sleep 1

# Check if MCP server is still running
if ! kill -0 $MCP_PID 2>/dev/null; then
  echo "❌ Error: MCP server failed to start"
  exit 1
fi

cd /app/packages/mcp

# Show initial logs
echo "--- MCP server logs (first 10 lines) ---"
head -10 /tmp/mcp.log 2>&1 || echo "No logs yet"
echo "---"

echo "✅ Both servers started successfully"
echo "MCP server PID: $MCP_PID"

# Function to handle shutdown
cleanup() {
  echo "Shutting down servers..."
  kill $MCP_PID 2>/dev/null || true
  exit 0
}

# Trap SIGTERM and SIGINT
trap cleanup SIGTERM SIGINT

# Wait for both processes
wait $MCP_PID

