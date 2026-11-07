#!/bin/sh
# Row 60's addendum pins, for harness push 2's evidence jobs, from the repo root of the checkout (the
# browser container), or locally. Each entry point prints exact counts and exits nonzero only when its
# bar is missed. No pipes; `|| true` on --list.
#   sh ci-row60-addendum.sh green     motion-harness.spec.ts at --repeat-each=5 --retries=0:
#                                      18 listed, 90 passed, 0 failed; and stall-reruns.test.mjs, 4/4.
#   sh ci-row60-addendum.sh mutants   each mutant in mutants.tsv (beside this script) written into its file
#                                      in place, its pins run, the file put back: each pin set fails exactly,
#                                      and the number run equals the tsv's data rows. A trap puts the file
#                                      back if the run is killed. Commands in the loop read /dev/null, not the tsv.
# ROW60A_OUT is where logs go (default reports/row60a).
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
OUT=${ROW60A_OUT:-reports/row60a}
SPEC=tests/e2e/motion-harness.spec.ts
mkdir -p "$OUT"
rc=0
count() { n=$(sed -n -E "s/^ *([0-9]+) $2( .*)?\$/\1/p" "$1" | tail -1); echo "${n:-0}"; }
listed() {
  { pnpm exec playwright test "$SPEC" --project=chromium --list --grep "$1" > "$OUT/list.log" 2>&1 < /dev/null || true; }
  n=$(sed -n -E 's/^Total: ([0-9]+) tests? in .*/\1/p' "$OUT/list.log" | tail -1); echo "${n:-0}"
}
bar() { if [ "$3" -eq "$4" ]; then echo "$1: $2 $4 of $3: ok"; else echo "$1: $2 $4, want $3: MISSED"; rc=1; fi; }
case "${1:?usage: sh ci-row60-addendum.sh green|mutants}" in
  green)
    want=$(listed '.')
    pnpm exec playwright test "$SPEC" --project=chromium --retries=0 --repeat-each=5 --reporter=list > "$OUT/green.log" 2>&1
    echo "green: exit $?, listed $want x 5, passed $(count "$OUT/green.log" passed), failed $(count "$OUT/green.log" failed), flaky $(count "$OUT/green.log" flaky)"
    bar green passed "$((want * 5))" "$(count "$OUT/green.log" passed)"
    [ "$want" -eq 18 ] || { echo "green: listed $want, want 18"; rc=1; }
    node --test tests/harness/stall-reruns.test.mjs > "$OUT/units.log" 2>&1
    passed=$(sed -n -E 's/^# pass ([0-9]+)$/\1/p' "$OUT/units.log"); failed=$(sed -n -E 's/^# fail ([0-9]+)$/\1/p' "$OUT/units.log")
    echo "units: stall-reruns.test.mjs passed ${passed:-0}, failed ${failed:-0}"
    bar units passed 4 "${passed:-0}"
    ;;
  mutants)
    rows=$(grep -vc -E '^(#|$)' "$HERE/mutants.tsv")
    ran=0
    restore=''
    trap 'if [ -n "$restore" ]; then cp "$restore" "$file"; fi' EXIT
    trap 'if [ -n "$restore" ]; then cp "$restore" "$file"; restore=""; fi; exit 130' INT TERM
    while IFS="$(printf '\t')" read -r name file anchor replacement tests want; do
      case "$name" in ''|'#'*) continue ;; esac
      cp "$file" "$OUT/$name.orig"
      restore="$OUT/$name.orig"
      node -e '
const fs = require("fs");
const [p, a, b] = process.argv.slice(1);
const nl = (x) => x.split("\\n").join("\n");
const old = nl(a), nw = nl(b);
const s = fs.readFileSync(p, "utf8");
const n = s.split(old).length - 1;
if (n !== 1) { console.error(`anchor found ${n} times`); process.exit(1); }
fs.writeFileSync(p, s.replace(old, () => nw));
' "$file" "$anchor" "$replacement" < /dev/null
      if [ $? -ne 0 ]; then echo "$name: anchor not found once: MISSED"; rc=1; cp "$OUT/$name.orig" "$file"; restore=''; continue; fi
      listedn=$(listed "$tests")
      pnpm exec playwright test "$SPEC" --project=chromium --retries=0 --reporter=list --grep "$tests" > "$OUT/$name.log" 2>&1 < /dev/null
      echo "$name: exit $?, listed $listedn, passed $(count "$OUT/$name.log" passed), failed $(count "$OUT/$name.log" failed)"
      bar "$name" failed "$want" "$(count "$OUT/$name.log" failed)"
      [ "$listedn" -eq "$want" ] || { echo "$name: listed $listedn, want $want"; rc=1; }
      cp "$OUT/$name.orig" "$file"
      restore=''
      ran=$((ran + 1))
    done < "$HERE/mutants.tsv"
    if [ "$ran" -eq "$rows" ]; then echo "mutants: ran $ran of $rows: ok"; else echo "mutants: ran $ran of $rows: MISSED"; rc=1; fi
    ;;
  *) echo "unknown entry point $1"; rc=2 ;;
esac
echo "row60 addendum $1 rc $rc"
exit $rc
