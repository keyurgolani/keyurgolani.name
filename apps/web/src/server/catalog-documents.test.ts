import test from 'node:test';
import assert from 'node:assert/strict';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import type { AppearanceCatalog } from '@portfolio/schema';
import { readPair } from '@portfolio/schema/node';
import { contractValidators } from '@portfolio/variant-contract';
import { REGISTRY } from '~/lib/variants';
// The schema package's test extension, shared with its own tests.
import { acmePortfolioPhotography } from '../../../../packages/schema/src/__fixtures__/acme-portfolio-photography';
import {
  BUNDLED_SAMPLE_NAMES,
  openDocumentsCatalog,
  type DocumentsCatalogOptions,
  type OpenDocumentsResult,
} from './catalog-documents';
import type { ConfigIssue, RuntimeMode } from './config';
import { pairDigest } from './pair-records';

// The source-directory and document rows of the startup matrix for the pair
// (#4, items 4 to 6), plus the adapter's re-validation under next dev. The
// schema package's own tests cover each diagnostic; these cover how the
// adapter turns them into startup issues.

const ROOT = '../../../../';
const EXAMPLES = {
  portfolio: fileURLToPath(new URL(`${ROOT}portfolio.example.yml`, import.meta.url)),
  site: fileURLToPath(new URL(`${ROOT}site.example.yml`, import.meta.url)),
};
/** The lines every version 2 portfolio starts with, before identity. */
const HEAD = 'schemaVersion: 3\nlocale: en\ndirection: ltr\n';
const PORTFOLIO = `${HEAD}identity:\n  name: Rowan Test\nsections:\n  - kind: lede\n    id: about\n    body: Hi.\n`;
const SITE = readFileSync(EXAMPLES.site, 'utf8');

/**
 * A test catalog that registers color schemes and typography presets, as
 * #19's will, so an appearance record has something to be about. Like the
 * host's interim catalog, it names no variant: the contract's validators
 * check the selection, live at startup, where an unregistered one only warns.
 */
const CATALOG: AppearanceCatalog = {
  ids(axis) {
    const ids: Record<string, string[]> = {
      colorScheme: ['warm', 'noir'],
      typography: ['classic', 'modernist'],
      displayMode: ['system', 'light', 'dark', 'high-contrast'],
    };
    return ids[axis] ?? null;
  },
  generatorInput: () => undefined,
};
const LIVE = contractValidators(REGISTRY, { live: true });

function tempDir(t: { after: (fn: () => void) => void }, files: Record<string, string> = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'catalog-documents-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const [name, text] of Object.entries(files)) writeFileSync(path.join(dir, name), text);
  return dir;
}

const pair = (portfolio = PORTFOLIO, site = SITE) => ({
  'portfolio.yml': portfolio,
  'site.yml': site,
});

function open(
  sourceDir: string,
  mode: RuntimeMode,
  overrides: Partial<DocumentsCatalogOptions> = {},
): OpenDocumentsResult {
  return openDocumentsCatalog({
    sourceDir,
    mode,
    examples: EXAMPLES,
    catalog: CATALOG,
    report: () => assert.fail('nothing re-validates at startup'),
    ...overrides,
  });
}

function fatal(result: OpenDocumentsResult): ConfigIssue[] {
  assert.equal(result.ok, false);
  return result.issues.filter((issue) => issue.severity === 'fatal');
}

const codes = (issues: readonly ConfigIssue[]) =>
  issues.map((issue) => `${issue.severity}:${issue.code}`);

/** Writes a file and moves its mtime, so a re-validation always sees the change. */
function rewrite(file: string, text: string, seconds: number) {
  writeFileSync(file, text);
  utimesSync(file, seconds, seconds);
}

const canRestrict = process.platform !== 'win32' && process.getuid?.() !== 0;

