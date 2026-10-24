import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  createAppearanceRegistry,
  type AppearanceRegistry,
  type DesignLanguageManifest,
  type MetaPack,
} from '@portfolio/appearance';
import { packPackages } from '@portfolio/appearance/node';
import { registryMeta } from '@portfolio/variant-contract/node';
import { appearanceTargets } from './appearance-targets';
import {
  heldFindings,
  heldRecord,
  readHeld,
  renderHeldRecord,
  surfaceOpacityFloor,
  type HeldPack,
  type HeldRecord,
} from './catalog-held';
import { generateRegistry, renderOptions, REPO_ROOT } from './registry-options';
// The approved review lab's catalog, as the seed copied it (#20).
import { DESIGN_LANGUAGES } from '../../../scripts/catalog/seed/appearance-catalog.js';
import { BORDER_FIXES, languageManifest } from '../../../scripts/catalog/seed.mjs';

// #20, PR 2b: the 40 design languages, with the ones that fail
// check:appearance held with their gate records. PR 2c's anchor-v2 and
// translucency floors ship 27: the 13 opaque textured languages as they
// are, and glassmorphism at its floor. The 13 textured translucent ones
// stay held: their floor is opaque.

interface SeedLanguage {
  readonly id: string;
  readonly status: string;
}

const PACKS = path.join(REPO_ROOT, 'packages/appearance-languages/packs');
const targets = appearanceTargets();

let cached: Promise<{ registry: AppearanceRegistry; meta: MetaPack[] }> | undefined;
function production() {
  cached ??= generateRegistry({}, { write: false }).then(({ result, excluded = [] }) => {
    assert.ok(result.ok);
    const data = registryMeta(result, renderOptions({}));
    const packs = data.PACKS as MetaPack[];
    return {
      registry: createAppearanceRegistry({
        VARIANTS: data.VARIANTS,
        PACKS: packs,
        PLATFORM_STYLESHEET: data.PLATFORM_STYLESHEET,
        EXCLUDED_PACKS: excluded,
      }),
      meta: packs,
    };
  });
  return cached;
}

const held = () => readHeld(REPO_ROOT, packPackages(REPO_ROOT));
const tally = (tiers: readonly string[]) =>
  tiers.reduce<Record<string, number>>((counts, tier) => {
    counts[tier] = (counts[tier] ?? 0) + 1;
    return counts;
  }, {});

test('the 40 approved languages: 27 ship and 13 are held, each in its approved tier', async () => {
  const { registry } = await production();
  const shipping = [...registry.packs.designLanguage.values()].filter((pack) => !pack.fixture);
  const holding = held();
  assert.equal(shipping.length + holding.length, 40);
  for (const language of DESIGN_LANGUAGES as readonly SeedLanguage[]) {
    const ships = registry.packs.designLanguage.get(language.id);
    const kept = holding.find(({ id }) => id === language.id);
    assert.ok(Boolean(ships) !== Boolean(kept), `${language.id} ships or is held, never both`);
    const tier = ships?.manifest.tier ?? kept?.manifest?.tier;
    assert.equal(tier, language.status, `${language.id}'s tier`);
  }
  assert.deepEqual(tally(shipping.map(({ manifest }) => manifest.tier)), {
    stable: 11,
    extended: 11,
    experimental: 5,
  });
  assert.deepEqual(tally(holding.map(({ manifest }) => manifest!.tier)), {
    stable: 1,
    extended: 7,
    experimental: 5,
  });
  // Registry generation reads packs/ alone: no held id has a pack directory.
  for (const pack of holding) assert.ok(!fs.existsSync(path.join(PACKS, pack.id)), pack.id);
});

