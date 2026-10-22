import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs, {
  chmodSync,
  chownSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { validateManifest, type VariantRegistry } from '@portfolio/variant-contract';
import { migrateControlsCommand } from './migrate-controls';

// `pnpm variants:migrate-controls` (#5, Slice 5, item 3): a dry run prints
// each entry's changes and a diff and writes nothing, --write writes them,
// and a second run is a no-op. Ocean, the contract's fixture manifest, is at
// controls version 2 with a migration from 1.

const SCRIPT = fileURLToPath(new URL('./migrate-controls.ts', import.meta.url));
const TSX = createRequire(import.meta.url).resolve('tsx/cli');
const FIXTURES = new URL('../../../packages/', import.meta.url);

function ocean() {
  const raw = JSON.parse(
    readFileSync(new URL('variant-contract/src/__fixtures__/manifest.json', FIXTURES), 'utf8'),
  );
  const result = validateManifest(raw, { packageName: '@acme/ocean' });
  assert.ok(result.ok, JSON.stringify(result.diagnostics));
  return result.manifest;
}

const REGISTRY: VariantRegistry = [
  { packageName: '@acme/ocean', version: '1.0.0', manifest: ocean() },
];

const SITE = readFileSync(
  new URL('schema/src/__fixtures__/pairs/engineering/yaml/site.yml', FIXTURES),
  'utf8',
);
const STORED = `variantControls:
  acme-ocean:
    version: 1
    values:
      layout: full
      columns: 9
  acme-tide:
    version: 2
    values: {}
`;

function scratch(t: test.TestContext, text = `${SITE}${STORED}`, name = 'site.yml') {
  const dir = mkdtempSync(path.join(tmpdir(), 'migrate-controls-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(path.join(dir, name), text);
  return dir;
}

function run(cwd: string, ...args: string[]) {
  let out = '';
  let err = '';
  const code = migrateControlsCommand(args, REGISTRY, {
    cwd,
    out: (text) => (out += text),
    err: (text) => (err += text),
  });
  return { code, out, err };
}

test('a dry run prints each change and the diff, and writes nothing', (t) => {
  const dir = scratch(t);
  const before = readFileSync(path.join(dir, 'site.yml'), 'utf8');
  const result = run(dir, '--site', 'site.yml');
  assert.equal(result.code, 0, result.err);
  assert.deepEqual(result.out.split('\n').slice(0, 5), [
    "site.yml: acme-ocean's controls migrate from version 1 to 2:",
    '  renames layout to heroLayout',
    '  maps heroLayout from "full" to "wide"',
    '  clamps columns from 9 to 4',
    "site.yml: acme-tide's controls stay as they are: this build doesn't register acme-tide.",
  ]);
  assert.match(result.out, /^--- site\.yml\n\+\+\+ site\.yml\n/m);
  assert.match(result.out, /^- {4}version: 1\n/m);
  assert.match(result.out, /^\+ {4}version: 2\n/m);
  assert.match(result.out, /Run it again with --write to write site\.yml\.\n$/);
  assert.equal(readFileSync(path.join(dir, 'site.yml'), 'utf8'), before);
});

test('--write writes the migrated document, and a second run changes nothing', (t) => {
  const dir = scratch(t);
  const written = run(dir, '--site', 'site.yml', '--write');
  assert.equal(written.code, 0, written.err);
  assert.match(written.out, /\nWrote site\.yml\.\n$/);
  const after = readFileSync(path.join(dir, 'site.yml'), 'utf8');
  assert.ok(after.startsWith(SITE));
  assert.match(
    after,
    /acme-ocean:\n {4}version: 2\n {4}values:\n {6}columns: 4\n {6}heroLayout: wide\n/,
  );
  const again = run(dir, '--site', 'site.yml', '--write');
  assert.equal(again.code, 0, again.err);
  assert.equal(
    again.out,
    [
      "site.yml: acme-ocean's controls are current, at version 2.",
      "site.yml: acme-tide's controls stay as they are: this build doesn't register acme-tide.",
      'Nothing to migrate in site.yml.',
      '',
    ].join('\n'),
  );
  assert.equal(readFileSync(path.join(dir, 'site.yml'), 'utf8'), after);
});

test('through a symbolic link, --write migrates the file the link names and keeps the link', (t) => {
  const dir = scratch(t);
  const real = path.join(dir, 'real');
  mkdirSync(real);
  renameSync(path.join(dir, 'site.yml'), path.join(real, 'site.yml'));
  chmodSync(path.join(real, 'site.yml'), 0o640);
  symlinkSync(path.join('real', 'site.yml'), path.join(dir, 'site.yml'));
  const written = run(dir, '--site', 'site.yml', '--write');
  assert.equal(written.code, 0, written.err);
  assert.match(written.out, /\nWrote site\.yml\.\n$/);
  assert.ok(lstatSync(path.join(dir, 'site.yml')).isSymbolicLink());
  assert.equal(readlinkSync(path.join(dir, 'site.yml')), path.join('real', 'site.yml'));
  const after = readFileSync(path.join(real, 'site.yml'), 'utf8');
  assert.match(after, /acme-ocean:\n {4}version: 2\n/);
  assert.equal(statSync(path.join(real, 'site.yml')).mode & 0o777, 0o640);
  // Nothing is left beside the link or the file.
  assert.deepEqual(readdirSync(dir).sort(), ['real', 'site.yml']);
  assert.deepEqual(readdirSync(real), ['site.yml']);
  assert.match(run(dir, '--site', 'site.yml').out, /Nothing to migrate in site\.yml\.\n$/);
});

test("--write keeps the file's mode, whatever the umask, through a link too", (t) => {
  const cases = [
    { mode: 0o664, umask: 0o022, link: false },
    { mode: 0o666, umask: 0o022, link: true },
    { mode: 0o644, umask: 0o077, link: false },
    { mode: 0o640, umask: 0o077, link: true },
  ];
  for (const { mode, umask, link } of cases) {
    const dir = scratch(t);
    const file = path.join(dir, 'site.yml');
    chmodSync(file, mode);
    if (link) {
      mkdirSync(path.join(dir, 'links'));
      symlinkSync(path.join('..', 'site.yml'), path.join(dir, 'links', 'site.yml'));
    }
    const previous = process.umask(umask);
    let written;
    try {
      written = run(link ? path.join(dir, 'links') : dir, '--site', 'site.yml', '--write');
    } finally {
      process.umask(previous);
    }
    const label = `${mode.toString(8)} under umask ${umask.toString(8)}${link ? ', through a link' : ''}`;
    assert.equal(written.code, 0, `${label}: ${written.err}`);
    assert.match(readFileSync(file, 'utf8'), /acme-ocean:\n {4}version: 2\n/, label);
    assert.equal(statSync(file).mode & 0o777, mode, label);
  }
});

test("--write keeps the file's owner and group, such as a second group the server reads it through", (t) => {
  const dir = scratch(t);
  const file = path.join(dir, 'site.yml');
  // A file made in this directory gets this group, so the test needs another.
  const made = statSync(file);
  const second =
    process.getuid?.() === 0
      ? made.gid === 1
        ? 2
        : 1
      : (process.getgroups?.() ?? []).find((gid) => gid !== made.gid);
  assert.ok(second !== undefined, 'The user running this test needs a second group.');
  chownSync(file, made.uid, second);
  chmodSync(file, 0o640);
  const written = run(dir, '--site', 'site.yml', '--write');
  assert.equal(written.code, 0, written.err);
  const after = statSync(file);
  assert.deepEqual([after.uid, after.gid, after.mode & 0o777], [made.uid, second, 0o640]);
  assert.match(readFileSync(file, 'utf8'), /acme-ocean:\n {4}version: 2\n/);
});

test("when the new file can't take the old one's owner and group, it exits 1 and nothing changes", (t) => {
  const dir = scratch(t);
  const file = path.join(dir, 'site.yml');
  const before = readFileSync(file, 'utf8');
  const { uid, gid } = statSync(file);
  // What fchown says when the owner is another user, or the group one this user isn't in.
  t.mock.method(fs, 'fchownSync', () => {
    throw Object.assign(new Error('EPERM: operation not permitted, fchown'), { code: 'EPERM' });
  });
  const result = run(dir, '--site', 'site.yml', '--write');
  assert.equal(result.code, 1);
  assert.equal(
    result.err,
    `site.yml belongs to uid ${uid} and gid ${gid}, which a file this user writes can't keep, so it's left as it is. Run the command as that user, or with sudo.\n`,
  );
  assert.doesNotMatch(result.out, /Wrote/);
  assert.equal(readFileSync(file, 'utf8'), before);
  assert.deepEqual(readdirSync(dir), ['site.yml']);
});

test("--write through a link in a directory this user can't write still replaces the file it names", (t) => {
  const dir = scratch(t);
  const links = path.join(dir, 'links');
  mkdirSync(links);
  symlinkSync(path.join('..', 'site.yml'), path.join(links, 'site.yml'));
  // The temp file goes beside the file, so the link's directory is never written.
  chmodSync(links, 0o555);
  let written;
  try {
    written = run(links, '--site', 'site.yml', '--write');
  } finally {
    chmodSync(links, 0o755);
  }
  assert.equal(written.code, 0, written.err);
  assert.match(written.out, /\nWrote site\.yml\.\n$/);
  assert.ok(lstatSync(path.join(links, 'site.yml')).isSymbolicLink());
  assert.match(readFileSync(path.join(dir, 'site.yml'), 'utf8'), /acme-ocean:\n {4}version: 2\n/);
  assert.deepEqual(readdirSync(links), ['site.yml']);
});

test('a link named for one format to a file named for the other is left as it is', (t) => {
  const json = `${JSON.stringify(parse(`${SITE}${STORED}`), null, 2)}\n`;
  const dir = scratch(t, json, 'site.json');
  symlinkSync('site.json', path.join(dir, 'site.yml'));
  const result = run(dir, '--site', 'site.yml', '--write');
  assert.equal(result.code, 1);
  assert.equal(
    result.err,
    "site.yml links to site.json, a file named for the other format, so it's left as it is. Give the link and the file the same extension, then run it again.\n",
  );
  assert.equal(readFileSync(path.join(dir, 'site.json'), 'utf8'), json);
  // The other way round, too.
  const yaml = scratch(t);
  symlinkSync('site.yml', path.join(yaml, 'site.json'));
  assert.equal(run(yaml, '--site', 'site.json', '--write').code, 1);
  assert.equal(readFileSync(path.join(yaml, 'site.yml'), 'utf8'), `${SITE}${STORED}`);
  // A file whose name declares no format is read in the link's.
  const plain = scratch(t);
  renameSync(path.join(plain, 'site.yml'), path.join(plain, 'site-data'));
  symlinkSync('site-data', path.join(plain, 'site.yml'));
  const written = run(plain, '--site', 'site.yml', '--write');
  assert.equal(written.code, 0, written.err);
  assert.match(
    readFileSync(path.join(plain, 'site-data'), 'utf8'),
    /acme-ocean:\n {4}version: 2\n/,
  );
});

test('a JSON document is written in its own indent', (t) => {
  const data = parse(`${SITE}${STORED}`) as Record<string, unknown>;
  const text = `${JSON.stringify(data, null, 4)}\n`;
  const dir = scratch(t, text, 'site.json');
  const written = run(dir, '--site', 'site.json', '--write');
  assert.equal(written.code, 0, written.err);
  const controls = data.variantControls as Record<string, unknown>;
  const migrated = {
    ...data,
    variantControls: {
      ...controls,
      'acme-ocean': { version: 2, values: { columns: 4, heroLayout: 'wide' } },
    },
  };
  assert.equal(
    readFileSync(path.join(dir, 'site.json'), 'utf8'),
    `${JSON.stringify(migrated, null, 4)}\n`,
  );
  // So the diff shows only the entry that migrates.
  const diff = run(scratch(t, text, 'site.json'), '--site', 'site.json').out;
  assert.deepEqual(
    diff.split('\n').filter((line) => /^[-+] /.test(line)),
    [
      '-            "version": 1,',
      '+            "version": 2,',
      '-                "layout": "full",',
      '-                "columns": 9',
      '+                "columns": 4,',
      '+                "heroLayout": "wide"',
    ],
  );
});

test("an edit the document's text can't take exits 1 and leaves the file as it is", (t) => {
  // A YAML complex key, which the edits can't change in place.
  const complex = STORED.replace('      layout: full\n', '      ? layout\n      : full\n');
  assert.notEqual(complex, STORED);
  const dir = scratch(t, `${SITE}${complex}`);
  const before = readFileSync(path.join(dir, 'site.yml'), 'utf8');
  const result = run(dir, '--site', 'site.yml', '--write');
  assert.equal(result.code, 1);
  assert.equal(
    result.err,
    "site.yml has text the migration can't edit in place, such as a YAML complex key (? key), so it's left as it is. Make the changes above by hand, or write that entry as plain key: value lines and run it again.\n",
  );
  // What to change by hand is still printed.
  assert.match(result.out, /^site\.yml: acme-ocean's controls migrate from version 1 to 2:\n/);
  assert.doesNotMatch(result.out, /Wrote/);
  assert.equal(readFileSync(path.join(dir, 'site.yml'), 'utf8'), before);
  assert.deepEqual(readdirSync(dir), ['site.yml']);
});

test('the printed diff redacts anything secret-shaped, and the file keeps it', (t) => {
  const token = `ghp_${'x'.repeat(36)}`;
  const text = `${SITE}# pasted by mistake: ${token}\n${STORED}`;
  const dir = scratch(t, text);
  const result = run(dir, '--site', 'site.yml', '--write');
  assert.equal(result.code, 0, result.err);
  assert.ok(!result.out.includes(token));
  assert.match(result.out, /^ # pasted by mistake: \[secret\]$/m);
  assert.ok(readFileSync(path.join(dir, 'site.yml'), 'utf8').includes(token));
});

test('a wrong argument, a missing file, and a document it cannot read exit 1', (t) => {
  const dir = scratch(t, 'appearance: [\n');
  for (const args of [
    [],
    ['site.yml'],
    ['--site', 'site.toml'],
    ['--site', 'site.yml', '--force'],
  ]) {
    const result = run(dir, ...args);
    assert.equal(result.code, 1, args.join(' '));
    assert.match(result.err, /Usage: pnpm variants:migrate-controls/, args.join(' '));
  }
  assert.match(run(dir, '--site', 'gone.yml').err, /^gone\.yml can't be read\.\n$/);
  assert.match(
    run(dir, '--site', 'site.yml').err,
    /^site\.yml isn't a site document this release reads\. Run pnpm config:validate to see why\.\n$/,
  );
});

test('the script runs on the host registry, from the directory pnpm ran in', (t) => {
  const dir = scratch(t);
  const result = spawnSync(process.execPath, [TSX, SCRIPT, '--site', 'site.yml'], {
    cwd: path.dirname(SCRIPT),
    env: { ...process.env, INIT_CWD: dir },
    encoding: 'utf8',
    timeout: 120_000,
  });
  assert.equal(result.status, 0, result.stderr);
  // This build registers no variant with controls yet, so both stay as they are.
  assert.equal(
    result.stdout,
    [
      "site.yml: acme-ocean's controls stay as they are: this build doesn't register acme-ocean.",
      "site.yml: acme-tide's controls stay as they are: this build doesn't register acme-tide.",
      'Nothing to migrate in site.yml.',
      '',
    ].join('\n'),
  );
});
