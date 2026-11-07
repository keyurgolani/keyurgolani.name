#!/bin/sh
# Batch K's pins on CI Linux, from the repo root of the checkout (quality-pr's pinned image), after the
# build. Each part prints exact counts and exits nonzero only when its bar is missed. No pipes but the
# few into grep for counts; `|| true` on --list; retries 0.
#   sh k-pins.sh unit    composition.test.tsx: row 61's 2 and row 94's 1 named tests, each passed 1,
#                        failed 0; the whole file, passed == its tests.
#   sh k-pins.sh e2e     kinetic-motion.spec.ts: row 61's 3 named tests listed == 3, then
#                        --repeat-each=5 --retries=0: 15 passed, 0 failed.
#   sh k-pins.sh cells   the 12 packs' 1440x900 print cells and #197's 4 reduced-transparency cells, by
#                        exact grep: listed == 16 (quality:full -- --list), then run; k-read.py names
#                        each cell's status and keys: every cell finished, the 12 print cells with no
#                        record (row 94's bar), the 4 reduced-transparency cells shown as data
#                        (expected red, row 91's), never a failure.
# K_OUT is where logs go (default reports/batch-k).
set -u
OUT=${K_OUT:-reports/batch-k}
mkdir -p "$OUT" && OUT=$(cd "$OUT" && pwd) || exit 2
rc=0
UNIT=packages/variant-kinetic-cosmos/src/composition.test.tsx
SPEC=tests/e2e/kinetic-motion.spec.ts
U61A="with no script a section link shows only its own fold, and print and no script read every dialog inline"
U61B="with no script the stylesheet keys on main's noscript mark, never on a scripting query"
U94="in print, the caption and plates the map grounds on the stage's dark take the page's ground, as their ink does (#197's print reds)"
E61A="the no-script styles apply only where main's noscript mark is, and no stylesheet reads a scripting query"
E61B="with no script, at 1024 by 768, no arc stop on the first screen is under the dock"
E61C="with script there is no noscript mark and the dock stays sticky; without, it is in the flow"
LANGS="carbon-inspired|fluent-2-inspired|glassmorphism|international-grid|material-3-inspired|minimal-flat|neobrutalist|paper-tactile|platform-neutral|primer-inspired|soft-organic|spectrum-2-inspired"
RT_LANGS="fluent-2-inspired|platform-neutral|soft-organic|spectrum-2-inspired"
GREP="composition:kinetic-cosmos complete / kinetic-cosmos/(($LANGS)/warm-parchment/humanist-ui/system 1440x900 print|($RT_LANGS)/warm-parchment/humanist-ui/system 1440x900 reduced-transparency)"
esc() { printf '%s' "$1" | sed 's/[][\\.*^$()+?{}|]/\\&/g'; }
count() { n=$(sed -n -E "s/^ *([0-9]+) $2( .*)?\$/\1/p" "$1" | tail -1); echo "${n:-0}"; }
bar() { if [ "$3" -eq "$4" ]; then echo "$1: $2 $4 of $3: ok"; else echo "$1: $2 $4, want $3: MISSED"; rc=1; fi; }
case "${1:?usage: sh k-pins.sh unit|e2e|cells}" in
  unit)
    n=0
    for t in "$U61A" "$U61B" "$U94"; do
      n=$((n + 1))
      (cd packages/variant-kinetic-cosmos && ../../node_modules/.bin/tsx --test --test-reporter=tap --test-name-pattern="$(esc "$t")" src/composition.test.tsx > "$OUT/unit-$n.log" 2>&1 < /dev/null)
      p=$(sed -n -E 's/^# pass ([0-9]+)$/\1/p' "$OUT/unit-$n.log"); f=$(sed -n -E 's/^# fail ([0-9]+)$/\1/p' "$OUT/unit-$n.log")
      case $n in 3) row=94 ;; *) row=61 ;; esac
      echo "unit row $row: passed ${p:-0}, failed ${f:-0}: $t"
      bar "unit row $row pin $n" passed 1 "${p:-0}"; bar "unit row $row pin $n" failed 0 "${f:-0}"
    done
    (cd packages/variant-kinetic-cosmos && ../../node_modules/.bin/tsx --test --test-reporter=tap src/composition.test.tsx > "$OUT/unit-whole.log" 2>&1 < /dev/null)
    ut=$(sed -n -E 's/^# tests ([0-9]+)$/\1/p' "$OUT/unit-whole.log"); up=$(sed -n -E 's/^# pass ([0-9]+)$/\1/p' "$OUT/unit-whole.log")
    echo "unit whole: tests ${ut:-0}, passed ${up:-0}"
    [ "${ut:-0}" -gt 0 ] && bar "unit whole" passed "$ut" "${up:-0}" || { echo "unit whole: no tests: MISSED"; rc=1; }
    ;;
  e2e)
    PINS="$(esc "$E61A")|$(esc "$E61B")|$(esc "$E61C")"
    { pnpm exec playwright test "$SPEC" --project=chromium --list --grep "$PINS" > "$OUT/e2e-list.log" 2>&1 < /dev/null || true; }
    l=$(sed -n -E 's/^Total: ([0-9]+) tests? in .*/\1/p' "$OUT/e2e-list.log" | tail -1)
    bar "e2e row 61" listed 3 "${l:-0}"
    pnpm exec playwright test "$SPEC" --project=chromium --retries=0 --repeat-each=5 --reporter=list --grep "$PINS" > "$OUT/e2e.log" 2>&1 < /dev/null
    echo "e2e row 61: exit $?, passed $(count "$OUT/e2e.log" passed), failed $(count "$OUT/e2e.log" failed), flaky $(count "$OUT/e2e.log" flaky)"
    for t in "$E61A" "$E61B" "$E61C"; do echo "e2e row 61: $(grep -c -F -- "$t" "$OUT/e2e.log") result lines: $t"; done
    bar "e2e row 61" passed 15 "$(count "$OUT/e2e.log" passed)"; bar "e2e row 61" failed 0 "$(count "$OUT/e2e.log" failed)"
    ;;
  cells)
    echo "$GREP" > "$OUT/cells-grep.txt"
    { CI_REPORTS_DIR="$OUT/cells-list" pnpm quality:full -- --grep "$GREP" --list > "$OUT/cells-list.log" 2>&1 < /dev/null || true; }
    l=$(sed -n -E 's/^Total: ([0-9]+) tests? in .*/\1/p' "$OUT/cells-list.log" | tail -1)
    bar "cells" listed 16 "${l:-0}"
    { CI_REPORTS_DIR="$OUT/cells" pnpm quality:full -- --grep "$GREP" --retries=0 > "$OUT/cells.log" 2>&1 < /dev/null || true; }
    echo "cells: quality:full done (its exit is the verdict's over the whole plan; the records are the read)"
    python3 -I -B ci/evidence/batch-k/k-read.py "$OUT/cells" > "$OUT/k-read.txt" 2>&1
    ke=$?; cat "$OUT/k-read.txt"
    [ "$ke" -eq 0 ] && echo "cells: k-read exit 0: ok" || { echo "cells: k-read exit $ke: MISSED"; rc=1; }
    ;;
  *) echo "unknown part $1"; rc=2 ;;
esac
echo "batch-k $1 rc $rc"
exit $rc
