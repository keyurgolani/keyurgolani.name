#!/bin/bash
# Harness-2 CI evidence only, not for merge (kgn-e/harness-2-ci): harness push 2's quality pins and
# meta cases on CI Linux, as E's local proof ticket ran them (ci/evidence/harness-2/meta-select.mts,
# judged as quality:meta judges them).
#   bash meta-linux.sh units   the quality unit pins the push changes (meta, a11y, exceptions,
#                              script-only-marks, release-scope) and ci/release's tests, each count
#                              held exactly (WANT_TSX, WANT_NODE)
#   bash meta-linux.sh cases   every A11Y_CASES case at this head (the a11y and motion meta cases),
#                              the count held exactly at WANT_A11Y, 0 NOT OK; and each of the
#                              inventory addendum's 49 script-only ids (selection.txt) ok once
#   bash meta-linux.sh red     red first, in a temp copy of the workspace (the checkout is never
#                              touched): row 48's two settle cases on 62af1e18b's interaction.ts and
#                              run-cell.ts, row 65's four motion cases on 62af1e18b's motion.ts,
#                              thresholds.json and thresholds.ts, then the rafFrames 0 mutant
#   bash meta-linux.sh inv-red  the inventory addendum's 49 script-only ids on 62af1e18b's probe.ts
#                              and conditions.ts: F1's 3, F6's 1 and F2's 8 red, exactly 12, as
#                              behaviour reds; server-words, live-server-words and
#                              hidden-server-words red, exactly 3, listed apart as message-only
#   bash meta-linux.sh inv-mutants  a05b7's 12 inventory meta mutants, each in a temp copy, each of
#                              its ids NOT OK, ran 12 of 12
# No pipes: each command writes a file and awk reads it (awk exits 0 on no match).
set -u
mode=${1:?units, cases, red, inv-red or inv-mutants}
W=$PWD
E="$W/ci/evidence/harness-2"
# a05b7's inventory meta mutants, under tests/ (their anchors name the script-only mark, which only
# the harness, the docs and the tests may name unlisted), with a suffix no tool globs.
IM="$W/tests/evidence/harness-2/inv-mutants.json.data"
R="$W/reports/harness-2"
# HARNESS2_TSX stands in for tsx in a local dry run of the plumbing only.
TSX="${HARNESS2_TSX:-$W/node_modules/.bin/tsx}"
WANT_A11Y=231
WANT_TSX=85
WANT_NODE=146
WANT_SELECTED=49
I48=(keyboard/no-js-smooth-scroll keyboard/no-js-smooth-scroll-out)
I65=(motion/frame-loop motion/good motion/one-late-frame motion/double-raf-once)
mkdir -p "$R"
lines() { awk '/^(ok|NOT OK) / { n++ } END { print n + 0 }' "$1"; }
notok() { awk '/^NOT OK / { n++ } END { print n + 0 }' "$1"; }
has() { awk -v l="$2" '$0 == l { f = 1 } END { exit !f }' "$1"; }
red() { awk -v p="NOT OK $2:" 'index($0, p) == 1 { f = 1 } END { exit !f }' "$1"; }
# sel <dir> <out> <id>...: the named cases, run from <dir>, one line each and a count.
sel() {
  local dir=$1 out=$2; shift 2
  (cd "$dir" && "$TSX" "$E/meta-select.mts" "$@") > "$out" 2> "$out.stderr" || true
  cat "$out"
}
bad=0
bar() { echo "BAR: $*"; bad=1; }
# lines_of <file>: the file's lines in the array L (no mapfile, no pipe).
lines_of() {
  L=()
  local line
  while IFS= read -r line || [ -n "$line" ]; do L+=("$line"); done < "$1"
}
groups=0
# units <label> <want> <command...>: a node:test run, its tests and passes held exactly at <want>.
units() {
  local label=$1 want=$2; shift 2
  "$@" > "$R/units-$label.log" 2>&1
  local st=$?
  local t p f
  t=$(awk '/^# tests [0-9]+$/ { n = $3 } END { print n + 0 }' "$R/units-$label.log")
  p=$(awk '/^# pass [0-9]+$/ { n = $3 } END { print n + 0 }' "$R/units-$label.log")
  f=$(awk '/^# fail [0-9]+$/ { n = $3 } END { print n + 0 }' "$R/units-$label.log")
  groups=$((groups + 1))
  echo "harness-2: units ($label): exit $st, tests $t, pass $p, fail $f; $want asked"
  awk '/^not ok / { print }' "$R/units-$label.log"
  exact "units ($label) passed" "$want" "$p"
  [ "$t" = "$want" ] || bar "units ($label): $t tests, $want asked"
  [ "$st" = 0 ] || bar "units ($label) exit $st"
}
exact() {
  if [ "$3" = "$2" ]; then echo "runs ok $1: $3 of $2"; else bar "$1: asked exactly $2, got $3"; fi
}
# copy <name>: a temp copy of the workspace without .git, the build and the reports, its node_modules
# folders linked back; its path in $T. The checkout is never touched.
copy() {
  T="${RUNNER_TEMP:-/tmp}/harness-2-$1"
  mkdir -p "$T"
  tar -C "$W" --exclude=./.git --exclude=./apps/web/.next --exclude=./reports --exclude=node_modules -cf "$T.tar" .
  tar -C "$T" -xf "$T.tar"
  find "$W" -name node_modules -type d -prune > "$R/node-modules-$1.txt"
  while read -r d; do ln -s "$d" "$T${d#"$W"}"; done < "$R/node-modules-$1.txt"
  echo "harness-2: temp copy at $T, $(awk 'END { print NR }' "$R/node-modules-$1.txt") node_modules folder(s) linked"
}
# 62af1e18b's files, written into a temp copy at run time, never carried in the tree: each read with
# git show and held to its blob id. The commit is fetched alone (CI's checkout is one commit deep)
# only when it isn't already there; a fetch or a blob that doesn't match refuses the step.
BASE=62af1e18bcd58e862195bd17dd31fe44a1bf0782
base_ready() {
  if ! git -C "$W" cat-file -e "$BASE^{commit}" 2> /dev/null; then
    echo "harness-2: fetching 62af1e18b alone (git fetch --no-tags --depth=1 origin $BASE)"
    git -C "$W" fetch --no-tags --depth=1 origin "$BASE" > "$R/fetch-base.log" 2>&1 || { cat "$R/fetch-base.log"; echo "BAR: 62af1e18b couldn't be fetched"; exit 1; }
  fi
}
# base_into <path> <blob id>: 62af1e18b's <path> over the temp copy's, if its blob is <blob id>.
base_into() {
  local got
  got=$(git -C "$W" rev-parse "$BASE:$1")
  [ "$got" = "$2" ] || { echo "BAR: 62af1e18b's $1 is blob $got, not $2"; exit 1; }
  git -C "$W" show "$BASE:$1" > "$T/$1"
}
# The inventory addendum's red-first ids (F1's 3, F6's 1, F2's 8), and its message-only reds.
INV_RED=(inventory/script-only-role-by-script inventory/script-only-mark-by-script inventory/script-only-moved
  inventory/script-only-requires-script
  inventory/script-only-live-empty enhancement/script-only-live-empty
  inventory/script-only-live-upper-off enhancement/script-only-live-upper-off
  inventory/script-only-live-bogus enhancement/script-only-live-bogus
  inventory/script-only-status-off enhancement/script-only-status-off)
