#!/bin/bash

# Bird Whisperer Cookie Sync Script
# Run this daily via cron to sync X cookies to Cloudflare
#
# Add to crontab:
#   crontab -e
#   0 */2 * * * /home/frank/Projects/bird-whisperer/scripts/sync-cookies.sh
#
# Or run manually:
#   ./scripts/sync-cookies.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
COOKIE_SOURCE="${COOKIE_SOURCE:-chrome}"
CHROME_PROFILE_DIR="${CHROME_PROFILE_DIR:-$HOME/.config/chromium/Default}"
WORKER_NAME="${WORKER_NAME:-bird-whisperer}"

echo "🔐 Syncing cookies for Bird Whisperer..."
echo "   Cookie source: $COOKIE_SOURCE"
echo "   Chrome profile: $CHROME_PROFILE_DIR"
echo ""

# Check if bird CLI is available
if ! command -v bird &> /dev/null; then
    BIRD_PATH="$PROJECT_DIR/node_modules/.bin/bird"
    if [ -f "$BIRD_PATH" ]; then
        echo "Using local bird: $BIRD_PATH"
    else
        echo "❌ bird CLI not found. Install with: pnpm add -D @steipete/bird"
        exit 1
    fi
fi

# Extract cookies
echo "📂 Extracting cookies from $COOKIE_SOURCE..."
COOKIE_OUTPUT=$(cd "$PROJECT_DIR" && pnpm exec bird check --cookie-source "$COOKIE_SOURCE" --chrome-profile-dir "$CHROME_PROFILE_DIR" 2>&1) || true

AUTH_TOKEN=$(echo "$COOKIE_OUTPUT" | grep "auth_token:" | head -1 | awk '{print $2}')
CT0=$(echo "$COOKIE_OUTPUT" | grep "ct0:" | head -1 | awk '{print $2}')

if [ -z "$AUTH_TOKEN" ] || [ -z "$CT0" ]; then
    echo "❌ Failed to extract cookies"
    echo "$COOKIE_OUTPUT"
    exit 1
fi

echo "✅ Extracted auth_token and ct0"

# Upload to Cloudflare
echo "☁️  Uploading cookies to Cloudflare..."
cd "$PROJECT_DIR"

echo "$AUTH_TOKEN" | npx wrangler secret put AUTH_TOKEN --name "$WORKER_NAME"
echo "$CT0" | npx wrangler secret put CT0 --name "$WORKER_NAME"

echo ""
echo "✅ Cookie sync complete!"
echo "   Next scheduled run: tomorrow at 8am"
