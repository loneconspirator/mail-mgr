#!/bin/sh
set -e

# Seed default config on first run
if [ ! -f "$DATA_PATH/config.yml" ]; then
  echo "First run: seeding default config to $DATA_PATH/config.yml"
  cp /app/config/default.yml "$DATA_PATH/config.yml"
fi

exec "$@"
