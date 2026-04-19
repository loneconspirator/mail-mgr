#!/usr/bin/env bash
# Stop the dev environment: kill app, stop GreenMail, clean up data dir.
# Usage: stop.sh
#
# Safe to run even if nothing is running — each step is idempotent.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../../.." && pwd)"
DATA_DIR="/tmp/mail-mgr-dev"
PID_FILE="$DATA_DIR/app.pid"
APP_PORT=3001

echo "Stopping dev environment..."

# 1. Kill app via PID file
if [ -f "$PID_FILE" ]; then
  APP_PID="$(cat "$PID_FILE")"
  if kill -0 "$APP_PID" 2>/dev/null; then
    echo "Killing app (PID $APP_PID)..."
    kill "$APP_PID" 2>/dev/null || true
    # Give it a moment to die gracefully
    sleep 1
    # Force kill if still alive
    if kill -0 "$APP_PID" 2>/dev/null; then
      echo "Force killing app (PID $APP_PID)..."
      kill -9 "$APP_PID" 2>/dev/null || true
    fi
  else
    echo "PID $APP_PID not running (stale PID file)."
  fi
  rm -f "$PID_FILE"
fi

# 2. Kill anything still listening on the app port (safety net)
PORT_PID="$(lsof -ti:$APP_PORT 2>/dev/null || true)"
if [ -n "$PORT_PID" ]; then
  echo "Killing leftover process on port $APP_PORT (PID $PORT_PID)..."
  echo "$PORT_PID" | xargs kill 2>/dev/null || true
fi

# 3. Stop GreenMail container
if docker ps --filter name=greenmail --format '{{.Names}}' 2>/dev/null | grep -q greenmail; then
  echo "Stopping GreenMail..."
  docker compose -f "$REPO_DIR/docker-compose.test.yaml" down
else
  echo "GreenMail not running."
fi

# 4. Clean up data directory
if [ -d "$DATA_DIR" ]; then
  echo "Cleaning up $DATA_DIR..."
  rm -rf "$DATA_DIR"
fi

echo "Dev environment stopped and cleaned up."
