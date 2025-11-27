#!/bin/bash
# Build script for MCP server Docker image
# Handles workspace dependencies properly

set -e

echo "Building OpenIntent MCP Server Docker image..."
echo ""

# Get the script directory and monorepo root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MONOREPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Check if we're in the mcp directory
if [ ! -f "$SCRIPT_DIR/Dockerfile" ]; then
    echo "Error: Dockerfile not found in mcp directory"
    exit 1
fi

# Build Docker image from monorepo root with Dockerfile path
echo "Building Docker image from monorepo root..."
cd "$MONOREPO_ROOT"
docker build -f packages/mcp/Dockerfile -t oiml-mcp-server:latest .

echo ""
echo "✓ Docker image built successfully!"
echo ""
echo "Run with:"
echo "  docker run -p 3000:3000 -v /var/run/docker.sock:/var/run/docker.sock oiml-mcp-server:latest"
echo ""
echo "Or use docker-compose:"
echo "  docker-compose up -d"

