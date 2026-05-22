#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

echo "Starting Bubble Wrap on http://127.0.0.1:3000"

if command -v python >/dev/null 2>&1; then
  python -m http.server 3000 --bind 127.0.0.1
elif command -v python3 >/dev/null 2>&1; then
  python3 -m http.server 3000 --bind 127.0.0.1
else
  echo "Python was not found in PATH." >&2
  exit 1
fi