test('a missing source directory is fatal', (t) => {
  const [issue] = fatal(open(path.join(tempDir(t), 'absent'), 'production'));
  assert.deepEqual([issue?.key, issue?.code], ['PORTFOLIO_SOURCE_DIR', 'source_missing']);
});

test('a source path that names a file is fatal, and says to name its directory', (t) => {
  const dir = tempDir(t, pair());
  const [issue] = fatal(open(path.join(dir, 'portfolio.yml'), 'production'));
  assert.equal(issue?.code, 'source_not_directory');
  assert.match(issue!.message, /directory that holds portfolio\.yml and site\.yml/);
});

test('an unreadable source directory is fatal', { skip: !canRestrict }, (t) => {
  const dir = tempDir(t, pair());
  chmodSync(dir, 0o000);
  try {
    assert.equal(fatal(open(dir, 'production'))[0]?.code, 'source_unreadable');
  } finally {
    chmodSync(dir, 0o700);
  }
});

test('neither document is fatal in production: one source.missing for each', (t) => {
  const issues = fatal(open(tempDir(t, { 'notes.md': 'not a portfolio' }), 'production'));
  assert.deepEqual(
    issues.map((issue) => [issue.code, issue.document, issue.path]),
    [
      ['source.missing', 'portfolio', ''],
      ['source.missing', 'site', ''],
    ],
  );
  assert.match(issues[0]!.remediation ?? '', /portfolio\.example\.yml is one to start from/);
});

test('neither document renders the bundled examples under next dev, with a warning', async (t) => {
  const result = open(tempDir(t), 'development');
  assert.ok(result.ok, JSON.stringify(result.issues));
  assert.deepEqual(codes(result.issues), ['warning:source_empty']);
  const live = await result.reader.getLive();
  assert.equal(live.unit.portfolio.identity.name, BUNDLED_SAMPLE_NAMES[0]);
  assert.equal(live.unit.site.appearance.variant, 'editorial-evidence');
});

test('one document alone is fatal in every mode', (t) => {
  for (const mode of ['production', 'development'] as const) {
    for (const [files, missing] of [
      [{ 'portfolio.yml': PORTFOLIO }, 'site'],
      [{ 'site.json': '{}' }, 'portfolio'],
    ] as const) {
      const issues = fatal(open(tempDir(t, files), mode));
      assert.deepEqual(
        issues.map((issue) => [issue.code, issue.document]),
        [['source.missing', missing]],
        mode,
      );
    }
  }
});

test('a document in two formats is fatal, even under next dev', (t) => {
  const dir = tempDir(t, { ...pair(), 'site.json': '{}' });
  const issues = fatal(open(dir, 'development'));
  assert.deepEqual(
    issues.map((issue) => [issue.code, issue.document, issue.message]),
    [
      [
        'source.duplicate',
        'site',
        'The directory holds site.json and site.yml, one site document in 2 formats.',
      ],
    ],
  );
});

test('a portfolio.toml is the old format, refused by name in every mode, even beside a pair', (t) => {
  for (const mode of ['production', 'development'] as const) {
    const dir = tempDir(t, { ...pair(), 'portfolio.toml': '[identity]\nname = "Rowan"\n' });
    const issues = fatal(open(dir, mode));
    assert.deepEqual(
      issues.map((issue) => issue.code),
      ['legacy.document'],
    );
    assert.match(issues[0]!.remediation ?? '', /Convert it to YAML or JSON first/);
  }
});

test('an old-format portfolio with no site document is the old format, not a missing site', (t) => {
  // The layout an upgrade finds: the one file, before the migration splits it.
  const old = 'identity:\n  name: Rowan Test\nvariant: editorial\ntheme: dark\n';
  for (const mode of ['production', 'development'] as const) {
    const issues = fatal(open(tempDir(t, { 'portfolio.yml': old }), mode));
    assert.deepEqual(
      issues.map((issue) => [issue.code, issue.file, issue.document, issue.line]),
      [['legacy.document', 'portfolio.yml', 'portfolio', 3]],
      mode,
    );
    assert.match(issues[0]!.remediation ?? '', /--write --out <dir>/);
  }
});

