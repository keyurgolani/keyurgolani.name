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
import {
  compareVersions,
  packPackages,
  SHADOW_KEY_KNOWN_FAILURES,
} from '@portfolio/appearance/node';
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
// are, and glassmorphism at its floor. PR 2d ships eight more at their
// opaque floor (the orchestrator's call under the owner's delegation), and
// the five whose design is their translucency stay held.

interface SeedLanguage {
  readonly id: string;
  readonly status: string;
}

const PACKS = path.join(REPO_ROOT, 'packages/appearance-languages/packs');
// LANG-1: the seeded languages retired as aliases of their survivors, each manifest moved unchanged.
const RETIRED = path.join(REPO_ROOT, 'packages/appearance-languages/retired');
const retired = () => fs.readdirSync(RETIRED).sort();
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

/**
 * The design languages the ten compositions add (packs plan §4), each
 * Extended and first-party, beside the 40 the seed approved. Each ships a
 * stylesheet, which the language CSS lint reads.
 */
const TEN_VARIANT_LANGUAGES: readonly string[] = ['poster-press', 'letterpress'];

test('the 40 approved languages: 31 ship, 5 are held, and 4 are retired, each in its approved tier, and the ten compositions add theirs', async () => {
  const { registry } = await production();
  const shipping = [...registry.packs.designLanguage.values()].filter((pack) => !pack.fixture);
  const holding = held();
  const retiring = retired();
  assert.deepEqual(retiring, [
    'ant-inspired',
    'atlassian-inspired',
    'polaris-inspired',
    'radix-inspired',
  ]);
  assert.equal(
    shipping.length + holding.length + retiring.length,
    40 + TEN_VARIANT_LANGUAGES.length,
  );
  for (const id of TEN_VARIANT_LANGUAGES) {
    const pack = registry.packs.designLanguage.get(id);
    assert.equal(pack?.manifest.tier, 'extended', id);
    assert.equal(pack?.manifest.provenance.license, 'first-party', id);
  }
  for (const language of DESIGN_LANGUAGES as readonly SeedLanguage[]) {
    const ships = registry.packs.designLanguage.get(language.id);
    const kept = holding.find(({ id }) => id === language.id);
    const gone = retiring.includes(language.id)
      ? (JSON.parse(
          fs.readFileSync(path.join(RETIRED, language.id, 'manifest.json'), 'utf8'),
        ) as DesignLanguageManifest)
      : undefined;
    assert.equal(
      [ships, kept, gone].filter(Boolean).length,
      1,
      `${language.id} ships, is held, or is retired, exactly one`,
    );
    const tier = ships?.manifest.tier ?? kept?.manifest?.tier ?? gone?.tier;
    assert.equal(tier, language.status, `${language.id}'s tier`);
  }
  assert.deepEqual(tally(shipping.map(({ manifest }) => manifest.tier)), {
    stable: 12,
    extended: 12 + TEN_VARIANT_LANGUAGES.length,
    experimental: 7,
  });
  assert.deepEqual(tally(holding.map(({ manifest }) => manifest!.tier)), {
    extended: 2,
    experimental: 3,
  });
  // Registry generation reads packs/ alone: no held or retired id has a pack directory.
  for (const pack of holding) assert.ok(!fs.existsSync(path.join(PACKS, pack.id)), pack.id);
  for (const id of retiring) {
    assert.ok(!fs.existsSync(path.join(PACKS, id)), id);
    assert.ok(!registry.packs.designLanguage.has(id), id);
  }
});

/**
 * The fields a seeded language may move from its seed once its version is
 * past the seed's (LANG-2's signatures): its design. Everything else, its
 * id, name, tier, family, provenance, modes, accessibility, cost, budgets,
 * and fallbacks, stays the seed's whatever its version.
 */
const DESIGN_FIELDS = ['tokens', 'description', 'caveats', 'version', 'stylesheet'] as const;

/** Seeded languages whose redesign (a version past the pinned one) added a stylesheet, a design field. */
const REDESIGNED_STYLESHEETS: readonly string[] = ['material-3-inspired'];

