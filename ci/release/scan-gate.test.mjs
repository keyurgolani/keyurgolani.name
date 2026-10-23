// The release scan's policy and its expiring exceptions, on fixture Grype
// output (ci/release/fixtures/grype-*.json).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  EXCEPTIONS_FILE,
  evaluateDeps,
  evaluateImage,
  findingsOf,
  parseDate,
  readExceptions,
} from './scan-gate.mjs';

const grype = (name) =>
  findingsOf(JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8')));
const ON = parseDate('2026-10-23');
const entry = (fields = {}) => ({
  id: 'CVE-2026-1001',
  package: 'libcrypto3',
  reason: 'Test entry.',
  owner: 'keyurgolani',
  expires: '2026-11-30',
  ...fields,
});
const yaml = (entries) =>
  `exceptions:\n${entries
    .map(
      (e) =>
        `  - ${Object.entries(e)
          .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
          .join('\n    ')}`,
    )
    .join('\n')}\n`;
const exceptions = (entries) => readExceptions(yaml(entries), { on: ON });

test('the image fails on a fixable Critical or High finding, and only on one', () => {
  const verdict = evaluateImage(grype('grype-image'), []);
  assert.equal(verdict.ok, false);
  assert.deepEqual(
    verdict.failing.map((f) => `${f.severity} ${f.id} ${f.package}`),
    ['Critical CVE-2026-1001 libcrypto3', 'High GHSA-AAAA-BBBB-CCCC cross-spawn'],
  );
  // Not fixed and won't fix are reported, never failed. Medium is neither.
  assert.deepEqual(
    verdict.unfixable.map((f) => f.id),
    ['CVE-2026-1002', 'CVE-2026-1005'],
  );
  assert.equal(evaluateImage(grype('grype-clean'), []).ok, true);
});

test('an exception lets one finding through, by id or alias, in its package only', () => {
  const { exceptions: list, problems } = exceptions([
    entry(),
    entry({ id: 'CVE-2026-1003', package: 'cross-spawn' }),
  ]);
  assert.deepEqual(problems, []);
  const verdict = evaluateImage(grype('grype-image'), list);
  assert.equal(verdict.ok, true);
  assert.equal(verdict.excepted.length, 2);
  // The same id in another package doesn't match.
  const elsewhere = exceptions([entry({ package: 'libssl3' })]).exceptions;
  assert.equal(evaluateImage(grype('grype-image'), elsewhere).failing.length, 2);
});

test('production dependencies fail on a new High or Critical finding, fixable or not', () => {
  const verdict = evaluateDeps(grype('grype-deps-head'), grype('grype-deps-base'), []);
  assert.equal(verdict.ok, false);
  assert.deepEqual(
    verdict.failing.map((f) => `${f.id} ${f.package}`),
    ['GHSA-4444-5555-6666 postcss', 'CVE-2026-2003 next'],
  );
  // The High the base already had isn't new.
  assert.deepEqual(
    verdict.known.map((f) => f.package),
    ['sanitize-html'],
  );
  // With no baseline, the first release's, every High or Critical is new.
  assert.equal(evaluateDeps(grype('grype-deps-head'), [], []).failing.length, 3);
  const list = exceptions([
    entry({ id: 'GHSA-4444-5555-6666', package: 'postcss' }),
    entry({ id: 'CVE-2026-2003', package: 'next' }),
  ]).exceptions;
  assert.equal(evaluateDeps(grype('grype-deps-head'), grype('grype-deps-base'), list).ok, true);
});

test('an expired exception is a problem, and so is one more than 90 days out', () => {
  let result = exceptions([entry({ expires: '2026-10-22' })]);
  assert.deepEqual(result.exceptions, []);
  assert.match(result.problems.join(), /expired on 2026-10-22/);
  // The day it expires still counts.
  assert.deepEqual(exceptions([entry({ expires: '2026-10-23' })]).problems, []);
  assert.deepEqual(exceptions([entry({ expires: '2027-01-21' })]).problems, []);
  result = exceptions([entry({ expires: '2027-01-22' })]);
  assert.match(result.problems.join(), /more than 90 days out/);
  // An expired entry no longer lets its finding through.
  const expired = exceptions([entry({ expires: '2026-01-01' })]).exceptions;
  assert.equal(evaluateImage(grype('grype-image'), expired).failing.length, 2);
});

test('an exception needs exactly its five fields, a real id and date, and no twin', () => {
  const cases = [
    [{ ...entry(), reason: '' }, /lacks reason/],
    [Object.fromEntries(Object.entries(entry()).filter(([k]) => k !== 'owner')), /lacks owner/],
    [entry({ extra: 'x' }), /unknown keys: extra/],
    [entry({ id: 'CVE-26-1' }), /isn't a CVE or GHSA id/],
    [entry({ id: 'GHSA-aaaa-bbbb-cccc' }), /isn't a CVE or GHSA id/],
    [entry({ expires: '2026-02-30' }), /isn't a YYYY-MM-DD date/],
    [entry({ expires: 'soon' }), /isn't a YYYY-MM-DD date/],
  ];
  for (const [bad, reason] of cases) {
    const result = exceptions([bad]);
    assert.match(result.problems.join(), reason, JSON.stringify(bad));
    assert.deepEqual(result.exceptions, []);
  }
  assert.match(exceptions([entry(), entry()]).problems.join(), /repeats an earlier entry/);
  assert.deepEqual(exceptions([entry({ id: 'GHSA-2c8m-3x7q-9wvp' })]).problems, []);
});

test('the exceptions file must be a list under exceptions:', () => {
  assert.match(readExceptions('', { on: ON }).problems.join(), /no exceptions: list/);
  assert.match(readExceptions('exceptions: {}', { on: ON }).problems.join(), /no exceptions: list/);
  assert.match(
    readExceptions('exceptions: []\nignore: []\n', { on: ON }).problems.join(),
    /unknown top-level keys: ignore/,
  );
  assert.match(readExceptions('exceptions: [', { on: ON }).problems.join(), /isn't valid YAML/);
  assert.deepEqual(readExceptions('exceptions: []\n', { on: ON }), {
    exceptions: [],
    problems: [],
  });
});

test('the committed exceptions file reads with no problem', () => {
  // Checked today: an entry that has expired fails this, as it fails the scan.
  assert.deepEqual(readExceptions(readFileSync(EXCEPTIONS_FILE, 'utf8')).problems, []);
});

test("anything but Grype's JSON is refused", () => {
  assert.throws(() => findingsOf({}), /isn't Grype JSON/);
  assert.throws(() => findingsOf(null), /isn't Grype JSON/);
});
