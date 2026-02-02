#!/usr/bin/env bash
set -euo pipefail

NSID=$(grep -A5 '^\[\[kv_namespaces\]\]' wrangler.toml | grep '^id' | sed 's/.*= *"\(.*\)"/\1/')

if [ -z "$NSID" ]; then
  echo "Error: Could not find KV namespace ID in wrangler.toml"
  exit 1
fi

echo "Resetting KV namespace: $NSID"

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
