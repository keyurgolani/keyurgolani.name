import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { defineContentExtension } from './extensions';
import { parsePortfolio, parseSite } from './load';
import {
  findPair,
  loadPair,
  pairFileNames,
  readPair,
  readPairBytes,
  readUnitFiles,
  type LoadPairResult,
} from './node';
import { PUBLICATION_VALIDATORS, PUBLISH_VALIDATORS } from './published-urls';
import { canonicalize, serialize } from './serialize';
import { parseSource } from './source';
import { lockedModes, lockMode, MADE, tempDir } from './test-support/scratch';
import {
  DIAGNOSTIC_SEVERITIES,
  type AppearanceCatalog,
  type Context,
  type DiagnosticCode,
} from './validate';

const FIXTURES = fileURLToPath(new URL('./__fixtures__/', import.meta.url));
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/**
 * A test catalog: the color schemes and typography presets the fixtures name,
 * #19's platform defaults, which the bundled examples select, and every
 * display mode. It names no variant: the variant contract checks the
 * selection, and every fixture selects missing-variant, which no package
 * registers.
 */
const IDS = {
  colorScheme: ['warm', 'warm-parchment', 'noir', 'ink-and-paper', 'nebula', 'aurora', 'solar'],
  typography: ['classic', 'humanist-ui', 'modernist', 'geometric', 'humanist'],
  displayMode: ['system', 'light', 'dark', 'high-contrast'],
} as const;
const CATALOG: AppearanceCatalog = {
  ids(axis) {
    return axis in IDS ? IDS[axis as keyof typeof IDS] : null;
  },
  generatorInput: () => undefined,
};
/** The invalid pairs link to https://rowan.name, their own origin. */
const INVALID_CONTEXT: Context = { catalog: CATALOG, canonicalOrigin: 'https://rowan.name' };

const PRACTICES = [
  'academic',
  'consulting',
  'design',
  'engineering',
  'mixed',
  'music',
  'photography',
  'writing',
];

const codes = (result: LoadPairResult) => result.diagnostics.map(({ code }) => code);

const fixture = (...parts: string[]) => path.join(FIXTURES, ...parts);
const text = (...parts: string[]) => fs.readFileSync(fixture(...parts), 'utf8');

test('every profession pair loads clean, in YAML and as its JSON twin', () => {
  assert.deepEqual(fs.readdirSync(fixture('pairs')).sort(), PRACTICES);
  for (const practice of PRACTICES) {
    // The pairs link only to reserved .test hosts, so no origin is configured.
    const yaml = loadPair(fixture('pairs', practice, 'yaml'), { catalog: CATALOG });
    const json = loadPair(fixture('pairs', practice, 'json'), { catalog: CATALOG });
    assert.ok(yaml.ok, `${practice}: ${codes(yaml).join(', ')}`);
    assert.ok(json.ok, `${practice}: ${codes(json).join(', ')}`);
    assert.deepEqual(yaml.diagnostics, [], practice);
    assert.deepEqual(json.diagnostics, [], practice);
    assert.deepEqual(json.pair, yaml.pair, practice);
    assert.deepEqual(
      [json.sources.portfolio.format, json.sources.site.format],
      ['json', 'json'],
      practice,
    );
  }
});

test('each JSON twin is what serialize writes from its YAML, and both round-trip', () => {
  for (const practice of PRACTICES) {
    for (const [document, parse] of [
      ['portfolio', parsePortfolio],
      ['site', parseSite],
    ] as const) {
      const yaml = text('pairs', practice, 'yaml', `${document}.yml`);
      const json = text('pairs', practice, 'json', `${document}.json`);
      const authored = parseSource(yaml, 'yaml');
      assert.ok(authored.ok, `${practice}/${document}`);
      assert.equal(serialize(authored.data, 'json'), json, `${practice}/${document}`);
      assert.equal(canonicalize(authored.data), canonicalize(JSON.parse(json)));
      // Written back out as YAML, it reads as the same model.
      const model = parse(yaml, 'yaml');
      const again = parse(serialize(authored.data, 'yaml'), 'yaml');
      assert.ok(model.ok && again.ok, `${practice}/${document}`);
      assert.deepEqual(again.value, model.value, `${practice}/${document}`);
    }
  }
});

