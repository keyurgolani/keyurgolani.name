import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import type { AppearanceCatalog } from '@portfolio/schema';
import { acmePortfolioPhotography } from '../../../../packages/schema/src/__fixtures__/acme-portfolio-photography';
import { BUNDLED_SAMPLE_NAMES } from './catalog-documents';
import { openSampleCatalog } from './catalog-sample';

// The sample adapter for `demo` (#1, item 16): the bundled pair, read once,
// checked as a pair, and frozen, without the sections that fetch live data.

const EXAMPLES = {
  portfolio: fileURLToPath(new URL('../../../../portfolio.example.yml', import.meta.url)),
  site: fileURLToPath(new URL('../../../../site.example.yml', import.meta.url)),
};
const HEAD = 'schemaVersion: 2\nlocale: en\ndirection: ltr\n';
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

/** Editorial only, as a build that registers one variant would say. */
const EDITORIAL_ONLY: AppearanceCatalog = {
  ids: (axis) => (axis === 'variant' ? ['editorial'] : null),
  generatorInput: () => undefined,
};

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
  const opened = openSampleCatalog({ examples: EXAMPLES, catalog: EDITORIAL_ONLY });
  assert.ok(opened.ok, JSON.stringify(opened.issues));
  assert.deepEqual(opened.issues, []);
  const live = await opened.reader.getLive();
  assert.ok(BUNDLED_SAMPLE_NAMES.includes(live.unit.portfolio.identity.name));
  assert.equal(live.unit.site.appearance.variant, 'editorial');
  assert.match(live.revisionId, /^sample-[0-9a-f]{12}$/);
  assert.ok(Object.isFrozen(live));
  assert.ok(Object.isFrozen(live.unit.portfolio.identity));
  assert.ok(Object.isFrozen(live.unit.site.appearance));
  assert.equal(await opened.reader.getLive(), live);
});

test('it drops the github sections, which fetch a live account, and keeps the rest', async () => {
  const written = (
    parseYaml(readFileSync(EXAMPLES.portfolio, 'utf8')) as { sections: { kind: string }[] }
  ).sections;
  assert.ok(
    written.some(({ kind }) => kind === 'github'),
    'the sample has a github section to drop',
  );
  const opened = openSampleCatalog({ examples: EXAMPLES });
  assert.ok(opened.ok);
  const { sections } = (await opened.reader.getLive()).unit.portfolio;
  assert.deepEqual(
    sections.map(({ kind }) => kind),
    written.map(({ kind }) => kind).filter((kind) => kind !== 'github'),
  );
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

test('a sample that fails the schema, or a site the build cannot render, refuses demo', (t) => {
  const broken = openSampleCatalog({
    examples: withPortfolio(
      t,
      'schemaVersion: 2\nidentity:\n  name: canary-name\n  canary-field: x\n',
    ),
  });
  assert.equal(broken.ok, false);
  assert.deepEqual(
    broken.issues.map((issue) => `${issue.key}:${issue.code}`),
    ['PORTFOLIO_PROFILE:sample_invalid'],
  );
  assert.ok(!JSON.stringify(broken.issues).includes('canary'));
  // A build that doesn't register the example's variant can't serve it either.
  const unregistered = openSampleCatalog({
    examples: EXAMPLES,
    catalog: {
      ids: (axis) => (axis === 'variant' ? ['kinetic-cosmos'] : null),
      generatorInput: () => undefined,
    },
  });
  assert.deepEqual(
    unregistered.issues.map((issue) => `${issue.code} ${issue.file}`),
    ['sample_invalid site.example.yml'],
  );
});
