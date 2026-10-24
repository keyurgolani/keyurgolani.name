import test from 'node:test';
import assert from 'node:assert/strict';
import { ALLOWED_LICENSES, ResearchRecordSchema } from './manifests';
import { isUpstreamLicense, licenseExclusion } from './governance';
import {
  DARK_ONLY,
  HUMANIST_UI,
  LIGHT_ONLY,
  PLATFORM_NEUTRAL,
  SEED,
  WARM_PARCHMENT,
} from './test-support/packs';
import { validatePackManifest, type PackManifest } from './validate-pack';
import type { PackKind } from './axes';

// #20's manifest fields and tier policy: every rule has a manifest here
// that breaks it alone, and each record names the pack, its axis, and the
// field.

const FIRST_PARTY = '@portfolio/x';
const clone = <T>(value: T): T => structuredClone(value);

function records(input: unknown, kind: PackKind, packageName = FIRST_PARTY) {
  const result = validatePackManifest(input, { kind, packageName });
  return result.diagnostics.map(({ code, pointer }) => [code, pointer]);
}

const withLicense = <M extends PackManifest>(manifest: M, license: string): M => ({
  ...clone(manifest),
  provenance: { ...manifest.provenance, license },
});

test('the three fallback packs carry every governance field', () => {
  for (const [kind, manifest] of [
    ['design-language', PLATFORM_NEUTRAL],
    ['color-scheme', WARM_PARCHMENT],
    ['typography', HUMANIST_UI],
  ] as const) {
    assert.deepEqual(records(clone(manifest), kind), [], manifest.id);
    assert.equal(manifest.version, '1.0.0');
    assert.equal(manifest.tier, 'stable');
    assert.ok(manifest.provenance.source.url.startsWith('https://'));
    assert.ok(manifest.provenance.attribution);
    assert.deepEqual(manifest.modes, ['light', 'dark']);
    assert.ok(manifest.fallbacks.length > 0);
  }
  // The approved profiles are OS system stacks with no font files.
  assert.equal(HUMANIST_UI.provenance.license, 'provided-by-operating-system');
  assert.deepEqual(HUMANIST_UI.cost, { assets: 0, assetBytes: 0 });
});

test('every governance field is required, and a record names the pack, the axis, and the field', () => {
  for (const field of [
    'version',
    'modes',
    'accessibility',
    'cost',
    'budgets',
    'fallbacks',
    'caveats',
  ] as const) {
    const manifest: Record<string, unknown> = clone(WARM_PARCHMENT);
    delete manifest[field];
    const result = validatePackManifest(manifest, {
      kind: 'color-scheme',
      packageName: FIRST_PARTY,
    });
    assert.equal(result.ok, false, field);
    assert.deepEqual(
      result.diagnostics.map(({ code, pointer }) => [code, pointer]),
      [['manifest.missing', `/${field}`]],
      field,
    );
    assert.match(
      result.diagnostics[0]!.message,
      new RegExp(`^The color scheme warm-parchment in @portfolio/x: /${field} is required`),
    );
  }
  for (const field of ['url'] as const) {
    const manifest = clone(WARM_PARCHMENT) as unknown as {
      provenance: { source: Record<string, unknown> };
    };
    delete manifest.provenance.source[field];
    assert.deepEqual(records(manifest, 'color-scheme'), [
      ['manifest.missing', `/provenance/source/${field}`],
    ]);
  }
  const noAttribution = clone(WARM_PARCHMENT) as unknown as { provenance: Record<string, unknown> };
  delete noAttribution.provenance.attribution;
  assert.deepEqual(records(noAttribution, 'color-scheme'), [
    ['manifest.missing', '/provenance/attribution'],
  ]);
});

