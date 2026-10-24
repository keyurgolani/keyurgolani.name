import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { decide, evidence, REQUEST } from './rehearsal-request.mjs';

// catalog-rehearsal.yml's guard (#20 PR 3): one request, one run.

const PARENT = 'a'.repeat(40);
const ASKED = JSON.stringify({ for: PARENT, shards: 8 });

test('the rehearsal runs only when the head commit changes the request file, and the file parses', () => {
  const at = { parent: PARENT, base: null };
  assert.equal(decide({ changed: [REQUEST], text: ASKED, ...at }).run, true);
  // A later push that leaves the request alone runs nothing.
  assert.deepEqual(decide({ changed: ['README.md'], text: ASKED, ...at }), {
    run: false,
    reason: `the head commit doesn't change ${REQUEST}`,
  });
  // The commit that removes it runs nothing.
  assert.deepEqual(decide({ changed: [REQUEST], text: null, ...at }), {
    run: false,
    reason: `the head commit removes ${REQUEST}`,
  });
  for (const text of ['not json', '[]', 'null', '7']) {
    assert.equal(decide({ changed: [REQUEST], text, ...at }).run, false, text);
  }
});

test("a request is one run: it names the commit it rehearses, the head's parent, and a restack or the base's own request runs nothing (#20 PR 3)", () => {
  const changed = [REQUEST];
  assert.deepEqual(decide({ changed, text: ASKED, parent: PARENT, base: null }), {
    run: true,
    reason: `the head commit asks to rehearse ${PARENT}`,
  });
  // No id, or one that isn't a full commit id, runs nothing.
  for (const text of ['{}', '{"for":"main"}', `{"for":"${'a'.repeat(39)}"}`]) {
    assert.match(
      decide({ changed, text, parent: PARENT, base: null }).reason,
      /has no `for`/,
      text,
    );
  }
  // A restack rewrote the head's parent: the same request is for a commit that's gone.
  const restacked = decide({ changed, text: ASKED, parent: 'b'.repeat(40), base: null });
  assert.equal(restacked.run, false);
  assert.match(restacked.reason, /a restack left it behind, so ask again/);
  // The base already holds this request.
  assert.deepEqual(decide({ changed, text: ASKED, parent: PARENT, base: ASKED }), {
    run: false,
    reason: `the base already holds the request for ${PARENT}`,
  });
  // A base with another request leaves this one to run.
  const older = JSON.stringify({ for: 'c'.repeat(40) });
  assert.equal(decide({ changed, text: ASKED, parent: PARENT, base: older }).run, true);
});

test("on a pull request's merge checkout, the request runs once, and a restack under it runs nothing (#20 PR 3)", (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'rehearsal-request-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: 'test',
    GIT_AUTHOR_EMAIL: 'test@example.invalid',
    GIT_COMMITTER_NAME: 'test',
    GIT_COMMITTER_EMAIL: 'test@example.invalid',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
  };
  const git = (...args) => execFileSync('git', args, { cwd: root, env, encoding: 'utf8' }).trim();
  const commit = (file, text, message) => {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), text);
    git('add', file);
    git('commit', '-q', '-m', message);
    return git('rev-parse', 'HEAD');
  };
  git('init', '-q', '-b', 'next');
  commit('README.md', 'base\n', 'base');
  git('switch', '-q', '-c', 'stack');
  const under = commit('pack.txt', 'one\n', 'the stack');
  commit(REQUEST, JSON.stringify({ for: under }), 'the request');
  git('switch', '-q', 'next');
  commit('other.txt', 'next moved\n', 'next moves');
  // The pull request's checkout: the merge of its head into the base.
  const merge = () => {
    git('switch', '-q', '--detach', 'next');
    git('merge', '-q', '--no-ff', '--no-edit', 'stack');
  };
  merge();
  assert.deepEqual(decide(evidence(root)), {
    run: true,
    reason: `the head commit asks to rehearse ${under}`,
  });
  // A restack onto the moved base rewrites the commit under the request.
  git('switch', '-q', 'stack');
  git('rebase', '-q', 'next');
  merge();
  const restacked = decide(evidence(root));
  assert.equal(restacked.run, false);
  assert.match(
    restacked.reason,
    new RegExp(`the request is for ${under}, and the head's parent is [0-9a-f]{40}: a restack`),
  );
});
