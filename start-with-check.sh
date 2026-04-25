#!/bin/bash
set -e
# Prevent 3GB core dumps on Next.js OOM from filling the 32GB container disk.
# The PM2 $0 ulimit -c 0 is the key guard; max-old-space-size is already capped in ecosystem.config.js.
ulimit -c 0
cd .
if [ ! -f .next/BUILD_ID ]; then
  echo "[Reader] .next/BUILD_ID missing — refusing to start. Run \"npm run build\" first." >&2
  exit 1
fi
exec node node_modules/next/dist/bin/next start -p 3017 -H 127.0.0.1
