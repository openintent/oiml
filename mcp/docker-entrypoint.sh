#!/bin/sh
# Entrypoint script for OpenIntent MCP Server
# Uses pre-cached schemas bundled in the container image

set -e

echo "Starting OpenIntent MCP Server..."
echo ""

# Verify schema cache directory exists
CACHE_DIR="${SCHEMA_CACHE_DIR:-/root/.openintent/schema-cache}"
if [ ! -d "$CACHE_DIR" ]; then
    echo "⚠ Warning: Schema cache directory not found: $CACHE_DIR"
    mkdir -p "$CACHE_DIR"
fi

echo "📦 Schema cache directory: $CACHE_DIR"

# Check if schemas are pre-cached (they should be from the Docker build)
if [ -d "$CACHE_DIR" ] && [ "$(ls -A $CACHE_DIR 2>/dev/null)" ]; then
    echo "✓ Pre-cached schemas found:"
    ls -la "$CACHE_DIR" | tail -n +4 | awk '{print "  - " $9 " (" $5 " bytes)"}'
    echo ""
    
    # Verify required schema files exist
    for schema_dir in "$CACHE_DIR"/*; do
        if [ -d "$schema_dir" ]; then
            schema_name=$(basename "$schema_dir")
            if [ -f "$schema_dir/schema.json" ] && [ -f "$schema_dir/schema.zod.js" ]; then
                echo "  ✓ $schema_name is valid"
            else
                echo "  ⚠ $schema_name is missing required files"
            fi
        fi
    done
else
    echo "⚠ No pre-cached schemas found!"
    echo "  This may cause validation to fail."
    echo "  Ensure schemas are bundled during Docker build."
fi

echo ""
echo "🚀 Starting MCP server on port ${PORT:-3000}..."
echo "---"

# Execute the main command
exec "$@"

