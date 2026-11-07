#!/bin/sh
# Row 68's green and mutant for tests/e2e/motion-harness.spec.ts's stall-step pins, for harness push 2's
# evidence jobs to call from the repo root of the checkout (the browser container), or locally. The red
# is main's push run 42327335855 (62af1e18b, browser 3/4, job 128265602762).
#   sh ci-red-green.sh green    the checkout's spec, --repeat-each=5 --retries=0: every listed test
#                                passes every repeat (9 listed, 45 passed).
#   sh ci-red-green.sh mutant   a temp copy of the spec whose stub stalls at STALL_STEP + 1 while the
#                                pins still name STALL_STEP: its four stall pins all fail.
# Prints exact counts; exits nonzero only when the part's bar is missed. No pipes; `|| true` on --list.
# ROW68_OUT is where logs go (default reports/row68). The old `red` part stays for a local look only.
set -u
OLD=62af1e18b
PARTS=${1:?usage: sh ci-red-green.sh green|mutant}
OUT=${ROW68_OUT:-reports/row68}
SPEC=tests/e2e/motion-harness.spec.ts
mkdir -p "$OUT"
rc=0
FRAME_PINS='a scroll whose frames stop fails within its bound|a frame stall gets one rerun|a stall on both runs fails'
STALL_PINS="$FRAME_PINS|a main-thread block gets the same one rerun"

# count <log> <word>: the number before "<word>" in Playwright's list summary, or 0.
count() {
  n=$(sed -n -E "s/^ *([0-9]+) $2( .*)?\$/\1/p" "$1" | tail -1)
  echo "${n:-0}"
}
# listed <spec> <grep or empty>: Playwright's --list total.
listed() {
  if [ -n "$2" ]; then
    { pnpm exec playwright test "$1" --project=chromium --list --grep "$2" > "$OUT/list.log" 2>&1 || true; }
  else
    { pnpm exec playwright test "$1" --project=chromium --list > "$OUT/list.log" 2>&1 || true; }
  fi
  n=$(sed -n -E 's/^Total: ([0-9]+) tests? in .*/\1/p' "$OUT/list.log" | tail -1)
  echo "${n:-0}"
}
# drop <file>: a temp spec out of the tree; to the Trash where there is one (lane E's machine), else removed.
drop() {
  if [ -d "$HOME/.Trash" ]; then mv "$1" "$HOME/.Trash/$(basename "$1")-$(date +%H%M%S)"; else rm -f "$1"; fi
}
bar() { # bar <part> <what> <want> <got>
  if [ "$3" -eq "$4" ]; then echo "$1: $2 $4 of $3: ok"; else echo "$1: $2 $4, want $3: MISSED"; rc=1; fi
}

for part in $PARTS; do
  case "$part" in
    red)
      T=tests/e2e/zz-row68-red.spec.ts
      git show "$OLD:$SPEC" > "$T" || { echo "red: git show $OLD:$SPEC failed"; rc=1; continue; }
      want=$(listed "$T" "$FRAME_PINS")
      pnpm exec playwright test "$T" --project=chromium --retries=0 --reporter=list --grep "$FRAME_PINS" > "$OUT/red.log" 2>&1
      echo "red ($OLD's pins): exit $?, listed $want, passed $(count "$OUT/red.log" passed), failed $(count "$OUT/red.log" failed)"
      bar red "failed" "$want" "$(count "$OUT/red.log" failed)"
      [ "$want" -eq 3 ] || { echo "red: listed $want, want 3"; rc=1; }
      drop "$T"
      ;;
    green)
      want=$(listed "$SPEC" "")
      pnpm exec playwright test "$SPEC" --project=chromium --retries=0 --repeat-each=5 --reporter=list > "$OUT/green.log" 2>&1
      echo "green: exit $?, listed $want x 5, passed $(count "$OUT/green.log" passed), failed $(count "$OUT/green.log" failed), flaky $(count "$OUT/green.log" flaky)"
      bar green "passed" "$((want * 5))" "$(count "$OUT/green.log" passed)"
      [ "$want" -eq 9 ] || { echo "green: listed $want, want 9"; rc=1; }
      ;;
    mutant)
      T=tests/e2e/zz-row68-mutant.spec.ts
      sed 's/if (length === ${STALL_STEP} + 1)/if (length === ${STALL_STEP} + 2)/' "$SPEC" > "$T"
      if cmp -s "$SPEC" "$T"; then echo "mutant: the trap line wasn't found, nothing moved"; rc=1; drop "$T"; continue; fi
      want=$(listed "$T" "$STALL_PINS")
      pnpm exec playwright test "$T" --project=chromium --retries=0 --reporter=list --grep "$STALL_PINS" > "$OUT/mutant.log" 2>&1
      echo "mutant (stall one step later): exit $?, listed $want, passed $(count "$OUT/mutant.log" passed), failed $(count "$OUT/mutant.log" failed)"
      bar mutant "failed" "$want" "$(count "$OUT/mutant.log" failed)"
      [ "$want" -eq 4 ] || { echo "mutant: listed $want, want 4"; rc=1; }
      drop "$T"
      ;;
    *) echo "unknown part $part"; rc=1 ;;
  esac
done
echo "row68 red-green rc $rc"
exit $rc
