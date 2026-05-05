import test from 'node:test';
import assert from 'node:assert/strict';
import { GithubSchema } from './github';

const BASE = { kind: 'github' as const, username: 'octocat' };

test('default parses to defaults including showRecentlyActive=true and recentlyActiveLimit=10', () => {
  const out = GithubSchema.parse(BASE);
  assert.equal(out.showRecentlyActive, true);
  assert.equal(out.recentlyActiveLimit, 10);
});

test('accepts showRecentlyActive=false', () => {
  const out = GithubSchema.parse({ ...BASE, showRecentlyActive: false });
  assert.equal(out.showRecentlyActive, false);
});

test('accepts recentlyActiveLimit at boundary 1', () => {
  const out = GithubSchema.parse({ ...BASE, recentlyActiveLimit: 1 });
  assert.equal(out.recentlyActiveLimit, 1);
});

test('accepts recentlyActiveLimit at boundary 20', () => {
  const out = GithubSchema.parse({ ...BASE, recentlyActiveLimit: 20 });
  assert.equal(out.recentlyActiveLimit, 20);
});

test('rejects recentlyActiveLimit=0', () => {
  assert.throws(() => GithubSchema.parse({ ...BASE, recentlyActiveLimit: 0 }));
});

test('rejects recentlyActiveLimit=21', () => {
  assert.throws(() => GithubSchema.parse({ ...BASE, recentlyActiveLimit: 21 }));
});

test('rejects non-integer recentlyActiveLimit', () => {
  assert.throws(() => GithubSchema.parse({ ...BASE, recentlyActiveLimit: 5.5 }));
});