test('the practices cover both directions and several locales, each selecting missing-variant', () => {
  const pairs = PRACTICES.map((practice) => {
    const result = loadPair(fixture('pairs', practice, 'yaml'), { catalog: CATALOG });
    assert.ok(result.ok, practice);
    return result.pair;
  });
  assert.deepEqual([...new Set(pairs.map(({ portfolio }) => portfolio.direction))].sort(), [
    'ltr',
    'rtl',
  ]);
  assert.ok(new Set(pairs.map(({ portfolio }) => portfolio.locale)).size >= 6);
  // No package registers it, so every host renders them in the fallback composition.
  assert.deepEqual(
    [...new Set(pairs.map(({ site }) => site.appearance.variant))],
    ['missing-variant'],
  );
  assert.ok(pairs.some(({ site }) => site.sections && Object.keys(site.sections).length > 0));
  assert.ok(pairs.some(({ site }) => site.motionPolicy === 'reduce'));
});

/** Codes no committed fixture can show: one would commit a secret-shaped string, one a broken build. */
const BUILT_AT_RUN_TIME: readonly DiagnosticCode[] = ['secret.detected', 'validator.failed'];

/** Codes about the snapshots and the media document beside the pair, which readUnitFiles raises. */
const UNIT_FILE_CODES: readonly DiagnosticCode[] = [
  'snapshot.syntax',
  'snapshot.invalid',
  'snapshot.ignored',
  'media.syntax',
  'media.invalid',
];
/** Codes the publication validators raise, with the live revision in `live/`. */
const PUBLICATION_CODES: readonly DiagnosticCode[] = ['urls.vanished', 'id.reused'];
/** The derived-change gate's code: its draft and live revision differ in a snapshot beside each pair. */
const DERIVED_CODES: readonly DiagnosticCode[] = ['derived.unapproved'];

test('every diagnostic code has an invalid pair, refused or loaded by its severity', () => {
  const all = Object.keys(DIAGNOSTIC_SEVERITIES) as DiagnosticCode[];
  assert.deepEqual(
    fs.readdirSync(fixture('invalid')).sort(),
    all.filter((code) => !BUILT_AT_RUN_TIME.includes(code)).sort(),
  );
  for (const code of fs.readdirSync(fixture('invalid')) as DiagnosticCode[]) {
    if ([...UNIT_FILE_CODES, ...PUBLICATION_CODES, ...DERIVED_CODES].includes(code)) continue;
    const result = loadPair(fixture('invalid', code), INVALID_CONTEXT);
    assert.deepEqual([...new Set(codes(result))], [code], code);
    for (const diagnostic of result.diagnostics) {
      assert.equal(diagnostic.severity, DIAGNOSTIC_SEVERITIES[code], code);
      assert.ok(diagnostic.remediation.length > 0, code);
      // A missing or doubled document is the document itself, with no text to point into.
      if (code.startsWith('source.')) continue;
      assert.ok(
        Number.isInteger(diagnostic.line) && Number.isInteger(diagnostic.column),
        `${code} at ${diagnostic.pointer} has no position`,
      );
    }
    if (DIAGNOSTIC_SEVERITIES[code] === 'warning') {
      assert.ok(result.ok, code);
      assert.equal(result.pair.portfolio.identity.name, 'Rowan Fixture', code);
    } else {
      assert.equal(result.ok, false, code);
      assert.equal('pair' in result, false, code);
    }
  }
});

test('each snapshot and media document code has a pair with that file beside it', () => {
  for (const code of UNIT_FILE_CODES) {
    const dir = fixture('invalid', code);
    // The pair itself is clean.
    const pair = loadPair(dir, INVALID_CONTEXT);
    assert.ok(pair.ok, code);
    assert.deepEqual(codes(pair), [], code);
    const unit = readUnitFiles(dir);
    assert.deepEqual([...new Set(unit.diagnostics.map(({ code }) => code))], [code], code);
    for (const diagnostic of unit.diagnostics) {
      assert.equal(diagnostic.severity, DIAGNOSTIC_SEVERITIES[code], code);
      assert.ok(diagnostic.remediation.length > 0, code);
      assert.ok(diagnostic.file, code);
      assert.equal(diagnostic.document, code.startsWith('media.') ? 'media' : 'snapshots', code);
      if (code !== 'snapshot.ignored') {
        assert.ok(Number.isInteger(diagnostic.line), `${code} has no position`);
      }
    }
    // A file that doesn't read is left out, so the view never renders it as data.
    assert.deepEqual(unit.snapshots, {}, code);
    assert.equal(unit.media, undefined, code);
  }
});