test(
  'an unreadable document is source.unreadable, naming the file',
  { skip: !canRestrict },
  (t) => {
    const dir = tempDir(t, pair());
    chmodSync(path.join(dir, 'site.yml'), 0o000);
    const issues = fatal(open(dir, 'production'));
    assert.deepEqual(
      issues.map((issue) => [issue.code, issue.file, issue.document, issue.message]),
      [['source.unreadable', 'site.yml', 'site', "site.yml can't be read."]],
    );
  },
);

test('each record becomes an issue: located, with its remediation, never quoting a value', (t) => {
  const located = (issues: ConfigIssue[]) =>
    issues.map(({ key, code, file, document, path: pointer, line, column }) => ({
      key,
      code,
      file,
      document,
      pointer,
      line,
      column,
    }));
  const portfolio = fatal(
    open(
      tempDir(
        t,
        pair(
          PORTFOLIO.replace('  name: Rowan Test', '  name: Rowan Test\n  tagine: canary-tagline'),
        ),
      ),
      'production',
    ),
  );
  assert.deepEqual(located(portfolio), [
    {
      key: 'PORTFOLIO_SOURCE_DIR',
      code: 'schema.invalid',
      file: 'portfolio.yml',
      document: 'portfolio',
      pointer: '/identity/tagine',
      line: 6,
      column: 3,
    },
  ]);
  assert.match(portfolio[0]!.message, /Did you mean tagline\?/);
  assert.ok((portfolio[0]!.remediation ?? '').length > 0);

  const site = SITE.replace('colorScheme: warm', 'colorScheme: canary-scheme');
  const appearance = fatal(open(tempDir(t, pair(PORTFOLIO, site)), 'production'));
  assert.deepEqual(located(appearance), [
    {
      key: 'PORTFOLIO_SOURCE_DIR',
      code: 'appearance.unknown',
      file: 'site.yml',
      document: 'site',
      pointer: '/appearance/colorScheme',
      line: site.split('\n').findIndex((text) => text.includes('canary-scheme')) + 1,
      column: 16,
    },
  ]);
  assert.equal(appearance[0]!.remediation, 'Use one of: warm, noir.');
  assert.ok(!JSON.stringify([...portfolio, ...appearance]).includes('canary'));
});

test('a variant the build does not register only warns, and the pair serves, for the fallback composition', async (t) => {
  const site = SITE.replace('variant: editorial-evidence', 'variant: retro');
  const dir = tempDir(t, pair(PORTFOLIO, site));
  const result = open(dir, 'production', { validators: LIVE });
  assert.ok(result.ok, JSON.stringify(result.issues));
  assert.deepEqual(
    result.issues.map((issue) => [issue.severity, issue.code, issue.file, issue.path, issue.line]),
    [['warning', 'variant.unavailable', 'site.yml', '/appearance/variant', 21]],
  );
  // It names neither the id nor a path, and says how to install one.
  assert.ok(!result.issues[0]!.message.includes('retro'));
  assert.match(result.issues[0]!.remediation ?? '', /pnpm --filter @portfolio\/web add/);
  assert.equal((await result.reader.getLive()).unit.site.appearance.variant, 'retro');
  // Not live, as #3's publish will check, the same record blocks.
  const published = open(dir, 'production', { validators: contractValidators(REGISTRY) });
  assert.deepEqual(
    fatal(published).map((issue) => [issue.code, issue.path]),
    [['variant.unavailable', '/appearance/variant']],
  );
});

