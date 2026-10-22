import test from 'node:test';
import assert from 'node:assert/strict';
import { CALIBRATION_DESCRIPTION, parseCalibrateArgs, withCalibration } from './calibration.mjs';

const SHA = '62a0f06cf88c5d6c55045945bf0733a6882c5425';

test('calibrate takes a name, a report, the traced commit, and the command', () => {
  assert.deepEqual(
    parseCalibrateArgs([
      'baseline-editorial',
      'report.json',
      '--commit',
      SHA,
      '--command',
      'pnpm test:trace --base-url http://127.0.0.1:4000 --allow-third-party',
      '--date',
      '2026-10-22',
      '--note',
      'thirdPartyBytes=unknown: aborted, so = stays in the text',
    ]),
    {
      name: 'baseline-editorial',
      report: 'report.json',
      commit: SHA,
      command: 'pnpm test:trace --base-url http://127.0.0.1:4000 --allow-third-party',
      date: '2026-10-22',
      notes: { thirdPartyBytes: 'unknown: aborted, so = stays in the text' },
    },
  );
});

test('calibrate refuses what would make an entry it cannot trust', () => {
  const base = ['fallback-route', 'r.json', '--commit', SHA, '--command', 'pnpm test:trace'];
  assert.throws(() => parseCalibrateArgs([]), /usage/);
  assert.throws(() => parseCalibrateArgs(['--commit', SHA]), /usage/);
  assert.throws(() => parseCalibrateArgs(['Bad Name', 'r.json']), /an id/);
  assert.throws(() => parseCalibrateArgs([...base.slice(0, 2), '--commit', '62a0f06']), /full SHA/);
  assert.throws(() => parseCalibrateArgs(base.slice(0, 4)), /--command is the command/);
  assert.throws(() => parseCalibrateArgs([...base, '--date', '22/10/2026']), /YYYY-MM-DD/);
  assert.throws(() => parseCalibrateArgs([...base, '--note', 'no-equals']), /key=text/);
  assert.throws(() => parseCalibrateArgs([...base, '--route']), /--route needs a value/);
  assert.throws(() => parseCalibrateArgs([...base, '--colour', 'x']), /unknown option --colour/);
});

test('an entry joins the block in name order, and everything else stays', () => {
  const first = withCalibration(null, 'fallback-route', { n: 1 });
  assert.deepEqual(first, {
    description: CALIBRATION_DESCRIPTION,
    calibration: { 'fallback-route': { n: 1 } },
  });
  const later = withCalibration(
    { description: 'kept', limits: { light: {} }, calibration: first.calibration },
    'baseline-editorial',
    { n: 2 },
  );
  assert.equal(later.description, 'kept');
  assert.deepEqual(later.limits, { light: {} });
  assert.deepEqual(Object.keys(later.calibration), ['baseline-editorial', 'fallback-route']);
  assert.deepEqual(
    withCalibration(later, 'fallback-route', { n: 3 }).calibration['fallback-route'],
    {
      n: 3,
    },
  );
});
