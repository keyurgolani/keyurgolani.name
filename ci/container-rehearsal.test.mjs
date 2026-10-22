import test from 'node:test';
import assert from 'node:assert/strict';
import { field, fixturePair, liveOf } from './container-rehearsal.mjs';

// The container rehearsal runs in CI alone, where there is Docker. What it
// reads from portfolio-store and the pair it mounts are checked here.

test("the rehearsal reads portfolio-store's labelled lines", () => {
  const status = [
    'state: live',
    `live revision: rev_${'a'.repeat(32)} (seq 2)`,
    `unit hash: sha256:${'b'.repeat(64)}`,
    'revisions: 2',
  ].join('\n');
  assert.equal(field(status, 'state'), 'live');
  assert.equal(field(status, 'unit hash'), `sha256:${'b'.repeat(64)}`);
  assert.equal(field(status, 'reason'), undefined);
  assert.deepEqual(liveOf(status), { revisionId: `rev_${'a'.repeat(32)}`, seq: 2 });
  assert.equal(liveOf('live revision: none'), null);
});

test('the rehearsal pair selects the reference variant and carries its marker in the meta description', () => {
  const pair = fixturePair('acme-reference', 'rehearsal one abcd');
  assert.match(pair.site, /^ {2}variant: acme-reference$/m);
  assert.doesNotMatch(pair.site, /^ {2}variant: missing-variant$/m);
  assert.match(pair.portfolio, /^ {2}description: Fixture portfolio, rehearsal one abcd\.$/m);
  // Nothing in it fetches from a third party at render time.
  assert.doesNotMatch(pair.portfolio, /kind: github/);
});