test('a blocks-publish record stops startup too, and a warning only logs', (t) => {
  // Every section hidden: nothing to publish.
  const empty = tempDir(t, pair(PORTFOLIO, `${SITE}sections:\n  about:\n    hidden: true\n`));
  assert.deepEqual(codes(fatal(open(empty, 'production'))), ['fatal:content.empty']);
  // A link to an old copy of the origin's domain warns.
  const stale = tempDir(
    t,
    pair(PORTFOLIO.replace('sections:', 'links:\n  - url: https://rowan.com/blog\nsections:')),
  );
  const result = open(stale, 'production', { origin: 'https://rowan.name' });
  assert.ok(result.ok, JSON.stringify(result.issues));
  assert.deepEqual(
    result.issues.map((issue) => [issue.severity, issue.code, issue.path]),
    [['warning', 'origin.stale', '/links/0/url']],
  );
  // Without the origin, links aren't checked against it.
  assert.deepEqual(codes((open(stale, 'production') as { issues: ConfigIssue[] }).issues), []);
});

test('an old-format document gets one issue naming its old fields and the migrate command', (t) => {
  const dir = tempDir(t, pair('identity:\n  name: Rowan\nvariant: canary-variant\n'));
  const issues = fatal(open(dir, 'production'));
  assert.deepEqual(
    issues.map((issue) => [issue.code, issue.file, issue.path, issue.line]),
    [['legacy.document', 'portfolio.yml', '', 3]],
  );
  assert.match(issues[0]!.message, /\/variant to appearance\.variant in site\.yml/);
  assert.match(issues[0]!.remediation ?? '', /pnpm config:migrate portfolio\.yml --set /);
  assert.ok(!JSON.stringify(issues).includes('canary'));
});

test('the content extensions reach the check, and a problem in one is fatal', (t) => {
  const dir = tempDir(
    t,
    pair(
      PORTFOLIO.replace(
        '  name: Rowan Test',
        "  name: Rowan Test\n  extensions:\n    '@acme/portfolio-photography': { camra: Leica }",
      ),
    ),
  );
  // Unregistered, it loads as written, with a warning.
  const unregistered = open(dir, 'production');
  assert.deepEqual(codes(unregistered.issues), ['warning:extension.unregistered']);
  const registered = open(dir, 'production', { extensions: [acmePortfolioPhotography] });
  assert.deepEqual(codes(fatal(registered)), ['fatal:schema.invalid']);
  assert.match(registered.issues[0]!.message, /Did you mean camera\?/);
});

test('a bundled sample identity is fatal in production and a warning under next dev', (t) => {
  const dir = tempDir(
    t,
    pair(PORTFOLIO.replace('Rowan Test', `"  ${BUNDLED_SAMPLE_NAMES[0]!.toUpperCase()} "`)),
  );
  const [issue] = fatal(open(dir, 'production'));
  assert.deepEqual(
    [issue?.code, issue?.file, issue?.path, issue?.line],
    ['sample_identity', 'portfolio.yml', '/identity/name', 5],
  );
  const dev = open(dir, 'development');
  assert.equal(dev.ok, true);
  assert.deepEqual(codes(dev.issues), ['warning:sample_identity']);
});

test('the sample list matches the bundled example', () => {
  const example = parseYaml(readFileSync(EXAMPLES.portfolio, 'utf8')) as {
    identity: { name: string };
  };
  assert.deepEqual(BUNDLED_SAMPLE_NAMES, [example.identity.name]);
});

test('a valid pair becomes one frozen revision, named by a hash over both documents', async (t) => {
  const dir = tempDir(t, pair());
  const result = open(dir, 'production');
  assert.ok(result.ok, JSON.stringify(result.issues));
  assert.deepEqual(result.issues, []);
  const live = await result.reader.getLive();
  const read = readPair({
    portfolio: path.join(dir, 'portfolio.yml'),
    site: path.join(dir, 'site.yml'),
  });
  assert.ok(read.ok);
  assert.equal(live.revisionId, `doc-${pairDigest(read.sources)}`);
  assert.equal(live.unit.portfolio.identity.name, 'Rowan Test');
  assert.equal(live.unit.site.appearance.colorScheme, 'warm');
  for (const frozen of [live, live.unit, live.unit.portfolio.sections, live.unit.site.appearance]) {
    assert.ok(Object.isFrozen(frozen));
  }
  assert.ok(Object.isFrozen(result.reader));
  assert.equal(await result.reader.getLive(), live);
  // A change to the site document alone is a new revision.
  const other = tempDir(t, pair(PORTFOLIO, SITE.replace('colorScheme: warm', 'colorScheme: noir')));
  const changed = open(other, 'production');
  assert.ok(changed.ok);
  assert.notEqual((await changed.reader.getLive()).revisionId, live.revisionId);
});

