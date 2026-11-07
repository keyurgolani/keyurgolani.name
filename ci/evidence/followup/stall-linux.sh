#!/bin/sh
# Harness push 2 follow-up's CI Linux evidence for the stall reporter (items 7, 9b and 9c), from the
# repo root of the checkout (the browser container). Each part prints exact counts; the script exits
# nonzero only when a bar is missed. No pipes; `|| true` on --list only.
#   sh ci/evidence/followup/stall-linux.sh <landing commit, full sha>
# 1. The tree: HEAD is this evidence commit, its parent the landing commit, and it changes nothing
#    but .github/workflows/ci.yml and ci/evidence/followup/, so every file under test is the landing's.
# 2. tests/harness/stall-reruns.test.mjs: 7 passed, 0 failed.
# 3. tests/e2e/motion-harness.spec.ts once (chromium, no retry) under CI_GATE=browser, the config's own
#    reporters (failure-reporter.ts among them): 18 listed, 18 passed, 0 failed, 0 flaky; no
#    motion-stall-rerun warning in its log; the job summary it wrote printed, holding "### Stall
#    reruns", "Stall reruns: 0" and "harness self-tests: 9", each exactly once.
# OUT is reports/followup.
set -u
LANDING=${1:?landing commit}
OUT=reports/followup
SPEC=tests/e2e/motion-harness.spec.ts
mkdir -p "$OUT"
rc=0
bar() { if [ "$3" = "$4" ]; then echo "$1: $2 $4 of $3: ok"; else echo "$1: $2 $4, want $3: MISSED"; rc=1; fi; }
summed() { awk -v w="$2" '$2 == w && $1 ~ /^[0-9]+$/ { n = $1 } END { print n + 0 }' "$1"; }
lines() { awk -v l="$2" '$0 == l { n++ } END { print n + 0 }' "$1"; }

echo "== 1. the tree"
head=$(git rev-parse HEAD)
parent=$(git rev-parse HEAD^)
echo "HEAD $head"
echo "HEAD^ $parent"
bar tree "the parent" "$LANDING" "$parent"
git diff --name-only HEAD^ HEAD > "$OUT/changed.txt"
cat "$OUT/changed.txt"
other=$(awk '$0 != ".github/workflows/ci.yml" && index($0, "ci/evidence/followup/") != 1 { n++ } END { print n + 0 }' "$OUT/changed.txt")
bar tree "files outside the evidence" 0 "$other"

echo "== 2. stall-reruns.test.mjs"
node --test tests/harness/stall-reruns.test.mjs > "$OUT/units.log" 2>&1
echo "units: exit $?"
p=$(awk '/^# pass [0-9]+$/ { n = $3 } END { print n + 0 }' "$OUT/units.log")
f=$(awk '/^# fail [0-9]+$/ { n = $3 } END { print n + 0 }' "$OUT/units.log")
bar units passed 7 "$p"
bar units failed 0 "$f"

echo "== 3. motion-harness.spec.ts x 1, CI_GATE=browser"
{ pnpm exec playwright test "$SPEC" --project=chromium --list > "$OUT/list.log" 2>&1 < /dev/null || true; }
listed=$(awk '/^Total: [0-9]+ tests? in / { n = $2 } END { print n + 0 }' "$OUT/list.log")
before=$(awk 'END { print NR }' "${GITHUB_STEP_SUMMARY:?no job summary}")
CI_GATE=browser pnpm exec playwright test "$SPEC" --project=chromium --retries=0 > "$OUT/harness.log" 2>&1 < /dev/null
echo "harness: exit $?, listed $listed, passed $(summed "$OUT/harness.log" passed), failed $(summed "$OUT/harness.log" failed), flaky $(summed "$OUT/harness.log" flaky)"
bar harness listed 18 "$listed"
bar harness passed 18 "$(summed "$OUT/harness.log" passed)"
bar harness failed 0 "$(summed "$OUT/harness.log" failed)"
bar harness flaky 0 "$(summed "$OUT/harness.log" flaky)"
warned=$(awk 'index($0, "::warning title=motion-stall-rerun::") > 0 { n++ } END { print n + 0 }' "$OUT/harness.log")
bar harness "motion-stall-rerun warnings" 0 "$warned"
awk -v from="$before" 'NR > from' "$GITHUB_STEP_SUMMARY" > "$OUT/summary.md"
echo "-- the job summary the reporter wrote:"
cat "$OUT/summary.md"
echo "-- end of the job summary"
bar summary '"### Stall reruns" lines' 1 "$(lines "$OUT/summary.md" '### Stall reruns')"
bar summary '"Stall reruns: 0" lines' 1 "$(lines "$OUT/summary.md" 'Stall reruns: 0')"
bar summary '"harness self-tests: 9" lines' 1 "$(lines "$OUT/summary.md" 'harness self-tests: 9')"

echo "== followup evidence: $([ "$rc" = 0 ] && echo 'every bar met' || echo 'a bar MISSED')"
exit "$rc"