test('each publication code has a draft pair, refused against the live revision beside it', () => {
  for (const code of PUBLICATION_CODES) {
    const live = loadPair(fixture('invalid', code, 'live'), INVALID_CONTEXT);
    assert.ok(live.ok, code);
    if (!live.ok) continue;
    const dir = fixture('invalid', code);
    // Without the live revision there's nothing to compare, so the checks wait.
    const alone = loadPair(dir, { ...INVALID_CONTEXT, validators: PUBLICATION_VALIDATORS });
    assert.ok(alone.ok, code);
    assert.deepEqual(codes(alone), [], code);
    assert.ok(alone.notChecked.includes(code), code);
    const result = loadPair(dir, {
      ...INVALID_CONTEXT,
      validators: PUBLICATION_VALIDATORS,
      publication: { live: { pair: live.pair } },
    });
    assert.deepEqual([...new Set(codes(result))], [code], code);
    assert.equal(result.ok, false, code);
    for (const diagnostic of result.diagnostics) {
      assert.equal(diagnostic.severity, DIAGNOSTIC_SEVERITIES[code], code);
      assert.ok(Number.isInteger(diagnostic.line) && Number.isInteger(diagnostic.column), code);
    }
  }
});

test('the derived-change code has a draft whose snapshot differs from the live revision beside it, refused until the change is accepted (#10)', () => {
  const [code] = DERIVED_CODES;
  const dir = fixture('invalid', code!);
  const live = loadPair(fixture('invalid', code!, 'live'), INVALID_CONTEXT);
  assert.ok(live.ok);
  if (!live.ok) return;
  const publication = {
    live: {
      pair: live.pair,
      snapshots: readUnitFiles(fixture('invalid', code!, 'live')).snapshots,
    },
    draft: { snapshots: readUnitFiles(dir).snapshots },
  };
  const check = (derived: unknown) =>
    loadPair(dir, {
      ...INVALID_CONTEXT,
      validators: PUBLISH_VALIDATORS,
      publication: { ...publication, derived },
    });
  // The pair alone is clean, and without the live revision the gate waits.
  const alone = loadPair(dir, { ...INVALID_CONTEXT, validators: PUBLISH_VALIDATORS });
  assert.ok(alone.ok);
  assert.ok(alone.notChecked.includes(code!));
  const refused = check({ changes: [] });
  assert.deepEqual([...new Set(codes(refused))], [code]);
  assert.equal(refused.ok, false);
  for (const diagnostic of refused.diagnostics) {
    assert.equal(diagnostic.severity, DIAGNOSTIC_SEVERITIES[code!]);
    // On the GitHub section the snapshot is for, with its line.
    assert.equal(diagnostic.document, 'portfolio');
    assert.equal(diagnostic.pointer, '/sections/1');
    assert.ok(Number.isInteger(diagnostic.line) && Number.isInteger(diagnostic.column));
    assert.ok(diagnostic.remediation.includes('portfolio-store changes accept'));
  }
  // An import brings no derived block, and counts as accepting what it brings.
  assert.ok(check(undefined).ok);
});

test('a secret-shaped value refuses the pair without the value in any record', (t) => {
  // Built here, so no secret-shaped literal is ever committed.
  const token = ['ghp', '_', 'Q'.repeat(36)].join('');
  const pair = (document: string) => text('pairs', 'engineering', 'yaml', document);
  const dir = tempDir(t, {
    'portfolio.yml': pair('portfolio.yml').replace('label: Code', `label: ${token}`),
    'site.yml': pair('site.yml'),
  });
  const result = loadPair(dir, { catalog: CATALOG });
  assert.equal(result.ok, false);
  assert.deepEqual(
    result.diagnostics.map(({ code, pointer, line }) => [code, pointer, line]),
    [['secret.detected', '/links/0/label', 17]],
  );
  assert.doesNotMatch(JSON.stringify(result), /Q{20}/);
});

