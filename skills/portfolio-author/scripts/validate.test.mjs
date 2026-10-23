import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(__dirname, 'validate.mjs');
const FIXTURES = path.join(__dirname, '__fixtures__');

/** Runs validate.mjs on a fixture pair, from the fixtures directory. */
function run(...args) {
  const result = spawnSync('node', [SCRIPT, ...args], { cwd: FIXTURES, encoding: 'utf8' });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

/** Every pair warns for a variant this build doesn't register, and names the one it does (#14). */
const UNAVAILABLE = 'site.yml:3:12: variant.unavailable (warning) at /appearance/variant';

test('the valid pair exits 0, with only the warning that the fallback composition renders', () => {
  const r = run('valid');
  assert.equal(r.code, 0, `stdout: ${r.stdout}\nstderr: ${r.stderr}`);
  assert.equal(
    r.stdout,
    [
      UNAVAILABLE,
      "  /appearance/variant names a variant this build doesn't register, so the fallback composition renders instead. It blocks publishing, not preview.",
      '  Install its package with pnpm --filter @portfolio/web add <package> and rebuild, or select one this build registers: kinetic-cosmos.',
      '',
      'portfolio.yml and site.yml are valid, with 1 warning.',
      '',
    ].join('\n'),
  );
});

test('invalid-kind exits 1 and reports the bad kind where it is', () => {
  const r = run('invalid-kind');
  assert.equal(r.code, 1);
  assert.match(
    r.stdout,
    /^portfolio\.yml:12:11: schema\.invalid \(blocks-preview\) at \/sections\/0\/kind\n/,
  );
  // Records never quote the document, so the typo shows only as the hint.
  assert.match(r.stdout, /is not a known section kind\. Did you mean hero\?/);
  assert.doesNotMatch(r.stdout, /heroo/);
  assert.match(r.stdout, /\ninvalid-kind can't go live: 1 record blocks it\.\n$/);
});

test('missing-required exits 1 and points at identity.name', () => {
  const r = run('missing-required');
  assert.equal(r.code, 1);
  assert.match(r.stdout, /schema\.invalid \(blocks-preview\) at \/identity\/name\n/);
});

test('wrong-type exits 1 and mentions the type mismatch', () => {
  const r = run('wrong-type');
  assert.equal(r.code, 1);
  assert.match(
    r.stdout,
    /^portfolio\.yml:6:9: schema\.invalid \(blocks-preview\) at \/identity\/name\n/,
  );
  assert.match(r.stdout, /string|expected/i);
});

test('unregistered-extension exits 0 and warns where each extension is used', () => {
  const r = run('unregistered-extension');
  assert.equal(r.code, 0, `stdout: ${r.stdout}\nstderr: ${r.stderr}`);
  const heads = r.stdout.split('\n').filter((line) => /^\S+:\d+:\d+: /.test(line));
  assert.deepEqual(heads, [
    'portfolio.yml:8:5: extension.unregistered (warning) at /identity/extensions/@acme~1portfolio-photography',
    'portfolio.yml:12:5: extension.unregistered (warning) at /sections/0',
    UNAVAILABLE,
  ]);
  assert.match(r.stdout, /\nportfolio\.yml and site\.yml are valid, with 3 warnings\.\n$/);
});

test('a directory that is missing or a file, and a usage error', () => {
  const missing = run('nowhere');
  assert.equal(missing.code, 1);
  assert.equal(missing.stdout, "nowhere doesn't exist. Give the directory that holds the pair.\n");
  const file = run(path.join('valid', 'portfolio.yml'));
  assert.equal(file.code, 1);
  assert.match(file.stdout, /is a file\. Give the directory that holds the pair\./);
  for (const args of [[], ['valid', 'extra']]) {
    const usage = run(...args);
    assert.equal(usage.code, 2, args.join(' '));
    assert.match(usage.stderr, /usage: node validate\.mjs <dir>/);
  }
});