/**
 * The version a seeded language's design is pinned at: its seed record's,
 * or 1.1.0 once a translucency floor bumped the minor, and, once it has a
 * family, the one patch the family took (a family bumps the patch and
 * changes nothing else). Past it, the pack has been bumped for a design
 * change of its own.
 */
function pinnedVersion(seedVersion: string, manifest: DesignLanguageManifest): string {
  const base = manifest.approvedSurfaceOpacity === undefined ? seedVersion : '1.1.0';
  if (manifest.family === undefined) return base;
  const [major, minor, patch] = base.split('.').map(Number);
  return `${major}.${minor}.${patch! + 1}`;
}

/**
 * The manifest `language`'s seed record maps to, as `manifest` must equal
 * it: the seed mapping in full, less a family, a translucency floor, and,
 * for a pack bumped past its pinned version, its design fields.
 */
function seedExpectation(
  language: SeedLanguage,
  manifest: DesignLanguageManifest,
  floored: string[] = [],
): DesignLanguageManifest {
  const seeded = JSON.parse(JSON.stringify(languageManifest(language))) as DesignLanguageManifest;
  const redesigned = compareVersions(manifest.version, pinnedVersion(seeded.version, manifest)) > 0;
  if (manifest.family !== undefined) {
    // A family (the Studio mockup's filter chips), which the seed predates, bumps the patch
    // version and changes nothing else: the seed's line at any patch, or a floor's below.
    if (manifest.approvedSurfaceOpacity === undefined) {
      const line = seeded.version.split('.').slice(0, 2).join('\\.');
      assert.match(manifest.version, new RegExp(`^${line}\\.\\d+$`), language.id);
    }
    seeded.family = manifest.family;
    seeded.version = manifest.version;
  }
  if (manifest.approvedSurfaceOpacity !== undefined) {
    // A floor (PR 2c) raises the approved opacity, records it, and bumps the minor version:
    // the 1.1 line, at any patch, since a family bumps the patch too.
    floored.push(language.id);
    assert.equal(manifest.approvedSurfaceOpacity, seeded.tokens['surface-opacity'], language.id);
    assert.match(manifest.version, /^1\.1\.\d+$/, language.id);
    seeded.version = manifest.version;
    seeded.tokens = { ...seeded.tokens, 'surface-opacity': manifest.tokens['surface-opacity'] };
    seeded.approvedSurfaceOpacity = manifest.approvedSurfaceOpacity;
    if (manifest.tokens['surface-opacity'] === '100%') {
      // An opaque floor (PR 2d) adds one caveat saying so, and nothing else.
      const added = manifest.caveats.at(-1)!;
      assert.equal(
        added,
        `Ships opaque: its approved ${manifest.approvedSurfaceOpacity} translucent surfaces fall under the contrast targets with its texture over a black or white backdrop, so its surfaces are 100% opaque, and only a dialog's backdrop is blurred. This supersedes the translucency caveats above.`,
        language.id,
      );
      seeded.caveats = [...seeded.caveats, added];
    }
  }
  if (redesigned) {
    // Bumped past its pinned version: its design is its own now, and only its design.
    const own = seeded as unknown as Record<string, unknown>;
    const mine = manifest as unknown as Record<string, unknown>;
    for (const field of DESIGN_FIELDS) {
      if (mine[field] === undefined) delete own[field];
      else own[field] = mine[field];
    }
  }
  return seeded;
}

/** A seeded language's manifest, wherever it lives: shipping, retired, or held. */
function seededManifest(id: string): DesignLanguageManifest {
  const shipped = path.join(PACKS, id, 'manifest.json');
  const moved = path.join(RETIRED, id, 'manifest.json');
  const file = fs.existsSync(shipped)
    ? shipped
    : fs.existsSync(moved)
      ? moved
      : path.join(REPO_ROOT, 'packages/appearance-languages/held', id, 'manifest.json');
  return JSON.parse(fs.readFileSync(file, 'utf8')) as DesignLanguageManifest;
}

