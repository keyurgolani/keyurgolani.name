#!/bin/sh
# Row 61's e2e pins on CI Linux, from the repo root of the checkout (the browser container), after
# the build. Each part prints exact counts and exits nonzero only when its bar is missed. No pipes;
# `|| true` on --list.
#   sh kc-motion.sh spec   tests/e2e/kinetic-motion.spec.ts once, --retries=0: passed == its own
#                          --list count, 0 failed, 0 flaky.
#   sh kc-motion.sh pins   the two new pins, --repeat-each=5 --retries=0: 2 listed, 10 passed.
# KC_MOTION_OUT is where logs go (default reports/row61).
set -u
OUT=${KC_MOTION_OUT:-reports/row61}
SPEC=tests/e2e/kinetic-motion.spec.ts
PINS='with no script, at 1024 by 768, no arc stop on the first screen is under the dock|with script there is no noscript mark and the dock stays sticky; without, it is in the flow'
mkdir -p "$OUT"
rc=0
count() { n=$(sed -n -E "s/^ *([0-9]+) $2( .*)?\$/\1/p" "$1" | tail -1); echo "${n:-0}"; }
listed() {
  if [ -n "$1" ]; then
    { pnpm exec playwright test "$SPEC" --project=chromium --list --grep "$1" > "$OUT/list.log" 2>&1 < /dev/null || true; }
  else
    { pnpm exec playwright test "$SPEC" --project=chromium --list > "$OUT/list.log" 2>&1 < /dev/null || true; }
  fi
  n=$(sed -n -E 's/^Total: ([0-9]+) tests? in .*/\1/p' "$OUT/list.log" | tail -1); echo "${n:-0}"
}
bar() { if [ "$3" -eq "$4" ]; then echo "$1: $2 $4 of $3: ok"; else echo "$1: $2 $4, want $3: MISSED"; rc=1; fi; }
case "${1:?usage: sh kc-motion.sh spec|pins}" in
  spec)
    want=$(listed '')
    [ "$want" -gt 0 ] || { echo "spec: listed 0: MISSED"; rc=1; }
    pnpm exec playwright test "$SPEC" --project=chromium --retries=0 --reporter=list > "$OUT/spec.log" 2>&1 < /dev/null
    echo "spec: exit $?, listed $want, passed $(count "$OUT/spec.log" passed), failed $(count "$OUT/spec.log" failed), flaky $(count "$OUT/spec.log" flaky), skipped $(count "$OUT/spec.log" skipped)"
    bar spec passed "$want" "$(count "$OUT/spec.log" passed)"
    bar spec failed 0 "$(count "$OUT/spec.log" failed)"
    ;;
  pins)
    want=$(listed "$PINS")
    [ "$want" -eq 2 ] || { echo "pins: listed $want, want 2: MISSED"; rc=1; }
    pnpm exec playwright test "$SPEC" --project=chromium --retries=0 --repeat-each=5 --reporter=list --grep "$PINS" > "$OUT/pins.log" 2>&1 < /dev/null
    echo "pins: exit $?, listed $want x 5, passed $(count "$OUT/pins.log" passed), failed $(count "$OUT/pins.log" failed), flaky $(count "$OUT/pins.log" flaky)"
    bar pins passed 10 "$(count "$OUT/pins.log" passed)"
    bar pins failed 0 "$(count "$OUT/pins.log" failed)"
    ;;
  *) echo "unknown part $1"; rc=2 ;;
esac
echo "row61 kc-motion $1 rc $rc"
exit $rc
