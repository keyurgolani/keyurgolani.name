import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAppearanceRegistry, type MetaPack } from '@portfolio/appearance';
import { checkAppearance, NOTICES_FILE, renderNotices } from '@portfolio/appearance/node';
import { readRegistry, registryMeta, type RegistryResult } from '@portfolio/variant-contract/node';
import Ajv2020 from 'ajv/dist/2020';
import { failureRecord, readFailureRecords, SCHEMA_PATH } from '../../../ci/lib/reports.mjs';
import {
  catalogFindings,
  contrastRecords,
  hierarchyRecords,
  noticePacks,
  responsiblePack,
  writeCatalogRecords,
  type CatalogRecord,
} from './check-appearance-catalog';
import { registryOptions, renderOptions, REPO_ROOT } from './registry-options';

// #20: check:appearance's governance checks, each finding naming its pack
// and axis, and each failure a valid failure record naming the pack, axis,
// token role, display mode, and tuple where it has them.

// The failure record schema, compiled as ci/summarize.mjs compiles it.
const validate = new Ajv2020({ allErrors: true, strict: true, allowUnionTypes: true }).compile(
  JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8')),
);

async function shipped(env: Record<string, string> = {}): Promise<RegistryResult> {
  const result = await readRegistry(registryOptions(env));
  assert.ok(result.ok, JSON.stringify(result.diagnostics, null, 2));
  return result;
}

/** A copy of the repository's governance files in a scratch root, for a check to break. */
function scratch(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'portfolio-governance-'));
  for (const dir of [
    'packages/appearance-languages',
    'packages/appearance-schemes',
    'packages/appearance-typography',
    'packages/appearance-fixtures-schemes',
  ]) {
    fs.cpSync(path.join(REPO_ROOT, dir), path.join(root, dir), {
      recursive: true,
      filter: (source) => !source.includes('node_modules'),
    });
  }
  for (const file of [
    'packages/appearance/appearance-catalog.lock.json',
    'apps/web/public/third-party-notices.txt',
  ]) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.copyFileSync(path.join(REPO_ROOT, file), path.join(root, file));
  }
  return root;
}

function valid(record: CatalogRecord) {
  const full = failureRecord({ ...record, gate: 'appearance', reproCommand: 'pnpm ci:appearance' });
  assert.equal(validate(full), true, `${JSON.stringify(full)}: ${JSON.stringify(validate.errors)}`);
}

test('the repository passes every governance check', async () => {
  const findings = catalogFindings(REPO_ROOT, await shipped(), []);
  assert.deepEqual(findings.lines, []);
  assert.deepEqual(findings.counts, { gated: 3, locked: 3, research: 1 });
});

/** The registry with a third party's MIT copy of warm-parchment, as if installed from npm. */
function withInstalledMit(result: RegistryResult): RegistryResult {
  const base = result.packs.find(({ manifest }) => manifest.id === 'warm-parchment')!;
  const manifest = structuredClone(base.manifest) as typeof base.manifest & {
    tier: string;
    provenance: { license: string; copyright?: string };
  };
  Object.assign(manifest, { id: 'acme-ocean', name: 'Acme Ocean', tier: 'extended' });
  manifest.provenance.license = 'MIT';
  manifest.provenance.copyright = 'Copyright (c) 2026 Acme Packs';
  return {
    ...result,
    packs: [...result.packs, { ...base, packageName: '@acme/packs', manifest }],
  };
}

test('the committed notices are what the production registry renders', async () => {
  assert.equal(
    fs.readFileSync(path.join(REPO_ROOT, NOTICES_FILE), 'utf8'),
    renderNotices(noticePacks(await shipped())),
  );
  // A fixture a flag admits ships in no production build, so no notice covers it,
  // though fixture-font is OFL-1.1 and fixture-dark-only MIT.
  const fixtures = await shipped({ APPEARANCE_FIXTURES: '1' });
  assert.ok(fixtures.packs.some(({ manifest }) => manifest.id === 'fixture-font'));
  assert.ok(!noticePacks(fixtures).some(({ id }) => id.startsWith('fixture-')));
});

