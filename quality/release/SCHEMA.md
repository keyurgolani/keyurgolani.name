# The release quality scope and records list

A release candidate's quality gate reads two files here. `rc-quality` reads them through [`tests/quality/lib/release-scope.ts`](../../tests/quality/lib/release-scope.ts), and `rc-verify` reads them through [`ci/release/verify-rc.mjs`](../../ci/release/verify-rc.mjs) and [`ci/release/verify-scope.mjs`](../../ci/release/verify-scope.mjs). Both validate and match them with [`ci/release/release-records.mjs`](../../ci/release/release-records.mjs).

## scope.json

| Field     | Type   | Meaning                                                                                                                                                       |
| --------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `release` | string | The release the files are for: `X.Y.Z-rc.N` for a candidate, or `X.Y.Z`. `rc-verify` refuses a tag of another release.                                        |
| `scope`   | string | `full`, every cell of the full plan; or `default-packs`, every composition and surface on its own default packs, in every state, mode, width, row and engine. |
| `unswept` | string | What a narrowed scope leaves out, in words. It may be empty only for `full`.                                                                                  |
| `records` | string | The records list beside this file, always `records.json`; any other name, and any other field, is refused.                                                    |

## records.json

A JSON array with one entry for each failure record the candidate ships with. A failure record is one rule failing on one element in one cell test. Fields that aren't listed here are refused.

| Field      | Type   | Meaning                                                                                                                                                                                                                                               |
| ---------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cell`     | string | The test's cell id, exactly as `summary.json` names it: `<kind>:<id> <state> / <variant>/<language>/<scheme>/<typography>/<display mode>`.                                                                                                            |
| `viewport` | string | The test's viewport, such as `1440x900`.                                                                                                                                                                                                              |
| `row`      | string | The test's preference row, such as `default` or `forced-colors`.                                                                                                                                                                                      |
| `engine`   | string | The test's engine: `chromium`.                                                                                                                                                                                                                        |
| `check`    | string | The failure record's check: `axe`, `focus`, `contrast`, `motion`, `transparency`, `runner`, and the rest.                                                                                                                                             |
| `rule`     | string | The rule in that check that failed, such as `color-contrast`.                                                                                                                                                                                         |
| `target`   | string | The element: the page selector the check recorded. An element with none, inside a frame or a shadow root, is `aria:<role>\|<name>\|<slot>`. A record with no element is `null` in the summary, and RC1's list refuses it until RC2's per-element key. |
| `owner`    | string | The lane or person who fixes it, such as `lane C`. Blank values, the printed placeholder, and TBD, TBA, none, unknown, unowned, nobody or owner in any case are refused.                                                                              |
| `routed`   | string | The row that fixes it before the final release: `row <n>`, such as `row 5` or `row 22b`. Blank values, `TBD`, `row 0` and the printed placeholder are refused.                                                                                        |
| `note`     | string | Optional text for readers, at most 300 characters. It is never matched.                                                                                                                                                                               |
| `flaky`    | `true` | Optional. It marks an entry seen failing and passing on one commit. It needs `seen`. Until RC2's evidence check reads the runs, every flaky entry is refused.                                                                                         |
| `seen`     | object | A flaky entry's evidence: `{"commit": "<40-hex sha>", "failed": "<run id>", "passed": "<run id>"}`. These are the commit, a run where the record failed and a run where it passed, as two different digit strings. It is refused on a strict entry.   |

### The key and the matcher

An entry's key is `[cell, viewport, row, engine, check, rule, target]`, compared by exact string equality. It comes from the failure record's own fields: the summary test carries them for each unwaived record, through the reporter's `failures`. It never comes from the message. Measurements such as expected, actual, threshold, element counts and pixel counts are never part of the key.

- Each unwaived failure record of a failing cell test must be listed. If it isn't, the gate fails with `unlisted-failure` and prints a ready-to-paste entry, with placeholders where the owner and row go.
- A failing cell test counts as its listed records only when they're all it failed on: it ended `failed` (not timed out), with no error past the soft expectations runCell counts behind its records, every check it owed run, and no key twice. Anything else fails it as unrecorded: no record, egress (the browser's own runner record, or a server error past those expectations), a teardown error or timeout, an owed check skipped, a malformed record.
- Key fields take no space at either end, the engine is one RUN_ENGINES.full launches, and no entry may name egress.
- A **strict** entry, one without `flaky`, must still fail wherever its test runs. If its test ran without that record, the gate fails with `listed-passed`.
- A **flaky** entry may pass or fail where its test runs. When its test fails, the test's other records still have to be listed, so any other failure in that cell blocks. `rc-verify`'s job summary prints each flaky entry and how it came out: failed, passed, not run, or not read on a green run.
- A list may hold at most 5 flaky entries (`MAX_FLAKY`). More need the coordinator's word, and a change to that cap.
- A final release, `X.Y.Z`, takes scope `full` and an empty list, flaky entries included. The full matrix fits the release's 256-shard matrix only after RC2's sizing item, so v1.0.0 waits on it.

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