INV_MESSAGE=(inventory/script-only-server-words inventory/script-only-live-server-words
  inventory/script-only-hidden-server-words)
case "$mode" in
units)
  # tsx: the quality unit pins the push changes; node: ci/release's (rows 64 and the cheap list).
  units "tsx" "$WANT_TSX" "$TSX" --test tests/quality/meta.test.ts tests/quality/a11y.test.ts \
    tests/quality/exceptions.test.ts tests/quality/script-only-marks.test.ts tests/quality/release-scope.test.ts \
    tests/quality/reporter.test.ts
  find ci/release -maxdepth 1 -name '*.test.mjs' > "$R/release-tests.unsorted"
  LC_ALL=C sort "$R/release-tests.unsorted" > "$R/release-tests.txt"
  lines_of "$R/release-tests.txt"
  release=("${L[@]}")
  echo "harness-2: ${#release[@]} ci/release test files, and tests/harness/stall-reruns.test.mjs"
  [ "${#release[@]}" = 16 ] || bar "ci/release test files: ${#release[@]}, 16 asked"
  units "node" "$WANT_NODE" node --test "${release[@]}" tests/harness/stall-reruns.test.mjs
  exact "unit groups run" 2 "$groups"
  ;;
cases)
  "$TSX" "$E/a11y-ids.mts" > "$R/a11y-ids.txt" 2> "$R/a11y-ids.stderr" || true
  n=$(awk 'END { print NR }' "$R/a11y-ids.txt")
  echo "harness-2: A11Y_CASES at $(git rev-parse --short=9 HEAD): $n listed, $WANT_A11Y asked"
  exact "A11Y_CASES listed" "$WANT_A11Y" "$n"
  awk '{ sub(/ \(no browser\)$/, ""); print }' "$R/a11y-ids.txt" > "$R/a11y-ids.plain"
  lines_of "$R/a11y-ids.plain"
  ids=("${L[@]}")
  sel "$W" "$R/a11y-head.txt" "${ids[@]}" > /dev/null
  awk '/^NOT OK |^selected / { print }' "$R/a11y-head.txt"
  exact "A11Y_CASES run" "$WANT_A11Y" "$(lines "$R/a11y-head.txt")"
  [ "$(notok "$R/a11y-head.txt")" = 0 ] || bar "A11Y_CASES: $(notok "$R/a11y-head.txt") NOT OK"
  # The inventory addendum's script-only selection (a05b7's inv/selection.txt): each ok, exactly once.
  n=$(awk 'NF { n++ } END { print n + 0 }' "$E/selection.txt")
  exact "script-only selection listed" "$WANT_SELECTED" "$n"
  got=$(awk 'NR == FNR { if (NF) want[$0] = 1; next } /^ok / { id = substr($0, 4); if (id in want) { seen[id]++ } } END { for (id in want) if (seen[id] == 1) n++; print n + 0 }' "$E/selection.txt" "$R/a11y-head.txt")
  exact "script-only selection ok once each" "$WANT_SELECTED" "$got"
  ;;
