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
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// `pnpm config:migrate`, `pnpm config:validate`, and `pnpm config:ids-fix`,
// run the way the root scripts run them: config.mjs through tsx. Each run
// gets a scratch directory as INIT_CWD, the directory pnpm would have run in.

const CONFIG = fileURLToPath(new URL('./config.mjs', import.meta.url));
const TSX = fileURLToPath(import.meta.resolve('tsx/cli'));
const ALL_FIXTURES = fileURLToPath(
  new URL('../../../packages/schema/src/__fixtures__/', import.meta.url),
);
const FIXTURES = path.join(ALL_FIXTURES, 'legacy');
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
  // This build registers no color scheme until #19, so it lists none to pick from.
  assert.match(run.stdout, /It was warm\. Pass --set site\.appearance\.colorScheme=<value>\.\n/);
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
  assert.match(portfolio, /^schemaVersion: 3\nlocale: en\ndirection: ltr\n/);
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
    /is already a schemaVersion 3 portfolio document\. Nothing to migrate\./,
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
  // The section's id, talks, is a value; "the talks section", its old kind, isn't.
  assert.match(run.stdout, /The talks section is an evidence section/);
  for (const value of [
    'Rowan Owner',
    'rowan-old',
    'Lisbon',
    'calm-systems',
    '/sections/talks',
    'is talks',
    '"talks"',
    '=warm',
  ]) {
    assert.ok(!run.stdout.includes(value), value);
  }
});

