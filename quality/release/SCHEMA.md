# The release quality scope and records list

A release candidate's quality gate reads two files here. `rc-quality` reads them through [`tests/quality/lib/release-scope.ts`](../../tests/quality/lib/release-scope.ts), and `rc-verify` reads them through [`ci/release/verify-rc.mjs`](../../ci/release/verify-rc.mjs) and [`ci/release/verify-scope.mjs`](../../ci/release/verify-scope.mjs). Both validate and match them with [`ci/release/release-records.mjs`](../../ci/release/release-records.mjs).

## scope.json

| Field            | Type   | Meaning                                                                                                                                                                                                                                                                                                                                                                            |
| ---------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `release`        | string | The release the files are for: `X.Y.Z-rc.N` for a candidate, or `X.Y.Z`. `rc-verify` refuses a tag of another release.                                                                                                                                                                                                                                                             |
| `scope`          | string | `full`, every cell of the full plan; `default-packs`, every composition and surface on its own default packs, in every state, mode, width, row and engine; or `reachable`, what a visitor or the owner can reach: pairwise over the public compositions and shipping packs, each composition's 114 default scheme and mode pairs, no fixture pack, `acme-reference` or `fallback`. |
| `unswept`        | string | What a narrowed scope leaves out, in words. It may be empty only for `full`.                                                                                                                                                                                                                                                                                                       |
| `records`        | string | The records list beside this file, always `records.json`; any other name is refused.                                                                                                                                                                                                                                                                                               |
| `timingReported` | array  | Optional, a candidate's only: the timings its release run reports instead of gating, one entry each (see timingReported below). A final's (`X.Y.Z`) must be empty or absent.                                                                                                                                                                                                       |

Any other field is refused.

### timingReported

Each entry names one timing metric of one perf target. The release run's timing gate (`tests/quality/lib/perf/timing.ts`) logs that median against its bar instead of failing it, over the bar or under it: unlike a strict records entry, one that comes in under its bar isn't refused as passed, since a median moves from run to run. Only that metric's `timing-over` on that target is waived. The target's other metrics, the metric on any other target, a perf test that's missing, retried or short of loads, and a re-run still fail. Each target and metric pair appears once, and fields that aren't listed here are refused. Each candidate's `timingReported` is its own: a later candidate lists an entry again only with the coordinator's word, and promotion refuses a candidate whose `timingReported` names any.

| Field    | Type   | Meaning                                                                                                                 |
| -------- | ------ | ----------------------------------------------------------------------------------------------------------------------- |
| `target` | string | The perf test's target, as `summary.json` names it: `composition:<id>` or `surface:<id>`.                               |
| `metric` | string | One of `lcpMs`, `cls`, `tbtMs`, `idleTaskMs`, `heapMiB` and `growthMiB`.                                                |
| `row`    | string | The routed row that gates it again before the final release, as `row <n>`, such as `row 135`. Anything else is refused. |
| `reason` | string | Why the timing is reported, in words. It may not be blank.                                                              |

## records.json

A JSON array with one entry for each failure record the candidate ships with. A failure record is one rule failing on one element in one cell test. Fields that aren't listed here are refused.