test('a broken build is validator.failed, not a problem with the pair', () => {
  const twins = [
    defineContentExtension({ namespace: 'twin' }),
    defineContentExtension({ namespace: 'twin' }),
  ];
  const result = loadPair(fixture('pairs', 'engineering', 'yaml'), { extensions: twins });
  assert.equal(result.ok, false);
  assert.deepEqual(codes(result), ['validator.failed']);
});

test('the startup cases: neither document, one of them, and the old format alone', (t) => {
  const empty = loadPair(fixture('startup', 'empty'));
  assert.equal(empty.ok, false);
  assert.deepEqual(
    empty.diagnostics.map(({ code, document }) => [code, document]),
    [
      ['source.missing', 'portfolio'],
      ['source.missing', 'site'],
    ],
  );
  assert.deepEqual(!empty.ok && empty.missing, ['portfolio', 'site']);

  const siteOnly = loadPair(fixture('startup', 'site-only'));
  assert.deepEqual(!siteOnly.ok && siteOnly.missing, ['portfolio']);
  assert.deepEqual(codes(siteOnly), ['source.missing']);
  assert.equal(
    siteOnly.diagnostics[0]!.message,
    'The directory holds no portfolio document: portfolio.yml, portfolio.yaml, or portfolio.json.',
  );

  const portfolioOnly = loadPair(fixture('invalid', 'source.missing'));
  assert.deepEqual(!portfolioOnly.ok && portfolioOnly.missing, ['site']);

  // A TOML document can only be the old format, and nothing else is reported.
  const toml = loadPair(fixture('startup', 'toml'));
  assert.equal(toml.ok, false);
  assert.deepEqual(codes(toml), ['legacy.document']);
  assert.match(toml.diagnostics[0]!.remediation, /Convert it to YAML or JSON first/);
  assert.match(toml.diagnostics[0]!.remediation, /pnpm config:migrate/);

  // The old file with no site document, as an upgrade finds it: the old
  // format is the one thing reported, as it is with a site document beside it.
  const dir = fixture('startup', 'legacy-only');
  const legacyOnly = loadPair(dir, { catalog: CATALOG });
  assert.equal(legacyOnly.ok, false);
  assert.deepEqual(
    legacyOnly.diagnostics.map(({ code, document, pointer, line }) => [
      code,
      document,
      pointer,
      line,
    ]),
    [['legacy.document', 'portfolio', '', 5]],
  );
  assert.equal(!legacyOnly.ok && legacyOnly.missing, undefined);
  assert.deepEqual(pairFileNames(legacyOnly), { portfolio: 'portfolio.yml' });
  assert.match(legacyOnly.diagnostics[0]!.message, /portfolio\.yml is in the old one-file format/);
  assert.match(legacyOnly.diagnostics[0]!.remediation, /--write --out <dir>/);
  const beside = tempDir(t, {
    'portfolio.yml': text('startup', 'legacy-only', 'portfolio.yml'),
    'site.yml': text('invalid', 'source.duplicate', 'site.yml'),
  });
  assert.deepEqual(legacyOnly.diagnostics, loadPair(beside, { catalog: CATALOG }).diagnostics);
});

test('a document in two formats names each file', (t) => {
  const site = text('invalid', 'source.duplicate', 'site.yml');
  const portfolio = text('invalid', 'source.duplicate', 'portfolio.yml');
  const dir = tempDir(t, {
    'portfolio.yml': portfolio,
    'site.yml': site,
    'site.yaml': site,
    'site.json': '{}',
  });
  const result = loadPair(dir);
  assert.equal(result.ok, false);
  assert.deepEqual(
    result.diagnostics.map(({ code, document, message }) => [code, document, message]),
    [
      [
        'source.duplicate',
        'site',
        'The directory holds site.json, site.yaml, and site.yml, one site document in 3 formats.',
      ],
    ],
  );
  assert.equal(
    loadPair(fixture('invalid', 'source.duplicate')).diagnostics[0]!.message,
    'The directory holds portfolio.json and portfolio.yml, one portfolio document in 2 formats.',
  );
});

