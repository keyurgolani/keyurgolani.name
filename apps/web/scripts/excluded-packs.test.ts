import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createAppearanceRegistry,
  resolveAppearance,
  PLATFORM_DEFAULTS,
} from '@portfolio/appearance';
import { readRegistry, registryMeta, type RegistryResult } from '@portfolio/variant-contract/node';
import {
  excludePacks,
  registryOptions,
  renderExcludedPacks,
  renderOptions,
} from './registry-options';

// #20: a valid pack under a license off the allowlist leaves the build at
// registry generation, before anything renders or is served, and keeps its
// reason; selecting it renders its axis's fallback with that reason.

async function shipped(): Promise<RegistryResult> {
  const result = await readRegistry(registryOptions({}));
  assert.ok(result.ok, JSON.stringify(result.diagnostics, null, 2));
  return result;
}

/** The registry with a third party's copy of warm-parchment under `license`. */
function withThirdParty(result: RegistryResult, license: string): RegistryResult {
  const base = result.packs.find(({ manifest }) => manifest.id === 'warm-parchment')!;
  const manifest = structuredClone(base.manifest) as typeof base.manifest & {
    tier: string;
    provenance: { license: string };
  };
  Object.assign(manifest, { id: 'acme-ocean', tier: 'extended' });
  manifest.provenance.license = license;
  return {
    ...result,
    packs: [...result.packs, { ...base, packageName: '@acme/packs', manifest }],
  };
}

test('a pack under an allowed license stays, and nothing is excluded', async () => {
  const read = await shipped();
  const { result, excluded } = excludePacks(read);
  assert.equal(result, read);
  assert.deepEqual(excluded, []);
  const kept = excludePacks(withThirdParty(read, 'MIT'));
  assert.ok(kept.result.packs.some(({ manifest }) => manifest.id === 'acme-ocean'));
  assert.deepEqual(kept.excluded, []);
});

test('a pack under any other license is left out with a reason that names it', async () => {
  const read = withThirdParty(await shipped(), 'LicenseRef-Proprietary');
  const { result, excluded } = excludePacks(read);
  assert.ok(!result.packs.some(({ manifest }) => manifest.id === 'acme-ocean'));
  assert.deepEqual(
    excluded.map(({ kind, id, packageName }) => [kind, id, packageName]),
    [['color-scheme', 'acme-ocean', '@acme/packs']],
  );
  assert.match(
    excluded[0]!.reason,
    /its license, LicenseRef-Proprietary, isn't one a pack may ship under/,
  );
  // Nothing of it reaches the metadata module, and the excluded-packs module names it alone.
  const meta = registryMeta(result, renderOptions({}));
  assert.ok(!JSON.stringify(meta).includes('acme-ocean'));
  assert.ok(renderExcludedPacks(excluded).includes('"id": "acme-ocean"'));
  // Selecting it falls back on its axis, with the reason.
  const registry = createAppearanceRegistry({
    VARIANTS: meta.VARIANTS,
    PACKS: meta.PACKS as never,
    EXCLUDED_PACKS: excluded,
  });
  const resolved = resolveAppearance({
    published: { ...PLATFORM_DEFAULTS, colorScheme: 'acme-ocean' },
    visitorControls: {
      variant: 'locked',
      designLanguage: 'locked',
      colorScheme: 'locked',
      typography: 'locked',
      displayMode: 'locked',
    },
    motionPolicy: 'respect-os',
    profile: 'read-only',
    registry,
  });
  assert.equal(resolved.selection.colorScheme, PLATFORM_DEFAULTS.colorScheme);
  const scheme = resolved.diagnostics.filter(({ axis }) => axis === 'colorScheme');
  assert.deepEqual(
    scheme.map(({ code }) => code),
    ['appearance.unavailable'],
  );
  assert.match(scheme[0]!.message, /left out: its license, LicenseRef-Proprietary/);
});

test("a fallback can't be excluded: the build stops instead", async () => {
  const read = await shipped();
  const packs = read.packs.map((pack) =>
    pack.manifest.id === 'humanist-ui'
      ? {
          ...pack,
          manifest: {
            ...pack.manifest,
            provenance: {
              ...(pack.manifest as never as { provenance: object }).provenance,
              license: 'GPL-3.0',
            },
          },
        }
      : pack,
  );
  assert.throws(
    () => excludePacks({ ...read, packs }),
    /humanist-ui .* is a fallback, and it can't ship: its license, GPL-3.0/,
  );
});