/** snapshots/github.json for a github section, with every field the snapshot schema requires. */
const GITHUB_SNAPSHOT = JSON.stringify({
  records: [
    {
      adapter: 'github',
      sectionId: 'on-github',
      fetchedAt: '2026-10-02T08:00:00Z',
      data: {
        username: 'rowan-test',
        profileUrl: 'https://github.com/rowan-test',
        source: 'rest',
        totalRepos: 3,
        totalStarsReceived: 4,
        starsGiven: null,
        contributionsLastYear: null,
        pinnedRepos: [],
        recentlyActive: [],
        contributionCalendar: [],
        languageBreakdown: [],
      },
    },
  ],
});

/** A source directory holding the pair and `snapshots/<name>` with `text`. */
function withSnapshot(t: { after: (fn: () => void) => void }, name: string, text: string) {
  const dir = tempDir(t, pair());
  mkdirSync(path.join(dir, 'snapshots'));
  writeFileSync(path.join(dir, 'snapshots', name), text);
  return dir;
}

test('the snapshots beside the pair reach the revision, frozen (#10)', async (t) => {
  const result = open(withSnapshot(t, 'github.json', GITHUB_SNAPSHOT), 'production');
  assert.ok(result.ok, JSON.stringify(result.issues));
  assert.deepEqual(result.issues, []);
  const live = await result.reader.getLive();
  assert.deepEqual(Object.keys(live.unit.snapshots), ['github']);
  assert.ok(Object.isFrozen(live.unit.snapshots));
  assert.equal(live.unit.media, undefined);
  // Without a snapshots directory, the unit has none.
  const bare = open(tempDir(t, pair()), 'production');
  assert.ok(bare.ok);
  assert.deepEqual((await bare.reader.getLive()).unit.snapshots, {});
});

test('a snapshot that does not read stops startup, naming its file and never quoting it (#10)', (t) => {
  for (const [text, code] of [
    ['{ "records": [canary-snapshot', 'snapshot.syntax'],
    ['{ "records": "canary-snapshot" }', 'snapshot.invalid'],
  ] as const) {
    for (const mode of ['production', 'development'] as const) {
      const issues = fatal(open(withSnapshot(t, 'github.json', text), mode));
      assert.deepEqual(
        issues.map((issue) => [issue.key, issue.code, issue.file, issue.document]),
        [['PORTFOLIO_SOURCE_DIR', code, 'snapshots/github.json', 'snapshots']],
        `${code} ${mode}`,
      );
      assert.ok(!JSON.stringify(issues).includes('canary'), code);
    }
  }
});

test('a file in snapshots/ that is no snapshot only warns, and the pair serves (#10)', async (t) => {
  const result = open(withSnapshot(t, 'notes.txt', 'canary-notes'), 'production');
  assert.ok(result.ok, JSON.stringify(result.issues));
  assert.deepEqual(
    result.issues.map((issue) => [issue.severity, issue.code, issue.file]),
    [['warning', 'snapshot.ignored', 'snapshots/notes.txt']],
  );
  assert.deepEqual((await result.reader.getLive()).unit.snapshots, {});
});

