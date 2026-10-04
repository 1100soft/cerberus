#!/usr/bin/env bash
# Run mocked integration checks against Vite in Linux's native webview engine.
set -euo pipefail
cd "$(dirname "$0")/.."
if curl --fail --silent http://127.0.0.1:3000/ > /dev/null; then
  echo 'Port 3000 is already serving; stop it before running the isolated CI suite.' >&2
  exit 1
fi
npm run dev -- --host 127.0.0.1 --port 3000 --strictPort > /tmp/cerberus-vite-ci.log 2>&1 &
vite_pid=$!
trap 'kill "$vite_pid" 2>/dev/null || true' EXIT
ready=false
for attempt in {1..60}; do
  if curl --fail --silent http://127.0.0.1:3000/ > /dev/null; then
    ready=true
    break
  fi
  if ! kill -0 "$vite_pid" 2>/dev/null; then
    cat /tmp/cerberus-vite-ci.log
    exit 1
  fi
  sleep 1
done
if [ "$ready" != true ]; then
  cat /tmp/cerberus-vite-ci.log
  exit 1
fi
# Each fixture owns its mocked state; run sequentially.
for fixture in check-saved-prompts.py check-ci-automation.py check-handoffs.py check-card-reorder.py check-viewport.py; do
  xvfb-run --auto-servernum /usr/bin/python3 "scripts/$fixture"
done