test('every seeded language, shipping or held, is the seed mapping of its prototype record, in full, less a translucency floor, or past its pinned version, its design', () => {
  const floored: string[] = [];
  for (const language of DESIGN_LANGUAGES as readonly SeedLanguage[]) {
    if (language.id === 'platform-neutral') continue; // #19's fallback, which predates the seed.
    const manifest = seededManifest(language.id);
    assert.deepEqual(manifest, seedExpectation(language, manifest, floored), language.id);
  }
  assert.deepEqual(floored.sort(), [
    'art-deco',
    'atelier-luxury',
    'blueprint',
    'cyberpunk',
    'fluent-2-inspired',
    'glassmorphism',
    'industrial',
    'synthwave',
    'terminal-chrome',
  ]);
});

test('the seed pin is keyed on version: past its pinned version a pack moves only its design, and at it nothing (LANG-2)', () => {
  const matches = (manifest: DesignLanguageManifest, language: SeedLanguage) => {
    try {
      assert.deepEqual(manifest, seedExpectation(language, manifest));
      return true;
    } catch {
      return false;
    }
  };
  const next = (version: string) => {
    const [major, minor, patch] = version.split('.').map(Number);
    return `${major}.${minor}.${patch! + 1}`;
  };
  // The pin: the seed's version, or the floor's 1.1.0, and the family's one patch on top.
  const shape = (extra: object) => ({ ...extra }) as DesignLanguageManifest;
  assert.equal(pinnedVersion('1.0.1', shape({})), '1.0.1');
  assert.equal(pinnedVersion('1.0.1', shape({ family: 'quiet' })), '1.0.2');
  assert.equal(pinnedVersion('1.1.0', shape({ family: 'quiet' })), '1.1.1');
  assert.equal(
    pinnedVersion('1.0.1', shape({ family: 'retro', approvedSurfaceOpacity: '92%' })),
    '1.1.1',
  );
  // One plain language and one with a translucency floor, each as its seed maps it at its pinned version.
  for (const id of ['minimal-flat', 'cyberpunk']) {
    const language = (DESIGN_LANGUAGES as readonly SeedLanguage[]).find(
      (entry) => entry.id === id,
    )!;
    const live = seededManifest(id);
    const pinned = pinnedVersion(languageManifest(language).version, live);
    const base = seedExpectation(language, { ...live, version: pinned });
    assert.equal(base.version, pinned, id);
    assert.ok(matches(base, language), `${id} at its pin`);
    // Bumped, it may move every design field.
    const redesigned: DesignLanguageManifest = {
      ...base,
      version: next(pinned),
      description: 'Redrawn for its signature.',
      tokens: { ...base.tokens, 'radius-card': '3px' },
      caveats: [`A signature caveat.`, ...base.caveats],
      stylesheet: 'styles.css',
    } as DesignLanguageManifest;
    assert.ok(matches(redesigned, language), `${id} redesigned past its pin`);
    // Known-bad: bumped, it still can't move a pinned field.
    const pinnedFields: [string, unknown][] = [
      ['id', `${id}-renamed`],
      ['name', 'Renamed'],
      ['tier', base.tier === 'experimental' ? 'stable' : 'experimental'],
      ['provenance', { ...base.provenance, attribution: 'Someone else.' }],
      ['modes', ['light']],
      ['accessibility', { checks: ['contrast'] }],
      ['cost', { assets: 1, assetBytes: 1 }],
      ['budgets', { ...base.budgets, css: 1 }],
      ['fallbacks', []],
    ];
    for (const [field, value] of pinnedFields) {
      assert.ok(
        !matches({ ...redesigned, [field]: value } as DesignLanguageManifest, language),
        `${id}: a bumped pack moved its ${field}`,
      );
    }
    // Known-bad: at its pinned version, it can't move a design field.
    const designFields: [string, unknown][] = [
      ['tokens', { ...base.tokens, 'radius-card': '3px' }],
      ['description', 'Redrawn without a bump.'],
      ['caveats', ['A caveat without a bump.', ...base.caveats]],
      ['stylesheet', 'styles.css'],
    ];
    for (const [field, value] of designFields) {
      assert.ok(
        !matches({ ...base, [field]: value } as DesignLanguageManifest, language),
        `${id}: an unbumped pack moved its ${field}`,
      );
    }
  }
});

