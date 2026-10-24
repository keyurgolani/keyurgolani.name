import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  createAppearanceRegistry,
  resolveAppearance,
  PLATFORM_DEFAULTS,
} from '@portfolio/appearance';
import {
  ACCEPTANCE_FILE,
  GENERATED_DIR,
  recordDigest,
  referenceFile,
} from '@portfolio/appearance/node';
import { readRegistry, registryMeta, type RegistryResult } from '@portfolio/variant-contract/node';
import {
  excludePacks,
  registryOptions,
  renderExcludedPacks,
  renderOptions,
  REPO_ROOT,
} from './registry-options';

// #20: a valid pack under a license off the allowlist leaves the build at
// registry generation, before anything renders or is served, and keeps its
// reason; selecting it renders its axis's fallback with that reason. PR 3:
// so does an image-derived scheme the owner hasn't accepted.

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

/** The image-derived schemes, which wait for the owner's acceptance (#20 PR 3). */
const AWAITING = ['portfolio-artwork', 'profile-image'];

test('a pack under an allowed license stays, and only the image-derived schemes wait', async () => {
  const read = await shipped();
  const { result, excluded } = excludePacks(read);
  assert.deepEqual(
    excluded.map(({ id, awaiting }) => [id, awaiting]),
    AWAITING.map((id) => [id, 'owner-acceptance']),
  );
  assert.deepEqual(
    result.packs.map(({ manifest }) => manifest.id),
    read.packs.map(({ manifest }) => manifest.id).filter((id) => !AWAITING.includes(id)),
  );
  const kept = excludePacks(withThirdParty(read, 'MIT'));
  assert.ok(kept.result.packs.some(({ manifest }) => manifest.id === 'acme-ocean'));
  assert.deepEqual(
    kept.excluded.map(({ id }) => id),
    AWAITING,
  );
});

/** `read` with profile-image's pack directory in a scratch package holding its record and `acceptance`. */
function withAcceptance(
  read: RegistryResult,
  acceptance: (digest: string) => unknown,
): RegistryResult {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'kgn-acceptance-'));
  const record = fs.readFileSync(
    path.join(REPO_ROOT, 'packages/appearance-schemes', referenceFile('profile-image')),
    'utf8',
  );
  fs.mkdirSync(path.join(scratch, GENERATED_DIR), { recursive: true });
  fs.writeFileSync(path.join(scratch, referenceFile('profile-image')), record);
  fs.writeFileSync(
    path.join(scratch, GENERATED_DIR, ACCEPTANCE_FILE),
    JSON.stringify(acceptance(recordDigest(record))),
  );
  return {
    ...read,
    packs: read.packs.map((pack) =>
      pack.manifest.id === 'profile-image'
        ? { ...pack, dir: path.join(scratch, 'packs', 'profile-image') }
        : pack,
    ),
  };
}

test("an image-derived scheme ships once the owner's acceptance pins its current record, and waits again when it's stale", async () => {
  const read = await shipped();
  const accepted = excludePacks(
    withAcceptance(read, (digest) => ({
      'profile-image': { record: digest, acceptedBy: 'keyurgolani', acceptedAt: '2026-10-24' },
    })),
  );
  assert.ok(accepted.result.packs.some(({ manifest }) => manifest.id === 'profile-image'));
  assert.deepEqual(
    accepted.excluded.map(({ id }) => id),
    ['portfolio-artwork'],
  );
  const stale = excludePacks(
    withAcceptance(read, () => ({
      'profile-image': {
        record: `sha256-${'0'.repeat(64)}`,
        acceptedBy: 'keyurgolani',
        acceptedAt: '2026-10-24',
      },
    })),
  );
  const waiting = stale.excluded.find(({ id }) => id === 'profile-image');
  assert.equal(waiting?.awaiting, 'owner-acceptance');
  assert.match(waiting!.reason, /accepted an earlier reference record/);
});

test('selecting an image-derived scheme that waits falls back with its reason, which blocks publish', async () => {
  const { result, excluded } = excludePacks(await shipped());
  const meta = registryMeta(result, renderOptions({}));
  assert.ok(!meta.PACKS.some(({ manifest }) => manifest.id === 'profile-image'));
  const registry = createAppearanceRegistry({
    VARIANTS: meta.VARIANTS,
    PACKS: meta.PACKS as never,
    EXCLUDED_PACKS: excluded,
  });
  const resolved = resolveAppearance({
    published: { ...PLATFORM_DEFAULTS, colorScheme: 'profile-image' },
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
  assert.match(scheme[0]!.message, /waits for the owner to accept its reference record/);
});

test('a pack under any other license is left out with a reason that names it', async () => {
  const read = withThirdParty(await shipped(), 'LicenseRef-Proprietary');
  const { result, excluded: all } = excludePacks(read);
  const excluded = all.filter(({ awaiting }) => awaiting === undefined);
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
