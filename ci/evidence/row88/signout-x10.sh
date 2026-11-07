#!/bin/sh
# Rows 88, 88c and 88b's CI Linux evidence (Batch S), from the repo root of the checkout (the browser
# container), after pnpm ci:build. Each part prints exact counts; the script exits nonzero only when a
# bar is missed. No pipes; `|| true` on --list only.
#   sh ci/evidence/row88/signout-x10.sh <landing commit, full sha>
# 1. The tree: HEAD is this evidence commit, its parent the landing commit, and it changes nothing but
#    .github/workflows/ci.yml and ci/evidence/row88/, so every file under test is the landing's.
# 2. Each selection x 10 (--repeat-each=10, chromium, --retries=0), every run passed:
#    - row88: tests/e2e/studio-signout.spec.ts, all 8 tests (80 runs);
#    - preview: studio-preview.spec.ts's "signing out in another tab sends the frame to about:blank..." (10);
#    - studio: studio.spec.ts's "logout clears the HTTP cache and signs every other tab out" (10);
#    - load: row 88c's load-failure specs, whole: studio-load-failure.spec.ts (8 tests, row 88c's 7 and
#      row 88b's alert case) and demo-studio-load-failure.spec.ts (1) (90 runs);
#    - store: row 88b's new studio.spec.ts cases, --grep 'row 88b': the store-failed sign-in state and
#      Sign out to it (20 runs).
# OUT is reports/row88.
set -u
LANDING=${1:?landing commit}
OUT=reports/row88
mkdir -p "$OUT"
rc=0
bar() { if [ "$3" = "$4" ]; then echo "$1: $2 $4 of $3: ok"; else echo "$1: $2 $4, want $3: MISSED"; rc=1; fi; }
summed() { awk -v w="$2" '$2 == w && $1 ~ /^[0-9]+$/ { n = $1 } END { print n + 0 }' "$1"; }

echo "== 1. the tree"
head=$(git rev-parse HEAD)
parent=$(git rev-parse HEAD^)
echo "HEAD $head"
echo "HEAD^ $parent"
bar tree "the parent" "$LANDING" "$parent"
git diff --name-only HEAD^ HEAD > "$OUT/changed.txt"
cat "$OUT/changed.txt"
other=$(awk '$0 != ".github/workflows/ci.yml" && index($0, "ci/evidence/row88/") != 1 { n++ } END { print n + 0 }' "$OUT/changed.txt")
bar tree "files outside the evidence" 0 "$other"

# x10 <name> <runs wanted> <specs, space-separated> [grep]
x10() {
  name=$1; want=$2; specs=$3; grep=${4:-}
  echo "== 2. $name x 10: $specs ${grep:+(--grep \"$grep\")}"
  # shellcheck disable=SC2086
  if [ -n "$grep" ]; then
    { pnpm exec playwright test $specs --project=chromium --grep "$grep" --repeat-each=10 --list > "$OUT/$name-list.log" 2>&1 < /dev/null || true; }
    pnpm exec playwright test $specs --project=chromium --grep "$grep" --repeat-each=10 --retries=0 > "$OUT/$name.log" 2>&1 < /dev/null
  else
    { pnpm exec playwright test $specs --project=chromium --repeat-each=10 --list > "$OUT/$name-list.log" 2>&1 < /dev/null || true; }
    pnpm exec playwright test $specs --project=chromium --repeat-each=10 --retries=0 > "$OUT/$name.log" 2>&1 < /dev/null
  fi
  code=$?
  listed=$(awk '/^Total: [0-9]+ tests? in / { n = $2 } END { print n + 0 }' "$OUT/$name-list.log")
  echo "$name: exit $code, listed $listed, passed $(summed "$OUT/$name.log" passed), failed $(summed "$OUT/$name.log" failed), flaky $(summed "$OUT/$name.log" flaky)"
  bar "$name" listed "$want" "$listed"
  bar "$name" passed "$want" "$(summed "$OUT/$name.log" passed)"
  bar "$name" failed 0 "$(summed "$OUT/$name.log" failed)"
  bar "$name" flaky 0 "$(summed "$OUT/$name.log" flaky)"
  bar "$name" exit 0 "$code"
}
x10 row88 80 tests/e2e/studio-signout.spec.ts
x10 preview 10 tests/e2e/studio-preview.spec.ts 'signing out in another tab sends the frame to about:blank and shows Preview expired with Sign in again, and the page stays'
x10 studio 10 tests/e2e/studio.spec.ts 'logout clears the HTTP cache and signs every other tab out'
x10 load 90 'tests/e2e/studio-load-failure.spec.ts tests/e2e/demo-studio-load-failure.spec.ts'
x10 store 20 tests/e2e/studio.spec.ts 'row 88b'

echo "== Batch S evidence (rows 88, 88c, 88b): $([ "$rc" = 0 ] && echo 'every bar met' || echo 'a bar MISSED')"
exit "$rc"