test('only the six document names count', (t) => {
  // The examples and other files sit beside the pair, unread.
  const dir = tempDir(t, {
    'portfolio.example.yml': 'not read',
    'site.example.yml': 'not read',
    'notes.md': 'not read',
    'site.yml.bak': 'not read',
    'portfolio.yml': 'read',
    'site.json': 'read',
  });
  assert.deepEqual(findPair(dir), {
    ok: true,
    files: { portfolio: path.join(dir, 'portfolio.yml'), site: path.join(dir, 'site.json') },
  });
  const examplesOnly = findPair(
    tempDir(t, { 'portfolio.example.yml': 'not read', 'site.example.yml': 'not read' }),
  );
  assert.equal(examplesOnly.ok, false);
  assert.deepEqual(!examplesOnly.ok && examplesOnly.missing, ['portfolio', 'site']);
});

test('the directory itself: missing, a file, or unreadable', (t) => {
  const parent = tempDir(t, { 'portfolio.yml': 'x' });
  const missing = loadPair(path.join(parent, 'absent'));
  assert.equal(missing.ok, false);
  assert.equal(!missing.ok && missing.directory, 'missing');
  assert.deepEqual(missing.diagnostics, []);

  const file = loadPair(path.join(parent, 'portfolio.yml'));
  assert.equal(!file.ok && file.directory, 'not-directory');

  if (process.getuid?.() !== 0) {
    const locked = tempDir(t);
    lockMode(locked, 0o000);
    try {
      const unreadable = loadPair(locked);
      assert.equal(!unreadable.ok && unreadable.directory, 'unreadable');
    } finally {
      fs.chmodSync(locked, 0o700);
    }
  }
});

test("a document that can't be read is source.unreadable, and loadPair never throws", (t) => {
  // The fixture's portfolio.yml is a directory, which lists like a document
  // and then fails to read.
  const dir = fixture('invalid', 'source.unreadable');
  assert.ok(fs.statSync(path.join(dir, 'portfolio.yml')).isDirectory());
  const result = loadPair(dir);
  assert.equal(result.ok, false);
  assert.deepEqual(
    result.diagnostics.map(({ code, document, message, remediation }) => [
      code,
      document,
      message,
      remediation,
    ]),
    [
      [
        'source.unreadable',
        'portfolio',
        "portfolio.yml can't be read.",
        "Make portfolio.yml a file the server's user can read.",
      ],
    ],
  );

  if (process.getuid?.() !== 0) {
    const locked = tempDir(t, {
      'portfolio.yml': text('invalid', 'source.missing', 'portfolio.yml'),
      'site.yml': text('invalid', 'source.unreadable', 'site.yml'),
    });
    lockMode(path.join(locked, 'site.yml'), 0o000);
    assert.deepEqual(
      loadPair(locked).diagnostics.map(({ code, document }) => [code, document]),
      [['source.unreadable', 'site']],
    );
  }

  // A file that's gone between listing and reading, or never was, is missing.
  const absent = readPair({
    portfolio: path.join(dir, 'gone.yml'),
    site: path.join(dir, 'site.yml'),
  });
  assert.deepEqual(
    absent.diagnostics.map(({ code, document, message }) => [code, document, message]),
    [['source.missing', 'portfolio', "gone.yml doesn't exist."]],
  );
});

test('a FIFO for a document, a snapshot, or the media document is unreadable, never a hang', (t) => {
  if (process.platform === 'win32') return t.skip('Windows has no FIFOs.');
  const dir = tempDir(t, { 'site.yml': text('invalid', 'source.unreadable', 'site.yml') });
  fs.mkdirSync(path.join(dir, 'snapshots'));
  fs.mkdirSync(path.join(dir, 'media'));
  for (const name of ['portfolio.yml', 'snapshots/github.json', 'media/media.json']) {
    execFileSync('mkfifo', [path.join(dir, name)]);
  }
  // In a child process, so a read that blocks fails the test instead of hanging it.
  const reader = pathToFileURL(fileURLToPath(new URL('./node.ts', import.meta.url))).href;
  const script = [
    `import { loadPair, readUnitFiles } from ${JSON.stringify(reader)};`,
    'const dir = process.env.FIFO_DIR;',
    'const pair = loadPair(dir).diagnostics.map(({ code, document }) => [code, document]);',
    'const unit = readUnitFiles(dir).diagnostics.map(({ code, file }) => [code, file]);',
    'console.log(JSON.stringify({ pair, unit }));',
  ].join('\n');
  const run = spawnSync(
    process.execPath,
    [...process.execArgv, '--input-type=module', '--eval', script],
    { env: { ...process.env, FIFO_DIR: dir }, encoding: 'utf8', timeout: 60_000 },
  );
  assert.equal(run.signal, null, 'a read blocked on a FIFO');
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(JSON.parse(run.stdout), {
    pair: [['source.unreadable', 'portfolio']],
    unit: [
      ['snapshot.invalid', 'snapshots/github.json'],
      ['media.invalid', 'media/media.json'],
    ],
  });
});

