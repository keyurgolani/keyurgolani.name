// A release candidate's named records list (quality/release/records.json): the failure records the
// candidate ships with, each named with its owner and the row that fixes it. One matcher for both
// gates that read it: rc-quality's verdict (tests/quality/lib/verdict.ts, through
// tests/quality/lib/release-scope.ts) and rc-verify's push-gate check (ci/release/verify-rc.mjs).
//
// An entry is one failure record: one rule failing on one element in one cell test. Its key is
// [cell, viewport, row, engine, check, rule, target]: the test's cell, viewport, row and engine,
// and the record's own check, rule and element (its target qualified by page and viewport when
// those aren't the test's own: failureOf), never its message, so a measurement that moves from
// run to run (an element count, a pixel count, a ratio) never moves the key.
// quality/release/SCHEMA.md documents the file.
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
/** The runner's egress rules: a failure no records list may name (recordsProblems refuses them). */
export const EGRESS_RULES = ['browser-egress', 'server-egress'];
/** Owners that name no one, in any case: refused like a blank one. */
const NO_OWNER = new Set(['tbd', 'tba', 'none', 'unknown', 'unowned', 'nobody', 'owner']);
/**
 * Until RC2's evidence check reads the runs a flaky entry names, a list takes no flaky entry: its
 * `seen` is checked for shape only (RC1's interim guard).
 */
