#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [ ! -d "$ROOT_DIR/flux-mcp/node_modules" ]; then
  npm --prefix "$ROOT_DIR/flux-mcp" ci
fi

if [ -f "$ROOT_DIR/fluxos-cli/package.json" ] && [ ! -d "$ROOT_DIR/fluxos-cli/node_modules" ]; then
  if [ -f "$ROOT_DIR/fluxos-cli/package-lock.json" ]; then
    npm --prefix "$ROOT_DIR/fluxos-cli" ci
  else
    npm --prefix "$ROOT_DIR/fluxos-cli" install
  fi
fi
