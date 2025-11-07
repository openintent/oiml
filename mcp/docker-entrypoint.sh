#!/bin/sh
# Entrypoint script for OpenIntent MCP Server
# Handles Docker daemon initialization for schema fetching

set -e

echo "Starting OpenIntent MCP Server..."

# Check if Docker socket is available (Docker socket mounting scenario)
if [ -S /var/run/docker.sock ]; then
    echo "✓ Docker socket detected at /var/run/docker.sock"
    echo "  Using host Docker daemon for schema fetching"
else
    echo "⚠ No Docker socket found"
    echo "  Note: Schema fetching from GHCR will require Docker access"
    echo "  For Google Cloud Run, consider using Cloud Build or pre-cached schemas"
fi

# Create schema cache directory if it doesn't exist
mkdir -p "${SCHEMA_CACHE_DIR:-/root/.openintent/schema-cache}"
echo "✓ Schema cache directory: ${SCHEMA_CACHE_DIR:-/root/.openintent/schema-cache}"

# Check if schemas are pre-cached
if [ -d "${SCHEMA_CACHE_DIR:-/root/.openintent/schema-cache}" ] && [ "$(ls -A ${SCHEMA_CACHE_DIR:-/root/.openintent/schema-cache})" ]; then
    echo "✓ Pre-cached schemas found"
    ls -la "${SCHEMA_CACHE_DIR:-/root/.openintent/schema-cache}"
else
    echo "ℹ No pre-cached schemas found - will fetch on first validation"
fi

echo ""
echo "Starting MCP server..."
echo "---"

# Execute the main command
exec "$@"

