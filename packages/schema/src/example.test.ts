import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsePortfolio } from './load';
import { migrate } from './migrate';
import { readPair, readUnitFiles } from './node';
import { detectFormat, parseSource } from './source';
import { resolvePortfolioView } from './view';

// The bundled example is what a fresh clone renders, and the harness fixtures
// are what the browser tests render. Both must stay valid documents.
const repoFile = (relative: string) =>
  fileURLToPath(new URL(`../../../${relative}`, import.meta.url));

function read(relative: string) {
  const path = repoFile(relative);
  const result = parsePortfolio(readFileSync(path, 'utf8'), detectFormat(path));
  assert.equal(result.ok, true, result.ok ? '' : JSON.stringify(result.problems, null, 2));
  if (!result.ok) throw new Error(`${relative} is invalid`);
  return result.value;
}

for (const relative of [
  'portfolio.example.yml',
  'tests/fixtures/portfolio.yml',
  'tests/fixtures/portfolio-markup.yml',
  'tests/fixtures/hidden/portfolio.yml',
  'tests/fixtures/motion/portfolio.yml',
  'tests/fixtures/extensions/portfolio.yml',
]) {
  test(`${relative} is a valid version 3 portfolio document`, () => {
    const portfolio = read(relative);
    assert.equal(portfolio.schemaVersion, 3);
    assert.ok(portfolio.identity.name.length > 0);
    assert.ok((portfolio.sections ?? []).length > 0);
  });
}

test('the baseline example, migrated, keeps the anchors the baseline rendered for it', () => {
  const baseline = JSON.parse(
    readFileSync(repoFile('tests/fixtures/baseline/example-home.json'), 'utf8'),
  ) as { sectionIds: string[] };
  const old = readFileSync(repoFile('packages/schema/src/__fixtures__/legacy/example.yml'), 'utf8');
  const migration = migrate(
    { text: old, format: 'yaml' },
    {
      set: [
        { path: 'site.appearance.colorScheme', value: 'warm' },
        { path: 'site.appearance.typography', value: 'classic' },
      ],
    },
  );
  assert.ok(migration.status === 'ready' || migration.status === 'blocked');
  if (migration.status !== 'ready' && migration.status !== 'blocked') return;
  const parsed = parseSource(migration.portfolio.text, 'yaml');
  assert.ok(parsed.ok);
  const sections = (parsed.data as { sections: Array<{ id: string }> }).sections;
  assert.deepEqual(
    sections.map(({ id }) => id),
    baseline.sectionIds,
  );
});

test('the example leads with its curation: a thesis, a signature with a case study, featured works, a proof strip, and an archive', () => {
  const portfolio = read('portfolio.example.yml');
  assert.ok(portfolio.practice?.thesis);
  const signature = portfolio.works?.find(({ id }) => id === portfolio.signature);
  assert.ok(signature?.caseStudy && signature.slug);
  assert.ok((portfolio.featured ?? []).length >= 2);
  assert.ok((portfolio.proof ?? []).length >= 3);
  assert.ok((portfolio.archive ?? []).length >= 1);
  assert.equal(portfolio.sections?.[1]?.kind, 'practice');
});

test('the example pairs with its site document and snapshot, with no blocking diagnostic', () => {
  const result = readPair({
    portfolio: repoFile('portfolio.example.yml'),
    site: repoFile('site.example.yml'),
  });
  assert.ok(result.ok, JSON.stringify(result.diagnostics, null, 2));
  if (!result.ok) return;
  assert.deepEqual(
    result.diagnostics.filter(({ severity }) => severity !== 'warning'),
    [],
  );
  const unit = readUnitFiles(repoFile('.'));
  assert.deepEqual(unit.diagnostics, []);
  const view = resolvePortfolioView(result.pair, unit, { mediaBase: '/media' });
  const github = view.derived['on-github'];
  assert.equal(github?.state, 'ready');
  if (github?.state === 'ready') {
    assert.equal(github.value.username, 'anamika');
    assert.equal(github.derivedAt, '2026-10-17T09:00:00Z');
  }
  // No media document is bundled yet, so each image waits for slice 2's ingestion.
  for (const asset of Object.values(view.media)) assert.equal(asset.derived.state, 'unavailable');
});

test('every example image is bundled, self-made, small, and recorded in provenance.json', () => {
  const portfolio = read('portfolio.example.yml');
  const root = repoFile('example-media');
  const provenance = JSON.parse(readFileSync(path.join(root, 'provenance.json'), 'utf8')) as {
    license: string;
    images: Array<{ file: string; bytes: number }>;
  };
  assert.equal(provenance.license, 'MIT');
  const recorded = new Set(provenance.images.map(({ file }) => file));
  let total = 0;
  for (const asset of portfolio.media ?? []) {
    assert.ok(!/^https?:/i.test(asset.source), `${asset.id} is bundled`);
    assert.ok(recorded.has(asset.source), `${asset.source} is in provenance.json`);
    const { size } = statSync(path.join(root, asset.source));
    assert.ok(size <= 150 * 1024, `${asset.source} is at most 150 KB`);
    total += size;
  }
  assert.ok(total <= 3 * 1024 * 1024);
  const pngs = readdirSync(root, { recursive: true }).filter((name) =>
    String(name).endsWith('.png'),
  );
  assert.equal(pngs.length, provenance.images.length);
  assert.doesNotMatch(readFileSync(repoFile('portfolio.example.yml'), 'utf8'), /picsum/);
});

test("the example's images are the ones generate.mjs draws", () => {
  // --check redraws every image and compares its pixels with provenance.json.
  execFileSync(process.execPath, [repoFile('example-media/generate.mjs'), '--check'], {
    stdio: 'pipe',
  });
});