| Field      | Type   | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ---------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cell`     | string | The test's cell id, exactly as `summary.json` names it: `<kind>:<id> <state> / <variant>/<language>/<scheme>/<typography>/<display mode>`.                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `viewport` | string | The test's viewport, such as `1440x900`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `row`      | string | The test's preference row, such as `default` or `forced-colors`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `engine`   | string | The test's engine: `chromium`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `check`    | string | The failure record's check: `axe`, `focus`, `contrast`, `motion`, `transparency`, `runner`, and the rest.                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `rule`     | string | The rule in that check that failed, such as `color-contrast`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `target`   | string | The element: the page selector the check recorded. An element with none, inside a frame or a shadow root, is `aria:<role>\|<name>\|<slot>`. A record from another page than the test's own, such as the primitives page an appearance cell also audits, is `<surface> >> <element>`. A record from another viewport, such as the landscape occlusion pass, is `@<width>x<height> <element>`, and one from both, `@844x390 primitives >> <element>`. A record with no element is `null` in the summary, and RC1's list refuses it until RC2's per-element key. |
| `owner`    | string | The lane or person who fixes it, such as `lane C`. Blank values, the printed placeholder, and TBD, TBA, none, unknown, unowned, nobody or owner in any case are refused.                                                                                                                                                                                                                                                                                                                                                                                      |
| `routed`   | string | The row that fixes it before the final release: `row <n>`, such as `row 5` or `row 22b`. Blank values, `TBD`, `row 0` and the printed placeholder are refused.                                                                                                                                                                                                                                                                                                                                                                                                |
| `note`     | string | Optional text for readers, at most 300 characters. It is never matched.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `flaky`    | `true` | Optional. It marks an entry seen failing and passing on one commit. It needs `seen`. Until RC2's evidence check reads the runs, every flaky entry is refused.                                                                                                                                                                                                                                                                                                                                                                                                 |
| `seen`     | object | A flaky entry's evidence: `{"commit": "<40-hex sha>", "failed": "<run id>", "passed": "<run id>"}`. These are the commit, a run where the record failed and a run where it passed, as two different digit strings. It is refused on a strict entry.                                                                                                                                                                                                                                                                                                           |

### The key and the matcher

An entry's key is `[cell, viewport, row, engine, check, rule, target]`, compared by exact string equality. Its cell, viewport, row and engine are the test's. Its check, rule and target come from the failure record's own fields, the target qualified when the record's page or viewport isn't the test's own. The summary test carries them for each unwaived record, through the reporter's `failures`. It never comes from the message. Measurements such as expected, actual, threshold, element counts and pixel counts are never part of the key.

- Each unwaived failure record of a failing cell test must be listed. If it isn't, the gate fails with `unlisted-failure` and prints a ready-to-paste entry, with placeholders where the owner and row go.
- A failing cell test counts as its listed records only when they're all it failed on: it ended `failed` (not timed out), with no error past the soft expectations runCell counts behind its records, every check it owed run, and no key twice. A test interrupted mid-run comes out skipped, which the verdict refuses as an undeclared skip. Anything else fails it as unrecorded: no record, egress (the egress fixtures' own runner records, or the worker's late server check, whose error is past those expectations), a teardown error or timeout, an owed check skipped, a malformed record, or a summary field missing or odd (no errors list, no soft count, nothing owed).
- Key fields take no space at either end, the engine is one RUN_ENGINES.full launches, and no entry may name egress.
- A **strict** entry, one without `flaky`, must still fail wherever its test runs. If its test ran without that record, the gate fails with `listed-passed`. A test that is itself unrecorded is held: what it failed on, such as a timeout before it wrote any record or a skipped check behind one, says nothing of its records, so none of its entries reads as passed. The gate fails on the test all the same. `rc-verify`, reading a push run, judges a condition entry only where its check ran: when the entry's check is `reflow`, `inventory` or `enhancement`, and its test's well-formed `owed` list lacks it and its `checks` list doesn't hold it, the entry is not judged, and the job summary prints it as a note, never as one to take out. A `quality-pr` test owes the conditions only where the plan gives its cell them (the first default cell, a tier pack's, or one a change directs), so most sentinels owe none and some do; theirs stay judged. An entry of any other check is judged as before, and so is one whose test's `owed` list is missing or malformed (not a list of non-empty names, or short of one of `CELL_CHECKS`, which every test owes) or whose `checks` list is missing. `rc-quality` judges every entry, since full mode owes every condition.
- A **flaky** entry may pass or fail where its test runs. When its test fails, the test's other records still have to be listed, so any other failure in that cell blocks. `rc-verify`'s job summary prints each flaky entry and how it came out: failed, passed, not judged (its test held, or a condition its test didn't owe or run there), or not run.
- A list may hold at most 5 flaky entries (`MAX_FLAKY`). More need the coordinator's word, and a change to that cap.
- A final release, `X.Y.Z`, takes scope `full` or `reachable`, an empty list, flaky entries included, and no `timingReported`. v1.0.0 promotes on `reachable`.

### Example

```json
[
  {
    "cell": "composition:horizontal-cinema complete / horizontal-cinema/platform-neutral/warm-parchment/humanist-ui/system",
    "viewport": "1440x900",
    "row": "default",
    "engine": "chromium",
    "check": "focus",
    "rule": "contrast",
    "target": "html > body:nth-child(2) > div:nth-child(2) > div:nth-child(2) > header:nth-child(2) > nav:nth-child(2) > span:nth-child(1) > a:nth-child(1)",
    "owner": "lane C",
    "routed": "row 5",
    "note": "nav link focus ring under 3:1"
  },
  {
    "cell": "composition:horizontal-cinema complete / horizontal-cinema/platform-neutral/warm-parchment/humanist-ui/system",
    "viewport": "1024x768",
    "row": "default",
    "engine": "chromium",
    "check": "focus",
    "rule": "perimeter",
    "target": "#scene-15 > div:nth-child(4) > a:nth-child(2)",
    "owner": "lane C",
    "routed": "row 31",
    "flaky": true,
    "seen": {
      "commit": "0123456789abcdef0123456789abcdef01234567",
      "failed": "42200000001",
      "passed": "42200000002"
    }
  }
]
```

The second entry's `seen` values are placeholders that only show the shape, and RC1's list refuses a flaky entry until RC2's evidence check lands. A real flaky entry names two runs on one commit, one where its record failed and one where it passed.
