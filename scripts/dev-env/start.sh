#!/usr/bin/env bash
# Start the dev environment: GreenMail, seed data, app.
# Usage: start.sh
#
# Exits non-zero if any step fails (port conflict, timeout, etc.)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
DATA_DIR="/tmp/mail-mgr-dev"
PID_FILE="$DATA_DIR/app.pid"
APP_PORT=3001
IMAP_PORT=3143

# ── 1. Start GreenMail if not running ────────────────────────────
if docker ps --filter name=greenmail --format '{{.Names}}' 2>/dev/null | grep -q greenmail; then
  echo "GreenMail already running."
else
  echo "Starting GreenMail..."
  docker compose -f "$REPO_DIR/docker-compose.test.yaml" up -d
fi

# ── 2. Wait for GreenMail IMAP port ─────────────────────────────
"$SCRIPT_DIR/wait-for-port.sh" "$IMAP_PORT" "GreenMail IMAP" 15

# ── 3. Check for port conflict ───────────────────────────────────
if lsof -ti:$APP_PORT >/dev/null 2>&1; then
  echo "ERROR: Port $APP_PORT is already in use. Run stop.sh first or check what's listening." >&2
  exit 1
fi

# ── 4. Build frontend ───────────────────────────────────────────
echo "Building frontend..."
(cd "$REPO_DIR" && npm run build:frontend)

# ── 5. Seed data ─────────────────────────────────────────────────
mkdir -p "$DATA_DIR"
echo "Seeding dev data..."
DATA_PATH="$DATA_DIR" npx tsx "$SCRIPT_DIR/seed.ts"

# ── 6. Start the app in the background ───────────────────────────
echo "Starting app..."
DATA_PATH="$DATA_DIR" npx tsx "$REPO_DIR/src/index.ts" &
APP_PID=$!
echo "$APP_PID" > "$PID_FILE"

# ── 7. Wait for app to be ready ──────────────────────────────────
"$SCRIPT_DIR/wait-for-port.sh" "$APP_PORT" "Mail Manager app" 15

# ── 8. Report ────────────────────────────────────────────────────
cat <<EOF

Dev environment is running!
  Web UI:         http://localhost:$APP_PORT
  GreenMail IMAP: localhost:$IMAP_PORT
  GreenMail SMTP: localhost:3025
  Data directory: $DATA_DIR
  App PID:        $APP_PID
EOF
