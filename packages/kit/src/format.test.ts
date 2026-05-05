import test from 'node:test';
import assert from 'node:assert/strict';
import { formatRelativeTime } from './format';

const NOW = new Date('2026-05-04T12:00:00Z');

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

test('uses real new Date() when now omitted', () => {
  // Just ensure no throw; result format depends on real time.
  const out = formatRelativeTime(new Date().toISOString());
  assert.match(out, /^(just now|\d+[smhdwy](o)? ago)$/);
});