test('a translucent language ships at its floor, the least surface-opacity that passes over the worst backdrop', async () => {
  const { registry } = await production();
  const glass = registry.packs.designLanguage.get('glassmorphism')!.manifest;
  assert.equal(glass.approvedSurfaceOpacity, '78%');
  assert.equal(glass.tokens['surface-opacity'], '97%');
  const at = (percent: number) => ({ ...glass.tokens, 'surface-opacity': `${percent}%` });
  // The search starts at the approved value and stops at the first that passes.
  assert.equal(surfaceOpacityFloor(registry, at(97), targets), 99);
  // The shadow-key check (B, 2026-11-02) raised its floor from 97% to 99%: at 97% and 98%
  // its key layer, over a surface on a black or white backdrop, takes text-secondary under
  // 4.5:1. It ships at 97%, a known failure (SHADOW_KEY_KNOWN_FAILURES) until its ticket.
  assert.equal(surfaceOpacityFloor(registry, at(78), targets), 99);
  assert.ok(SHADOW_KEY_KNOWN_FAILURES.some(({ language }) => language === 'glassmorphism'));
  const unshadowed = (percent: number) => ({
    ...at(percent),
    'shadow-raised': 'none',
    'shadow-card': 'none',
  });
  assert.equal(surfaceOpacityFloor(registry, unshadowed(78), targets), 97);
  assert.equal(heldRecord(registry, { ...glass, tokens: at(99) }, targets), null);
  const shipped = heldRecord(registry, { ...glass, tokens: at(97) }, targets)!;
  assert.ok(shipped.pairs.length > 0);
  for (const pair of shipped.pairs) {
    assert.ok(pair.shadow && (pair.backdrop === '#000000' || pair.backdrop === '#ffffff'));
  }
  assert.equal(heldRecord(registry, { ...glass, tokens: unshadowed(97) }, targets), null);
  const below = heldRecord(registry, { ...glass, tokens: unshadowed(96) }, targets)!;
  assert.ok(
    below.pairs.every((pair) => pair.backdrop === '#000000' || pair.backdrop === '#ffffff'),
  );
  // Past 100%, there's no floor: an opaque surface that fails is a scheme or texture problem.
  const unreadable = { ...glass.tokens, 'surface-opacity': 'none' };
  assert.equal(surfaceOpacityFloor(registry, unreadable, targets), null);
  // A marked translucent language passes only opaque, so its floor is 100%.
  const vapor = held().find(({ id }) => id === 'vaporwave')!.manifest as DesignLanguageManifest;
  assert.equal(surfaceOpacityFloor(registry, vapor.tokens, targets), 100);
  // Without its texture: 99%, raised from 97% by the shadow-key check, as glassmorphism's was.
  const bare = (tokens: DesignLanguageManifest['tokens']) => ({ ...tokens, texture: 'none' });
  const unlifted = (tokens: DesignLanguageManifest['tokens']) => ({
    ...bare(tokens),
    'shadow-raised': 'none',
    'shadow-card': 'none',
  });
  assert.equal(surfaceOpacityFloor(registry, bare(vapor.tokens), targets), 99);
  assert.equal(surfaceOpacityFloor(registry, unlifted(vapor.tokens), targets), 97);
  // A washed one fails at every opacity, since the wash takes the text under the targets (LANG-5c r2).
  const aero = held().find(({ id }) => id === 'frutiger-aero')!.manifest as DesignLanguageManifest;
  assert.equal(surfaceOpacityFloor(registry, aero.tokens, targets), null);
  assert.equal(surfaceOpacityFloor(registry, bare(aero.tokens), targets), 99);
  assert.equal(surfaceOpacityFloor(registry, unlifted(aero.tokens), targets), 97);
});

