// A release candidate's named records list (quality/release/records.json): the failure records the
// candidate ships with, each named with its owner and the row that fixes it. One matcher for both
// gates that read it: rc-quality's verdict (tests/quality/lib/verdict.ts, through
// tests/quality/lib/release-scope.ts) and rc-verify's push-gate check (ci/release/verify-rc.mjs).
//
// An entry is one failure record: one rule failing on one element in one cell test. Its key is
// [cell, viewport, row, engine, check, rule, target], each from the record's own fields, never
// from its message, so a measurement that moves from run to run (an element count, a pixel count,
// a ratio) never moves the key. quality/release/SCHEMA.md documents the file.
//
// An entry is strict by default: its record must still fail wherever its test runs. One marked
// `"flaky": true` was seen failing and passing on one commit (`seen` names the commit and both
// runs), so its test may pass; when it fails, it must still fail on exactly that record. At most
// MAX_FLAKY entries are flaky without the coordinator's word.
//
// Pure Node with no dependencies, so rc-verify's sparse checkout runs it with no install.

/** What a printed entry holds for its owner and row until someone fills them: validation refuses both. */
export const OWNER_PLACEHOLDER = '<owner: the lane or person who fixes it>';
export const ROUTED_PLACEHOLDER = '<routed: the row that fixes it, as row <n>>';

const RELEASE = /^\d+\.\d+\.\d+(?:-rc\.[1-9]\d*)?$/;
const OWNER = /^[A-Za-z][A-Za-z0-9 ._-]{0,63}$/;
const ROUTED = /^row [1-9]\d*[a-z]?$/;
const NOTE_MAX = 300;
const COMMIT = /^[0-9a-f]{40}$/;
const RUN_ID = /^[1-9]\d*$/;
/** The most flaky entries a list holds: more need the coordinator's word, and a change here. */
export const MAX_FLAKY = 5;

/** The fields that name a record, in key order. */
export const KEY_FIELDS = ['cell', 'viewport', 'row', 'engine', 'check', 'rule', 'target'];
const ENTRY_FIELDS = new Set([...KEY_FIELDS, 'owner', 'routed', 'note', 'flaky', 'seen']);
const SEEN_FIELDS = ['commit', 'failed', 'passed'];

/** Whether `entry` is a flaky one (validated: `flaky` is true, with its `seen` evidence). */
export const isFlaky = (entry) => entry?.flaky === true;

/** Whether `release` is X.Y.Z or X.Y.Z-rc.N. */
export const isRelease = (release) => typeof release === 'string' && RELEASE.test(release);

/**
 * A failure record's element, as an entry's `target` names it: the page selector the check
 * recorded; for an element with none (inside a frame or a shadow root), `aria:` and its role,
 * accessible name and slot; null for a record with no element, such as the runner check's.
 */
export function failureTarget(element) {
  if (!element || typeof element !== 'object') return null;
  if (typeof element.selector === 'string' && element.selector !== '') return element.selector;
  const parts = [element.semanticRole, element.accessibleName, element.uiSlot];
  if (parts.every((part) => part === undefined || part === null || part === '')) return null;
  return `aria:${parts.map((part) => (typeof part === 'string' ? part : '')).join('|')}`;
}

/**
 * A failure record (a cell test's CellFailure) as a summary test lists it: its check, rule and
 * target, from its own fields. Its measurements (expected, actual, threshold) and message stay out.
 */
export const failureOf = (record) => ({
  check: record.check,
  rule: record.rule,
  target: failureTarget(record.element),
});

/** An entry's key, or a failure's under its test: the fields that name the record, in order. */
export const recordKey = (each) => JSON.stringify(KEY_FIELDS.map((field) => each?.[field] ?? null));

/** The keys of a summary test's failures, each under the test's own cell, viewport, row and engine. */
export function testFailures(test) {
  const failures = Array.isArray(test?.failures) ? test.failures : [];
  return failures.map((failure) => ({
    cell: test.cell ?? '',
    viewport: test.viewport ?? '',
    row: test.row ?? '',
    engine: test.engine ?? '',
    check: typeof failure?.check === 'string' ? failure.check : '',
    rule: typeof failure?.rule === 'string' ? failure.rule : '',
    target: typeof failure?.target === 'string' ? failure.target : null,
  }));
}

/** A ready-to-paste entry for `failure` (testFailures'), its owner and row placeholders the list refuses. */
export function listEntry(failure) {
  return JSON.stringify({
    ...Object.fromEntries(KEY_FIELDS.map((field) => [field, failure[field] ?? null])),
    owner: OWNER_PLACEHOLDER,
    routed: ROUTED_PLACEHOLDER,
  });
}

