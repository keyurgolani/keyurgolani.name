import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { contractValidators } from '@portfolio/variant-contract';
import { acmePortfolioPhotography } from '../../../../packages/schema/src/__fixtures__/acme-portfolio-photography';
import { REGISTRY } from '~/lib/variants';
import { appearanceCatalog } from '../lib/appearance-checks';
import { APPEARANCE_REGISTRY } from '../lib/appearance-registry';
import { bundledSample } from '../lib/sample-identity';
import { openSampleCatalog } from './catalog-sample';

// The sample adapter for `demo` (#1, item 16): the bundled pair, read once,
// checked as a pair, and frozen, with the snapshots bundled beside it (#10),
// which its github section renders instead of fetching.

const EXAMPLES = {
  portfolio: fileURLToPath(new URL('../../../../portfolio.example.yml', import.meta.url)),
  site: fileURLToPath(new URL('../../../../site.example.yml', import.meta.url)),
};
const HEAD = 'schemaVersion: 3\nlocale: en\ndirection: ltr\n';
const WITH_EXTENSIONS = `${HEAD}${[
  'identity:',
  '  name: Anamika Devi',
  '  extensions:',
  "    '@acme/portfolio-photography': { camera: canary-camera-5 }",
  'sections:',
  "  - kind: '@acme/portfolio-photography/exhibitions'",
  '    id: exhibitions',
  '    data:',
  '      items: [{ title: canary-show-5, venue: V, year: 2024 }]',
  '  - kind: lede',
  '    id: about',
  '    body: Hi.',
  '',
].join('\n')}`;

/** The host's appearance catalog, which leaves every axis to the appearance check. */
const HOST = appearanceCatalog(APPEARANCE_REGISTRY);
/** The contract's checks, live, as startup runs them on the sample. */
const LIVE = contractValidators(REGISTRY, { live: true });

function scratch(t: TestContext): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'catalog-sample-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** A sample portfolio in a scratch directory, beside the bundled site example. */
function withPortfolio(t: TestContext, text: string) {
  const file = path.join(scratch(t), 'portfolio.example.yml');
  writeFileSync(file, text);
  return { portfolio: file, site: EXAMPLES.site };
}

test('it serves the bundled pair, frozen', async () => {
  const opened = openSampleCatalog({ examples: EXAMPLES, catalog: HOST });
  assert.ok(opened.ok, JSON.stringify(opened.issues));
  assert.deepEqual(opened.issues, []);
  const live = await opened.reader.getLive();
  assert.equal(
    live.unit!.portfolio.identity.name,
    bundledSample(readFileSync(EXAMPLES.portfolio, 'utf8'), 'portfolio.example.yml')?.name,
  );
  assert.equal(live.unit!.site.appearance.variant, 'editorial-evidence');
  assert.match(live.revisionId ?? '', /^sample-[0-9a-f]{12}$/);
  // The port's shape (#3): always live, with its unit's hash.
  assert.equal(live.state, 'live');
  assert.match(live.unitHash ?? '', /^sha256:[0-9a-f]{64}$/);
  assert.ok(Object.isFrozen(live));
  assert.ok(Object.isFrozen(live.unit!.portfolio.identity));
  assert.ok(Object.isFrozen(live.unit!.site.appearance));
  assert.equal(await opened.reader.getLive(), live);
});

test('it keeps every section, and hands on the snapshots bundled beside the examples, frozen', async () => {
  const written = (
    parseYaml(readFileSync(EXAMPLES.portfolio, 'utf8')) as { sections: { kind: string }[] }
  ).sections;
  assert.ok(
    written.some(({ kind }) => kind === 'github'),
    'the sample has a github section, which renders its snapshot',
  );
  const opened = openSampleCatalog({ examples: EXAMPLES });
  assert.ok(opened.ok, JSON.stringify(opened.issues));
  const unit = (await opened.reader.getLive()).unit!;
  assert.deepEqual(
    (unit.portfolio.sections ?? []).map(({ kind }) => kind),
    written.map(({ kind }) => kind),
  );
  assert.ok(Object.hasOwn(unit.snapshots, 'github'), 'the bundled github snapshot');
  assert.ok(Object.isFrozen(unit.snapshots));
  assert.equal(unit.media, undefined);
});

test('a bundled snapshot or media document that does not read refuses demo, naming its file', (t) => {
  for (const [file, text] of [
    ['snapshots/github.json', '{ "records": [canary-snapshot] }'],
    ['media/media.json', '{ "assets": [canary-media'],
    ['media/media.json', '{ "assets": "canary-media" }'],
  ] as const) {
    const dir = scratch(t);
    const portfolio = path.join(dir, 'portfolio.example.yml');
    writeFileSync(portfolio, readFileSync(EXAMPLES.portfolio, 'utf8'));
    mkdirSync(path.join(dir, path.dirname(file)));
    writeFileSync(path.join(dir, file), text);
    const opened = openSampleCatalog({ examples: { portfolio, site: EXAMPLES.site } });
    assert.equal(opened.ok, false, file);
    assert.deepEqual(
      opened.issues.map((issue) => `${issue.severity} ${issue.key}:${issue.code} ${issue.file}`),
      [`fatal PORTFOLIO_PROFILE:sample_invalid ${file}`],
    );
    // The message names the file that doesn't read, whichever it is.
    assert.deepEqual(
      opened.issues.map(({ message }) => message),
      [`The bundled sample's ${file} doesn't read, so this build is broken.`],
    );
    assert.ok(!JSON.stringify(opened.issues).includes('canary'), file);
  }
});

