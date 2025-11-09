#!/bin/bash
# Script to manually publish a schema to GitHub Container Registry
# Usage: ./publish-schema.sh <entity-type> <version>
# Arguments:
#   entity-type: "intent" or "project" (or full schema name like "oiml.intent")
#   version: Schema version (e.g., "0.1.0")
# Examples:
#   ./publish-schema.sh intent 0.1.0
#   ./publish-schema.sh project 0.1.0
#   ./publish-schema.sh oiml.intent 0.1.0  # Also works with full name

set -e

ENTITY_TYPE=${1:-intent}
SCHEMA_VERSION=${2:-0.1.0}

# Convert entity type to full schema name if needed
case "$ENTITY_TYPE" in
  intent)
    SCHEMA_NAME="oiml.intent"
    ;;
  project)
    SCHEMA_NAME="oiml.project"
    ;;
  oiml.*)
    # Already a full schema name
    SCHEMA_NAME="$ENTITY_TYPE"
    ;;
  *)
    echo "Error: Invalid entity type: $ENTITY_TYPE"
    echo "Valid options: intent, project, or full schema name (oiml.*)"
    exit 1
    ;;
esac

REGISTRY="ghcr.io"
ORG_NAME="${GITHUB_REPOSITORY_OWNER:-openintent}"
IMAGE_NAME="${REGISTRY}/${ORG_NAME}/schemas/${SCHEMA_NAME}"

SCHEMA_DIR="$(dirname "$0")/../schemas/${SCHEMA_NAME}/${SCHEMA_VERSION}"

# Check if schema directory exists
if [ ! -d "$SCHEMA_DIR" ]; then
  echo "Error: Schema directory not found: $SCHEMA_DIR"
  exit 1
fi

# Check if required files exist
for file in schema.json schema.zod.js metadata.json Dockerfile; do
  if [ ! -f "$SCHEMA_DIR/$file" ]; then
    echo "Error: Required file not found: $file"
    exit 1
  fi
done

echo "Publishing schema:"
echo "  Entity Type: ${ENTITY_TYPE}"
echo "  Schema Name: ${SCHEMA_NAME}"
echo "  Version: ${SCHEMA_VERSION}"
echo "  Directory: ${SCHEMA_DIR}"
echo "  Image: ${IMAGE_NAME}:${SCHEMA_VERSION}"
echo "  Architectures: linux/amd64, linux/arm64"
echo ""

# Login to GHCR if token is available (needed for buildx push)
if [ -n "$GHCR_PAT" ]; then
  echo "Logging in to GitHub Container Registry..."
  echo "$GHCR_PAT" | docker login ghcr.io -u oimladmin --password-stdin
  echo ""
fi

# Setup buildx for multi-architecture builds
echo "Setting up Docker buildx for multi-architecture build..."
docker buildx create --name multiarch --use 2>/dev/null || docker buildx use multiarch 2>/dev/null || docker buildx use default

echo ""
echo "Building multi-architecture Docker image..."
echo "  Platforms: linux/amd64, linux/arm64"
echo ""

# Build and push multi-architecture image
if [ -n "$GHCR_PAT" ]; then
  # Build and push directly to registry
  docker buildx build \
    --platform linux/amd64,linux/arm64 \
    --tag "${IMAGE_NAME}:${SCHEMA_VERSION}" \
    --tag "${IMAGE_NAME}:latest" \
    --push \
    "$SCHEMA_DIR"
  
  echo ""
  echo "✓ Multi-architecture schema published successfully!"
  echo ""
  echo "Pull with:"
  echo "  docker pull ${IMAGE_NAME}:${SCHEMA_VERSION}"
  echo "  docker pull ${IMAGE_NAME}:latest"
  echo ""
  echo "Supported platforms: linux/amd64, linux/arm64"
else
  # Build locally only (no push)
  docker buildx build \
    --platform linux/amd64,linux/arm64 \
    --tag "${IMAGE_NAME}:${SCHEMA_VERSION}" \
    --tag "${IMAGE_NAME}:latest" \
    --load \
    "$SCHEMA_DIR" 2>/dev/null || {
      echo "⚠ Warning: --load doesn't support multiple platforms"
      echo "Building for current platform only..."
      docker buildx build \
        --tag "${IMAGE_NAME}:${SCHEMA_VERSION}" \
        --tag "${IMAGE_NAME}:latest" \
        --load \
        "$SCHEMA_DIR"
    }
  
  echo ""
  echo "GHCR_PAT not set. Image built locally but not pushed."
  echo ""
  echo "To push multi-architecture image, run:"
  echo "  export GHCR_PAT=your_github_token"
  echo "  ./publish-schema.sh ${ENTITY_TYPE} ${SCHEMA_VERSION}"
fi