test('under next dev an edit to a snapshot re-validates, as an edit to a document does (#10)', async (t) => {
  const dir = withSnapshot(t, 'github.json', GITHUB_SNAPSHOT);
  const file = path.join(dir, 'snapshots', 'github.json');
  rewrite(file, GITHUB_SNAPSHOT, 1_000);
  const reported: ConfigIssue[] = [];
  const result = open(dir, 'development', { report: (issue) => reported.push(issue) });
  assert.ok(result.ok);
  const first = await result.reader.getLive();
  rewrite(file, '{ "records": [', 2_000);
  await assert.rejects(result.reader.getLive());
  assert.deepEqual(
    reported.map((issue) => [issue.code, issue.file]),
    [['snapshot.syntax', 'snapshots/github.json']],
  );
  rewrite(file, GITHUB_SNAPSHOT, 3_000);
  assert.deepEqual((await result.reader.getLive()).unit.snapshots, first.unit.snapshots);
});

test('production reads the pair once and never again', async (t) => {
  const dir = tempDir(t, pair());
  const result = open(dir, 'production');
  assert.ok(result.ok);
  const first = await result.reader.getLive();
  rewrite(path.join(dir, 'site.yml'), 'schemaVersion: [broken\n', 2_000);
  rmSync(path.join(dir, 'portfolio.yml'));
  assert.equal(await result.reader.getLive(), first);
});

test('under next dev an edit to either document re-validates, and an invalid one throws without a path', async (t) => {
  const dir = tempDir(t);
  const portfolio = path.join(dir, 'portfolio.yml');
  const site = path.join(dir, 'site.yml');
  rewrite(portfolio, PORTFOLIO, 1_000);
  rewrite(site, SITE, 1_000);
  const reported: ConfigIssue[] = [];
  const result = open(dir, 'development', { report: (issue) => reported.push(issue) });
  assert.ok(result.ok);
  const first = await result.reader.getLive();
  assert.equal(await result.reader.getLive(), first);

  rewrite(portfolio, PORTFOLIO.replace('Rowan Test', 'Rowan Edited'), 2_000);
  const edited = await result.reader.getLive();
  assert.equal(edited.unit.portfolio.identity.name, 'Rowan Edited');
  assert.notEqual(edited.revisionId, first.revisionId);

  rewrite(site, SITE.replace('colorScheme: warm', 'colorScheme: retro'), 3_000);
  await assert.rejects(result.reader.getLive(), (error: Error) => {
    assert.ok(!error.message.includes(dir));
    return true;
  });
  assert.deepEqual(
    reported.map((issue) => [issue.severity, issue.code, issue.file, issue.path]),
    [['fatal', 'appearance.unknown', 'site.yml', '/appearance/colorScheme']],
  );
  // Still broken, but already reported.
  await assert.rejects(result.reader.getLive());
  assert.equal(reported.length, 1);

  rewrite(portfolio, PORTFOLIO, 4_000);
  rewrite(site, SITE, 4_000);
  assert.equal((await result.reader.getLive()).revisionId, first.revisionId);

  // Removing both documents falls back to the examples, with a warning.
  rmSync(portfolio);
  rmSync(site);
  const fallback = await result.reader.getLive();
  assert.equal(fallback.unit.portfolio.identity.name, BUNDLED_SAMPLE_NAMES[0]);
  assert.equal(reported.at(-1)?.code, 'source_empty');
});

test('under next dev a second format, or a portfolio.toml, is reported and throws', async (t) => {
  for (const [name, code] of [
    ['site.json', 'source.duplicate'],
    ['portfolio.toml', 'legacy.document'],
  ] as const) {
    const dir = tempDir(t, pair());
    const reported: ConfigIssue[] = [];
    const result = open(dir, 'development', { report: (issue) => reported.push(issue) });
    assert.ok(result.ok);
    await result.reader.getLive();
    mkdirSync(path.join(dir, 'nested'));
    writeFileSync(path.join(dir, name), '{}');
    await assert.rejects(result.reader.getLive());
    assert.deepEqual(
      reported.map((issue) => issue.code),
      [code],
      name,
    );
  }
});
