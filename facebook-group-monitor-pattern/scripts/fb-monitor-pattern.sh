#!/usr/bin/env bash
# Facebook Group Monitor Pattern — Shell wrapper
# Runs the TypeScript CLI via tsx (no build step needed).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Check node
if ! command -v node &>/dev/null; then
    echo '{"success": false, "action": "error", "error": "Node.js not found. Install Node.js 20+ first."}'
    exit 1
fi

# Check if node_modules exists
if [ ! -d "$SCRIPT_DIR/node_modules" ]; then
    echo "Installing dependencies..." >&2
    (cd "$SCRIPT_DIR" && npm install --no-fund --no-audit) >&2
fi

# Check if Playwright browsers installed
if [ ! -d "$HOME/.cache/ms-playwright" ] && [ ! -d "$SCRIPT_DIR/node_modules/playwright/.local-browsers" ]; then
    echo "Installing Playwright Chromium..." >&2
    (cd "$SCRIPT_DIR" && npx playwright install chromium) >&2
fi

# Run the CLI
exec npx tsx "$SCRIPT_DIR/src/index.ts" "$@"
