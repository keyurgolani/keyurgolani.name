#!/usr/bin/env bash
# stop.sh — clean shutdown of the visual companion mockup-mode server.
#
# Usage: stop.sh <state_dir>
#
# state_dir is the path printed by server.cjs on startup as part of its JSON.
set -euo pipefail

STATE_DIR="${1:-}"
if [ -z "$STATE_DIR" ] || [ ! -d "$STATE_DIR" ]; then
  echo "usage: stop.sh <state_dir>" >&2
  exit 2
fi

INFO_FILE="$STATE_DIR/server-info"
if [ ! -f "$INFO_FILE" ]; then
  echo "no server-info found in $STATE_DIR — server may already be stopped"
  touch "$STATE_DIR/server-stopped" 2>/dev/null || true
  exit 0
fi

PORT=$(grep -o '"port":[0-9]*' "$INFO_FILE" | head -1 | grep -o '[0-9]*$')
if [ -z "$PORT" ]; then
  echo "could not parse port from $INFO_FILE" >&2
  exit 1
fi

# Find PID listening on $PORT (linux + macOS via lsof)
PID=""
if command -v lsof >/dev/null 2>&1; then
  PID=$(lsof -ti tcp:"$PORT" 2>/dev/null | head -1 || true)
fi
if [ -z "$PID" ] && command -v ss >/dev/null 2>&1; then
  PID=$(ss -lptn "sport = :$PORT" 2>/dev/null | grep -o 'pid=[0-9]*' | head -1 | grep -o '[0-9]*$' || true)
fi

if [ -n "$PID" ]; then
  kill "$PID" 2>/dev/null || true
  echo "stopped server on port $PORT (pid $PID)"
else
  echo "no process listening on port $PORT"
fi

touch "$STATE_DIR/server-stopped"