test("a version 2 portfolio's site document is written too, in its own format, when a section it names goes", (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'config-migrate-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  const portfolio = {
    schemaVersion: 2,
    locale: 'en',
    direction: 'ltr',
    identity: { name: 'Rowan Two' },
    sections: [
      { kind: 'lede', id: 'about', title: 'About', body: 'Hi.' },
      { kind: 'lede', id: 'later', title: 'Later', body: 'Soon.' },
      { kind: 'talks', id: 'talks', title: 'Talks', items: [] },
    ],
  };
  writeFileSync(path.join(dir, 'portfolio.json'), `${JSON.stringify(portfolio, null, 2)}\n`);
  const site = `${readFileSync(path.join(root, 'site.example.yml'), 'utf8')}sections:\n  # Not yet.\n  later: { hidden: true }\n  talks: { hidden: true }\n`;
  writeFileSync(path.join(dir, 'site.yml'), site);
  const run = migrate(dir, 'portfolio.json', '--write', '--out', 'new');
  assert.equal(run.code, 0, run.stdout + run.stderr);
  assert.match(
    run.stdout,
    /^portfolio\.json is a schemaVersion 2 portfolio document\. Migrating it writes portfolio\.json at schemaVersion 3, and site\.yml without the entries of the sections that go\.\n/,
  );
  assert.match(run.stdout, /\nWrote new\/portfolio\.json and new\/site\.yml\.\n$/);
  // The site keeps its comments and every other byte, and stays YAML.
  assert.equal(
    readFileSync(path.join(dir, 'new', 'site.yml'), 'utf8'),
    site.replace('  talks: { hidden: true }\n', ''),
  );
  const written = JSON.parse(readFileSync(path.join(dir, 'new', 'portfolio.json'), 'utf8'));
  assert.deepEqual(
    written.sections.map(({ id }) => id),
    ['about', 'later'],
  );
  assert.equal(readFileSync(path.join(dir, 'site.yml'), 'utf8'), site);
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

function validate(cwd, ...args) {
  const result = spawnSync(process.execPath, [TSX, CONFIG, 'validate', ...args], {
    cwd,
    env: { ...process.env, INIT_CWD: cwd },
    encoding: 'utf8',
    timeout: 120_000,
  });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

/** The invalid pairs link to https://rowan.name, their own origin. */
const ORIGIN = ['--origin', 'https://rowan.name'];

/** What every pair says for a variant this build doesn't register, which names the one it does (#14). */
const UNAVAILABLE = (file) => [
  `${file}: variant.unavailable (warning) at /appearance/variant`,
  "  /appearance/variant names a variant this build doesn't register, so the fallback composition renders instead. It blocks publishing, not preview.",
  '  Install its package with pnpm --filter @portfolio/web add <package> and rebuild, or select one this build registers: editorial-evidence, kinetic-cosmos, obsidian-atelier, spatial-bento.',
  '',
];

test('validate prints each record where it is, with how to fix it, and exits 1', () => {
  const run = validate(ALL_FIXTURES, 'invalid/anchor.broken', ...ORIGIN);
  assert.equal(run.code, 1, run.stderr);
  assert.equal(
    run.stdout,
    [
      'portfolio.yml:10:10: anchor.broken (blocks-publish) at /links/1/url',
      '  /links/1/url links to no visible section or record.',
      '  Point the link at a visible section or record id, or drop the #fragment.',
      '',
      ...UNAVAILABLE('site.yml:4:12'),
      "invalid/anchor.broken can't go live: 1 record blocks it.",
      '',
    ].join('\n'),
  );
});

test('validate exits 0 on a valid pair, warnings or not, and lists what it could not check', () => {
  // The fallback composition renders for the pair's variant, which this
  // build doesn't register, and the fallback packs for its scheme and
  // typography, whose humanist-ui covers no Arabic (#19, Slice 4).
  const valid = validate(ALL_FIXTURES, 'pairs/mixed/json');
  assert.equal(valid.code, 0, valid.stderr);
  assert.ok(valid.stdout.includes(UNAVAILABLE('site.json:4:16').join('\n')), valid.stdout);
  assert.deepEqual(
    [...valid.stdout.matchAll(/^\S+: ([a-z.-]+) \(warning\) at (\S+)$/gm)].map((match) =>
      match.slice(1).join(' '),
    ),
    [
      'appearance.script-coverage /locale',
      'appearance.unavailable /appearance/colorScheme',
      'appearance.unavailable /appearance/typography',
      'variant.unavailable /appearance/variant',
    ],
    valid.stdout,
  );
  assert.match(valid.stdout, /\nportfolio\.json and site\.json are valid, with 4 warnings\.\n/);
  assert.match(valid.stdout, /\nNot checked: origin\.sample, origin\.stale\.\n/);
  assert.match(valid.stdout, /\nPass --origin with the site's origin/);

  const warned = validate(ALL_FIXTURES, 'invalid/origin.stale', ...ORIGIN);
  assert.equal(warned.code, 0, warned.stderr);
  assert.match(
    warned.stdout,
    /^portfolio\.yml:10:10: origin\.stale \(warning\) at \/links\/1\/url\n/,
  );
  assert.match(warned.stdout, /\nportfolio\.yml and site\.yml are valid, with 2 warnings\.\n/);
});

/**
 * Codes that compare a draft with the live revision, which only publish and
 * import have (the schema's node.test.ts checks each against its live/).
 */
const PUBLICATION_CODES = ['urls.vanished', 'id.reused', 'derived.unapproved'];

test('validate refuses every blocking invalid pair and loads every warning one, as JSON', () => {
  for (const code of readdirSync(path.join(ALL_FIXTURES, 'invalid'))) {
    const run = validate(ALL_FIXTURES, `invalid/${code}`, ...ORIGIN, '--json');
    const report = JSON.parse(run.stdout);
    const warning = report.diagnostics.every(({ severity }) => severity === 'warning');
    assert.equal(run.code, warning ? 0 : 1, code);
    assert.equal(report.ok, warning, code);
    // Each pair selects missing-variant, so once it parses, the fallback composition renders for it.
    const [unavailable, others] = [
      report.diagnostics.filter((record) => record.code === 'variant.unavailable'),
      report.diagnostics.filter((record) => record.code !== 'variant.unavailable'),
    ];
    if (unavailable.length > 0) {
      assert.deepEqual(
        unavailable.map(({ severity, document, pointer }) => [severity, document, pointer]),
        [['warning', 'site', '/appearance/variant']],
        code,
      );
    } else {
      // Only a pair that doesn't parse goes unchecked by the contract.
      assert.ok(
        others.some(({ severity }) => severity === 'blocks-preview'),
        `${code} parses, and has no variant.unavailable`,
      );
    }
    // The host checks appearance against the packs this build registers (#19,
    // Slice 4), where a scheme it doesn't register is appearance.unavailable,
    // a warning, as the fallback pack renders in its place. A publication
    // code's draft is clean on its own.
    const expected = PUBLICATION_CODES.includes(code)
      ? []
      : [code === 'appearance.unknown' ? 'appearance.unavailable' : code];
    assert.deepEqual([...new Set(others.map((record) => record.code))], expected, code);
    assert.ok(!report.notChecked.some((what) => what.startsWith('site.appearance.')), code);
    for (const record of report.diagnostics) {
      // A snapshot's or the media document's record names its file.
      const file = record.document === 'snapshots' || record.document === 'media';
      assert.deepEqual(
        Object.keys(record).filter((key) => !['line', 'column', 'stableId'].includes(key)),
        [
          'code',
          'severity',
          'document',
          ...(file ? ['file'] : []),
          'pointer',
          'message',
          'remediation',
        ],
        code,
      );
    }
  }
});

test('validate names the files, the directory, and a bad argument', (t) => {
  const dir = scratch(t);
  const json = JSON.parse(validate(ALL_FIXTURES, 'pairs/writing/yaml', '--json').stdout);
  assert.deepEqual(json.files, { portfolio: 'portfolio.yml', site: 'site.yml' });
  assert.equal(json.ok, true);

  const missing = validate(dir, 'nowhere');
  assert.equal(missing.code, 1);
  assert.equal(missing.stdout, "nowhere doesn't exist.\n");
  const file = validate(dir, 'owner.yml');
  assert.equal(file.code, 1);
  assert.match(file.stdout, /^owner\.yml is a file\. Give the directory that holds the pair/);

  for (const [args, message] of [
    [['a', 'b'], /Give one directory to validate\./],
    [['.', '--origin', 'https://rowan.name/blog'], /--origin takes an origin alone/],
    [['.', '--origin', 'rowan.name'], /--origin takes an origin alone/],
    [['.', '--strict'], /Unknown option '--strict'/],
  ]) {
    const run = validate(dir, ...args);
    assert.equal(run.code, 1, args.join(' '));
    assert.match(run.stderr, message, args.join(' '));
    assert.match(run.stderr, /Usage: pnpm config:validate \[dir\]/, args.join(' '));
  }
});

test('validate warns when the portfolio is still the bundled sample, which production refuses', (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'config-validate-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  copyFileSync(path.join(root, 'portfolio.example.yml'), path.join(dir, 'portfolio.yml'));
  copyFileSync(path.join(root, 'site.example.yml'), path.join(dir, 'site.yml'));

  const text = validate(dir, '.');
  assert.equal(text.code, 0, text.stderr);
  assert.match(
    text.stdout,
    /^portfolio\.yml:\d+:\d+: sample\.identity \(warning\) at \/identity\/name\n/m,
  );
  assert.match(text.stdout, /Production refuses to start with it\./);
  assert.match(text.stdout, /\nportfolio\.yml and site\.yml are valid, with 1 warning\.\n/);

  const json = JSON.parse(validate(dir, '.', '--json').stdout);
  assert.equal(json.ok, true);
  assert.deepEqual(
    json.diagnostics.map(({ code, severity, document, pointer }) => [
      code,
      severity,
      document,
      pointer,
    ]),
    // The example's variant, Editorial Evidence, is registered (#13).
    [['sample.identity', 'warning', 'portfolio', '/identity/name']],
  );

  // With a name of your own, the sample's warning is gone.
  const own = readFileSync(path.join(dir, 'portfolio.yml'), 'utf8').replace(
    'name: Anamika Devi',
    'name: Rowan Hale',
  );
  writeFileSync(path.join(dir, 'portfolio.yml'), own);
  const renamed = validate(dir, '.', '--json');
  assert.deepEqual(JSON.parse(renamed.stdout).diagnostics, []);
});

function idsFix(cwd, ...args) {
  const result = spawnSync(process.execPath, [TSX, CONFIG, 'ids-fix', ...args], {
    cwd,
    env: { ...process.env, INIT_CWD: cwd },
    encoding: 'utf8',
    timeout: 120_000,
  });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

function idsDir(t, files) {
  const dir = mkdtempSync(path.join(tmpdir(), 'config-ids-fix-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const [name, text] of Object.entries(files)) writeFileSync(path.join(dir, name), text);
  return dir;
}

const NEEDS_IDS = [
  '# Rowan, before ids.',
  'schemaVersion: 3',
  'locale: en',
  'direction: ltr',
  'identity: { name: Rowan Ids }',
  'works:',
  '  - { id: Tidewater Atlas, title: Tidewater Atlas, medium: interface }',
  'sections:',
  '  - kind: lede',
  '    title: About Me',
  '    body: Hi.',
  '  - { kind: works, id: work, items: [Tidewater Atlas] }',
  '',
].join('\n');

test('ids-fix prints the ids it would give, and writes them only with --write, keeping comments', (t) => {
  const dir = idsDir(t, { 'portfolio.yml': NEEDS_IDS });
  const dry = idsFix(dir, '.');
  assert.equal(dry.code, 0, dry.stderr);
  assert.equal(
    dry.stdout,
    [
      'portfolio.yml:',
      '  /sections/0/id gets about-me: it had none.',
      "  /works/0/id gets tidewater-atlas: its id wasn't well formed.",
      '    /sections/1/items/0 names it too, and changes with it.',
      '',
      'Nothing was written. Run pnpm config:ids-fix with --write to write 2 ids into portfolio.yml.',
      '',
    ].join('\n'),
  );
  assert.equal(readFileSync(path.join(dir, 'portfolio.yml'), 'utf8'), NEEDS_IDS);

  const wrote = idsFix(dir, 'portfolio.yml', '--write');
  assert.equal(wrote.code, 0, wrote.stderr);
  assert.match(wrote.stdout, /\nWrote 2 ids into portfolio\.yml\.\n$/);
  const fixed = readFileSync(path.join(dir, 'portfolio.yml'), 'utf8');
  assert.ok(fixed.startsWith('# Rowan, before ids.\n'), fixed);
  assert.match(fixed, /\n {4}body: Hi\.\n {4}id: about-me\n/);
  assert.match(fixed, /items: \[tidewater-atlas\]/);
  // Nothing is left beside it, and its own output has nothing to fix.
  assert.deepEqual(readdirSync(dir), ['portfolio.yml']);
  const again = idsFix(dir, '.');
  assert.equal(again.code, 0);
  assert.equal(
    again.stdout,
    'portfolio.yml has an id on every section, record, and media asset. Nothing to fix.\n',
  );
});

test('ids-fix refuses a version 2 document, a symbolic link, two portfolio documents, and bad arguments', (t) => {
  const dir = idsDir(t, {
    'portfolio.yml': NEEDS_IDS.replace('schemaVersion: 3', 'schemaVersion: 2'),
  });
  const old = idsFix(dir, '.');
  assert.equal(old.code, 1);
  assert.equal(
    old.stderr,
    "portfolio.yml can't be fixed.\n  It isn't a schemaVersion 3 portfolio document. Run pnpm config:migrate on it first, which mints every id.\n",
  );
  symlinkSync(path.join(dir, 'portfolio.yml'), path.join(dir, 'link.yml'));
  const link = idsFix(dir, 'link.yml', '--write');
  assert.equal(link.code, 1);
  assert.equal(link.stderr, 'link.yml is a symbolic link. Run this on the file it points at.\n');

  const two = idsDir(t, { 'portfolio.yml': NEEDS_IDS, 'portfolio.json': '{}\n' });
  for (const [cwd, args, message] of [
    [two, ['.'], /^\. holds portfolio\.yml and portfolio\.json\. Keep one portfolio document\.\n/],
    [dir, ['a', 'b'], /^Give one directory or portfolio document\.\n/],
    [dir, ['.', '--force'], /Unknown option '--force'/],
  ]) {
    const run = idsFix(cwd, ...args);
    assert.equal(run.code, 1, args.join(' '));
    assert.match(run.stderr, message, args.join(' '));
    assert.match(run.stderr, /Usage: pnpm config:ids-fix \[dir \| portfolio-file\] \[--write\]/);
  }
  const missing = idsFix(dir, 'nowhere');
  assert.equal(missing.code, 1);
  assert.equal(missing.stderr, "nowhere doesn't exist or can't be read.\n");
});
