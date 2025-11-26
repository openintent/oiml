#!/bin/bash

# Script to run the packaged Electron app from terminal to see logs
# Run this from the apps/oiml-studio directory

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Try different possible locations
if [ -d "$APP_DIR/release/mac-arm64/OIML Studio.app" ]; then
    APP_PATH="$APP_DIR/release/mac-arm64/OIML Studio.app"
elif [ -d "$APP_DIR/release/OIML Studio.app" ]; then
    APP_PATH="$APP_DIR/release/OIML Studio.app"
else
    echo "❌ App not found. Searched:"
    echo "   - $APP_DIR/release/mac-arm64/OIML Studio.app"
    echo "   - $APP_DIR/release/OIML Studio.app"
    exit 1
fi

EXECUTABLE="$APP_PATH/Contents/MacOS/OIML Studio"

if [ ! -d "$APP_PATH" ]; then
    echo "❌ App not found at $APP_PATH"
    echo "Please build the app first: npm run dist:mac"
    exit 1
fi

if [ ! -f "$EXECUTABLE" ]; then
    echo "❌ Executable not found at $EXECUTABLE"
    exit 1
fi

echo "🚀 Launching OIML Studio..."
echo "📋 App path: $APP_PATH"
echo "📋 Executable: $EXECUTABLE"
echo "📋 Logs will appear below:"
echo "=================================="
echo ""

# Run the executable directly to see console output
cd "$APP_DIR"
"$EXECUTABLE" 2>&1 | tee /tmp/oiml-studio.log

echo ""
echo "💡 Logs also saved to: /tmp/oiml-studio.log"
echo "💡 You can also check Console.app for more detailed logs"
echo "   Search for 'OIML Studio' or 'Electron'"

