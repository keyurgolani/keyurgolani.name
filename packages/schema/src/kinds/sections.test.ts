import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SCHEMAS } from '../compose';
import { sectionSchemas } from './sections';

const { GithubSchema } = sectionSchemas(DEFAULT_SCHEMAS.parts);

const BASE = { kind: 'github' as const, id: 'github', username: 'octocat' };

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

test('a blank username, a blank repository name, and an empty list are refused, like every other blank', () => {
  for (const bad of [
    { username: '' },
    { username: '   ' },
    { featuredRepos: [] },
    { featuredRepos: [''] },
    { excludeRepos: [] },
    { excludeRepos: ['  '] },
  ]) {
    assert.equal(GithubSchema.safeParse({ ...BASE, ...bad }).success, false, JSON.stringify(bad));
  }
  // Left out, there are none.
  const out = GithubSchema.parse(BASE);
  assert.equal(out.featuredRepos, undefined);
  assert.equal(out.excludeRepos, undefined);
  assert.deepEqual(GithubSchema.parse({ ...BASE, excludeRepos: ['scratch'] }).excludeRepos, [
    'scratch',
  ]);
});