/** Why `records` isn't a valid list for `scope` ({ release, scope }), one problem a line; none when it is. */
export function recordsProblems(records, scope) {
  if (!Array.isArray(records)) return ['the records list is not an array'];
  const problems = [];
  const seen = new Set();
  records.forEach((entry, at) => {
    const where = `entry ${at + 1}`;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      problems.push(`${where}: not an object`);
      return;
    }
    for (const field of Object.keys(entry)) {
      if (!ENTRY_FIELDS.has(field)) problems.push(`${where}: ${field} is not a field`);
    }
    for (const field of ['cell', 'viewport', 'row', 'engine', 'check', 'rule']) {
      if (typeof entry[field] !== 'string' || entry[field].trim() === '')
        problems.push(`${where}: ${field} is missing`);
    }
    if (entry.target !== null && (typeof entry.target !== 'string' || entry.target.trim() === ''))
      problems.push(`${where}: target is ${JSON.stringify(entry.target)}, not a selector or null`);
    if (typeof entry.owner !== 'string' || !OWNER.test(entry.owner))
      problems.push(`${where}: owner is ${JSON.stringify(entry.owner)}, not a lane or person`);
    if (typeof entry.routed !== 'string' || !ROUTED.test(entry.routed))
      problems.push(`${where}: routed is ${JSON.stringify(entry.routed)}, not "row <n>"`);
    if (
      entry.note !== undefined &&
      (typeof entry.note !== 'string' || entry.note.length > NOTE_MAX)
    )
      problems.push(`${where}: note is not text of at most ${NOTE_MAX} characters`);
    if (entry.flaky !== undefined || entry.seen !== undefined) {
      const evidence = entry.seen;
      if (entry.flaky !== true)
        problems.push(
          `${where}: flaky is ${JSON.stringify(entry.flaky)}; a flaky entry says "flaky": true`,
        );
      if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) {
        problems.push(
          `${where}: a flaky entry needs "seen": {"commit": <sha>, "failed": <run id>, "passed": <run id>}`,
        );
      } else {
        for (const field of Object.keys(evidence)) {
          if (!SEEN_FIELDS.includes(field)) problems.push(`${where}: seen.${field} is not a field`);
        }
        if (typeof evidence.commit !== 'string' || !COMMIT.test(evidence.commit))
          problems.push(
            `${where}: seen.commit is ${JSON.stringify(evidence.commit)}, not a full commit sha`,
          );
        for (const field of ['failed', 'passed']) {
          if (typeof evidence[field] !== 'string' || !RUN_ID.test(evidence[field]))
            problems.push(
              `${where}: seen.${field} is ${JSON.stringify(evidence[field])}, not a run id`,
            );
        }
        if (typeof evidence.failed === 'string' && evidence.failed === evidence.passed)
          problems.push(
            `${where}: seen.failed and seen.passed are one run; a flaky entry needs two`,
          );
      }
    }
    const key = recordKey(entry);
    if (seen.has(key)) problems.push(`${where}: listed twice`);
    seen.add(key);
  });
  const flaky = records.filter((entry) => entry?.flaky === true).length;
  if (flaky > MAX_FLAKY)
    problems.push(
      `${flaky} flaky entries, over the ${MAX_FLAKY} a list holds without the coordinator's word`,
    );
  // A final release keeps the full matrix's rule: every cell, and none failing, flaky or not.
  if (isRelease(scope?.release) && !scope.release.includes('-rc.')) {
    if (scope.scope !== 'full')
      problems.push(`${scope.release} is a final release: its scope must be full`);
    if (records.length > 0)
      problems.push(`${scope.release} is a final release: its records list must be empty`);
  }
  return problems;
}

/**
 * A run's summary tests held to `listed`: every failing cell test's failures named, and every
 * entry whose test ran still failing. Returns
 * - unlisted: each failure of a failing cell test that no entry names, with its printed entry;
 * - unrecorded: each failing cell test with no failure records, which no entry can name;
 * - passed: each strict entry whose test ran here (not skipped) and whose failure it no longer has;
 * - flaky: each flaky entry and how it came out here: `failed` (its record failed), `passed` (its
 *   test ran without it), or `not run`. A flaky entry is never `passed` above; its test's other
 *   failures are unlisted all the same.
 * Entries whose test didn't run here are the caller's to judge.
 */
export function judgeListed(tests, listed) {
  const keys = new Set((listed ?? []).map(recordKey));
  const unlisted = [];
  const unrecorded = [];
  const ran = new Map();
  for (const test of tests ?? []) {
    if (test?.kind !== 'cell' || test.outcome === 'skipped') continue;
    const failing = test.outcome === 'unexpected' ? testFailures(test) : [];
    const testKey = JSON.stringify([test.cell, test.viewport, test.row, test.engine]);
    const own = ran.get(testKey) ?? new Set();
    for (const failure of failing) own.add(recordKey(failure));
    ran.set(testKey, own);
    if (test.outcome !== 'unexpected') continue;
    if (failing.length === 0) unrecorded.push(test);
    for (const failure of failing) {
      if (!keys.has(recordKey(failure)))
        unlisted.push({ test, failure, entry: listEntry(failure) });
    }
  }
  const ownOf = (entry) =>
    ran.get(JSON.stringify([entry.cell, entry.viewport, entry.row, entry.engine]));
  const passed = (listed ?? []).filter((entry) => {
    const own = ownOf(entry);
    return !isFlaky(entry) && own !== undefined && !own.has(recordKey(entry));
  });
  const flaky = (listed ?? []).filter(isFlaky).map((entry) => {
    const own = ownOf(entry);
    return {
      entry,
      outcome: own === undefined ? 'not run' : own.has(recordKey(entry)) ? 'failed' : 'passed',
    };
  });
  return { unlisted, unrecorded, passed, flaky };
}