test('the languages take no script, no stylesheet, no ambient motion, and neumorphic controls gain a border', () => {
  const manifests = [
    ...fs.readdirSync(PACKS).map((id) => path.join(PACKS, id, 'manifest.json')),
    ...held().map((pack) => path.join(REPO_ROOT, pack.dir, 'manifest.json')),
    ...retired().map((id) => path.join(RETIRED, id, 'manifest.json')),
  ].map((file) => JSON.parse(fs.readFileSync(file, 'utf8')) as DesignLanguageManifest);
  assert.equal(manifests.length, 40 + TEN_VARIANT_LANGUAGES.length);
  for (const manifest of manifests) {
    // Of the seeded languages only a redesign past its pinned version ships a stylesheet
    // (material-3-inspired's filled controls, LANG-5c round 2); the ten compositions' do, through the lint.
    if (TEN_VARIANT_LANGUAGES.includes(manifest.id) || REDESIGNED_STYLESHEETS.includes(manifest.id))
      assert.equal(manifest.stylesheet, './styles.css');
    else assert.equal(manifest.stylesheet, undefined, `${manifest.id} ships no stylesheet`);
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
  // Every one still held is textured and translucent. A marked one's floor is opaque; a washed
  // one (LANG-5c r2: holographic-iridescent, refractive-glass, y2k-translucent, frutiger-aero)
  // fails at every opacity until its wash passes.
  const washed = ['frutiger-aero', 'holographic-iridescent', 'refractive-glass', 'y2k-translucent'];
  assert.deepEqual(
    held()
      .map(({ id }) => id)
      .filter((id) => washed.includes(id))
      .sort(),
    washed,
  );
  for (const pack of held()) {
    const record = JSON.parse(pack.recorded!) as HeldRecord;
    const tokens = (pack.manifest as DesignLanguageManifest).tokens;
    assert.notEqual(tokens.texture, 'none', pack.id);
    assert.notEqual(tokens['surface-opacity'], '100%', pack.id);
    // Untextured it would pass under 100%, so the texture is a cause too.
    assert.ok((record.opacityFloor?.withoutTexture ?? 100) < 100, pack.id);
    assert.deepEqual(record.causes, ['texture', 'translucency'], pack.id);
    if (washed.includes(pack.id)) {
      assert.match(record.reason, /its texture washes its surfaces in /, pack.id);
      assert.equal(record.opacityFloor?.withTexture, null, pack.id);
      assert.match(record.unblockedBy.join(' '), /a lighter wash than /, pack.id);
      assert.match(record.unblockedBy.join(' '), /once its wash passes/, pack.id);
      assert.ok(
        record.pairs.some((pair) => pair.wash !== undefined),
        pack.id,
      );
      continue;
    }
    assert.match(record.reason, /without its texture they'd pass at \d+%/, pack.id);
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
  assert.equal(report.held.length, 5);
  // 31 gate schemes: 34 until LANG-5a retired bookcloth, zinc, and earthy-clay, which no gate reads now.
  for (const line of report.held)
    assert.match(
      line,
      /^Held design language [a-z0-9-]+ \((?:stable|extended|experimental)\): It fails check:appearance with \d+ of 31 color schemes: /,
    );
});

test('a held pack that registers, one whose record is stale, or one that passes now, is a finding', async () => {
  const { registry, meta } = await production();
  const all = held();
  const glass = all.find(({ id }) => id === 'frutiger-aero')!;
  const base = meta.find((pack) => pack.manifest.id === 'platform-neutral')!;
  // The mutant: frutiger-aero registered beside the shipping languages.
  const mutant = createAppearanceRegistry({
    VARIANTS: [...registry.variants],
    PACKS: [...meta, { ...base, manifest: glass.manifest } as MetaPack],
  });
  const registered = heldFindings(mutant, [glass], targets).findings.map(({ message }) => message);
  assert.ok(
    registered.some((message) =>
      /The held design language frutiger-aero is registered/.test(message),
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
        // Its percent-sized circles are washes now (LANG-5c r2): opaque alone no longer passes.
        texture: 'none',
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
