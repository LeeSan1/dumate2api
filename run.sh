#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"

if ! command -v node >/dev/null 2>&1; then
  echo "需要 Node.js 18 或更高版本。" >&2
  echo "macOS 可执行：brew install node" >&2
  exit 1
fi

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "当前 Node.js 版本过低：$(node --version)，需要 18 或更高版本。" >&2
  exit 1
fi

exec node "$SCRIPT_DIR/server.js" "$@"
