#!/usr/bin/env bash
# start.sh — launch the visual companion in mockup-mode or preview-mode.
#
# Usage:
#   start.sh --mode mockup --project-dir /path [--port N] [--foreground]
#       Starts a mockup-mode HTTP server (server.cjs).
#
#   start.sh --mode preview --variant <id> [--fixture <name>]
#       Starts the apps/web dev server and prints the dev fixture route,
#       /preview/dev/<id>/<name>, which renders one of #5's contract
#       fixtures (default: complete) in the variant, in the preview
#       document and under the preview's headers. It polls the route until
#       it answers 200. Add ?displayMode=dark, ?contrast=more,
#       ?motion=reduce, or ?enhancement=off for another environment.
#
#   start.sh --mode preview --variant <id> --matrix
#       Runs pnpm test:variants for the variant instead: every contract
#       fixture, in every mode, on this checkout's build (pnpm build first).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

MODE="mockup"
VARIANT=""
FIXTURE="complete"
MATRIX=0
PASSTHRU=()

while [ $# -gt 0 ]; do
  case "$1" in
    --mode) MODE="$2"; shift 2 ;;
    --variant) VARIANT="$2"; shift 2 ;;
    --fixture) FIXTURE="$2"; shift 2 ;;
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
      echo "error: --variant <id> required for preview mode" >&2
      exit 2
    fi
    cd "$ROOT"
    if [ "$MATRIX" = 1 ]; then
      echo "Running pnpm test:variants for $VARIANT, on this checkout's build."
      PORTFOLIO_VARIANTS_ONLY="$VARIANT" exec pnpm test:variants
    fi
    # next dev listens on 127.0.0.1, on $PORT when it is set.
    BASE="http://127.0.0.1:${PORT:-3000}"
    URL="$BASE/preview/dev/$VARIANT/$FIXTURE"
    echo "Starting the dev server. The preview will be at:"
    echo "  $URL"
    # Polls the route until it answers 200, and stops with the server.
    (
      status=""
      for _ in $(seq 1 180); do
        kill -0 "$PPID" 2>/dev/null || exit 0
        status="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$URL" || true)"
        if [ "$status" = 200 ]; then
          echo "The preview answers 200: $URL"
          exit 0
        fi
        sleep 1
      done
      echo "warning: $URL hasn't answered 200 in three minutes (last status: ${status:-none})." >&2
      echo "A 404 means the build doesn't register $VARIANT, or no fixture is named $FIXTURE." >&2
    ) &
    # The dev route renders fixtures in every profile. demo reads no source
    # directory, so the empty value overrides the one apps/web/.env.development
    # sets for read-only, and /sample?variant=<id> shows the bundled sample.
    export PORTFOLIO_PROFILE=demo PORTFOLIO_SOURCE_DIR=
    exec pnpm --filter @portfolio/web dev
    ;;
  *)
    echo "error: unknown mode '$MODE' (expected mockup or preview)" >&2
    exit 2
    ;;
esac
