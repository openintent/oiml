#!/bin/bash

# Build script for Electron production build
# Ensure we're in the correct directory (the app directory)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$APP_DIR"

echo "🔨 Building OIML Studio Electron Application..."
echo "📁 Working directory: $APP_DIR"

# Parse command line arguments
PUBLISH_MODE="never"
while [[ $# -gt 0 ]]; do
    case $1 in
        --publish)
            PUBLISH_MODE="always"
            echo "🚀 Publishing mode enabled - will publish to GitHub Releases"
            shift
            ;;
        --publish=*)
            PUBLISH_MODE="${1#*=}"
            echo "🚀 Publishing mode set to: $PUBLISH_MODE"
            shift
            ;;
        --help|-h)
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --publish              Enable publishing to GitHub Releases"
            echo "  --publish=always       Enable publishing to GitHub Releases"
            echo "  --publish=never        Disable publishing (default)"
            echo "  --help, -h             Show this help message"
            echo ""
            echo "Examples:"
            echo "  $0                     Build without publishing"
            echo "  $0 --publish           Build and publish to GitHub Releases"
            echo "  $0 --publish=always    Build and publish to GitHub Releases"
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            echo "Use --help for usage information"
            exit 1
            ;;
    esac
done

# Source environment variables from .env file if it exists
if [[ -f ".env" ]]; then
    echo "📄 Loading environment variables from .env file..."
    # Load environment variables and export them
    set -a  # Automatically export all variables
    source .env
    set +a  # Stop automatically exporting
    echo "✅ Loaded environment variables from .env"
fi

# Check for required environment variables for notarization
if [[ "$OSTYPE" == "darwin"* ]]; then
    echo "🍎 macOS detected - checking notarization credentials..."
    
    if [[ -z "$APPLE_ID" ]]; then
        echo "⚠️  APPLE_ID environment variable not set"
        echo "   Set it with: export APPLE_ID='your-apple-id@example.com'"
        echo "   Or add it to your .env file"
    fi
    
    if [[ -z "$APPLE_APP_SPECIFIC_PASSWORD" ]]; then
        echo "⚠️  APPLE_APP_SPECIFIC_PASSWORD environment variable not set"
        echo "   Set it with: export APPLE_APP_SPECIFIC_PASSWORD='your-app-specific-password'"
        echo "   Note: Use an app-specific password, not your main Apple ID password"
        echo "   Or add it to your .env file"
    fi
    
    if [[ -z "$APPLE_TEAM_ID" ]]; then
        echo "⚠️  APPLE_TEAM_ID environment variable not set"
        echo "   Set it with: export APPLE_TEAM_ID='your-team-id'"
        echo "   Find your Team ID at: https://developer.apple.com/account/#!/membership"
        echo "   Or add it to your .env file"
    fi
    
    if [[ -z "$APPLE_ID" || -z "$APPLE_APP_SPECIFIC_PASSWORD" || -z "$APPLE_TEAM_ID" ]]; then
        echo ""
        echo "❌ Missing required environment variables for notarization"
        echo "   The app will build but won't be notarized, which may cause Gatekeeper warnings"
        echo "   To enable notarization, set all three environment variables above"
        echo "   You can copy .env.example to .env and update the values"
        echo ""
        read -p "Continue with build without notarization? (y/N): " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            echo "Build cancelled"
            exit 1
        fi
    else
        echo "✅ All notarization credentials found"

        if [[ "$PUBLISH_MODE" == "always" ]]; then
            export CSC_IDENTITY_AUTO_DISCOVERY=true
            export CSC_NO_TIMESTAMP=true
            echo "✅ Code signing enabled (CSC_IDENTITY_AUTO_DISCOVERY=true)"
            echo "✅ Timestamping disabled (CSC_NO_TIMESTAMP=true)"
        else
            export CSC_IDENTITY_AUTO_DISCOVERY=false
            echo "✅ Code signing disabled (CSC_IDENTITY_AUTO_DISCOVERY=false)"
            echo "✅ Timestamping disabled (CSC_NO_TIMESTAMP=false)"
        fi
    fi
fi
# Build the application
echo "📦 Building Next.js and Electron main process..."
npm run build:electron

# Verify that standalone directory exists
if [[ ! -d ".next/standalone" ]]; then
    echo "❌ Error: .next/standalone directory not found after build!"
    echo "   Make sure Next.js build completed successfully and 'output: standalone' is set in next.config.ts"
    exit 1
fi

# Verify that server.js exists in standalone
if ! find .next/standalone -name "server.js" -type f | grep -q .; then
    echo "❌ Error: server.js not found in .next/standalone directory!"
    echo "   Next.js standalone build may have failed"
    exit 1
fi

echo "✅ Verified .next/standalone directory exists with server.js"

# Copy public folder to standalone directory (Next.js standalone doesn't copy it automatically)
if [[ -d "public" ]]; then
  echo "📁 Copying public folder to standalone directory..."
  cp -r public .next/standalone/public
  echo "✅ Copied public folder to .next/standalone/public"
else
  echo "⚠️  Warning: public folder not found"
fi

# Clean up broken symlinks and unnecessary files in standalone directory before packaging
# This prevents electron-builder from trying to sign non-existent or unnecessary files
if [[ -d ".next/standalone" ]]; then
    echo "🧹 Cleaning up .next/standalone before packaging..."
    # Only remove broken symlinks, not all symlinks (pnpm uses symlinks for module resolution)
    # Remove .next/cache directories (build artifacts, not needed in standalone)
    # NOTE: Keep .next/server - Next.js standalone needs it for pages-manifest.json and other runtime files
    find .next/standalone -type d -path "*/.next/cache" -exec rm -rf {} + 2>/dev/null || true
    # Remove only broken symlinks (not working ones needed for pnpm)
    find .next/standalone -type l ! -exec test -e {} \; -delete 2>/dev/null || true
    echo "✅ Cleaned up .next/standalone (preserved .next/server and working symlinks)"
fi

# Build the Electron app with specified publish mode
echo "🔨 Building Electron app with publish=$PUBLISH_MODE..."

npx electron-builder --mac --publish=$PUBLISH_MODE

# Check if build was successful
if [ $? -ne 0 ]; then
    echo "❌ Build failed!"
    exit 1
fi

echo "✅ Build completed successfully!"

# Final status
if [[ "$PUBLISH_MODE" == "always" ]]; then
    echo "🚀 App has been published to GitHub Releases!"
else
    echo "📦 App built locally (not published)"
fi
