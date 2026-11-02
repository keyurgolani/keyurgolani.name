import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BUDGETS_VERSION,
  CALIBRATION_DESCRIPTION,
  CALIBRATION_NOTES,
  egressEvidence,
  parseCalibrateArgs,
  withCalibration,
} from './calibration.mjs';

const SHA = '62a0f06cf88c5d6c55045945bf0733a6882c5425';

test('calibrate takes a name, a report, the base commit, the command, and evidence', () => {
  assert.deepEqual(
    parseCalibrateArgs([
      'baseline-editorial',
      'report.json',
      '--base',
      SHA,
      '--command',
      'pnpm test:trace:baseline',
      '--evidence',
      'evidence.json',
      '--date',
      '2026-10-22',
      '--note',
      'why=a note, and = stays in the text',
    ]),
    {
      name: 'baseline-editorial',
      report: 'report.json',
      base: SHA,
      command: 'pnpm test:trace:baseline',
      evidence: 'evidence.json',
      date: '2026-10-22',
      notes: { why: 'a note, and = stays in the text' },
    },
  );
});

test('calibrate refuses what would make an entry it cannot trust', () => {
  const base = ['fallback-route', 'r.json', '--base', SHA, '--command', 'pnpm test:trace'];
  assert.throws(() => parseCalibrateArgs([]), /usage/);
  assert.throws(() => parseCalibrateArgs(['--base', SHA]), /usage/);
  assert.throws(() => parseCalibrateArgs(['Bad Name', 'r.json']), /an id/);
  assert.throws(() => parseCalibrateArgs([...base.slice(0, 2), '--base', '62a0f06']), /full SHA/);
  assert.throws(
    () => parseCalibrateArgs([...base.slice(0, 2), '--commit', SHA]),
    /unknown option --commit/,
  );
  assert.throws(() => parseCalibrateArgs(base.slice(0, 4)), /--command is the command/);
  assert.throws(() => parseCalibrateArgs([...base, '--date', '22/10/2026']), /YYYY-MM-DD/);
  assert.throws(() => parseCalibrateArgs([...base, '--note', 'no-equals']), /key=text/);
  assert.throws(() => parseCalibrateArgs([...base, '--route']), /--route needs a value/);
});

test('egress evidence keeps what was refused and every socket, and needs all three', () => {
  const evidence = {
    commit: SHA,
    method: 'a trap and offline-fetch',
    trap: [],
    offlineFetch: ['api.github.com'],
    sockets: { server: { samples: 3, outsideLoopback: [], listeners: ['127.0.0.1:4000'] } },
    extra: 'dropped',
  };
  assert.deepEqual(egressEvidence(evidence), {
    commit: SHA,
    method: 'a trap and offline-fetch',
    trapAttempts: [],
    offlineFetchRefusals: ['api.github.com'],
    sockets: evidence.sockets,
  });
  for (const key of ['trap', 'offlineFetch', 'sockets']) {
    const partial = { ...evidence };
    delete partial[key];
    assert.throws(() => egressEvidence(partial), new RegExp(`no ${key}`));
  }
});

test('an entry joins the block in name order, under the tool version, description, and notes', () => {
  const first = withCalibration(null, 'fallback-route', { n: 1 });
  assert.deepEqual(first, {
    version: BUDGETS_VERSION,
    description: CALIBRATION_DESCRIPTION,
    notes: CALIBRATION_NOTES,
    calibration: { 'fallback-route': { n: 1 } },
  });
  assert.deepEqual(Object.keys(first), ['version', 'description', 'notes', 'calibration']);
  const later = withCalibration(
    { description: 'old', limits: { light: {} }, calibration: first.calibration },
    'baseline-editorial',
    { n: 2 },
  );
  assert.deepEqual(Object.keys(later), [
    'version',
    'description',
    'notes',
    'limits',
    'calibration',
  ]);
  assert.equal(later.description, CALIBRATION_DESCRIPTION);
  assert.deepEqual(later.limits, { light: {} });
  assert.deepEqual(Object.keys(later.calibration), ['baseline-editorial', 'fallback-route']);
  assert.deepEqual(
    withCalibration(later, 'fallback-route', { n: 3 }).calibration['fallback-route'],
    { n: 3 },
  );
  for (const note of ['unmapped', 'dataUrls', 'analyzeBytes', 'conditions']) {
    assert.ok(CALIBRATION_NOTES[note], `slice 3's ${note} note`);
  }
});