test('the schema is strict: an unknown key fails, where it is, with the pack and the axis named', () => {
  const result = validatePackManifest(
    { ...clone(HUMANIST_UI), popularity: 99, provenance: { ...HUMANIST_UI.provenance, stars: 5 } },
    { kind: 'typography', packageName: FIRST_PARTY },
  );
  assert.deepEqual(
    result.diagnostics.map(({ code, pointer }) => [code, pointer]),
    [
      ['manifest.unknown-key', '/provenance/stars'],
      ['manifest.unknown-key', '/popularity'],
    ],
  );
  for (const { message } of result.diagnostics) {
    assert.match(message, /^The typography profile humanist-ui in @portfolio\/x: \//);
  }
});

test("a version is semver's major.minor.patch", () => {
  for (const version of ['1', '1.0', '1.0.0-beta', 'v1.0.0', '01.0.0', '1.0.0+build']) {
    assert.deepEqual(records({ ...clone(WARM_PARCHMENT), version }, 'color-scheme'), [
      ['manifest.invalid', '/version'],
    ]);
  }
  assert.deepEqual(records({ ...clone(WARM_PARCHMENT), version: '12.3.40' }, 'color-scheme'), []);
});

test('a Research record is never a pack: tier research is refused before anything else', () => {
  const result = validatePackManifest(
    { ...clone(WARM_PARCHMENT), tier: 'research', version: 'bad' },
    { kind: 'color-scheme', packageName: FIRST_PARTY },
  );
  assert.deepEqual(
    result.diagnostics.map(({ code, pointer }) => [code, pointer]),
    [['manifest.invalid', '/tier']],
  );
  assert.match(result.diagnostics[0]!.message, /a Research record isn't a pack/);
  assert.match(result.diagnostics[0]!.remedy, /research\/<id>\.json/);
});

test('a research record is its own strict shape, tier research and nothing else', () => {
  const record = {
    id: 'nord',
    name: 'Nord',
    kind: 'color-scheme',
    tier: 'research',
    source: { name: 'Nord', url: null },
    license: 'unverified',
    researchedAt: '2026-10-17',
    reason: 'Its upstream license has not been verified.',
  };
  assert.ok(ResearchRecordSchema.safeParse(record).success);
  assert.ok(!ResearchRecordSchema.safeParse({ ...record, tier: 'stable' }).success);
  assert.ok(!ResearchRecordSchema.safeParse({ ...record, tokens: {} }).success);
  assert.ok(
    !ResearchRecordSchema.safeParse({ ...record, source: { name: 'Nord', url: 'http://x.test' } })
      .success,
  );
});

test('a license state fits only its own kind of pack', () => {
  // provided-by-operating-system: a typography profile with no font file.
  assert.deepEqual(
    records(withLicense(WARM_PARCHMENT, 'provided-by-operating-system'), 'color-scheme'),
    [['manifest.invalid', '/provenance/license']],
  );
  // generated: a generator scheme, and only one.
  assert.deepEqual(records(withLicense(WARM_PARCHMENT, 'generated'), 'color-scheme'), [
    ['manifest.invalid', '/provenance/license'],
  ]);
  assert.deepEqual(records(withLicense(SEED, 'first-party'), 'color-scheme'), [
    ['manifest.invalid', '/provenance/license'],
  ]);
  assert.deepEqual(records(clone(SEED), 'color-scheme'), []);
  // independent-inspired-interpretation: an -inspired id and an Inspired name.
  const inspired = withLicense(PLATFORM_NEUTRAL, 'independent-inspired-interpretation');
  assert.deepEqual(records(inspired, 'design-language'), [['manifest.invalid', '/id']]);
  assert.deepEqual(
    records({ ...inspired, id: 'carbon-inspired', name: 'Carbon' }, 'design-language'),
    [['manifest.invalid', '/id']],
  );
  assert.deepEqual(
    records({ ...inspired, id: 'carbon-inspired', name: 'Carbon Inspired' }, 'design-language'),
    [],
  );
});

test('a license off the allowlist excludes the pack, naming the license; the allowlist is exact', () => {
  for (const license of ALLOWED_LICENSES) {
    assert.equal(licenseExclusion({ provenance: { license } }), null, license);
  }
  for (const license of ['GPL-3.0', 'MIT OR GPL-3.0', 'mit', 'CC-BY-4.0', 'unverified', 'MIT ']) {
    const reason = licenseExclusion({ provenance: { license } });
    assert.ok(reason, license);
    assert.ok(reason.includes(`its license, ${license},`), reason);
  }
  assert.ok(isUpstreamLicense('OFL-1.1'));
  assert.ok(!isUpstreamLicense('first-party'));
  // The validator doesn't fail it: it's valid, and registry generation leaves it out.
  assert.deepEqual(
    records(
      { ...withLicense(DARK_ONLY, 'GPL-3.0'), id: 'acme-dark' },
      'color-scheme',
      '@acme/packs',
    ),
    [],
  );
});

test('a derived counterpart takes a distinct name and says how it was derived', () => {
  const derived = {
    ...clone(LIGHT_ONLY),
    name: 'Pearl Night',
    provenance: {
      ...LIGHT_ONLY.provenance,
      derivedFrom: { name: 'Pearl', url: 'https://example.test/pearl' },
      derivation: 'A dark counterpart of the light-only Pearl, through anchor-v1.',
    },
  };
  assert.deepEqual(records(derived, 'color-scheme'), []);
  assert.deepEqual(records({ ...derived, name: 'pearl' }, 'color-scheme'), [
    ['manifest.invalid', '/name'],
  ]);
  const unexplained = clone(derived);
  delete unexplained.provenance.derivation;
  assert.deepEqual(records(unexplained, 'color-scheme'), [
    ['manifest.missing', '/provenance/derivation'],
  ]);
});

test('modes are what the pack covers, and a single-mode scheme locks its native mode', () => {
  assert.deepEqual(records({ ...clone(WARM_PARCHMENT), modes: ['light'] }, 'color-scheme'), [
    ['manifest.invalid', '/modes'],
  ]);
  assert.deepEqual(records({ ...clone(PLATFORM_NEUTRAL), modes: ['dark'] }, 'design-language'), [
    ['manifest.invalid', '/modes'],
  ]);
  assert.deepEqual(records({ ...clone(HUMANIST_UI), modes: ['light', 'light'] }, 'typography'), [
    ['manifest.duplicate', '/modes/1'],
    ['manifest.invalid', '/modes'],
  ]);
  // The light-only fixture is Extended, locked to light.
  assert.equal(LIGHT_ONLY.lockedMode, 'light');
  const unlocked = clone(LIGHT_ONLY);
  delete unlocked.lockedMode;
  assert.deepEqual(records(unlocked, 'color-scheme'), [['manifest.missing', '/lockedMode']]);
  assert.deepEqual(records({ ...clone(LIGHT_ONLY), lockedMode: 'dark' }, 'color-scheme'), [
    ['manifest.invalid', '/lockedMode'],
  ]);
  assert.deepEqual(records({ ...clone(WARM_PARCHMENT), lockedMode: 'light' }, 'color-scheme'), [
    ['manifest.invalid', '/lockedMode'],
  ]);
  // Only Extended and Experimental take a single-mode scheme.
  assert.deepEqual(records({ ...clone(DARK_ONLY), tier: 'stable' }, 'color-scheme'), [
    ['manifest.invalid', '/tier'],
  ]);
});

test('accessibility evidence names exactly the gates the axis is held to', () => {
  assert.deepEqual(
    records({ ...clone(WARM_PARCHMENT), accessibility: { checks: ['contrast'] } }, 'color-scheme'),
    [['manifest.invalid', '/accessibility/checks']],
  );
  assert.deepEqual(
    records(
      { ...clone(HUMANIST_UI), accessibility: { checks: ['contrast', 'text-size', 'hierarchy'] } },
      'typography',
    ),
    [['manifest.invalid', '/accessibility/checks']],
  );
  assert.deepEqual(
    records(
      { ...clone(WARM_PARCHMENT), accessibility: { checks: ['contrast', 'safe'] } },
      'color-scheme',
    ),
    [['manifest.invalid', '/accessibility/checks/1']],
  );
  assert.deepEqual(
    records(
      {
        ...clone(PLATFORM_NEUTRAL),
        accessibility: {
          checks: ['stylesheet-lint', 'focus-ring', 'contrast'],
          notes: ['Checked by hand at 400% zoom.'],
        },
      },
      'design-language',
    ),
    [],
  );
});

test('cost counts the asset files the pack ships, and no file means no bytes', () => {
  assert.deepEqual(
    records({ ...clone(WARM_PARCHMENT), cost: { assets: 1, assetBytes: 0 } }, 'color-scheme'),
    [['manifest.invalid', '/cost/assets']],
  );
  assert.deepEqual(
    records({ ...clone(WARM_PARCHMENT), cost: { assets: 0, assetBytes: 10 } }, 'color-scheme'),
    [['manifest.invalid', '/cost/assetBytes']],
  );
});
