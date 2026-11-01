import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { COMPOSITION_IDS } from '../ids';
import type { VariantManifest } from '../manifest-schema';
import { STUDIO_THUMBNAIL_EXPORT, undrawnCompositions, type VariantEntry } from './registry';

// Every first-party composition draws its own Studio thumbnail (the owner's walk: 10 of 15
// fell to the generic plate). Each one COMPOSITION_IDS names, ready or pending, exports
// `./studio-thumbnail`; only a third party's variant, or the fallback, gets the generic plate.
// readRegistry sets each entry's thumbnail from that export (codegen.test.ts).

type Entry = Pick<VariantEntry, 'packageName' | 'manifest' | 'thumbnail'>;

const PACKAGES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const entry = (packageName: string, id: string, drawn: boolean): Entry => ({
  packageName,
  manifest: { id } as VariantManifest,
  thumbnail: drawn ? `${packageName}${STUDIO_THUMBNAIL_EXPORT.slice(1)}` : null,
});

/** The workspace's first-party compositions, each as registry generation reads its package.json. */
function workspace(): Entry[] {
  return COMPOSITION_IDS.map((id) => {
    const dir = path.join(PACKAGES, `variant-${id}`);
    const file = path.join(dir, 'package.json');
    assert.ok(fs.existsSync(file), `${id}: no package at ${path.relative(PACKAGES, file)}`);
    const pkg = JSON.parse(fs.readFileSync(file, 'utf8')) as {
      name: string;
      exports?: Record<string, string>;
    };
    const target = pkg.exports?.[STUDIO_THUMBNAIL_EXPORT];
    if (target !== undefined) {
      assert.ok(
        fs.existsSync(path.join(dir, target)),
        `${id}: ${STUDIO_THUMBNAIL_EXPORT} points at ${target}, which the package doesn't have`,
      );
    }
    return entry(pkg.name, id, target !== undefined);
  });
}

test('a first-party composition without ./studio-thumbnail is named; a third party is not', () => {
  const [drawn, undrawn] = COMPOSITION_IDS;
  assert.deepEqual(
    undrawnCompositions([
      entry(`@portfolio/variant-${drawn}`, drawn, true),
      // The planted red: a first-party id with no export.
      entry(`@portfolio/variant-${undrawn}`, undrawn, false),
      // A third party's variant with none gets Studio's generic plate, as the fallback does.
      entry('@acme/plain', 'acme-plain', false),
      entry('@portfolio/fallback-composition', 'fallback', false),
    ]),
    [undrawn],
  );
  // The planted red on the workspace itself: one drawn composition loses its export.
  const own = workspace();
  const at = own.findIndex(({ thumbnail }) => thumbnail !== null);
  assert.ok(at >= 0, 'a first-party composition draws its own');
  const planted = own.map((each, index) => (index === at ? { ...each, thumbnail: null } : each));
  assert.ok(undrawnCompositions(planted).includes(own[at]!.manifest.id));
});

test('every first-party composition in COMPOSITION_IDS exports ./studio-thumbnail', () => {
  const undrawn = undrawnCompositions(workspace());
  assert.deepEqual(
    undrawn,
    [],
    `first-party compositions with no ${STUDIO_THUMBNAIL_EXPORT} export, which Studio draws as its generic plate: ${undrawn.join(', ')}. Draw each in src/studio-thumbnail.tsx and add the export to its package.json.`,
  );
});
