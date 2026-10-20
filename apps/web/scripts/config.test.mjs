import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// `pnpm config:migrate`, run the way the root script runs it: config.mjs
// through tsx. Each run gets a scratch directory as INIT_CWD, the directory
// pnpm would have run in.

const CONFIG = fileURLToPath(new URL('./config.mjs', import.meta.url));
const TSX = fileURLToPath(import.meta.resolve('tsx/cli'));
const FIXTURES = fileURLToPath(
  new URL('../../../packages/schema/src/__fixtures__/legacy/', import.meta.url),
);
const BASELINE = [
  '--set',
  'site.appearance.colorScheme=warm',
  '--set',
  'site.appearance.typography=classic',
];

function scratch(t) {
  const dir = mkdtempSync(path.join(tmpdir(), 'config-migrate-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const name of ['owner.yml', 'owner.json'])
    copyFileSync(path.join(FIXTURES, name), path.join(dir, name));
  return dir;
}

function migrate(cwd, ...args) {
  const result = spawnSync(process.execPath, [TSX, CONFIG, 'migrate', ...args], {
    cwd,
    env: { ...process.env, INIT_CWD: cwd },
    encoding: 'utf8',
    timeout: 120_000,
  });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

test('a dry run prints what it needs, exits 2, and writes nothing', (t) => {
  const dir = scratch(t);
  const before = readFileSync(path.join(dir, 'owner.yml'), 'utf8');
  const run = migrate(dir, 'owner.yml');
  assert.equal(run.code, 2, run.stderr);
  assert.match(run.stdout, /^owner\.yml is in the old one-file format/);
  assert.match(
    run.stdout,
    /Pass --set site\.appearance\.colorScheme=<value>, one of: warm, noir, ink-and-paper\./,
  );
  assert.match(run.stdout, /\/sections\/4\/subtitel \(line 49, column 5\)/);
  assert.match(run.stdout, /It changed nothing\./);
  assert.equal(readFileSync(path.join(dir, 'owner.yml'), 'utf8'), before);
});

test('--write puts both documents in --out, never over a file, and never touches the input', (t) => {
  const dir = scratch(t);
  const before = readFileSync(path.join(dir, 'owner.yml'), 'utf8');
  const args = ['owner.yml', ...BASELINE, '--drop-unknown', '--write', '--out', 'new'];
  const run = migrate(dir, ...args);
  assert.equal(run.code, 0, run.stderr);
  assert.match(run.stdout, /\nWrote new\/portfolio\.yml and new\/site\.yml\.\n$/);
  const portfolio = readFileSync(path.join(dir, 'new', 'portfolio.yml'), 'utf8');
  const site = readFileSync(path.join(dir, 'new', 'site.yml'), 'utf8');
  assert.match(portfolio, /^schemaVersion: 2\nlocale: en\ndirection: ltr\n/);
  assert.match(site, /\n {2}colorScheme: warm\n {2}typography: classic\n/);
  // The dry run printed this very site document.
  assert.ok(run.stdout.includes(`site.yml:\n${site}`));
  assert.equal(readFileSync(path.join(dir, 'owner.yml'), 'utf8'), before);

  // Again: both names are taken, so it refuses and changes nothing.
  writeFileSync(path.join(dir, 'new', 'site.yml'), 'kept\n');
  const again = migrate(dir, ...args);
  assert.equal(again.code, 1);
  assert.match(
    again.stderr,
    /new\/portfolio\.yml already exists\. The migration never replaces a file/,
  );
  assert.equal(readFileSync(path.join(dir, 'new', 'portfolio.yml'), 'utf8'), portfolio);
  assert.equal(readFileSync(path.join(dir, 'new', 'site.yml'), 'utf8'), 'kept\n');

  // One taken name is enough to write neither.
  mkdirSync(path.join(dir, 'other'));
  writeFileSync(path.join(dir, 'other', 'site.yml'), 'kept\n');
  const half = migrate(
    dir,
    'owner.yml',
    ...BASELINE,
    '--drop-unknown',
    '--write',
    '--out',
    'other',
  );
  assert.equal(half.code, 1);
  assert.equal(existsSync(path.join(dir, 'other', 'portfolio.yml')), false);

  // Its own output is already current.
  const current = migrate(dir, path.join(dir, 'new', 'portfolio.yml'));
  assert.equal(current.code, 0);
  assert.match(
    current.stdout,
    /is already a schemaVersion 2 portfolio document\. Nothing to migrate\./,
  );
});

test('a JSON file is written as JSON, and a summary leaves its values out', (t) => {
  const dir = scratch(t);
  const run = migrate(
    dir,
    'owner.json',
    ...BASELINE,
    '--drop-unknown',
    '--summary',
    '--write',
    '--out',
    '.',
  );
  assert.equal(run.code, 0, run.stderr);
  const portfolio = JSON.parse(readFileSync(path.join(dir, 'portfolio.json'), 'utf8'));
  const site = JSON.parse(readFileSync(path.join(dir, 'site.json'), 'utf8'));
  assert.equal(portfolio.identity.name, 'Rowan Owner');
  assert.deepEqual(site.sections, { talks: { hidden: true } });
  for (const value of ['Rowan Owner', 'rowan-old', 'Lisbon', 'talks', '=warm']) {
    assert.ok(!run.stdout.includes(value), value);
  }
});

test('bad arguments, a TOML file, and a file it cannot read exit 1', (t) => {
  const dir = scratch(t);
  for (const [args, message] of [
    [[], /Give one old file to migrate\./],
    [['owner.yml', '--write'], /--write needs --out <dir>\./],
    [['owner.yml', '--out', 'x'], /--out goes with --write\./],
    [['owner.yml', '--set', 'colorScheme=warm'], /--set takes <portfolio\|site>\.<path>=<value>/],
    [['owner.yml', '--colour'], /Unknown option '--colour'/],
    [
      ['portfolio.toml'],
      /is TOML, which this release doesn't read\. Convert it to YAML or JSON first/,
    ],
    [['missing.yml'], /Can't read missing\.yml \(ENOENT\)\./],
    [['owner.yml', '--origin', 'https://rowan.test/blog'], /--origin takes an origin alone/],
  ]) {
    const run = migrate(dir, ...args);
    assert.equal(run.code, 1, `${args.join(' ')}: ${run.stdout}${run.stderr}`);
    assert.match(run.stderr, message, args.join(' '));
  }
});

test('an --out it cannot write into is one line and exit 1, never a stack trace', (t) => {
  const dir = scratch(t);
  const write = ['owner.yml', ...BASELINE, '--drop-unknown', '--write', '--out'];
  writeFileSync(path.join(dir, 'a-file'), '');
  const file = migrate(dir, ...write, 'a-file');
  assert.equal(file.code, 1, file.stderr);
  assert.equal(file.stderr, "a-file isn't a directory. Nothing was written.\n");
  if (process.getuid?.() !== 0) {
    const locked = path.join(dir, 'locked');
    mkdirSync(locked, { mode: 0o500 });
    try {
      const denied = migrate(dir, ...write, 'locked');
      assert.equal(denied.code, 1, denied.stderr);
      assert.equal(denied.stderr, "Can't write into locked (EACCES). Nothing was written.\n");
      assert.deepEqual(readdirSync(locked), []);
    } finally {
      chmodSync(locked, 0o700);
    }
  }
});

test('the report names the file as given, and its command quotes it for the shell', (t) => {
  const dir = scratch(t);
  mkdirSync(path.join(dir, 'old files'));
  copyFileSync(path.join(dir, 'owner.yml'), path.join(dir, 'old files', 'owner.yml'));
  const run = migrate(dir, 'old files/owner.yml', ...BASELINE, '--drop-unknown');
  assert.equal(run.code, 0, run.stderr);
  assert.match(run.stdout, /^old files\/owner\.yml is in the old one-file format/);
  assert.match(
    run.stdout,
    /\nNothing stops the migration\. pnpm config:migrate 'old files\/owner\.yml' --set site\.appearance\.colorScheme=warm --set site\.appearance\.typography=classic --drop-unknown --write --out <dir> /,
  );
});
