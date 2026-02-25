#!/usr/bin/env bash
set -euo pipefail

CONFIG_FILE=${WRANGLER_CONFIG:-}
if [ -z "$CONFIG_FILE" ]; then
  if [ -f "wrangler.local.toml" ]; then
    CONFIG_FILE="wrangler.local.toml"
  else
    CONFIG_FILE="wrangler.toml"
  fi
fi

if [ ! -f "$CONFIG_FILE" ]; then
  echo "Error: Wrangler config file not found: $CONFIG_FILE"
  exit 1
fi

NSID=$(grep -A5 '^\[\[kv_namespaces\]\]' "$CONFIG_FILE" | grep '^id' | sed 's/.*= *"\(.*\)"/\1/')

if [ -z "$NSID" ]; then
  echo "Error: Could not find KV namespace ID in $CONFIG_FILE"
  exit 1
fi

if [ "$NSID" = "your-kv-namespace-id" ]; then
  echo "Error: Replace placeholder KV namespace ID in $CONFIG_FILE first"
  exit 1
fi

echo "Resetting KV namespace: $NSID (from $CONFIG_FILE)"

keys=$(wrangler kv key list --namespace-id="$NSID" --remote | jq -r '.[].name')

if [ -z "$keys" ]; then
  echo "No keys found, nothing to reset."
  exit 0
fi

while IFS= read -r key; do
  echo "Deleting: $key"
  wrangler kv key delete --namespace-id="$NSID" --remote "$key"
done <<< "$keys"

echo "KV reset complete."