test('every seeded language, shipping or held, is the seed mapping of its prototype record, in full, less a translucency floor', () => {
  const floored: string[] = [];
  for (const language of DESIGN_LANGUAGES as readonly SeedLanguage[]) {
    if (language.id === 'platform-neutral') continue; // #19's fallback, which predates the seed.
    const shipped = path.join(PACKS, language.id, 'manifest.json');
    const file = fs.existsSync(shipped)
      ? shipped
      : path.join(REPO_ROOT, 'packages/appearance-languages/held', language.id, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(file, 'utf8')) as DesignLanguageManifest;
    const seeded = JSON.parse(JSON.stringify(languageManifest(language))) as DesignLanguageManifest;
    if (manifest.approvedSurfaceOpacity !== undefined) {
      // A floor (PR 2c) raises the approved opacity, records it, and bumps the minor version.
      floored.push(language.id);
      assert.equal(manifest.approvedSurfaceOpacity, seeded.tokens['surface-opacity'], language.id);
      assert.equal(manifest.version, '1.1.0', language.id);
      seeded.version = manifest.version;
      seeded.tokens = { ...seeded.tokens, 'surface-opacity': manifest.tokens['surface-opacity'] };
      seeded.approvedSurfaceOpacity = manifest.approvedSurfaceOpacity;
    }
    assert.deepEqual(manifest, seeded, language.id);
  }
  assert.deepEqual(floored, ['glassmorphism']);
});

test('a translucent language ships at its floor, the least surface-opacity that passes over the worst backdrop', async () => {
  const { registry } = await production();
  const glass = registry.packs.designLanguage.get('glassmorphism')!.manifest;
  assert.equal(glass.approvedSurfaceOpacity, '78%');
  assert.equal(glass.tokens['surface-opacity'], '97%');
  const at = (percent: number) => ({ ...glass.tokens, 'surface-opacity': `${percent}%` });
  // The search starts at the approved value and stops at the first that passes.
  assert.equal(surfaceOpacityFloor(registry, at(78), targets), 97);
  assert.equal(surfaceOpacityFloor(registry, at(97), targets), 97);
  assert.equal(heldRecord(registry, { ...glass, tokens: at(97) }, targets), null);
  const below = heldRecord(registry, { ...glass, tokens: at(96) }, targets)!;
  assert.ok(
    below.pairs.every((pair) => pair.backdrop === '#000000' || pair.backdrop === '#ffffff'),
  );
  // Past 100%, there's no floor: an opaque surface that fails is a scheme or texture problem.
  const unreadable = { ...glass.tokens, 'surface-opacity': 'none' };
  assert.equal(surfaceOpacityFloor(registry, unreadable, targets), null);
  // A textured translucent language passes only opaque, so its floor is 100%.
  const fluent = held().find(({ id }) => id === 'fluent-2-inspired')!
    .manifest as DesignLanguageManifest;
  assert.equal(surfaceOpacityFloor(registry, fluent.tokens, targets), 100);
  assert.equal(surfaceOpacityFloor(registry, { ...fluent.tokens, texture: 'none' }, targets), 97);
});

test('the languages take no script, no stylesheet, no ambient motion, and neumorphic controls gain a border', () => {
  const manifests = [
    ...fs.readdirSync(PACKS).map((id) => path.join(PACKS, id, 'manifest.json')),
    ...held().map((pack) => path.join(REPO_ROOT, pack.dir, 'manifest.json')),
  ].map((file) => JSON.parse(fs.readFileSync(file, 'utf8')) as DesignLanguageManifest);
  assert.equal(manifests.length, 40);
  for (const manifest of manifests) {
    assert.equal(manifest.stylesheet, undefined, `${manifest.id} ships no stylesheet`);
    assert.ok(!('ambientMotion' in manifest.tokens), `${manifest.id} has no ambient motion`);
    assert.ok(
      !JSON.stringify(manifest.tokens).includes('--appearance-'),
      `${manifest.id} reads only #19's --color-* roles`,
    );
    if (manifest.provenance.license === 'independent-inspired-interpretation') {
      assert.match(manifest.id, /-inspired$/);
      assert.match(manifest.name, / Inspired$/);
    }
  }
  const neumorphic = manifests.find(({ id }) => id === 'neumorphic')!;
  assert.equal(neumorphic.tokens['border-control'], BORDER_FIXES.neumorphic);
  assert.match(neumorphic.tokens['border-control'], /var\(--color-border-strong\)/);
  const aero = manifests.find(({ id }) => id === 'frutiger-aero')!;
  assert.doesNotMatch(JSON.stringify(aero.tokens), /frutiger/i);
});