test('a document over the size limit is refused where it passes it', (t) => {
  const site = text('invalid', 'source.duplicate', 'site.yml');
  const head = text('invalid', 'source.missing', 'portfolio.yml');
  const dir = tempDir(t, { 'site.yml': site });
  fs.writeFileSync(path.join(dir, 'portfolio.yml'), `${head}# ${'x'.repeat(2 * 1024 * 1024)}\n`);
  const result = loadPair(dir);
  assert.equal(result.ok, false);
  assert.deepEqual(
    result.diagnostics.map(({ code, line }) => [code, line]),
    [['parse.syntax', head.split('\n').length]],
  );
});

test('a loaded pair keeps the source text and format of both documents', () => {
  const dir = fixture('pairs', 'writing', 'yaml');
  const result = loadPair(dir, { catalog: CATALOG });
  assert.ok(result.ok);
  assert.deepEqual(
    [result.sources.portfolio.name, result.sources.site.name],
    ['portfolio.yml', 'site.yml'],
  );
  assert.equal(result.sources.site.text, text('pairs', 'writing', 'yaml', 'site.yml'));
  assert.equal(result.sources.portfolio.path, path.join(dir, 'portfolio.yml'));
});

test('readPairBytes finds the pair as loadPair does, and returns each file as its bytes', (t) => {
  const dir = tempDir(t, { 'portfolio.yml': 'not: validated\n', 'site.json': '{"x":\n' });
  const bom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('é\n')]);
  fs.writeFileSync(path.join(dir, 'portfolio.yml'), bom);
  const read = readPairBytes(dir);
  assert.ok(read.ok);
  assert.deepEqual(
    [read.files.portfolio.name, read.files.site.name],
    ['portfolio.yml', 'site.json'],
  );
  // The bytes as mounted, byte order mark and all: nothing decodes or validates them.
  assert.deepEqual(Buffer.from(read.files.portfolio.bytes), bom);
  assert.equal(Buffer.from(read.files.site.bytes).toString('utf8'), '{"x":\n');

  for (const code of ['source.missing', 'source.duplicate', 'source.unreadable'] as const) {
    const bytes = readPairBytes(fixture('invalid', code));
    const loaded = loadPair(fixture('invalid', code));
    assert.equal(bytes.ok, false, code);
    assert.deepEqual(
      !bytes.ok && bytes.diagnostics.map(({ code: found, document }) => [found, document]),
      loaded.diagnostics.map(({ code: found, document }) => [found, document]),
      code,
    );
  }
  const missing = readPairBytes(path.join(dir, 'nowhere'));
  assert.equal(!missing.ok && missing.directory, 'missing');
});

test('the bundled examples load as one pair with no blocking diagnostic', () => {
  const result = readPair(
    {
      portfolio: path.join(ROOT, 'portfolio.example.yml'),
      site: path.join(ROOT, 'site.example.yml'),
    },
    { catalog: CATALOG, canonicalOrigin: 'https://anamika.name' },
  );
  assert.ok(result.ok, codes(result).join(', '));
  assert.deepEqual(
    result.diagnostics.filter(({ severity }) => severity !== 'warning'),
    [],
  );
  // The platform default, which the host registers (#13).
  assert.equal(result.pair.site.appearance.variant, 'editorial-evidence');
  // The example omits appearanceInputs, so nothing about them goes unchecked.
  assert.ok(!result.notChecked.some((entry) => entry.includes('appearanceInputs')));
});

test('every scratch directory these tests made is gone once its test ends', () => {
  assert.ok(MADE.length > 0);
  assert.deepEqual(
    MADE.filter((dir) => fs.existsSync(dir)),
    [],
  );
  assert.equal(lockedModes(), 0);
});
