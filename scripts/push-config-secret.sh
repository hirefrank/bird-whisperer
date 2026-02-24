#!/usr/bin/env bash
set -euo pipefail

CONFIG_FILE=${CONFIG_FILE:-}
if [ -z "$CONFIG_FILE" ]; then
  if [ -f "config.local.yaml" ]; then
    CONFIG_FILE="config.local.yaml"
  else
    CONFIG_FILE="config.yaml"
  fi
fi

if [ ! -f "$CONFIG_FILE" ]; then
  echo "Error: Config file not found: $CONFIG_FILE"
  exit 1
fi

WRANGLER_CONFIG_FILE=${WRANGLER_CONFIG:-}
if [ -z "$WRANGLER_CONFIG_FILE" ]; then
  if [ -f "wrangler.local.toml" ]; then
    WRANGLER_CONFIG_FILE="wrangler.local.toml"
  else
    WRANGLER_CONFIG_FILE="wrangler.toml"
  fi
fi

echo "Pushing $CONFIG_FILE to CONFIG_YAML using $WRANGLER_CONFIG_FILE"
wrangler secret put CONFIG_YAML --config "$WRANGLER_CONFIG_FILE" < "$CONFIG_FILE"
echo "CONFIG_YAML secret updated"
