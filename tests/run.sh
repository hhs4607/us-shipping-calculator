#!/usr/bin/env bash
# Test runner: starts a local HTTP server and runs all *.test.js files in this dir.
# Usage:  bash tests/run.sh           # headless
#         HEADLESS=0 bash tests/run.sh # headed (needs a display)

set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PORT=8765
BASE_URL="http://localhost:${PORT}"

# Kill any leftover server on this port.
pkill -f "http.server ${PORT}" 2>/dev/null || true
sleep 0.3

# Start server in background.
python3 -m http.server "$PORT" >/tmp/jp-test-server.log 2>&1 &
SERVER_PID=$!
trap 'kill $SERVER_PID 2>/dev/null || true' EXIT
sleep 0.6

# Confirm it answers.
if ! curl -sf "${BASE_URL}/index.html" >/dev/null; then
  echo "Server did not start on ${BASE_URL}" >&2
  exit 1
fi

# Run each test file.
TEST_BASE_URL="$BASE_URL" \
HEADLESS="${HEADLESS:-1}" \
node tests/jp-smoke.test.js

echo
echo "All tests done."
