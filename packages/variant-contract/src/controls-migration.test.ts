import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyEdits, readSite, type DocumentFormat } from '@portfolio/schema';
import { planControlsMigration } from './controls-migration';
import type { VariantRegistry } from './registry';
import { validateManifest } from './validate-manifest';

// Migrating a site document's stored controls (#5, Slice 5, item 3): the
// plan's edits change only the entries that migrate, in the document's own
// text, and a second run has nothing to do.

function manifest(id: string, version = 2) {
  const raw = JSON.parse(
    readFileSync(new URL('./__fixtures__/manifest.json', import.meta.url), 'utf8'),
  );
  raw.id = id;
  if (version !== 2) {
    raw.controls.version = version;
    raw.controls.migrations = raw.controls.migrations.slice(0, version - 1);
  }
  const result = validateManifest(raw, { packageName: `@acme/${id.slice(5)}` });
  assert.ok(result.ok, JSON.stringify(result.diagnostics));
  return result.manifest;
}

const REGISTRY: VariantRegistry = [
  { packageName: '@acme/ocean', version: '1.0.0', manifest: manifest('acme-ocean') },
  { packageName: '@acme/reef', version: '1.0.0', manifest: manifest('acme-reef', 1) },
];

const SITE = readFileSync(
  new URL('../../schema/src/__fixtures__/pairs/engineering/yaml/site.yml', import.meta.url),
  'utf8',
);

const STORED = `# Set before Ocean 2.
variantControls:
  acme-ocean:
    version: 1
    values:
      layout: full # the old name
      columns: 9
      legacyFlag: true
      showIndex: false
  acme-reef:
    version: 1
    values:
      showIndex: true
  acme-tide:
    version: 4
    values:
      anything: 1
`;

function site(text: string, format: DocumentFormat = 'yaml') {
  const read = readSite(text, format, { name: format === 'yaml' ? 'site.yml' : 'site.json' });
  assert.ok(read.value, JSON.stringify(read.problems));
  return read.value;
}

test('a stale entry steps to the manifest version, through edits that keep the rest of the text', () => {
  const text = `${SITE}${STORED}`;
  const plan = planControlsMigration(site(text), REGISTRY);
  assert.deepEqual(
    plan.entries.map(({ variant, status, from, to }) => [variant, status, from, to]),
    [
      ['acme-ocean', 'migrated', 1, 2],
      // Reef's manifest is at version 1 still, and Tide isn't registered.
      ['acme-reef', 'current', 1, 1],
      ['acme-tide', 'unregistered', 4, 4],
    ],
  );
  assert.deepEqual(
    plan.entries[0]!.changes.map(({ op, control, before, after }) => [op, control, before, after]),
    [
      ['rename', 'layout', undefined, 'heroLayout'],
      ['mapValue', 'heroLayout', 'full', 'wide'],
      ['clamp', 'columns', 9, 4],
      ['drop', 'legacyFlag', true, undefined],
    ],
  );
  const migrated = applyEdits(text, 'yaml', plan.edits);
  assert.deepEqual(site(migrated).variantControls!['acme-ocean'], {
    version: 2,
    values: { columns: 4, heroLayout: 'wide', showIndex: false },
  });
  // Every other line is as it was, comments included.
  assert.ok(migrated.startsWith(`${SITE}# Set before Ocean 2.\n`));
  assert.match(migrated, /acme-tide:\n {4}version: 4\n/);
  // A second run has nothing to do.
  const again = planControlsMigration(site(migrated), REGISTRY);
  assert.deepEqual(again.edits, []);
  assert.deepEqual(
    again.entries.map(({ status }) => status),
    ['current', 'current', 'unregistered'],
  );
});

test('an entry from a newer release, or for a variant this build lacks, stays as it is', () => {
  const newer = STORED.replace('acme-ocean:\n    version: 1', 'acme-ocean:\n    version: 3');
  const plan = planControlsMigration(site(`${SITE}${newer}`), REGISTRY);
  assert.deepEqual(
    plan.entries.map(({ variant, status, changes }) => [variant, status, changes.length]),
    [
      ['acme-ocean', 'newer', 0],
      ['acme-reef', 'current', 0],
      ['acme-tide', 'unregistered', 0],
    ],
  );
  assert.deepEqual(plan.edits, []);
  assert.deepEqual(planControlsMigration(site(SITE), REGISTRY), { entries: [], edits: [] });
});

test('a JSON site document migrates the same way', () => {
  const data = JSON.parse(JSON.stringify(site(`${SITE}${STORED}`)));
  const text = `${JSON.stringify(data, null, 2)}\n`;
  const plan = planControlsMigration(site(text, 'json'), REGISTRY);
  const migrated = site(applyEdits(text, 'json', plan.edits), 'json');
  assert.deepEqual(migrated.variantControls!['acme-ocean'], {
    version: 2,
    values: { columns: 4, heroLayout: 'wide', showIndex: false },
  });
  assert.deepEqual(migrated.variantControls!['acme-tide'], data.variantControls['acme-tide']);
});