test('each held language records the gate it fails, its worst pair and scheme, and what would unblock it', async () => {
  const { registry } = await production();
  for (const pack of held()) {
    assert.deepEqual(pack.problems, [], pack.id);
    const record = JSON.parse(pack.recorded!) as HeldRecord;
    assert.equal(
      pack.recorded,
      renderHeldRecord(heldRecord(registry, pack.manifest as DesignLanguageManifest, targets)),
    );
    assert.equal(record.id, pack.id);
    assert.ok(record.pairs.length > 0 && record.schemes.failing > 0, pack.id);
    assert.ok(record.worst.ratio < record.worst.target, pack.id);
    const first: Record<string, unknown> = { ...record.pairs[0]! };
    delete first.failing;
    assert.deepEqual(record.worst, first);
    assert.ok(record.unblockedBy.length > 0, pack.id);
  }
  // Every one still held is textured and translucent, and its floor is opaque.
  for (const pack of held()) {
    const record = JSON.parse(pack.recorded!) as HeldRecord;
    const tokens = (pack.manifest as DesignLanguageManifest).tokens;
    assert.notEqual(tokens.texture, 'none', pack.id);
    assert.notEqual(tokens['surface-opacity'], '100%', pack.id);
    assert.deepEqual(record.causes, ['translucency'], pack.id);
    assert.equal(record.opacityFloor?.withTexture, 100, pack.id);
    assert.match(record.reason, /its floor is opaque/, pack.id);
    assert.match(record.unblockedBy.join(' '), /the owner's call/, pack.id);
    assert.ok(
      record.pairs.every((pair) => pair.backdrop !== undefined),
      pack.id,
    );
  }
});

test('check:appearance reads every held pack as held, with no finding', async () => {
  const { registry } = await production();
  const report = heldFindings(registry, held(), targets);
  assert.deepEqual(report.findings, []);
  assert.equal(report.held.length, 13);
  for (const line of report.held)
    assert.match(
      line,
      /^Held design language [a-z0-9-]+ \((?:stable|extended|experimental)\): It fails check:appearance with \d+ of 25 color schemes: /,
    );
});

test('a held pack that registers, one whose record is stale, or one that passes now, is a finding', async () => {
  const { registry, meta } = await production();
  const all = held();
  const glass = all.find(({ id }) => id === 'fluent-2-inspired')!;
  const base = meta.find((pack) => pack.manifest.id === 'platform-neutral')!;
  // The mutant: fluent-2-inspired registered beside the shipping languages.
  const mutant = createAppearanceRegistry({
    VARIANTS: [...registry.variants],
    PACKS: [...meta, { ...base, manifest: glass.manifest } as MetaPack],
  });
  const registered = heldFindings(mutant, [glass], targets).findings.map(({ message }) => message);
  assert.ok(
    registered.some((message) =>
      /The held design language fluent-2-inspired is registered/.test(message),
    ),
    registered.join('\n'),
  );

  const stale: HeldPack = {
    ...glass,
    recorded: glass.recorded!.replace('"ratio": ', '"ratio": 1'),
  };
  assert.match(
    heldFindings(registry, [stale], targets).findings[0]!.message,
    /gate\.json is stale/,
  );

  const fixed = {
    ...glass,
    manifest: {
      ...(glass.manifest as DesignLanguageManifest),
      tokens: {
        ...(glass.manifest as DesignLanguageManifest).tokens,
        'surface-opacity': '100%',
        'backdrop-blur': '0px',
      },
    },
  } as HeldPack;
  assert.match(
    heldFindings(registry, [fixed], targets).findings[0]!.message,
    /passes its gate now/,
  );

  assert.match(
    heldFindings(registry, [glass, glass], targets).findings[0]!.message,
    /is held twice/,
  );
});
