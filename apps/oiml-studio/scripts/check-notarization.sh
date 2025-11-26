#!/bin/bash

# Script to check if the packaged Electron app is signed and notarized
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

if [ ! -d "$APP_PATH" ]; then
    echo "❌ App not found at $APP_PATH"
    echo "Please build the app first: npm run dist:mac"
    exit 1
fi

echo "🔍 Checking notarization status for: $APP_PATH"
echo "=================================="
echo ""

# Check code signature
echo "📝 Code Signature:"
echo "-------------------"
SIGNATURE_OUTPUT=$(codesign -dv --verbose=4 "$APP_PATH" 2>&1)
if [ $? -eq 0 ]; then
    echo "$SIGNATURE_OUTPUT" | grep -E "(Authority|TeamIdentifier|Signature|Notarized|Identifier)" || echo "$SIGNATURE_OUTPUT" | head -10
else
    echo "❌ Code signature check failed:"
    echo "$SIGNATURE_OUTPUT" | head -5
    echo ""
    echo "This usually means the app is not signed."
fi
echo ""

# Check if app is notarized using spctl
echo "🔐 Notarization Status:"
echo "-------------------"
NOTARIZED=$(spctl -a -vv -t install "$APP_PATH" 2>&1)
SPCTL_EXIT_CODE=$?

if [ $SPCTL_EXIT_CODE -eq 0 ] && echo "$NOTARIZED" | grep -q "accepted"; then
    echo "✅ App is NOTARIZED and accepted by Gatekeeper"
    echo ""
    echo "Details:"
    echo "$NOTARIZED" | grep -E "(source|accepted|notarized)" || echo "$NOTARIZED"
elif echo "$NOTARIZED" | grep -q "rejected"; then
    echo "❌ App is REJECTED by Gatekeeper"
    echo ""
    echo "Details:"
    echo "$NOTARIZED"
elif echo "$NOTARIZED" | grep -q "no resources but signature indicates"; then
    echo "❌ Code signature error: App has signature but missing resources"
    echo ""
    echo "This usually means:"
    echo "  - The app was partially signed"
    echo "  - Resources were modified after signing"
    echo "  - There's a mismatch between signature and app contents"
    echo ""
    echo "Try rebuilding the app: pnpm run dist:mac"
    echo ""
    echo "Full error:"
    echo "$NOTARIZED"
else
    echo "⚠️  Could not determine notarization status"
    echo ""
    echo "This usually means the app is not signed or notarized."
    echo ""
    echo "Output:"
    echo "$NOTARIZED"
fi
echo ""

# Check using stapler (alternative method)
echo "📌 Stapler Status:"
echo "-------------------"
if command -v stapler &> /dev/null; then
    stapler validate "$APP_PATH" 2>&1 | head -5
else
    echo "⚠️  stapler command not found (it's part of Xcode Command Line Tools)"
fi
echo ""

# Summary
echo "=================================="
echo "Summary:"
echo "--------"

# Check for Team ID in signature (macOS-compatible grep)
TEAM_ID=$(codesign -dv "$APP_PATH" 2>&1 | grep -o 'TeamIdentifier=[^ ]*' | sed 's/TeamIdentifier=//' | head -1)
if [ -n "$TEAM_ID" ]; then
    echo "✅ Signed with Team ID: $TEAM_ID"
else
    echo "⚠️  No Team ID found (app may not be signed)"
    echo ""
    echo "To sign the app, ensure you have:"
    echo "  1. A valid Apple Developer certificate in your keychain"
    echo "  2. Set CSC_IDENTITY_AUTO_DISCOVERY=true (or specify CSC_NAME)"
    echo ""
    echo "Then rebuild: pnpm run dist:mac-signed"
fi

# Check for notarization in extended attributes
if xattr -l "$APP_PATH" 2>/dev/null | grep -q "com.apple.quarantine"; then
    echo "⚠️  App has quarantine attribute (downloaded from internet)"
else
    echo "✅ No quarantine attribute"
fi

# Final check
if echo "$NOTARIZED" | grep -q "accepted"; then
    echo "✅ Status: NOTARIZED and ready for distribution"
    exit 0
else
    echo "❌ Status: NOT notarized or rejected"
    echo ""
    echo "To notarize, set these environment variables:"
    echo "  export APPLE_ID='your-apple-id@example.com'"
    echo "  export APPLE_APP_SPECIFIC_PASSWORD='your-app-specific-password'"
    echo "  export APPLE_TEAM_ID='your-team-id'"
    echo ""
    echo "Then rebuild: pnpm run dist:mac"
    exit 1
fi

