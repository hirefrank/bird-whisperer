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
export CHROME_PROFILE_DIR="${CHROME_PROFILE_DIR:-$HOME/.config/chromium/Default}"
WORKER_NAME="${WORKER_NAME:-bird-whisperer}"

echo "🔐 Syncing cookies for Bird Whisperer..."
echo "   Chrome profile: $CHROME_PROFILE_DIR"
echo ""

# Extract cookies using bird library directly
echo "📂 Extracting cookies..."
COOKIE_JSON=$(cd "$PROJECT_DIR" && node scripts/extract-cookies.mjs) || {
    echo "❌ Failed to extract cookies"
    exit 1
}

AUTH_TOKEN=$(echo "$COOKIE_JSON" | node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).authToken)")
CT0=$(echo "$COOKIE_JSON" | node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).ct0)")

if [ -z "$AUTH_TOKEN" ] || [ -z "$CT0" ]; then
    echo "❌ Failed to parse cookies from extraction output"
    exit 1
fi

echo "✅ Extracted auth_token (${#AUTH_TOKEN} chars) and ct0 (${#CT0} chars)"

# Upload to Cloudflare
echo "☁️  Uploading cookies to Cloudflare..."
cd "$PROJECT_DIR"

printf '%s' "$AUTH_TOKEN" | npx wrangler secret put AUTH_TOKEN --name "$WORKER_NAME"
printf '%s' "$CT0" | npx wrangler secret put CT0 --name "$WORKER_NAME"

echo ""
echo "✅ Cookie sync complete!"
