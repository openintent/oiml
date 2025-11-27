#!/bin/sh
# Entrypoint script for OpenIntent MCP Server
# Uses pre-cached schemas bundled in the container image

set -e

echo "🚀 Starting MCP server on port ${PORT:-3000}..."
echo "---"

# Execute the main command
exec "$@"

