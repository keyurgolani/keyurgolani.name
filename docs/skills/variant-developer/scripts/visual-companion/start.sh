#!/usr/bin/env bash
# start.sh — launch the visual companion in mockup-mode or preview-mode.
#
# Usage:
#   start.sh --mode mockup --project-dir /path [--port N] [--foreground]
#       Starts a mockup-mode HTTP server (server.cjs).
#
#   start.sh --mode preview --variant <slug> [--matrix]
#       Starts the apps/web dev server. Visit /preview/<slug>.
#       With --matrix, also runs preview-matrix.mjs (requires Playwright).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

MODE="mockup"
VARIANT=""
MATRIX=0
PASSTHRU=()

while [ $# -gt 0 ]; do
  case "$1" in
    --mode) MODE="$2"; shift 2 ;;
    --variant) VARIANT="$2"; shift 2 ;;
    --matrix) MATRIX=1; shift ;;
    --help|-h)
      grep '^#' "$0" | sed 's/^# //; s/^#//'
      exit 0 ;;
    *) PASSTHRU+=("$1"); shift ;;
  esac
done

# Find repo root
cur="$SCRIPT_DIR"
ROOT=""
while [ "$cur" != "/" ]; do
  if [ -f "$cur/package.json" ] && grep -q '"name": *"portfolio-monorepo"' "$cur/package.json"; then
    ROOT="$cur"; break
  fi
  cur="$(dirname "$cur")"
done

if [ -z "$ROOT" ]; then
  echo "error: not in the keyurgolani/portfolio monorepo" >&2
  exit 2
fi

case "$MODE" in
  mockup)
    exec node "$SCRIPT_DIR/server.cjs" "${PASSTHRU[@]}"
    ;;
  preview)
    if [ -z "$VARIANT" ]; then
      echo "error: --variant <slug> required for preview mode" >&2
      exit 2
    fi
    echo "Starting dev server. Once it's up, visit:"
    echo "  http://localhost:3000/preview/$VARIANT"
    if [ "$MATRIX" = "1" ]; then
      # Best-effort matrix capture; runs in background once server is up.
      (
        # Wait until /preview/<slug> responds
        for i in $(seq 1 60); do
          if curl -sf "http://localhost:3000/preview/$VARIANT" >/dev/null 2>&1; then
            break
          fi
          sleep 1
        done
        node "$SCRIPT_DIR/preview-matrix.mjs" "$VARIANT"
      ) &
    fi
    cd "$ROOT"
    exec pnpm --filter @portfolio/web dev
    ;;
  *)
    echo "error: unknown mode '$MODE' (expected mockup or preview)" >&2
    exit 2
    ;;
esac
