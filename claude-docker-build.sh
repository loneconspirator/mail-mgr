#!/usr/bin/env bash
set -euo pipefail
docker build -f Dockerfile.claude -t mail-mgr-claude .
