import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(__dirname, 'validate.mjs');
const FIXTURES = path.join(__dirname, '__fixtures__');

function run(file) {
  const result = spawnSync('node', [SCRIPT, path.join(FIXTURES, file)], {
    encoding: 'utf8',
  });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

test('valid.yml exits 0 with no errors', () => {
  const r = run('valid.yml');
  assert.equal(r.code, 0, `stdout: ${r.stdout}\nstderr: ${r.stderr}`);
});

test('invalid-kind.yml exits 1 and reports the bad kind', () => {
  const r = run('invalid-kind.yml');
  assert.equal(r.code, 1);
  assert.match(r.stdout + r.stderr, /heroo|kind/i);
});

test('missing-required.yml exits 1 and points at identity.name', () => {
  const r = run('missing-required.yml');
  assert.equal(r.code, 1);
  assert.match(r.stdout + r.stderr, /identity.*name|name.*required/i);
});

test('wrong-type.yml exits 1 and mentions the type mismatch', () => {
  const r = run('wrong-type.yml');
  assert.equal(r.code, 1);
  assert.match(r.stdout + r.stderr, /string|expected/i);
});

test('unregistered-extension.yml exits 0 and warns where each extension is used', () => {
  const r = run('unregistered-extension.yml');
  assert.equal(r.code, 0, `stdout: ${r.stdout}\nstderr: ${r.stderr}`);
  const warnings = r.stdout.trim().split('\n');
  assert.equal(warnings.length, 2, r.stdout);
  assert.match(warnings[0], /unregistered-extension\.yml:8:5 {2}warning: \/identity\/extensions\//);
  assert.match(
    warnings[1],
    /unregistered-extension\.yml:12:5 {2}warning: \/sections\/0 is a section/,
  );
});

test('error output includes line numbers for at least one error', () => {
  const r = run('invalid-kind.yml');
  assert.match(r.stdout + r.stderr, /:\d+:|line \d+/i);
});
