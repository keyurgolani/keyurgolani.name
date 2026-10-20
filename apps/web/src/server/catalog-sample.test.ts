import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { acmePortfolioPhotography } from '../../../../packages/schema/src/__fixtures__/acme-portfolio-photography';
import { BUNDLED_SAMPLE_NAMES } from './catalog-documents';
import { openSampleCatalog } from './catalog-sample';

// The sample adapter for `demo` (#1, item 16): the bundled example, read
// once and frozen, without the sections that fetch live data.

const EXAMPLE = fileURLToPath(new URL('../../../../portfolio.example.yml', import.meta.url));
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
  '',
].join('\n')}`;

function scratch(t: TestContext): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'catalog-sample-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('it serves the bundled sample, frozen', async () => {
  const opened = openSampleCatalog({ examplePath: EXAMPLE });
  assert.ok(opened.ok, JSON.stringify(opened.issues));
  assert.deepEqual(opened.issues, []);
  const live = await opened.reader.getLive();
  assert.ok(BUNDLED_SAMPLE_NAMES.includes(live.unit.portfolio.identity.name));
  assert.match(live.revisionId, /^sample-[0-9a-f]{12}$/);
  assert.ok(Object.isFrozen(live));
  assert.ok(Object.isFrozen(live.unit.portfolio.identity));
  assert.equal(await opened.reader.getLive(), live);
});

test('it drops the github sections, which fetch a live account, and keeps the rest', async () => {
  const written = (parseYaml(readFileSync(EXAMPLE, 'utf8')) as { sections: { kind: string }[] })
    .sections;
  assert.ok(
    written.some(({ kind }) => kind === 'github'),
    'the sample has a github section to drop',
  );
  const opened = openSampleCatalog({ examplePath: EXAMPLE });
  assert.ok(opened.ok);
  const { sections } = (await opened.reader.getLive()).unit.portfolio;
  assert.deepEqual(
    sections.map(({ kind }) => kind),
    written.map(({ kind }) => kind).filter((kind) => kind !== 'github'),
  );
});

test('extension data the build does not register loads as written, with a warning', async (t) => {
  const file = path.join(scratch(t), 'portfolio.example.yml');
  writeFileSync(file, WITH_EXTENSIONS);
  const opened = openSampleCatalog({ examplePath: file });
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
        'extension_unregistered',
        'portfolio.example.yml',
        '/identity/extensions/@acme~1portfolio-photography',
        7,
        5,
      ],
      [
        'warning',
        'PORTFOLIO_PROFILE',
        'extension_unregistered',
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
  const file = path.join(scratch(t), 'portfolio.example.yml');
  writeFileSync(file, WITH_EXTENSIONS);
  const valid = openSampleCatalog({ examplePath: file, extensions: [acmePortfolioPhotography] });
  assert.ok(valid.ok);
  assert.deepEqual(valid.issues, []);
  writeFileSync(file, WITH_EXTENSIONS.replace('year: 2024', 'year: soon'));
  const invalid = openSampleCatalog({ examplePath: file, extensions: [acmePortfolioPhotography] });
  assert.deepEqual(
    invalid.issues.map((issue) => `${issue.key}:${issue.code}`),
    ['PORTFOLIO_PROFILE:sample_invalid'],
  );
});

test('a build without its sample refuses to start demo', (t) => {
  const opened = openSampleCatalog({ examplePath: path.join(scratch(t), 'portfolio.example.yml') });
  assert.equal(opened.ok, false);
  assert.deepEqual(
    opened.issues.map((issue) => `${issue.severity} ${issue.key}:${issue.code} ${issue.file}`),
    ['fatal PORTFOLIO_PROFILE:sample_missing portfolio.example.yml'],
  );
});

test('a sample that fails the schema refuses to start demo, without quoting it', (t) => {
  const file = path.join(scratch(t), 'portfolio.example.yml');
  writeFileSync(file, 'schemaVersion: 2\nidentity:\n  name: canary-name\n  canary-field: x\n');
  const opened = openSampleCatalog({ examplePath: file });
  assert.equal(opened.ok, false);
  assert.deepEqual(
    opened.issues.map((issue) => `${issue.key}:${issue.code}`),
    ['PORTFOLIO_PROFILE:sample_invalid'],
  );
  assert.ok(!JSON.stringify(opened.issues).includes('canary'));
});
