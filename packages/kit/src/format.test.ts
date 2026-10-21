import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ensureSectionId,
  formatDate,
  formatDuration,
  formatPeriod,
  formatRelativeTime,
  formatStatValue,
  formatYear,
  parseLooseDate,
} from './format';
import { withoutClock } from './test-support/clock';

const NOW = new Date('2026-05-04T12:00:00Z');

test('ensureSectionId returns a schema-valid section id unchanged', () => {
  for (const id of ['top', 'get-in-touch', 'quote', '2024', 'a'.repeat(64)]) {
    assert.equal(ensureSectionId(id, 'fallback'), id);
  }
});

test('ensureSectionId slugifies anything else, then falls back', () => {
  assert.equal(ensureSectionId('Get in touch', 'x'), 'get-in-touch');
  assert.equal(ensureSectionId(undefined, 'Work Showcase'), 'work-showcase');
  assert.equal(ensureSectionId('!!!', 'quote'), 'quote');
});

test('returns "just now" within 60 seconds', () => {
  assert.equal(formatRelativeTime('2026-05-04T11:59:30Z', NOW), 'just now');
  assert.equal(formatRelativeTime('2026-05-04T12:00:00Z', NOW), 'just now');
});

test('formats minutes ago', () => {
  assert.equal(formatRelativeTime('2026-05-04T11:55:00Z', NOW), '5m ago');
  assert.equal(formatRelativeTime('2026-05-04T11:01:00Z', NOW), '59m ago');
});

test('formats hours ago', () => {
  assert.equal(formatRelativeTime('2026-05-04T11:00:00Z', NOW), '1h ago');
  assert.equal(formatRelativeTime('2026-05-03T13:00:00Z', NOW), '23h ago');
});

test('formats days ago', () => {
  assert.equal(formatRelativeTime('2026-05-03T12:00:00Z', NOW), '1d ago');
  assert.equal(formatRelativeTime('2026-04-21T12:00:00Z', NOW), '13d ago');
});

test('formats weeks ago', () => {
  assert.equal(formatRelativeTime('2026-04-20T12:00:00Z', NOW), '2w ago');
  assert.equal(formatRelativeTime('2026-03-10T12:00:00Z', NOW), '8w ago');
});

test('formats months ago', () => {
  assert.equal(formatRelativeTime('2026-03-04T12:00:00Z', NOW), '2mo ago');
  assert.equal(formatRelativeTime('2025-05-04T12:00:00Z', NOW), '12mo ago');
});

test('formats years ago', () => {
  assert.equal(formatRelativeTime('2024-05-04T12:00:00Z', NOW), '2y ago');
  assert.equal(formatRelativeTime('2020-01-01T00:00:00Z', NOW), '6y ago');
});

test("takes now as a Date, an ISO string such as a render input's env.now, or milliseconds", () => {
  for (const now of [NOW, NOW.toISOString(), NOW.getTime()]) {
    assert.equal(formatRelativeTime('2026-05-04T11:55:00Z', now), '5m ago');
  }
});

test('present is the day now names, in UTC, and nothing reads the clock', () => {
  withoutClock(() => {
    for (const raw of ['present', 'Now', ' current ']) {
      assert.deepEqual(parseLooseDate(raw, '2026-05-04T23:30:00-02:00'), {
        year: 2026,
        month: 4,
        day: 5,
        isPresent: true,
      });
    }
    assert.deepEqual(parseLooseDate('2019-06', NOW), { year: 2019, month: 5, day: undefined });
    assert.equal(parseLooseDate('', NOW), null);
    assert.equal(formatDate('present'), 'Present');
    assert.equal(formatYear('present'), 'Present');
    assert.match(formatPeriod({ start: '2019-06' }), /^June 2019 \S Present$/);
    assert.equal(formatRelativeTime('2026-05-03T12:00:00Z', NOW), '1d ago');
  });
});

test('a period to the present runs to now', () => {
  withoutClock(() => {
    assert.equal(formatDuration({ start: '2019-06' }, NOW), '6 yrs 11 mos');
    assert.equal(formatDuration({ start: '2019-06', end: 'present' }, '2019-09-01'), '3 mos');
    assert.equal(formatDuration({ start: '2019-06', end: '2021-06' }, NOW), '2 yrs');
  });
});

test('an invalid now is an error, not a date', () => {
  assert.throws(() => parseLooseDate('present', 'soon'), /soon isn't a time/);
});

test('a stat number takes the content locale', () => {
  assert.equal(formatStatValue(1200, 'en'), '1,200');
  assert.equal(formatStatValue(1200, 'de'), '1.200');
  assert.equal(formatStatValue('10B+', 'de'), '10B+');
});
