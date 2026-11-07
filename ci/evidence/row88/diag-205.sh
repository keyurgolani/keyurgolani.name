#!/bin/sh
# #205's four reds on CI Linux, kept this time (Batch S, diagnostic, never merged), from the repo root of the
# checkout (the browser container), after pnpm ci:build. Each pin x 3, chromium, --retries=0, each selection
# with an output directory of its own: Playwright empties its outputDir at the start of every run, which is
# what left #205's artifact with no trace, screenshot or error-context.md (signout-x10.sh ran its five
# selections into one). The config already keeps a trace and a screenshot on failure.
#   sh ci/evidence/row88/diag-205.sh <landing commit, full sha>
# 1. The tree: HEAD^ is the landing commit, and this commit changes nothing but .github/workflows/ci.yml and
#    ci/evidence/row88/.
# 2. w2: studio-signout.spec.ts --grep 'row 88, W2' (:130), 3 runs; h: studio-load-failure.spec.ts
#    --grep 'row 88c, H' (H1 :215, H2 :233, H3 :254), 9 runs. Red is expected at this landing; the bars are
#    the counts listed and, for every run that didn't pass, a trace.zip, a test-failed PNG and an
#    error-context.md kept in its own result directory.
# OUT is reports/row88; results under reports/browser/results-<name>.
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

# x3 <name> <runs wanted> <spec> <grep>
x3() {
  name=$1; want=$2; spec=$3; grep=$4
  res=reports/browser/results-$name
  echo "== 2. $name x 3: $spec --grep \"$grep\", results in $res"
  { pnpm exec playwright test "$spec" --project=chromium --grep "$grep" --repeat-each=3 --list > "$OUT/$name-list.log" 2>&1 < /dev/null || true; }
  pnpm exec playwright test "$spec" --project=chromium --grep "$grep" --repeat-each=3 --retries=0 --output="$res" > "$OUT/$name.log" 2>&1 < /dev/null
  code=$?
  listed=$(awk '/^Total: [0-9]+ tests? in / { n = $2 } END { print n + 0 }' "$OUT/$name-list.log")
  passed=$(summed "$OUT/$name.log" passed)
  failed=$(summed "$OUT/$name.log" failed)
  echo "$name: exit $code, listed $listed, passed $passed, failed $failed, flaky $(summed "$OUT/$name.log" flaky)"
  bar "$name" listed "$want" "$listed"
  dirs=0; kept=0
  for d in "$res"/*/; do
    [ -d "$d" ] || continue
    dirs=$((dirs + 1))
    if [ -f "$d/trace.zip" ] && [ -f "$d/error-context.md" ] && ls "$d"/test-failed-*.png > /dev/null 2>&1; then kept=$((kept + 1)); fi
  done
  echo "$name: $dirs result directories, $kept with trace.zip, test-failed PNG and error-context.md"
  bar "$name" "failed runs with all three kept" "$failed" "$kept"
}
x3 w2 3 tests/e2e/studio-signout.spec.ts 'row 88, W2'
x3 h 9 tests/e2e/studio-load-failure.spec.ts 'row 88c, H'

echo "== #205 diagnostic: $([ "$rc" = 0 ] && echo 'every bar met' || echo 'a bar MISSED')"
exit "$rc"
