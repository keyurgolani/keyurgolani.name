import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAppearanceRegistry, type MetaPack } from '@portfolio/appearance';
import {
  checkAppearance,
  lockedPacks,
  NOTICES_FILE,
  renderNotices,
} from '@portfolio/appearance/node';
import { readRegistry, registryMeta, type RegistryResult } from '@portfolio/variant-contract/node';
import Ajv2020 from 'ajv/dist/2020';
import { failureRecord, readFailureRecords, SCHEMA_PATH } from '../../../ci/lib/reports.mjs';
import {
  baseLock,
  baseLockNote,
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
  // Every first-party pack, gated and locked; the 23 catalog records and the fixture one; and the audit over the first-party packs and the catalog's records.
  const shipping = ['appearance-languages', 'appearance-schemes', 'appearance-typography'].reduce(
    (count, dir) => count + fs.readdirSync(path.join(REPO_ROOT, 'packages', dir, 'packs')).length,
    0,
  );
  assert.deepEqual(findings.counts, {
    gated: shipping,
    locked: shipping,
    research: 24,
    // The held languages too (#20, PR 2b).
    audited:
      shipping +
      23 +
      fs.readdirSync(path.join(REPO_ROOT, 'packages/appearance-languages/held')).length,
  });
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
    // With the notices regenerated, it passes, and the lock pins the first-party packs alone.
    fs.writeFileSync(path.join(root, NOTICES_FILE), notices);
    const current = catalogFindings(root, result, []);
    assert.deepEqual(governance(current.lines), []);
    const firstParty = [
      'appearance-languages',
      'appearance-schemes',
      'appearance-typography',
    ].reduce(
      (count, dir) => count + fs.readdirSync(path.join(REPO_ROOT, 'packages', dir, 'packs')).length,
      0,
    );
    assert.equal(current.counts.locked, firstParty);
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

test("a pack changed with its lock edited to match fails against the base's lock, naming the pack and axis (#20)", async () => {
  const root = scratch();
  try {
    const lockFile = path.join(root, 'packages/appearance/appearance-catalog.lock.json');
    const base = { ref: 'HEAD^1', text: fs.readFileSync(lockFile, 'utf8') };
    const file = path.join(root, 'packages/appearance-schemes/packs/warm-parchment/manifest.json');
    const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
    manifest.description = `${manifest.description} Edited.`;
    fs.writeFileSync(file, JSON.stringify(manifest, null, 2));
    // The committed lock is edited to the new digest, so it alone looks current.
    const lock = JSON.parse(base.text);
    lock.packs['warm-parchment'].digest = lockedPacks(root).find(
      ({ id }) => id === 'warm-parchment',
    )!.digest;
    fs.writeFileSync(lockFile, `${JSON.stringify(lock, null, 2)}\n`);
    assert.deepEqual(catalogFindings(root, await shipped(), []).lines, []);
    const findings = catalogFindings(root, await shipped(), [], base);
    assert.equal(findings.lines.length, 1, findings.lines.join('\n'));
    assert.match(findings.lines[0]!, /warm-parchment changed since HEAD\^1 without a version bump/);
    assert.equal(findings.records[0]!.pack, 'warm-parchment');
    assert.equal(findings.records[0]!.axis, 'colorScheme');
    findings.records.forEach(valid);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('CATALOG_LOCK_BASE names the base lock by a git ref, none at a base without one, and a ref git cannot read fails', () => {
  assert.equal(baseLock({}), null);
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'portfolio-lock-base-'));
  const git = (...args: string[]) =>
    execFileSync(
      'git',
      ['-c', 'user.name=Lock Test', '-c', 'user.email=lock@example.test', ...args],
      {
        cwd: repo,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
  try {
    git('init', '-q', '-b', 'base');
    fs.writeFileSync(path.join(repo, 'README'), 'x\n');
    git('add', '-A');
    git('commit', '-q', '-m', 'no lock yet');
    assert.deepEqual(baseLock({ CATALOG_LOCK_BASE: 'HEAD' }, repo), { ref: 'HEAD', text: null });
    // A base with no lock says so, rather than passing silently.
    assert.equal(
      baseLockNote(baseLock({ CATALOG_LOCK_BASE: 'HEAD' }, repo)),
      'HEAD has no catalog lock: the lock is held to the packs alone.',
    );
    assert.equal(baseLockNote(null), null);
    const lockFile = path.join(repo, 'packages/appearance/appearance-catalog.lock.json');
    fs.mkdirSync(path.dirname(lockFile), { recursive: true });
    fs.writeFileSync(lockFile, '{"lockVersion":1,"packs":{}}\n');
    git('add', '-A');
    git('commit', '-q', '-m', 'lock');
    fs.writeFileSync(lockFile, '{"edited":true}\n');
    git('commit', '-q', '-am', 'edit');
    assert.deepEqual(baseLock({ CATALOG_LOCK_BASE: 'HEAD^1' }, repo), {
      ref: 'HEAD^1',
      text: '{"lockVersion":1,"packs":{}}\n',
    });
    assert.equal(baseLockNote(baseLock({ CATALOG_LOCK_BASE: 'HEAD^1' }, repo)), null);
    assert.throws(
      () => baseLock({ CATALOG_LOCK_BASE: 'refs/heads/no-such-base' }, repo),
      /CATALOG_LOCK_BASE is refs\/heads\/no-such-base, and git can't read it/,
    );
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
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

test('a contrast failure is one record per pack, rule, role pair, and display mode, naming the one pack it excludes', async () => {
  const result = await shipped({ QUALITY_FIXTURES: 'meta' });
  const meta = registryMeta(result, renderOptions({ QUALITY_FIXTURES: 'meta' }));
  const packs = meta.PACKS as readonly MetaPack[];
  const run = (extra: readonly MetaPack[]) =>
    checkAppearance(
      createAppearanceRegistry({ VARIANTS: meta.VARIANTS, PACKS: [...packs, ...extra] }),
      { gateFixture: () => true },
    );
  const check = run([]);
  assert.ok(check.failures.length > 0, 'the meta fixture fails the gate');
  const records = contrastRecords(check);
  for (const record of records) {
    valid(record);
    assert.equal(record.pack, 'fixture-scheme-experimental-low-contrast');
    assert.equal(record.axis, 'colorScheme');
    assert.ok(record.tokenRole && record.displayMode && record.tuple);
    assert.ok(record.tuple!.endsWith(`/${record.displayMode}`));
    // Its tuple count and its first tuple, in the test it names.
    assert.match(
      record.test,
      / in \d+ tuples?, first [a-z0-9-]+\/fixture-scheme-experimental-low-contrast\//,
    );
  }
  // One record per pack, rule, role pair, set, and mode: no two the same.
  const keys = records.map((r) => `${r.pack} ${r.rule} ${r.test.split(',')[0]} ${r.displayMode}`);
  assert.equal(new Set(keys).size, keys.length);
  // Twelve more languages that pass multiply the failing tuples, and leave the records as they are.
  const language = packs.find((pack) => pack.kind === 'design-language' && !pack.fixture)!;
  const more = Array.from({ length: 12 }, (_, index) => ({
    ...language,
    manifest: { ...language.manifest, id: `copy-language-${index + 1}`, name: `Copy ${index + 1}` },
  })) as MetaPack[];
  const wider = run(more);
  assert.ok(wider.failures.length > check.failures.length, 'the failing tuples grow');
  const grown = contrastRecords(wider);
  assert.equal(grown.length, records.length);
  assert.deepEqual(
    grown.map(({ test, ...rest }) => ({ ...rest, test: test.replace(/ in \d+ tuples/, '') })),
    records.map(({ test, ...rest }) => ({ ...rest, test: test.replace(/ in \d+ tuples/, '') })),
  );
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
  // A backdrop failure whose pair fails opaque too is the scheme's: no floor fixes it (#20 PR 2c).
  const backdrop = {
    ...failure,
    pair: { ...failure.pair, ground: 'surface-default', backdrop: '#000000' },
  };
  const opaque = {
    ...backdrop,
    language: 'solid',
    pair: { ...failure.pair, ground: 'surface-default' },
  };
  const check = { failures: [backdrop, opaque] } as unknown as Parameters<
    typeof contrastRecords
  >[0];
  assert.deepEqual(
    contrastRecords(check).map(({ pack, axis }) => `${axis}:${pack}`),
    ['colorScheme:scheme', 'colorScheme:scheme'],
  );
  assert.deepEqual(
    contrastRecords({ failures: [backdrop] } as unknown as Parameters<
      typeof contrastRecords
    >[0]).map(({ pack, axis }) => `${axis}:${pack}`),
    ['designLanguage:lang'],
  );
  // Only the same scheme's same pair, in the same set on the same ground, failing opaque moves the blame.
  for (const [what, other] of [
    ['another scheme', { ...opaque, scheme: 'other-scheme' }],
    ['another set', { ...opaque, pair: { ...opaque.pair, set: 'dark' as const } }],
    ['another ground', { ...opaque, pair: { ...opaque.pair, ground: 'surface-subtle' } }],
  ] as const) {
    const records = contrastRecords({ failures: [backdrop, other] } as unknown as Parameters<
      typeof contrastRecords
    >[0]);
    assert.equal(
      records.find(
        ({ tokenRole, tuple }) => tokenRole === 'text-muted' && (tuple ?? '').startsWith('lang/'),
      )?.pack,
      'lang',
      `an opaque failure on ${what} leaves the backdrop failure with the language`,
    );
  }
});
