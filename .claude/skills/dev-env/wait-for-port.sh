#!/usr/bin/env bash
# Wait for a TCP port to accept connections.
# Usage: wait-for-port.sh <port> <label> [timeout_seconds]
#   port             - TCP port number to probe
#   label            - human-readable name (e.g. "GreenMail IMAP")
#   timeout_seconds  - max wait time (default: 15)

set -euo pipefail

PORT="${1:?Usage: wait-for-port.sh <port> <label> [timeout]}"
LABEL="${2:?Usage: wait-for-port.sh <port> <label> [timeout]}"
TIMEOUT="${3:-15}"

echo "Waiting up to ${TIMEOUT}s for ${LABEL} on port ${PORT}..."

for i in $(seq 1 "$TIMEOUT"); do
  if nc -z localhost "$PORT" 2>/dev/null; then
    echo "${LABEL} is ready on port ${PORT}."
    exit 0
  fi
  sleep 1
done

echo "TIMEOUT: ${LABEL} not ready on port ${PORT} after ${TIMEOUT}s." >&2
exit 1
