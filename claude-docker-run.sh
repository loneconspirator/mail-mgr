#!/usr/bin/env bash
set -euo pipefail

if [ -z "${CLAUDE_CODE_OAUTH_TOKEN:-}" ]; then
  echo "Error: CLAUDE_CODE_OAUTH_TOKEN is not set. Run 'claude setup-token' to get one." >&2
  exit 1
fi

docker run -it --rm \
  -v "$(pwd):/app" \
  -v "$HOME/.claude:/home/claude/.claude" \
  -v "$HOME/.claude.json:/home/claude/.claude.json" \
  -e CLAUDE_CODE_OAUTH_TOKEN="$CLAUDE_CODE_OAUTH_TOKEN" \
  mail-mgr-claude \
  claude --dangerously-skip-permissions "$@"