red)
  copy swap
  base_ready
  echo "== row 48 at the head"; sel "$T" "$R/row48-head.txt" "${I48[@]}"
  base_into tests/quality/lib/a11y/interaction.ts 20d21fd163197fd19d4f3ac2660f7d3ba171e103
  base_into tests/quality/lib/run-cell.ts 23585e5d55a0a3253dc579bd9bfc93d8cefd04ad
  echo "== row 48 on 62af1e18b's interaction.ts and run-cell.ts"; sel "$T" "$R/row48-base.txt" "${I48[@]}"
  cp "$W/tests/quality/lib/a11y/interaction.ts" "$T/tests/quality/lib/a11y/interaction.ts"
  cp "$W/tests/quality/lib/run-cell.ts" "$T/tests/quality/lib/run-cell.ts"
  echo "== row 65 at the head"; sel "$T" "$R/row65-head.txt" "${I65[@]}"
  base_into tests/quality/lib/a11y/motion.ts 82c63b905d3f8383db8fc128ce183cdc37b11863
  base_into quality/thresholds.json 2f4ab8a3ce51bd1c55313cd2fc0379bf5a811cec
  base_into quality/thresholds.ts 4c2b62a17c77c6faba1f5a900193716a1202adad
  echo "== row 65 on 62af1e18b's motion.ts, thresholds.json and thresholds.ts"; sel "$T" "$R/row65-base.txt" "${I65[@]}"
  cp "$W/tests/quality/lib/a11y/motion.ts" "$T/tests/quality/lib/a11y/motion.ts"
  cp "$W/quality/thresholds.ts" "$T/quality/thresholds.ts"
  node -e 'const fs = require("fs"); const p = process.argv[1]; const d = JSON.parse(fs.readFileSync(p, "utf8")); d.reducedMotion.rafFrames = 0; fs.writeFileSync(p, JSON.stringify(d, null, 2) + "\n");' "$T/quality/thresholds.json"
  echo "== row 65 mutant: rafFrames 0"; sel "$T" "$R/row65-mutant.txt" "${I65[@]}"
  for id in "${I48[@]}"; do has "$R/row48-head.txt" "ok $id" || bar "row 48 head $id not ok"; done
  red "$R/row48-base.txt" keyboard/no-js-smooth-scroll || bar "row 48 base no-js-smooth-scroll not red"
  for id in "${I65[@]}"; do has "$R/row65-head.txt" "ok $id" || bar "row 65 head $id not ok"; done
  for id in motion/one-late-frame motion/double-raf-once; do red "$R/row65-base.txt" "$id" || bar "row 65 base $id not red"; done
  for id in motion/frame-loop motion/good; do has "$R/row65-base.txt" "ok $id" || bar "row 65 base $id not ok"; done
  red "$R/row65-mutant.txt" motion/one-late-frame || bar "row 65 mutant one-late-frame not red"
  for f in row48-head row48-base; do exact "$f selected" 2 "$(lines "$R/$f.txt")"; done
  for f in row65-head row65-base row65-mutant; do exact "$f selected" 4 "$(lines "$R/$f.txt")"; done
  if git -C "$W" diff --quiet; then echo "checkout untouched"; else bar "the checkout changed"; fi
  ;;
