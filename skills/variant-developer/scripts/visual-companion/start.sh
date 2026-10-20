#!/usr/bin/env bash
# start.sh — launch the visual companion in mockup-mode or preview-mode.
#
# Usage:
#   start.sh --mode mockup --project-dir /path [--port N] [--foreground]
#       Starts a mockup-mode HTTP server (server.cjs).
#
#   start.sh --mode preview --variant <slug> [--matrix]
#       Starts the apps/web dev server under the demo profile, which renders
#       the bundled sample in any registered variant at
#       /sample?variant=<slug>. With --matrix, also runs preview-matrix.mjs
#       (requires Playwright).
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
    # next dev listens on $PORT when it is set.
    URL="http://localhost:${PORT:-3000}/sample?variant=$VARIANT"
    echo "Starting the dev server under the demo profile, on the bundled sample. Visit:"
    echo "  $URL"
    if [ "$MATRIX" = "1" ]; then
      # Best-effort matrix capture; runs in background once server is up.
      (
        # Wait until the dev server responds
        for i in $(seq 1 60); do
          if curl -sf "$URL" >/dev/null 2>&1; then
            break
          fi
          sleep 1
        done
        node "$SCRIPT_DIR/preview-matrix.mjs" "$VARIANT"
      ) &
    fi
    cd "$ROOT"
    # demo serves /sample from the bundled sample. It reads no source
    # directory, so the empty value overrides the one apps/web/.env.development
    # sets for read-only.
    export PORTFOLIO_PROFILE=demo PORTFOLIO_SOURCE_DIR=
    exec pnpm --filter @portfolio/web dev
    ;;
  *)
    echo "error: unknown mode '$MODE' (expected mockup or preview)" >&2
    exit 2
    ;;
esac