export const FLAKY_HELD =
  "flaky entries wait on RC2's evidence check, which reads the runs seen names; until it lands, seen is checked for shape only, so a list holds strict entries alone";
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
 * `own` is the test's own surface and viewport. A record of another page or viewport under the
 * same test (the primitives page an appearance cell also audits, the landscape occlusion pass at
 * the test's viewport turned) has its target qualified by where it is, `<surface> >> <target>` and
 * `@<viewport> <target>`, so it never keys like the cell page's own record at the test's viewport.
 * A record with no element keeps a null target, which no list names.
 */
export function failureOf(record, own) {
  const target = failureTarget(record.element);
  const page = record.surface === own?.surface ? '' : `${String(record.surface)} >> `;
  const at = record.viewport === own?.viewport ? '' : `@${String(record.viewport)} `;
  return {
    check: record.check,
    rule: record.rule,
    target: target === null ? null : `${at}${page}${target}`,
  };
}

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
      else if (entry[field] !== entry[field].trim())
        problems.push(`${where}: ${field} has space at its start or end, which no record has`);
    }
    if (entry.target === null)
      problems.push(
        `${where}: target is null; a record with no element (a runner record, or an axe node in a frame or a shadow root) shares its key with every other of its rule in the test until RC2's per-element key, so RC1's list names elements only`,
      );
    else if (typeof entry.target !== 'string' || entry.target.trim() === '')
      problems.push(`${where}: target is ${JSON.stringify(entry.target)}, not a selector`);
    else if (entry.target !== entry.target.trim())
      problems.push(`${where}: target has space at its start or end, which no record has`);
    if (entry.check === 'runner' && EGRESS_RULES.includes(entry.rule))
      problems.push(
        `${where}: ${entry.rule} is egress, which no records list may name: it fails the release however it's listed`,
      );
    if (
      typeof entry.owner !== 'string' ||
      !OWNER.test(entry.owner) ||
      NO_OWNER.has(entry.owner.trim().toLowerCase())
    )
      problems.push(`${where}: owner is ${JSON.stringify(entry.owner)}, not a lane or person`);
    if (typeof entry.routed !== 'string' || !ROUTED.test(entry.routed))
      problems.push(`${where}: routed is ${JSON.stringify(entry.routed)}, not "row <n>"`);
    if (
      entry.note !== undefined &&
      (typeof entry.note !== 'string' || entry.note.length > NOTE_MAX)
    )
      problems.push(`${where}: note is not text of at most ${NOTE_MAX} characters`);
    if (entry.flaky === true) problems.push(`${where}: ${FLAKY_HELD}`);
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
 * Why a failing cell test can't count as its records alone, or null when it can: it ended
 * `failed` (not timed out or interrupted), hit no egress (an egress fixture's own runner record),
 * with no error beyond the soft expectations runCell annotated (`softFailures`, at least the one a
 * listable record fails; a fixture's throw is one more), every check it owed (`owed`, a non-empty
 * list) among those it ran, and every failure well-formed, with no key twice. The summary is
 * untrusted: a missing or odd field counts against the test, as a producer that drops one would.
 * A late server-egress check, the worker's as it stops, attaches no record: its error blocks the
 * test by the count alone.
 */
export function uncovered(test) {
  if (test.status !== 'failed') return `it ended ${String(test.status)}, not failed`;
  const failures = Array.isArray(test.failures) ? test.failures : [];
  if (failures.length === 0) return 'it failed with no failure record';
  const malformed = failures.some(
    (failure) =>
      !failure ||
      typeof failure.check !== 'string' ||
      failure.check === '' ||
      typeof failure.rule !== 'string' ||
      failure.rule === '' ||
      (failure.target !== null && (typeof failure.target !== 'string' || failure.target === '')),
  );
  if (malformed) return 'a failure record of it is malformed';
  const egress = failures.find(
    (failure) => failure.check === 'runner' && EGRESS_RULES.includes(failure.rule),
  );
  if (egress) return `it hit ${egress.rule}, which no records list may name`;
  if (typeof test.softFailures !== 'number' || !Number.isInteger(test.softFailures))
    return "it has no count of runCell's soft expectations, so an error beyond them can't be told";
  if (test.softFailures < 1)
    return "it counts no failed soft expectation, though every listable record fails one of runCell's";
  if (!Array.isArray(test.errors))
    return "it lists no errors, so an error beyond its soft expectations can't be told";
  if (test.errors.length !== test.softFailures)
    return `it ended with ${test.errors.length} error(s), not the ${test.softFailures} soft expectation(s) behind its records`;
  if (
    !Array.isArray(test.owed) ||
    test.owed.length === 0 ||
    test.owed.some((check) => typeof check !== 'string' || check === '')
  )
    return 'it names no checks it owed';
  const ran = Array.isArray(test.checks) ? test.checks : [];
  const missing = test.owed.filter((check) => !ran.includes(check));
  if (missing.length > 0) return `it didn't run its ${missing.join(', ')} check(s)`;
  return null;
}

/**
 * A run's summary tests held to `listed`: every failing cell test's failures named, and every
 * entry whose test ran still failing. Returns
 * - unlisted: each failure of a failing cell test that no entry names, with its printed entry;
 * - unrecorded: each failing cell test that can't count as its records alone (uncovered()), with
 *   why: no record, a status other than failed, an error beyond its soft expectations, an owed
 *   check it didn't run, a malformed record; no entry can name it;
 * - repeated: each failing cell test whose failures repeat a key, so no one entry names one record;
 * - covered: the failing cell tests whose every failure an entry names, and nothing else failed;
 * - passed: each strict entry whose test ran here (not skipped) and whose failure it no longer has.
 *   An uncovered test is held: what it failed on says nothing of its records (it may have timed
 *   out before it wrote any, or skipped the check behind one), so no entry of it is passed;
 * - notJudged: with `owedOnly` (rc-verify's read of a push run), each strict entry that would be
 *   passed but whose test, by its well-formed `owed` list, didn't owe the entry's check on this
 *   run (a quality-pr sentinel owes no reflow, inventory or enhancement), with why. An entry
 *   counts as passed only where its check ran. A missing or malformed `owed` keeps the entry
 *   judged, as passed. rc-quality never sets it: full mode owes every condition;
 * - flaky: each flaky entry and how it came out here: `failed` (its record failed), `passed` (its
 *   test ran without it), `not judged` (its test is held, or with `owedOnly` didn't owe its
 *   check), or `not run`. A flaky entry is never `passed` above; its test's other failures are
 *   unlisted all the same.
 * Entries whose test didn't run here are the caller's to judge.
 */
export function judgeListed(tests, listed, { owedOnly = false } = {}) {
  const keys = new Set((listed ?? []).map(recordKey));
  const unlisted = [];
  const unrecorded = [];
  const repeated = [];
  const covered = [];
  const ran = new Map();
  const held = new Set();
  // Each test's owed checks, when its list is well formed: a non-empty list of names.
  const owedBy = new Map();
  for (const test of tests ?? []) {
    if (test?.kind !== 'cell' || test.outcome === 'skipped') continue;
    const why = test.outcome === 'unexpected' ? uncovered(test) : null;
    const failing = test.outcome === 'unexpected' ? testFailures(test) : [];
    // An uncovered test's records still failed: its entries on them didn't pass, whatever else
    // it failed on.
    const testKey = JSON.stringify([test.cell, test.viewport, test.row, test.engine]);
    const own = ran.get(testKey) ?? new Set();
    for (const failure of failing) own.add(recordKey(failure));
    ran.set(testKey, own);
    const owed = test.owed;
    owedBy.set(
      testKey,
      Array.isArray(owed) &&
        owed.length > 0 &&
        owed.every((check) => typeof check === 'string' && check !== '')
        ? new Set(owed)
        : null,
    );
    if (test.outcome !== 'unexpected') continue;
    if (why !== null) {
      unrecorded.push({ test, why });
      held.add(testKey);
      continue;
    }
    const seen = new Set();
    const twice = failing.filter((failure) => {
      const key = recordKey(failure);
      const again = seen.has(key);
      seen.add(key);
      return again;
    });
    if (twice.length > 0) repeated.push({ test, failure: twice[0] });
    const mine = failing.filter((failure) => !keys.has(recordKey(failure)));
    for (const failure of mine) unlisted.push({ test, failure, entry: listEntry(failure) });
    if (mine.length === 0 && twice.length === 0) covered.push(test);
  }
  const keyOf = (entry) => JSON.stringify([entry.cell, entry.viewport, entry.row, entry.engine]);
  const ownOf = (entry) => ran.get(keyOf(entry));
  // With owedOnly, an entry whose test's well-formed owed list lacks its check, whose check never
  // ran there: a missing or malformed list judges it as before.
  const unowed = (entry) => {
    const owed = owedBy.get(keyOf(entry));
    return owedOnly && owed !== undefined && owed !== null && !owed.has(entry.check);
  };
  const gone = (listed ?? []).filter((entry) => {
    const own = ownOf(entry);
    return (
      !isFlaky(entry) && own !== undefined && !held.has(keyOf(entry)) && !own.has(recordKey(entry))
    );
  });
  const passed = gone.filter((entry) => !unowed(entry));
  const notJudged = gone
    .filter(unowed)
    .map((entry) => ({ entry, why: `its test didn't owe its ${entry.check} check on this run` }));
  const flaky = (listed ?? []).filter(isFlaky).map((entry) => {
    const own = ownOf(entry);
    return {
      entry,
      outcome:
        own === undefined
          ? 'not run'
          : own.has(recordKey(entry))
            ? 'failed'
            : held.has(keyOf(entry)) || unowed(entry)
              ? 'not judged'
              : 'passed',
    };
  });
  return { unlisted, unrecorded, repeated, covered, passed, notJudged, flaky };
}