inv-red)
  # The inventory addendum red first: its 49 script-only ids on 62af1e18b's probe.ts and
  # conditions.ts (the same blobs as 71898fafc's and 25fba4360's), in a temp copy.
  copy inv-red
  base_ready
  base_into tests/quality/lib/a11y/probe.ts 4856b288b367f7393f214097c8aac391c721a5d3
  base_into tests/quality/lib/a11y/conditions.ts 3440056b1835ac2633e63f5c4509a8130dc27671
  awk 'NF' "$E/selection.txt" > "$R/selection.plain"
  lines_of "$R/selection.plain"
  ids=("${L[@]}")
  sel "$T" "$R/inv-base.txt" "${ids[@]}" > /dev/null
  exact "inventory base selected" "$WANT_SELECTED" "$(lines "$R/inv-base.txt")"
  got=0
  for id in "${INV_RED[@]}"; do if red "$R/inv-base.txt" "$id"; then got=$((got + 1)); else bar "inventory base $id not red"; fi; done
  exact "inventory red first (F1 3, F6 1, F2 8)" "${#INV_RED[@]}" "$got"
  echo "message-only reds (the message changed, not the behaviour):"
  got=0
  for id in "${INV_MESSAGE[@]}"; do
    awk -v id="$id" 'index($0, "ok " id) == 1 || index($0, "NOT OK " id ":") == 1 { print "  " $0 }' "$R/inv-base.txt"
    if red "$R/inv-base.txt" "$id"; then got=$((got + 1)); else bar "inventory base $id (message-only) not red"; fi
  done
  exact "inventory message-only reds (server-words, live-server-words, hidden-server-words)" "${#INV_MESSAGE[@]}" "$got"
  echo "every NOT OK on the base:"
  awk '/^NOT OK / { print "  " $0 }' "$R/inv-base.txt"
  ;;
inv-mutants)
  # a05b7's 12 inventory meta mutants (tests/evidence/harness-2/inv-mutants.json.data), each patched into a temp copy, its named
  # ids run, each NOT OK, the files put back from the checkout; then ran 12 of 12.
  copy inv-mut
  n=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).length)' "$IM" < /dev/null)
  ran=0
  for ((i = 0; i < n; i++)); do
    name=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))[process.argv[2]].name)' "$IM" "$i" < /dev/null)
    node -e 'for (const id of JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))[process.argv[2]].ids) console.log(id)' "$IM" "$i" < /dev/null > "$R/inv-mut-$i.ids"
    lines_of "$R/inv-mut-$i.ids"
    mids=("${L[@]}")
    if ! node "$E/patch.mjs" "$IM" "$i" "$T" > "$R/inv-mut-$name.files" < /dev/null; then
      cat "$R/inv-mut-$name.files"; bar "$name: not applied"; continue
    fi
    sel "$T" "$R/inv-mut-$name.txt" "${mids[@]}" > /dev/null
    reds=$(notok "$R/inv-mut-$name.txt")
    echo "$name: ${#mids[@]} ids, $(lines "$R/inv-mut-$name.txt") run, $reds NOT OK"
    exact "$name ids run" "${#mids[@]}" "$(lines "$R/inv-mut-$name.txt")"
    exact "$name NOT OK" "${#mids[@]}" "$reds"
    while read -r f; do cp "$W/$f" "$T/$f"; done < "$R/inv-mut-$name.files"
    ran=$((ran + 1))
  done
  exact "inventory mutants ran" 12 "$ran"
  echo "inventory mutants: ran $ran of 12"
  ;;
*) echo "mode: units, cases, red, inv-red or inv-mutants"; exit 2 ;;
esac
echo "harness-2 $mode: $([ "$bad" = 0 ] && echo every bar met || echo NOT met)"
exit "$bad"
