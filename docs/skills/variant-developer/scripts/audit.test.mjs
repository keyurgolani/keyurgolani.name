import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(__dirname, 'audit.mjs');
const FIXTURES = path.join(__dirname, '__fixtures__');

function run(slug) {
  return spawnSync('node', [SCRIPT, path.join(FIXTURES, slug)], {
    encoding: 'utf8',
  });
}

test('variant-good audits clean (exit 0)', () => {
  const r = run('variant-good');
  assert.equal(r.status, 0, `stdout: ${r.stdout}\nstderr: ${r.stderr}`);
});

test('variant-missing-kind hard-fails on coverage', () => {
  const r = run('variant-missing-kind');
  assert.equal(r.status, 1);
  assert.match(r.stdout + r.stderr, /discography/);
});

test('variant-no-dark hard-fails on themes', () => {
  const r = run('variant-no-dark');
  assert.equal(r.status, 1);
  assert.match(r.stdout + r.stderr, /dark|theme/i);
});

test('variant-one-scheme exits 0 with a warning', () => {
  const r = run('variant-one-scheme');
  assert.equal(r.status, 0);
  assert.match(r.stdout + r.stderr, /warn|warning|color scheme/i);
});

test('variant claiming bright but missing [data-theme="bright"] block warns', () => {
  const r = run('variant-bright-claimed-no-css');
  assert.equal(r.status, 0, `stdout: ${r.stdout}\nstderr: ${r.stderr}`);
  assert.match(r.stdout, /WARN.*bright/);
});

test('variant claiming bright AND having [data-theme="bright"] block does not warn about bright', () => {
  const r = run('variant-bright-claimed-with-css');
  assert.equal(r.status, 0);
  assert.doesNotMatch(r.stdout, /WARN.*bright/);
});
