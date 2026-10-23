import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// __dirname is skills/scripts; up 2 = repo root.
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SCRIPT = path.join(__dirname, 'sync-checks.mjs');

/** Everything sync-checks reads, which each drift test copies. */
const READS = ['skills', 'packages/kit', 'packages/schema/src/kinds'];

/** The checkout's files the drift tests change copies of, and when each last changed as this file started. */
const DRIFTED = [
  'skills/variant-developer/references/section-kinds.md',
  'packages/kit/src/index.ts',
  'skills/portfolio-author/references/schema.md',
  'skills/portfolio-author/SKILL.md',
].map((file) => ({ file, changed: statSync(path.join(REPO_ROOT, file)).mtimeMs }));

/** sync-checks on `root`, a scratch copy, or on the checkout. */
function run(root) {
  return spawnSync('node', [SCRIPT, ...(root ? [root] : [])], {
    encoding: 'utf8',
    cwd: REPO_ROOT,
  });
}

/**
 * A scratch copy of what sync-checks reads, removed after the test, for a
 * drift test to change. Never the checkout: other test files read it while
 * these run, and kit-dedup found packages/kit/src/index.ts empty while a
 * drift test here rewrote it in place.
 */
function scratch(t) {
  const root = mkdtempSync(path.join(tmpdir(), 'sync-checks-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const part of READS) {
    cpSync(path.join(REPO_ROOT, part), path.join(root, part), {
      recursive: true,
      filter: (source) => path.basename(source) !== 'node_modules',
    });
  }
  return root;
}

/** Rewrites `file` in the scratch copy `root` with what `change` makes of its text. */
function drift(root, file, change) {
  const target = path.join(root, file);
  writeFileSync(target, change(readFileSync(target, 'utf8')));
}

test('sync-checks passes on the live tree', () => {
  const r = run();
  assert.equal(r.status, 0, `stdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
});

test('sync-checks passes on a scratch copy of what it reads', (t) => {
  const r = run(scratch(t));
  assert.equal(r.status, 0, `stdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
});

test('sync-checks detects when section-kinds.md files differ', (t) => {
  const root = scratch(t);
  drift(
    root,
    'skills/variant-developer/references/section-kinds.md',
    (text) => `${text}\n<!-- drift -->\n`,
  );
  const r = run(root);
  assert.equal(r.status, 1);
  assert.match(r.stdout + r.stderr, /section-kinds|differ|identical/i);
});

test('sync-checks detects missing kit export in catalog', (t) => {
  // Add a fake export to kit and verify the catalog drift is caught.
  const root = scratch(t);
  drift(
    root,
    'packages/kit/src/index.ts',
    (text) => `${text}\nexport function fakeDriftHelper() {}\n`,
  );
  const r = run(root);
  assert.equal(r.status, 1);
  assert.match(r.stdout + r.stderr, /fakeDriftHelper|kit-catalog/i);
});

test('sync-checks detects schema.md missing a kind', (t) => {
  // Remove every mention of "kind: hero" so schema.md no longer covers it
  const root = scratch(t);
  drift(root, 'skills/portfolio-author/references/schema.md', (text) =>
    text.replace(/kind:\s*hero/gi, 'kind: HEROO_RENAMED'),
  );
  const r = run(root);
  assert.equal(r.status, 1);
  assert.match(r.stdout + r.stderr, /hero|schema\.md/i);
});

test('sync-checks detects malformed SKILL.md frontmatter', (t) => {
  // Replace 'name: portfolio-author' with an invalid uppercase name
  const root = scratch(t);
  drift(root, 'skills/portfolio-author/SKILL.md', (text) =>
    text.replace(/^name: portfolio-author$/m, 'name: Portfolio-Author'),
  );
  const r = run(root);
  assert.equal(r.status, 1);
  assert.match(r.stdout + r.stderr, /name|Portfolio-Author/);
});

test('the drift tests change their scratch copies, never the checkout', () => {
  for (const { file, changed } of DRIFTED) {
    assert.equal(statSync(path.join(REPO_ROOT, file)).mtimeMs, changed, `${file} was written`);
  }
});
