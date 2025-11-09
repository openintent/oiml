#!/bin/bash
# Build script for MCP server Docker image
# Handles workspace dependencies properly

set -e

echo "Building OpenIntent MCP Server Docker image..."
echo ""

# Check if we're in the mcp directory
if [ ! -f "Dockerfile" ]; then
    echo "Error: Must run from mcp directory"
    exit 1
fi

# Build Docker image from monorepo root with mcp context
echo "Building Docker image..."
docker build -t oiml-mcp-server:latest .

echo ""
echo "✓ Docker image built successfully!"
echo ""
echo "Run with:"
echo "  docker run -p 3000:3000 -v /var/run/docker.sock:/var/run/docker.sock oiml-mcp-server:latest"
echo ""
echo "Or use docker-compose:"
echo "  docker-compose up -d"

