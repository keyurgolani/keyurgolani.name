#!/bin/sh
# Batch S's CI Linux evidence (rows 88, 88c, 88b; never merged), from the repo root of the checkout (the
# browser container), after pnpm ci:build. Each selection x 3, chromium, --retries=0, each with an output
# directory of its own (Playwright empties its outputDir at the start of every run); the config keeps a
# trace and a screenshot on failure, and Playwright writes error-context.md.
#   sh ci/evidence/row88/batchS-x3.sh <landing commit, full sha>
# 1. The tree: HEAD^ is the landing commit, and this commit changes nothing but .github/workflows/ci.yml and
#    ci/evidence/row88/.
# 2. The selections, each listed and passed exactly as wanted, and for every run that didn't pass a
#    trace.zip, a test-failed PNG and an error-context.md kept in its result directory:
#      signout     studio-signout.spec.ts whole                                   24 (8 x 3)
#      load        studio-load-failure.spec.ts whole, demo-studio-load-failure     24 (8 x 3)
#      recovery    studio-recovery.spec.ts whole (decides :236 on CI Linux)        21 (7 x 3)
#      chunks      demo-studio-chunks.spec.ts, owner-studio-chunks.spec.ts         6 (2 x 3)
#      preview     studio-preview.spec.ts:296 "signing out in another tab..."      3 (1 x 3)
#      cache       studio.spec.ts "logout clears the HTTP cache and signs..."      3 (1 x 3)
#      store       studio.spec.ts --grep 'row 88b'                                 6 (2 x 3)
# OUT is reports/row88; results under reports/browser/results-<name>. Exit 0 only when every bar is met.
set -u
LANDING=${1:?landing commit}
OUT=reports/row88
mkdir -p "$OUT"
rc=0
bar() { if [ "$3" = "$4" ]; then echo "$1: $2 $4 of $3: ok"; else echo "$1: $2 $4, want $3: MISSED"; rc=1; fi; }
summed() { awk -v w="$2" '$2 == w && $1 ~ /^[0-9]+$/ { n = $1 } END { print n + 0 }' "$1"; }

echo "== 1. the tree"
echo "HEAD $(git rev-parse HEAD)"
parent=$(git rev-parse HEAD^)
echo "HEAD^ $parent"
bar tree "the parent" "$LANDING" "$parent"
git diff --name-only HEAD^ HEAD > "$OUT/changed.txt"
cat "$OUT/changed.txt"
other=$(awk '$0 != ".github/workflows/ci.yml" && index($0, "ci/evidence/row88/") != 1 { n++ } END { print n + 0 }' "$OUT/changed.txt")
bar tree "files outside the evidence" 0 "$other"

# x3 <name> <runs wanted> <grep, or ""> <spec>...
x3() {
  name=$1; want=$2; grep=$3; shift 3
  res=reports/browser/results-$name
  echo "== 2. $name x 3: $* ${grep:+--grep \"$grep\"}, results in $res"
  if [ -n "$grep" ]; then
    set -- "$@" --grep "$grep"
  fi
  { pnpm exec playwright test "$@" --project=chromium --repeat-each=3 --list > "$OUT/$name-list.log" 2>&1 < /dev/null || true; }
  pnpm exec playwright test "$@" --project=chromium --repeat-each=3 --retries=0 --output="$res" > "$OUT/$name.log" 2>&1 < /dev/null
  code=$?
  listed=$(awk '/^Total: [0-9]+ tests? in / { n = $2 } END { print n + 0 }' "$OUT/$name-list.log")
  passed=$(summed "$OUT/$name.log" passed)
  failed=$(summed "$OUT/$name.log" failed)
  echo "$name: exit $code, listed $listed, passed $passed, failed $failed, flaky $(summed "$OUT/$name.log" flaky), skipped $(summed "$OUT/$name.log" skipped)"
  bar "$name" listed "$want" "$listed"
  bar "$name" passed "$want" "$passed"
  dirs=0; kept=0
  for d in "$res"/*/; do
    [ -d "$d" ] || continue
    dirs=$((dirs + 1))
    if [ -f "$d/trace.zip" ] && [ -f "$d/error-context.md" ] && ls "$d"/test-failed-*.png > /dev/null 2>&1; then kept=$((kept + 1)); fi
  done
  echo "$name: $dirs result directories, $kept with trace.zip, test-failed PNG and error-context.md"
  bar "$name" "failed runs with all three kept" "$failed" "$kept"
}
x3 signout 24 '' tests/e2e/studio-signout.spec.ts
x3 load 24 '' tests/e2e/studio-load-failure.spec.ts tests/e2e/demo-studio-load-failure.spec.ts
x3 recovery 21 '' tests/e2e/studio-recovery.spec.ts
x3 chunks 6 '' tests/e2e/demo-studio-chunks.spec.ts tests/e2e/owner-studio-chunks.spec.ts
x3 preview 3 'signing out in another tab sends the frame to about:blank' tests/e2e/studio-preview.spec.ts
x3 cache 3 'logout clears the HTTP cache and signs every other tab out' tests/e2e/studio.spec.ts
x3 store 6 'row 88b' tests/e2e/studio.spec.ts

echo "== Batch S evidence: $([ "$rc" = 0 ] && echo 'every bar met' || echo 'a bar MISSED')"
exit "$rc"