test('an installed third-party MIT pack gets its notice, with its copyright and the MIT text, and the lock never pins it', async () => {
  const root = scratch();
  try {
    const result = withInstalledMit(await shipped());
    const notices = renderNotices(noticePacks(result));
    const own = notices.slice(notices.indexOf('acme-ocean (color scheme, @acme/packs)'));
    assert.ok(notices.includes('acme-ocean (color scheme, @acme/packs)'));
    assert.match(own, /License: MIT/);
    assert.match(own, /^ {4}Copyright \(c\) 2026 Acme Packs$/m);
    assert.match(own, /^ {4}Permission is hereby granted, free of charge,/m);
    // The committed notices don't carry it, so the check names them stale.
    // Its copied stylesheet is warm-parchment's, which the pack gates refuse; only the governance lines matter here.
    const governance = (lines: readonly string[]) =>
      lines.filter((line) => !/(boundary-isolation)|(token-coverage)|(bundle-size)/.test(line));
    const stale = catalogFindings(root, result, []);
    assert.deepEqual(governance(stale.lines), [
      'apps/web/public/third-party-notices.txt is stale. Run pnpm catalog:lock and commit it.',
    ]);
    // With the notices regenerated, it passes, and the lock pins the first-party three alone.
    fs.writeFileSync(path.join(root, NOTICES_FILE), notices);
    const current = catalogFindings(root, result, []);
    assert.deepEqual(governance(current.lines), []);
    assert.equal(current.counts.locked, 3);
    assert.ok(
      !fs
        .readFileSync(path.join(root, 'packages/appearance/appearance-catalog.lock.json'), 'utf8')
        .includes('acme-ocean'),
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a pack whose content changed without a version bump fails, naming the pack and axis', async () => {
  const root = scratch();
  try {
    const file = path.join(root, 'packages/appearance-schemes/packs/warm-parchment/manifest.json');
    const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
    manifest.description = `${manifest.description} Edited.`;
    fs.writeFileSync(file, JSON.stringify(manifest, null, 2));
    const findings = catalogFindings(root, await shipped(), []);
    assert.equal(findings.lines.length, 1, findings.lines.join('\n'));
    assert.match(
      findings.lines[0]!,
      /The color scheme warm-parchment changed without a version bump/,
    );
    assert.equal(findings.records[0]!.pack, 'warm-parchment');
    assert.equal(findings.records[0]!.axis, 'colorScheme');
    findings.records.forEach(valid);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('stale notices fail, and a Research record taking a pack id fails', async () => {
  const root = scratch();
  try {
    fs.writeFileSync(path.join(root, 'apps/web/public/third-party-notices.txt'), 'edited\n');
    const research = path.join(root, 'packages/appearance-fixtures-schemes/research');
    const record = JSON.parse(
      fs.readFileSync(path.join(research, 'fixture-research.json'), 'utf8'),
    );
    fs.writeFileSync(
      path.join(research, 'warm-parchment.json'),
      JSON.stringify({ ...record, id: 'warm-parchment' }),
    );
    const findings = catalogFindings(root, await shipped(), []);
    assert.equal(findings.lines.length, 2, findings.lines.join('\n'));
    assert.match(findings.lines[0]!, /third-party-notices\.txt is stale/);
    assert.match(
      findings.lines[1]!,
      /the Research record warm-parchment, an id a color scheme pack has/,
    );
    findings.records.forEach(valid);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a pack gate failure and a first-party exclusion name the pack, the axis, and the role', async () => {
  const result = await shipped();
  const packs = result.packs.map((pack) =>
    pack.manifest.id === 'warm-parchment'
      ? { ...pack, manifest: { ...pack.manifest, budgets: { css: 10 } } as never }
      : pack,
  );
  const findings = catalogFindings(REPO_ROOT, { ...result, packs }, [
    {
      kind: 'typography',
      id: 'humanist-ui-copy',
      packageName: '@portfolio/appearance-typography',
      reason: "its license, GPL-3.0, isn't one a pack may ship under.",
    },
  ]);
  assert.deepEqual(
    findings.records.map(({ pack, axis, rule }) => [pack, axis, rule]),
    [
      ['warm-parchment', 'colorScheme', 'bundle-size'],
      ['humanist-ui-copy', 'typography', 'excluded'],
    ],
  );
  findings.records.forEach(valid);
  // A third party's exclusion is a warning, not a finding.
  const third = catalogFindings(REPO_ROOT, result, [
    {
      kind: 'typography',
      id: 'acme-type',
      packageName: '@acme/type',
      reason: 'its license, GPL-3.0.',
    },
  ]);
  assert.deepEqual(third.lines, []);
});

test('two packs on one axis with one display name fail: a derived counterpart takes its own', async () => {
  const result = await shipped();
  const scheme = result.packs.find(({ manifest }) => manifest.id === 'warm-parchment')!;
  const copy = { ...scheme, manifest: { ...scheme.manifest, id: 'warm-parchment-night' } };
  const findings = catalogFindings(REPO_ROOT, { ...result, packs: [...result.packs, copy] }, []);
  assert.ok(
    findings.lines.some((line) =>
      /warm-parchment-night is named Warm Parchment, as warm-parchment is/.test(line),
    ),
  );
});

test('a contrast failure is one record per display mode, naming the one pack it excludes', async () => {
  const result = await shipped({ QUALITY_FIXTURES: 'meta' });
  const meta = registryMeta(result, renderOptions({ QUALITY_FIXTURES: 'meta' }));
  const check = checkAppearance(
    createAppearanceRegistry({ VARIANTS: meta.VARIANTS, PACKS: meta.PACKS as readonly MetaPack[] }),
    { gateFixture: () => true },
  );
  assert.ok(check.failures.length > 0, 'the meta fixture fails the gate');
  const records = contrastRecords(check);
  assert.ok(records.length >= check.failures.length);
  for (const record of records) {
    valid(record);
    assert.equal(record.pack, 'fixture-scheme-experimental-low-contrast');
    assert.equal(record.axis, 'colorScheme');
    assert.ok(record.tokenRole && record.displayMode && record.tuple);
    assert.ok(record.tuple!.endsWith(`/${record.displayMode}`));
  }
  hierarchyRecords(check).forEach(valid);
});

test("the records it writes are ci/run.mjs's, one file each, and only under ci/run.mjs", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'portfolio-records-'));
  try {
    const record: CatalogRecord = {
      schemaVersion: '1.1',
      test: 'pack gate token-coverage',
      pack: 'warm-parchment',
      axis: 'colorScheme',
      tokenRole: 'text-muted',
      rule: 'token-coverage',
    };
    assert.deepEqual(writeCatalogRecords([record], { CI_REPORTS_DIR: dir }), []);
    const env = { CI_GATE: 'appearance', CI_REPRO: 'pnpm ci:appearance', CI_REPORTS_DIR: dir };
    assert.equal(writeCatalogRecords([record, { ...record, pack: 'humanist-ui' }], env).length, 2);
    const read = readFailureRecords(path.join(dir, 'failures'));
    assert.equal(read.length, 2);
    for (const { record: written } of read) {
      assert.equal(validate(written), true, JSON.stringify(validate.errors));
      assert.equal(written.gate, 'appearance');
      assert.equal(written.reproCommand, 'pnpm ci:appearance');
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("the responsible pack: a focus ring's width and a translucent backdrop are the language's, the rest the scheme's", () => {
  const failure = {
    language: 'lang',
    scheme: 'scheme',
    typography: 'type',
    modes: ['light' as const],
    pair: {
      set: 'light' as const,
      kind: 'text' as const,
      foreground: 'text-muted',
      ground: 'canvas',
      ratio: 3,
      target: 4.5,
      passes: false,
    },
  };
  assert.deepEqual(responsiblePack(failure), { axis: 'colorScheme', id: 'scheme' });
  assert.deepEqual(
    responsiblePack({ ...failure, pair: { ...failure.pair, kind: 'focus-width' } }),
    {
      axis: 'designLanguage',
      id: 'lang',
    },
  );
  assert.deepEqual(responsiblePack({ ...failure, pair: { ...failure.pair, backdrop: 'accent' } }), {
    axis: 'designLanguage',
    id: 'lang',
  });
});