test('extension data the build does not register loads as written, with a warning', async (t) => {
  const opened = openSampleCatalog({ examples: withPortfolio(t, WITH_EXTENSIONS) });
  assert.ok(opened.ok, JSON.stringify(opened.issues));
  assert.deepEqual(
    opened.issues.map((issue) => [
      issue.severity,
      issue.key,
      issue.code,
      issue.file,
      issue.path,
      issue.line,
      issue.column,
    ]),
    [
      [
        'warning',
        'PORTFOLIO_PROFILE',
        'extension.unregistered',
        'portfolio.example.yml',
        '/identity/extensions/@acme~1portfolio-photography',
        7,
        5,
      ],
      [
        'warning',
        'PORTFOLIO_PROFILE',
        'extension.unregistered',
        'portfolio.example.yml',
        '/sections/0',
        9,
        5,
      ],
    ],
  );
  assert.ok(!JSON.stringify(opened.issues).includes('canary'));
});

test('a registered extension checks the sample, as it checks a document', (t) => {
  const examples = withPortfolio(t, WITH_EXTENSIONS);
  const valid = openSampleCatalog({ examples, extensions: [acmePortfolioPhotography] });
  assert.ok(valid.ok);
  assert.deepEqual(valid.issues, []);
  writeFileSync(examples.portfolio, WITH_EXTENSIONS.replace('year: 2024', 'year: soon'));
  const invalid = openSampleCatalog({ examples, extensions: [acmePortfolioPhotography] });
  assert.deepEqual(
    invalid.issues.map((issue) => `${issue.key}:${issue.code} ${issue.file}`),
    ['PORTFOLIO_PROFILE:sample_invalid portfolio.example.yml'],
  );
});

test('a build without either example refuses to start demo', (t) => {
  const dir = scratch(t);
  for (const [examples, file] of [
    [{ ...EXAMPLES, portfolio: path.join(dir, 'portfolio.example.yml') }, 'portfolio.example.yml'],
    [{ ...EXAMPLES, site: path.join(dir, 'site.example.yml') }, 'site.example.yml'],
  ] as const) {
    const opened = openSampleCatalog({ examples });
    assert.equal(opened.ok, false);
    assert.deepEqual(
      opened.issues.map((issue) => `${issue.severity} ${issue.key}:${issue.code} ${issue.file}`),
      [`fatal PORTFOLIO_PROFILE:sample_missing ${file}`],
    );
  }
});

test('a build whose example the server cannot read refuses to start demo', (t) => {
  // A directory where the file belongs lists like the file and can't be read.
  const dir = scratch(t);
  const opened = openSampleCatalog({ examples: { ...EXAMPLES, site: dir } });
  assert.equal(opened.ok, false);
  assert.deepEqual(
    opened.issues.map((issue) => `${issue.severity} ${issue.key}:${issue.code} ${issue.file}`),
    [`fatal PORTFOLIO_PROFILE:sample_unreadable ${path.basename(dir)}`],
  );
  assert.match(opened.issues[0]!.message, /can't read it/);
});

test('a sample that fails the schema, or a site the build cannot render, refuses demo', (t) => {
  const broken = openSampleCatalog({
    examples: withPortfolio(
      t,
      'schemaVersion: 3\nidentity:\n  name: canary-name\n  canary-field: x\n',
    ),
  });
  assert.equal(broken.ok, false);
  assert.deepEqual(
    broken.issues.map((issue) => `${issue.key}:${issue.code}`),
    ['PORTFOLIO_PROFILE:sample_invalid'],
  );
  assert.ok(!JSON.stringify(broken.issues).includes('canary'));
  // This build registers the example's variant, Editorial Evidence (#13),
  // so the sample serves with no finding.
  const registered = openSampleCatalog({ examples: EXAMPLES, catalog: HOST, validators: LIVE });
  assert.ok(registered.ok);
  assert.deepEqual(registered.issues, []);
  // A site whose variant the build doesn't register serves in the fallback
  // composition, with the warning startup logs.
  const site = path.join(scratch(t), 'site.example.yml');
  writeFileSync(
    site,
    readFileSync(EXAMPLES.site, 'utf8').replace(
      'variant: editorial-evidence',
      'variant: missing-variant',
    ),
  );
  const unregistered = openSampleCatalog({
    examples: { ...EXAMPLES, site },
    catalog: HOST,
    validators: LIVE,
  });
  assert.ok(unregistered.ok);
  assert.deepEqual(
    unregistered.issues.map((issue) => `${issue.severity} ${issue.code} ${issue.file}`),
    ['warning variant.unavailable site.example.yml'],
  );
});
