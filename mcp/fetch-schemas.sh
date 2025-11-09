#!/bin/bash
# Download schemas from GHCR and extract to local schemas/ directory
# Run this before building the Docker image

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCHEMAS_DIR="$SCRIPT_DIR/schemas"

echo "📦 Downloading OpenIntent schemas..."
echo "Target directory: $SCHEMAS_DIR"
echo ""

# Create schemas directory
mkdir -p "$SCHEMAS_DIR"

# Function to extract schema from image
extract_schema() {
    local schema_name=$1
    local version=$2
    local image="ghcr.io/openintent/schemas/${schema_name}:${version}"
    local cache_key="${schema_name}_${version}"
    local target_dir="$SCHEMAS_DIR/$cache_key"
    
    echo "Downloading ${schema_name}@${version}..."
    
    # Pull the image (works with current architecture)
    docker pull "$image"
    
    # Create container and copy files
    local container_name="temp-schema-$$-$(date +%s)"
    docker create --name "$container_name" "$image" true >/dev/null 2>&1
    
    # Create target directory
    mkdir -p "$target_dir"
    
    # Copy schema files
    echo "  Extracting schema files..."
    docker cp "$container_name:/schema.json" "$target_dir/schema.json" 2>/dev/null || echo "  ⚠ Warning: schema.json not found"
    docker cp "$container_name:/schema.zod.js" "$target_dir/schema.zod.js" 2>/dev/null || echo "  ⚠ Warning: schema.zod.js not found"
    docker cp "$container_name:/metadata.json" "$target_dir/metadata.json" 2>/dev/null || echo "  ⚠ Warning: metadata.json not found"
    
    # Cleanup
    docker rm "$container_name" >/dev/null 2>&1
    
    # Verify files exist
    if [ -f "$target_dir/schema.json" ] && [ -f "$target_dir/schema.zod.js" ]; then
        echo "  ✓ ${schema_name}@${version} downloaded successfully"
    else
        echo "  ❌ Failed to download ${schema_name}@${version}"
        return 1
    fi
}

# Download all required schemas
extract_schema "oiml.intent" "0.1.0"
extract_schema "oiml.project" "0.1.0"

echo ""
echo "✅ All schemas downloaded successfully!"
echo ""
echo "Contents of schemas directory:"
ls -la "$SCHEMAS_DIR"
echo ""
echo "You can now build the Docker image:"
echo "  docker build -t oiml-mcp-server ."

