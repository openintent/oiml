#!/bin/bash

# Publish Release Script for OIML Studio
# This script helps publish a new release with the correct format for auto-updates

set -e

# Ensure we're in the correct directory (the app directory)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$APP_DIR"

echo "🚀 OIML Studio Release Publisher"
echo "=================================="
echo "📁 Working directory: $APP_DIR"

VERSION=$(node -p "require('./package.json').version")

# Check if GH_TOKEN is set
if [ -z "$GH_TOKEN" ]; then
    echo "❌ GH_TOKEN environment variable is not set"
    echo "Please set your GitHub token: export GH_TOKEN=your_token_here"
    exit 1
fi

echo "✅ GH_TOKEN found"

# Clean previous builds
echo "🧹 Cleaning previous builds..."
rm -rf release/
echo "✅ Cleaned previous builds"

# Build and publish
echo "🔨 Building and publishing version $VERSION..."
echo "📦 This will create:"
echo "   - macOS: OIML Studio-$VERSION-arm64.zip (for auto-updates)"
echo "   - macOS: OIML Studio-$VERSION-arm64.dmg (for manual downloads)"
echo "   - Windows: OIML Studio-$VERSION-x64.zip (for auto-updates)"
echo "   - Windows: OIML Studio-$VERSION Setup.exe (for manual downloads)"
echo "   - Linux: OIML Studio-$VERSION-x64.zip (for auto-updates)"
echo "   - Linux: OIML Studio-$VERSION-x64.AppImage (for manual downloads)"
echo ""

# Build and publish all platforms
echo "🔄 Building and publishing all platforms..."
# Enable automatic code signing discovery for macOS
export CSC_IDENTITY_AUTO_DISCOVERY=true
./scripts/build-electron.sh --publish

echo ""
echo "🎉 Release $VERSION published successfully!"
echo ""
echo "📋 Next steps:"
echo "   1. Check GitHub releases: https://github.com/openintent/oiml/releases"
echo "   2. Test auto-update in your app"
echo "   3. Update your website download links if needed"
echo ""
echo "🔗 Release URL: https://github.com/openintent/oiml/releases/tag/v$VERSION"

