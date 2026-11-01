import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  anchorV2Adjustments,
  PLATFORM_DEFAULTS,
  type ColorSchemeManifest,
  type PackManifest,
  type ResearchRecord,
  type TypographyManifest,
} from '@portfolio/appearance';
import { auditCatalog, type AuditInput } from './catalog-audit';
import {
  applyRecipe,
  catalogEntries,
  formatEntry,
  offeredRecipes,
  parseCatalogQuery,
  readRecipes,
  roundTrips,
  searchCatalog,
  serializeCatalogQuery,
  unavailable,
  type CatalogEntry,
} from './catalog-query';
import { readCatalogSources, type ReadSources } from './catalog-sources';
import { REPO_ROOT } from './registry-options';
// The approved review lab's catalog, as the seed copied it (#20).
import {
  APPEARANCE_DEFAULTS,
  APPEARANCE_RECIPES,
  COLOR_SCHEMES,
  TYPOGRAPHY_PROFILES,
} from '../../../scripts/catalog/seed/appearance-catalog.js';
import { ANCHOR_ADJUSTMENTS, GENERATED_SCHEMES } from '../../../scripts/catalog/seed.mjs';

// #20, PR 2: the seeded catalog, its tiers and Research records, the
// recipes and defaults, the search and its URL form, recipe application,
// unavailable-pack diagnostics, and the branded-name audit.

/** The seed's digest: the review lab's file, byte for byte. A change here is a change to the approved catalog. */
const SEED_SHA256 = '0a22d50552bc915ec3c7197b0f38fb1b545659633b77f849f0d9a1a56a928a27';

interface SeedEntry {
  readonly id: string;
  readonly status: string;
  readonly name: string;
}

let cached: Promise<ReadSources> | undefined;
function sources(): Promise<ReadSources> {
  cached ??= readCatalogSources({}).then((read) => {
    assert.ok(read.ok, read.ok ? '' : JSON.stringify(read.diagnostics, null, 2));
    return read.sources;
  });
  return cached;
}

const tally = (entries: readonly { tier: string }[]) =>
  entries.reduce<Record<string, number>>((counts, { tier }) => {
    counts[tier] = (counts[tier] ?? 0) + 1;
    return counts;
  }, {});

test('the seed is the review lab catalog, byte for byte', () => {
  const bytes = fs.readFileSync(path.join(REPO_ROOT, 'scripts/catalog/seed/appearance-catalog.js'));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), SEED_SHA256);
});

/**
 * The approved generated schemes' ids as this catalog ships them (#20 PR 3).
 * The scope's `material-hct` would claim Material conformance a first-party
 * HCT can't match (7 of 8 of M3's baseline tones at best without copying
 * Material's code), and the scope rules out implying exact conformance, so
 * it ships as `hct-tonal`, the same Extended tier: a stream D decision,
 * logged for the owner.
 */
const RENAMED: Readonly<Record<string, string>> = { 'material-hct': 'hct-tonal' };

/** The image-derived schemes (#20 PR 3), which wait until the owner's acceptance pins their record. */
const IMAGE_DERIVED = ['portfolio-artwork', 'profile-image'] as const;

/** The image-derived schemes the committed acceptance.json doesn't accept: the ones that wait. */
function waiting(): string[] {
  const accepted = JSON.parse(
    fs.readFileSync(
      path.join(REPO_ROOT, 'packages/appearance-schemes/generated/acceptance.json'),
      'utf8',
    ),
  ) as Record<string, unknown>;
  return IMAGE_DERIVED.filter((id) => !(id in accepted));
}

/**
 * The seeded packs LANG-5a retired, each with its survivor: none is in the
 * catalog, and each alias reads as its survivor, which is.
 */
const RETIRED_SCHEMES: Readonly<Record<string, string>> = {
  bookcloth: 'paper-ink',
  'earthy-clay': 'desert-terracotta',
  zinc: 'graphite',
};
const RETIRED_TYPOGRAPHY: Readonly<Record<string, string>> = {
  'literary-reading': 'editorial-serif',
};

test("every scheme ships in its approved tier, the generated four included, and an image-derived one waits until the owner's acceptance pins it", async () => {
  const read = await sources();
  const entries = catalogEntries(read).filter(({ axis }) => axis === 'colorScheme');
  assert.deepEqual(
    Object.fromEntries(
      [...read.registry.aliases!.colorScheme.values()].map(({ id, aliasOf }) => [id, aliasOf]),
    ),
    RETIRED_SCHEMES,
  );
  for (const scheme of COLOR_SCHEMES as readonly SeedEntry[]) {
    const id = RENAMED[scheme.id] ?? scheme.id;
    if (Object.hasOwn(RETIRED_SCHEMES, id)) {
      assert.equal(
        entries.find((each) => each.id === id),
        undefined,
        `${id} is retired, so the catalog lists none`,
      );
      assert.ok(
        entries.some((each) => each.id === RETIRED_SCHEMES[id] && each.status === 'shipping'),
        `${id}'s survivor ships`,
      );
      continue;
    }
    const entry = entries.find((each) => each.id === id);
    assert.ok(entry, `${id} is in the catalog`);
    assert.equal(
      entries.find((each) => each.id === scheme.id && id !== scheme.id),
      undefined,
    );
    assert.equal(entry.tier, scheme.status, `${id}'s tier`);
    const waits = waiting().includes(id);
    assert.equal(
      entry.status,
      scheme.status === 'research' ? 'research' : waits ? 'excluded' : 'shipping',
      id,
    );
    if (GENERATED_SCHEMES.has(scheme.id)) assert.equal(entry.license, 'generated', id);
  }
  assert.deepEqual(
    Object.keys(RENAMED).filter((id) => !GENERATED_SCHEMES.has(id)),
    [],
  );
  // neon-city, and each image-derived scheme the owner accepted, are the Experimental ones that ship.
  const accepted = IMAGE_DERIVED.length - waiting().length;
  assert.deepEqual(tally(entries.filter(({ status }) => status === 'shipping')), {
    // 18 seeded Stable, less earthy-clay, which LANG-5a retired.
    stable: 17,
    // The ten compositions' schemes land Extended (packs plan §2.1): signal-paper, ultramarine-ink, aurora-meadow, poster-primaries, drafting-blue, night-terminal, control-room, liquid-dusk so far. The 8 seeded Extended and the 9 compositions' each lost one to LANG-5a: zinc and bookcloth.
    extended: 7 + 8,
    experimental: 1 + accepted,
  });
  assert.deepEqual(
    tally(entries.filter(({ status }) => status === 'excluded')),
    waiting().length > 0 ? { experimental: waiting().length } : {},
  );
  assert.equal(entries.filter(({ status }) => status === 'research').length, 23);
});

test('every seeded typography profile ships in its approved tier, from OS stacks with no font file, but technical-sans-mono on Plex', async () => {
  const read = await sources();
  const entries = catalogEntries(read).filter(({ axis }) => axis === 'typography');
  // The eight seeded profiles, less literary-reading, which LANG-5a retired, and the eight font packs of packs-plan (P-2).
  assert.deepEqual(tally(entries), { stable: 6, extended: 9 });
  assert.deepEqual(
    Object.fromEntries(
      [...read.registry.aliases!.typography.values()].map(({ id, aliasOf }) => [id, aliasOf]),
    ),
    RETIRED_TYPOGRAPHY,
  );
  for (const id of [
    'screen-grotesque',
    'swiss-grotesque',
    'paste-up',
    'drafting-grotesk',
    'field-serif',
    'shell-mono',
    'console-mono',
    'book-serif',
  ]) {
    const entry = entries.find((candidate) => candidate.id === id);
    assert.equal(entry?.tier, 'extended', `${id}'s tier`);
    assert.equal(entry?.license, 'OFL-1.1', `${id}'s license`);
  }
  // Mono (b) (lead A, 2026-10-30): the seeded technical-sans-mono sets its monospace roles in
  // IBM Plex Mono, paste-up's Medium and a SemiBold for its headings, and keeps its seed's tier.
  const SELF_HOSTED_SEEDS: Readonly<Record<string, readonly (readonly [string, number])[]>> = {
    'technical-sans-mono': [
      ['IBM Plex Mono', 500],
      ['IBM Plex Mono', 600],
    ],
  };
  for (const profile of TYPOGRAPHY_PROFILES as readonly SeedEntry[]) {
    if (Object.hasOwn(RETIRED_TYPOGRAPHY, profile.id)) {
      assert.equal(
        entries.find(({ id }) => id === profile.id),
        undefined,
        `${profile.id} is retired, so the catalog lists none`,
      );
      assert.ok(read.registry.packs.typography.has(RETIRED_TYPOGRAPHY[profile.id]!));
      continue;
    }
    const entry = entries.find(({ id }) => id === profile.id);
    assert.equal(entry?.tier, profile.status, `${profile.id}'s tier`);
    const pack = read.registry.packs.typography.get(profile.id)!;
    const hosted = SELF_HOSTED_SEEDS[profile.id];
    if (hosted) {
      assert.equal(entry?.license, 'OFL-1.1', `${profile.id}'s license`);
      assert.deepEqual(
        pack.manifest.fontAssets.map(({ family, weight }) => [family, weight]),
        hosted,
        `${profile.id}'s fonts`,
      );
      continue;
    }
    assert.equal(entry?.license, 'provided-by-operating-system');
    assert.deepEqual(pack.manifest.fontAssets, []);
    assert.deepEqual(pack.fonts, []);
  }
});

/** Retired bookcloth's categorical anchors in `mode`, from its manifest, moved unchanged. */
function bookclothCloths(mode: 'light' | 'dark'): string[] {
  const manifest = JSON.parse(
    fs.readFileSync(
      path.join(REPO_ROOT, 'packages/appearance-schemes/retired/bookcloth/manifest.json'),
      'utf8',
    ),
  ) as { anchors: Record<string, { categorical: string[] }> };
  const cloths = manifest.anchors[mode]!.categorical;
  assert.equal(cloths.length, 5, `bookcloth's ${mode} cloths`);
  return cloths;
}

/**
 * The two of bookcloth's cloths LANG-5d moved in paper-ink (Q-L3, lead A,
 * 2026-10-30), by index: rust to a brick brown, apart from the claret
 * rubric, and slate tealer and more saturated, so it reads as an ink rather than
 * as text-secondary. Plum, ochre and sage are bookcloth's unchanged.
 */
const PAPER_INK_CLOTH_MOVES: Readonly<Record<'light' | 'dark', readonly string[]>> = {
  light: ['#965630', '#3e6980'],
  dark: ['#cf9771', '#6baed1'],
};

/** paper-ink's categorical anchors in `mode`: bookcloth's cloths with LANG-5d's two moves. */
function paperInkCloths(mode: 'light' | 'dark'): string[] {
  return bookclothCloths(mode).map((cloth, index) => PAPER_INK_CLOTH_MOVES[mode][index] ?? cloth);
}

/**
 * The seeded schemes LANG-5b re-anchored, apart from their LANG-4
 * neighbours (the owner's "Use all suggestions", 2026-10-29), and the modes
 * it moved, with the anchors each now has; the LANG-5b fix round re-anchored
 * forest-moss, jewel-twilight and paper-ink's light again, and
 * blue-orange-color-safe's light ink and dark, and neutral-slate in both modes
 * (apart from cool-color-safe, an owner keep), so every pair clears the line
 * in each mode. LANG-5d made paper-ink's two modes one dove-grey stock, its
 * light dimmed for dark, with a claret rubric apart from the danger red.
 * LANG-5e moved six dark grounds off the painted near-black and tinted-dark
 * clusters: arctic-aurora, botanical-sage, low-stimulus-warm, neutral-slate,
 * pastel-sorbet and sepia-film, the canvas only.
 * Every other seeded mode keeps the prototype's anchors exactly.
 */
const RE_ANCHORED: Readonly<
  Record<string, Partial<Record<'light' | 'dark', Readonly<Record<string, string>>>>>
> = {
  'arctic-aurora': {
    light: { canvas: '#d9f3ee', text: '#112a40', accent: '#2b7a2f', secondary: '#7a52c7' },
    dark: { canvas: '#03091f', text: '#e4f3ff', accent: '#86f09a', secondary: '#b79cff' },
  },
  'blue-orange-color-safe': {
    light: { canvas: '#fffaf2', text: '#2b2118', accent: '#0067b9', secondary: '#d46b08' },
    dark: { canvas: '#101c38', text: '#fff2dc', accent: '#5eb3ff', secondary: '#ffad5c' },
  },
  'botanical-sage': {
    dark: { canvas: '#1d251a', text: '#edf3ea', accent: '#91b997', secondary: '#d2a088' },
  },
  'desert-terracotta': {
    light: { canvas: '#f8e5d9', text: '#3c2820', accent: '#b55436', secondary: '#a68547' },
    dark: { canvas: '#2f1b16', text: '#f9e5d0', accent: '#e47c58', secondary: '#d1b16c' },
  },
  'forest-moss': {
    light: { canvas: '#e3ead2', text: '#1c2612', accent: '#5a6e22', secondary: '#8a6b3f' },
    dark: { canvas: '#162608', text: '#f0f0d2', accent: '#b7c95a', secondary: '#c9a066' },
  },
  'jewel-twilight': {
    light: { canvas: '#dcdcf4', text: '#150f38', accent: '#7414b8', secondary: '#047857' },
    dark: { canvas: '#22082e', text: '#e6eaff', accent: '#a64ff5', secondary: '#34d3a6' },
  },
  'low-stimulus-warm': {
    dark: { canvas: '#252620', text: '#e8e0d4', accent: '#b89c86', secondary: '#a5ad9b' },
  },
  'neutral-slate': {
    light: { canvas: '#e3e7ec', text: '#28313d', accent: '#3558c8', secondary: '#64748b' },
    dark: { canvas: '#242a34', text: '#dae1e9', accent: '#7c9cf5', secondary: '#94a3b8' },
  },
  'paper-ink': {
    light: { canvas: '#dedce7', text: '#151d33', accent: '#87133b', secondary: '#315b62' },
    dark: { canvas: '#1f1c27', text: '#efedf5', accent: '#c8536c', secondary: '#7fb0b7' },
  },
  'pastel-sorbet': {
    dark: { canvas: '#33273a', text: '#fff3fa', accent: '#f3a1c6', secondary: '#9bcfc8' },
  },
  'sepia-film': {
    dark: { canvas: '#25170b', text: '#f0d8b6', accent: '#cb7654', secondary: '#a0a77d' },
  },
};

test("seeded schemes keep the prototype anchors exactly, or LANG-5b's where it re-anchored them, and anchor-v2 replaces PR 2a's nudges", async () => {
  const read = await sources();
  for (const scheme of COLOR_SCHEMES as readonly (SeedEntry & {
    modes: Record<string, Record<string, string>>;
  })[]) {
    const pack = read.registry.packs.colorScheme.get(scheme.id);
    // A generated scheme has no anchors: its generator picks them (PR 3).
    if (!pack || pack.manifest.generator) continue;
    for (const mode of ['light', 'dark'] as const) {
      const seeded = scheme.modes[mode];
      const anchors: Readonly<Record<string, unknown>> | undefined = pack.manifest.anchors?.[mode];
      assert.equal(
        Boolean(anchors),
        Boolean(seeded),
        `${scheme.id} covers ${mode} as the seed does`,
      );
      if (!seeded || !anchors) continue;
      const expected: Record<string, unknown> = {
        ...(RE_ANCHORED[scheme.id]?.[mode] ?? {
          canvas: seeded.canvas,
          text: seeded['text-primary'],
          accent: seeded.accent,
          secondary: seeded.information,
        }),
        // paper-ink carries bookcloth's five cloths as its categorical anchors since LANG-5a, two moved by LANG-5d.
        ...(scheme.id === 'paper-ink' ? { categorical: paperInkCloths(mode) } : {}),
      };
      assert.deepEqual(anchors, expected, `${scheme.id}'s ${mode} anchors`);
    }
    assert.equal(pack.manifest.derivation, 'anchor-v2');
    // anchor-v2 is the 1.1 line; a later patch, as the `family` field's, stays on it.
    assert.match(pack.manifest.version, /^1\.1\.\d+$/, scheme.id);
    // The recorded derivation is the solver's output for these anchors.
    assert.deepEqual(
      pack.manifest.adjustments,
      anchorV2Adjustments(pack.manifest.anchors!),
      `${scheme.id}'s adjustments`,
    );
    const moves = Object.values(pack.manifest.adjustments ?? {}).reduce(
      (count, set) => count + Object.keys(set ?? {}).length,
      0,
    );
    const derivation = pack.manifest.provenance.derivation ?? '';
    assert.match(derivation, /^anchor-v2 from /, scheme.id);
    const listed = moves === 1 ? 'the role' : `the ${moves} roles`;
    assert.ok(
      derivation.endsWith(`adjustments lists ${listed} it moves from anchor-v1.`),
      scheme.id,
    );
    // 2a's light nudges are undone, and the derivation says so.
    const nudges = (
      ANCHOR_ADJUSTMENTS as unknown as Record<string, Record<string, readonly [string, string]>>
    )[scheme.id];
    for (const [role, [from, to]] of Object.entries(nudges ?? {})) {
      // A light anchor LANG-5b re-anchored no longer holds the value the nudge put back, so there's no undo to name.
      const reAnchored = RE_ANCHORED[scheme.id]?.light?.[role];
      if (reAnchored !== undefined && reAnchored !== from) continue;
      assert.ok(derivation.includes(`${role} ${to} back to ${from}`), `${scheme.id} ${role}`);
    }
    if (!nudges) assert.doesNotMatch(derivation, /PR 2a/, scheme.id);
  }
});

test('the upstream palettes keep their credit under anchor-v2, which moves derived roles only', async () => {
  const read = await sources();
  // oled-black is the one upstream palette that ships since LANG-5a retired zinc into graphite.
  assert.equal(read.registry.packs.colorScheme.get('zinc'), undefined);
  const oled = read.registry.packs.colorScheme.get('oled-black')!.manifest;
  assert.equal(oled.provenance.license, 'MIT');
  assert.match(oled.provenance.attribution, /Tailwind Labs/);
  assert.match(
    oled.provenance.derivation!,
    /Tailwind CSS v3\.4\.17 cyan-300 as the accent and purple-400 as the secondary/,
  );
  assert.match(oled.provenance.derivation!, /The anchors stay as credited/);
  assert.deepEqual(oled.anchors!.dark, {
    canvas: '#000000',
    text: '#f5f5f2',
    accent: '#67e8f9',
    secondary: '#c084fc',
  });
  for (const set of Object.values(oled.adjustments ?? {})) {
    for (const role of ['canvas', 'text-primary', 'accent', 'information'])
      assert.equal((set as Record<string, unknown>)[role], undefined, role);
  }
});

test('the defaults and the nine recipes are the review lab catalog, Shell the ninth', () => {
  assert.deepEqual({ ...PLATFORM_DEFAULTS }, { ...APPEARANCE_DEFAULTS });
  const recipes = readRecipes(REPO_ROOT);
  // The review lab's eight as the seed copied them, then the composition lanes' own: Shell (packs-plan §6).
  // Cinematic Archive named literary-reading, which LANG-5a retired, so it names the survivor,
  // editorial-serif, which is what it rendered as an alias: the same sizes, only the faces moved.
  const seeded = JSON.parse(JSON.stringify(APPEARANCE_RECIPES)) as {
    id: string;
    selection: Record<string, string>;
  }[];
  const archive = seeded.find(({ id }) => id === 'cinematic-archive')!;
  assert.equal(archive.selection.typography, 'literary-reading');
  archive.selection.typography = 'editorial-serif';
  assert.deepEqual(recipes.slice(0, 8), seeded);
  assert.deepEqual(recipes[8]?.selection, {
    variant: 'shell',
    designLanguage: 'primer-inspired',
    colorScheme: 'night-terminal',
    typography: 'shell-mono',
    displayMode: 'dark',
  });
  assert.deepEqual(
    recipes.map(({ name }) => name),
    [
      'Quiet Product',
      'Editorial Warmth',
      'Systems Clarity',
      'Night Gallery',
      'Material Portfolio',
      'Cinematic Archive',
      'Neon Maker',
      'Accessible Evidence',
      'Shell',
    ],
  );
});

test('a recipe applies as its ordinary axis ids, one query, and a diagnostic for each id the build lacks', async () => {
  const { registry } = await sources();
  for (const recipe of readRecipes(REPO_ROOT)) {
    const applied = applyRecipe(registry, recipe);
    assert.deepEqual(applied.selection, recipe.selection);
    assert.ok(roundTrips(applied), `${recipe.id}'s query reads back as its selection`);
    for (const diagnostic of applied.diagnostics) {
      assert.match(diagnostic.code, /unavailable|mode-incompatible/);
    }
  }
  const neon = applyRecipe(
    registry,
    readRecipes(REPO_ROOT).find(({ id }) => id === 'neon-maker')!,
  );
  assert.equal(
    neon.query,
    'variant=kinetic-cosmos&language=cyberpunk&scheme=neon-city&type=geometric-display&mode=dark',
  );
  // kinetic-cosmos, cyberpunk (opaque since #20 PR 2d), neon-city, and geometric-display all ship.
  assert.deepEqual(neon.diagnostics, []);
  // With the held packs, the diagnostic says held, with the reason, not that nothing registers it.
  const read = await sources();
  const reasons = new Map(
    read.held.map(({ manifest, reason }) => [`designLanguage:${manifest.id}`, reason]),
  );
  // No recipe names a held language since #20 PR 2d, so the check takes one that would.
  const recipe = readRecipes(REPO_ROOT).find(({ id }) => id === 'neon-maker')!;
  const held = applyRecipe(
    registry,
    { ...recipe, selection: { ...recipe.selection, designLanguage: 'frutiger-aero' } },
    reasons,
  );
  assert.match(
    held.diagnostics[0]!.message,
    /^names a held design language: It fails check:appearance/,
  );
  // None of the eight recipes names a held language: paper-tactile and carbon-inspired ship since
  // #20 PR 2c, and atelier-luxury and cyberpunk since PR 2d.
  const holding = readRecipes(REPO_ROOT).flatMap((recipe) =>
    reasons.has(`designLanguage:${recipe.selection.designLanguage}`)
      ? [`${recipe.id} ${recipe.selection.designLanguage}`]
      : [],
  );
  assert.deepEqual(holding, []);
});

test('the catalog query reads and writes as one URL form, and refuses what it cannot take', () => {
  const query = {
    text: '  warm  sage ',
    axis: 'colorScheme',
    tier: 'stable',
    status: 'shipping',
    license: 'first-party',
    mode: 'dark',
  } as const;
  const text = serializeCatalogQuery(query);
  assert.equal(
    text,
    'q=warm+sage&axis=scheme&tier=stable&status=shipping&license=first-party&mode=dark',
  );
  const read = parseCatalogQuery(`?${text}`);
  assert.ok(read.ok);
  assert.equal(serializeCatalogQuery(read.query), text);
  assert.deepEqual(parseCatalogQuery('axis=colorScheme'), {
    ok: true,
    query: { axis: 'colorScheme' },
  });
  assert.equal(serializeCatalogQuery({}), '');
  for (const bad of [
    'tier=research&tier=stable',
    'shade=dark',
    'tier=beta',
    'mode=system',
    'axis=variant',
    'status=pending',
    // A license filter takes the allowlist and a Research record's unverified, nothing else.
    'license=GPL-3.0',
    'license=mit',
  ]) {
    assert.equal(parseCatalogQuery(bad).ok, false, bad);
  }
  for (const good of ['license=MIT', 'license=first-party', 'license=unverified']) {
    assert.ok(parseCatalogQuery(good).ok, good);
  }
});

test("display names keep their words' own casing, not the seed's title-casing of an id", async () => {
  const entries = catalogEntries(await sources());
  const name = (id: string) => entries.find((entry) => entry.id === id)?.name;
  assert.equal(name('neutral-ui'), 'Neutral UI');
  assert.equal(name('humanist-ui'), 'Humanist UI');
  assert.equal(name('technical-sans-mono'), 'Technical Sans and Mono');
  assert.equal(name('oled-black'), 'OLED Black');
  for (const entry of entries) {
    assert.doesNotMatch(entry.name, /\b(?:Ui|Oled|Hct|Y2k|Oklch|Github)\b/, entry.id);
  }
});

test('search filters by words, axis, tier, status, license, and mode', async () => {
  const entries = catalogEntries(await sources());
  const ids = (text: string) => {
    const read = parseCatalogQuery(text);
    assert.ok(read.ok);
    return searchCatalog(entries, read.query).map(({ id }) => id);
  };
  // paper-ink names sage among the five cloths it took from bookcloth (LANG-5a), which no entry lists now.
  assert.deepEqual(ids('q=sage'), ['botanical-sage', 'paper-ink', 'warm-parchment']);
  assert.deepEqual(ids('q=bookcloth'), []);
  assert.deepEqual(ids('q=sage botanical'), ['botanical-sage']);
  assert.deepEqual(ids('license=MIT'), ['oled-black']);
  assert.equal(ids('tier=research').length, 23);
  assert.ok(ids('axis=scheme&mode=light').every((id) => id !== 'oled-black' && id !== 'neon-city'));
  assert.deepEqual(ids('axis=scheme&tier=experimental'), [
    'neon-city',
    'portfolio-artwork',
    'profile-image',
  ]);
  // The image-derived schemes the owner hasn't accepted wait (#20 PR 3).
  assert.deepEqual(ids('status=excluded'), waiting());
  assert.equal(ids('status=held').length, 5);
  assert.deepEqual(ids('q=refractive&status=held'), ['refractive-glass', 'holographic-iridescent']);
  assert.deepEqual(ids('q=nord&status=research'), ['nord']);
  assert.deepEqual(ids('q=nothing-matches-this'), []);
  assert.equal(ids('').length, entries.length);
  // Stable first, then Extended, Experimental, and Research, within each axis.
  const tiers = searchCatalog(entries, { axis: 'colorScheme' }).map(({ tier }) => tier);
  assert.deepEqual([...new Set(tiers)], ['stable', 'extended', 'experimental', 'research']);
});

test('show gives the provenance, and an unavailable id its reason or the resolver diagnostic', async () => {
  const read = await sources();
  const entries = catalogEntries(read);
  // oled-black, the upstream palette that ships since LANG-5a retired zinc.
  const oled = unavailable(read.registry, entries, 'oled-black').join('\n');
  assert.match(oled, /Tier: Extended/);
  assert.match(
    oled,
    /Source: Tailwind CSS v3\.4\.17 colors, https:\/\/github\.com\/tailwindlabs\/tailwindcss\/blob\/v3\.4\.17\/src\/public\/colors\.js/,
  );
  assert.match(oled, /Version: 1\.1\.\d+\n/);
  assert.match(oled, /License: MIT/);
  assert.match(oled, /Attribution: Tailwind Labs/);
  assert.match(oled, /Copyright: Copyright \(c\) Tailwind Labs, Inc\./);
  assert.match(oled, /Status: shipping/);
  // A retired id gets its alias notice on its own axis, and each other axis's diagnostic.
  assert.deepEqual(unavailable(read.registry, entries, 'zinc'), [
    "design language: appearance.unavailable, zinc names a design language this build doesn't register.",
    'color scheme: appearance.alias, zinc is now graphite; at the merge, its violet second color became copper brown, and its dark mode a slightly lighter charcoal.',
    "typography profile: appearance.unavailable, zinc names a typography profile this build doesn't register.",
  ]);
  assert.match(
    unavailable(read.registry, entries, 'literary-reading')[2]!,
    /^typography profile: appearance\.alias, literary-reading was merged into editorial-serif and follows its updates; at the merge, /,
  );
  const nord = unavailable(read.registry, entries, 'nord').join('\n');
  assert.match(nord, /Tier: Research/);
  assert.match(nord, /never registered, selectable, published, exported, or bundled/);
  assert.match(nord, /License: unverified/);
  const unknown = unavailable(read.registry, entries, 'no-such-pack');
  assert.equal(unknown.length, 3);
  for (const line of unknown) assert.match(line, /appearance\.unavailable, no-such-pack names a/);
  assert.deepEqual(unavailable(read.registry, entries, 'Not An Id'), [
    "Not An Id isn't a pack id.",
  ]);
});

test('an excluded pack is listed with the reason the build left it out', async () => {
  const read = await sources();
  const warm = read.registry.packs.colorScheme.get('warm-parchment')!;
  const manifest = {
    ...warm.manifest,
    id: 'left-out',
    name: 'Left Out',
    provenance: { ...warm.manifest.provenance, license: 'GPL-3.0' },
  } as PackManifest;
  const reason = "its license, GPL-3.0, isn't one a pack may ship under.";
  const entries = catalogEntries({
    ...read,
    excluded: [
      {
        pack: {
          kind: 'color-scheme',
          id: 'left-out',
          packageName: '@acme/schemes',
          reason,
        },
        manifest,
      },
    ],
  });
  const [entry] = searchCatalog(entries, { status: 'excluded' });
  assert.equal(entry?.id, 'left-out');
  assert.match(
    formatEntry(entry as CatalogEntry).join('\n'),
    /excluded from this build: its license, GPL-3\.0/,
  );
});

const scheme = (
  overrides: Partial<ColorSchemeManifest> & Pick<ColorSchemeManifest, 'id' | 'name'>,
) =>
  ({
    description: 'A test scheme.',
    tier: 'extended',
    provenance: {
      source: { name: 'Test', url: 'https://example.com' },
      license: 'first-party',
      attribution: 'Test.',
      researchedAt: '2026-10-23',
      maintainer: 'test',
    },
    anchors: {
      light: { canvas: '#ffffff', text: '#000000', accent: '#123456', secondary: '#654321' },
    },
    ...overrides,
  }) as unknown as PackManifest;

const research: ResearchRecord = {
  id: 'nord',
  name: 'Nord',
  kind: 'color-scheme',
  tier: 'research',
  source: { name: 'Nord', url: 'https://github.com/nordtheme/nord' },
  license: 'unverified',
  researchedAt: '2026-10-17',
  reason: 'Unverified.',
  anchors: {
    dark: { canvas: '#2e3440', text: '#eceff4', accent: '#88c0d0', secondary: '#b48ead' },
  },
};

const audit = (packs: AuditInput['packs'], reviewed?: AuditInput['reviewed']) =>
  auditCatalog({ packs, research: [research], reviewed: reviewed ?? {} }).findings.map(
    ({ pack, rule }) => `${pack} ${rule}`,
  );

test('the branded-name audit passes the shipping catalog', async () => {
  const read = await sources();
  // Every shipping and held pack, and every Research record.
  const report = auditCatalog({
    packs: [
      ...read.packs.filter(({ fixture }) => !fixture),
      ...read.held.map(({ kind, manifest }) => ({ kind, manifest })),
    ],
    research: read.research.map(({ record }) => record),
  });
  assert.deepEqual(report.findings, []);
  // The 81 registered packs besides the image-derived schemes (89 less LANG-1's four
  // retired languages and LANG-5a's three schemes and one typography profile, which ship
  // nothing to audit), each of those the owner accepted (#20 PR 3; the others wait,
  // unregistered), 5 held, and 23 Research.
  assert.equal(report.entries.length, 81 + (IMAGE_DERIVED.length - waiting().length) + 5 + 23);
  const aero = report.entries.find(({ id }) => id === 'frutiger-aero')!;
  assert.deepEqual(aero.names, ['Aero', 'Frutiger']);
  assert.ok(aero.notes.every((note) => note.includes('reviewed')));
  for (const id of Object.keys({ ...RETIRED_SCHEMES, ...RETIRED_TYPOGRAPHY })) {
    assert.equal(
      report.entries.find((each) => each.id === id),
      undefined,
      `${id} is audited`,
    );
  }
  const oled = report.entries.find(({ id }) => id === 'oled-black')!;
  assert.equal(oled.status, 'upstream');
  assert.deepEqual(oled.names, ['Tailwind']);
  // The Tailwind-derived scheme that ships carries Tailwind CSS v3.4.17's values, credited under MIT.
  for (const id of ['oled-black']) {
    const entry = report.entries.find((each) => each.id === id)!;
    assert.equal(entry.license, 'MIT', id);
    assert.ok(
      entry.notes.some((note) => /carries .* credited under MIT\./.test(note)),
      id,
    );
  }
  // neutral-slate shares one Tailwind anchor a mode, under the threshold, and says so.
  const slate = report.entries.find(({ id }) => id === 'neutral-slate')!;
  assert.equal(slate.status, 'first-party');
  assert.deepEqual(
    slate.notes.filter((note) => /under the 2-anchor threshold/.test(note)).length,
    2,
  );
});

test('the audit refuses an upstream palette carried without its license, copyright, and credit', () => {
  const kind = 'color-scheme' as const;
  // cyan-300 and purple-400, Tailwind CSS v3's, in one mode.
  const anchors = {
    dark: { canvas: '#000000', text: '#f5f5f2', accent: '#67e8f9', secondary: '#c084fc' },
  };
  assert.deepEqual(
    audit([{ kind, manifest: scheme({ id: 'night-pop', name: 'Night Pop', anchors }) }]),
    ['night-pop upstream-palette'],
  );
  const credited = {
    source: { name: 'Tailwind CSS v3.4.17 colors', url: 'https://example.com' },
    license: 'MIT',
    attribution: 'Tailwind Labs, Inc.',
    copyright: 'Copyright (c) Tailwind Labs, Inc.',
    researchedAt: '2026-10-23',
    maintainer: 'test',
  };
  assert.deepEqual(
    audit([
      {
        kind,
        manifest: scheme({ id: 'night-pop', name: 'Night Pop', anchors, provenance: credited }),
      },
    ]),
    [],
  );
  // Without the copyright line, the credit isn't complete.
  const { copyright: _copyright, ...uncopied } = credited;
  void _copyright;
  assert.deepEqual(
    audit([
      {
        kind,
        manifest: scheme({ id: 'night-pop', name: 'Night Pop', anchors, provenance: uncopied }),
      },
    ]),
    ['night-pop upstream-palette'],
  );
  // One shared anchor is under the threshold.
  const one = { dark: { ...anchors.dark, secondary: '#123456' } };
  assert.deepEqual(
    audit([{ kind, manifest: scheme({ id: 'night-pop', name: 'Night Pop', anchors: one }) }]),
    [],
  );
});

test("the palette audit reads anchor-v2's emphasis and categorical anchors too (S1)", () => {
  const kind = 'color-scheme' as const;
  const own = { canvas: '#000000', text: '#f5f5f2', accent: '#123456', secondary: '#654321' };
  // Tailwind CSS v3's cyan-300 and purple-400, carried through the new anchors alone.
  for (const anchors of [
    { dark: { ...own, categorical: ['#67e8f9', '#c084fc'] } },
    { dark: { ...own, emphasis: '#67e8f9', categorical: ['#c084fc'] } },
  ]) {
    assert.deepEqual(
      audit([
        {
          kind,
          manifest: scheme({
            id: 'night-pop',
            name: 'Night Pop',
            anchors,
            derivation: 'anchor-v2',
          }),
        },
      ]),
      ['night-pop upstream-palette'],
      JSON.stringify(anchors.dark),
    );
  }
  // A Research record's palette, carried through categorical anchors.
  const nord = {
    dark: { ...own, categorical: ['#88c0d0', '#b48ead'] },
  };
  assert.deepEqual(
    audit([
      {
        kind,
        manifest: scheme({
          id: 'arctic-night',
          name: 'Arctic Night',
          anchors: nord,
          derivation: 'anchor-v2',
        }),
      },
    ]),
    ['arctic-night research-palette'],
  );
  // An authored set's own emphasis, when it isn't its accent, as poster-primaries authors one.
  const authored = {
    canvas: '#000000',
    'text-primary': '#f5f5f2',
    accent: '#67e8f9',
    information: '#123456',
    emphasis: '#c084fc',
  } as unknown as ColorSchemeManifest['dark'];
  assert.deepEqual(
    audit([
      {
        kind,
        manifest: scheme({
          id: 'night-pop',
          name: 'Night Pop',
          anchors: undefined,
          dark: authored,
        }),
      },
    ]),
    ['night-pop upstream-palette'],
  );
  // One color given as two anchors counts once.
  const once = { dark: { ...own, accent: '#67e8f9', emphasis: '#67e8f9' } };
  assert.deepEqual(
    audit([{ kind, manifest: scheme({ id: 'night-pop', name: 'Night Pop', anchors: once }) }]),
    [],
  );
});

test('the branded-name audit refuses a brand named outside an inspired label or its license', () => {
  const kind = 'color-scheme' as const;
  assert.deepEqual(audit([{ kind, manifest: scheme({ id: 'nord-night', name: 'Nord Night' }) }]), [
    'nord-night branded-name',
  ]);
  assert.deepEqual(
    audit([
      {
        kind,
        manifest: scheme({ id: 'carbon-grey', name: 'Grey', description: 'After IBM Carbon.' }),
      },
    ]),
    ['carbon-grey branded-name', 'carbon-grey uncredited-name', 'carbon-grey uncredited-name'],
  );
  // An upstream adaptation that credits the brand passes, and so does an inspired one.
  assert.deepEqual(
    audit([
      {
        kind,
        manifest: scheme({
          id: 'tailwind-slate',
          name: 'Tailwind Slate',
          description: 'Tailwind slate.',
          provenance: {
            source: { name: 'Tailwind CSS colors', url: 'https://tailwindcss.com/docs/colors' },
            license: 'MIT',
            attribution: 'Tailwind Labs, Inc.',
            researchedAt: '2026-10-23',
            maintainer: 'test',
          },
        }),
      },
      {
        kind: 'design-language',
        manifest: {
          ...scheme({
            id: 'carbon-inspired',
            name: 'Carbon Inspired',
            description: 'After Carbon.',
          }),
          provenance: {
            source: { name: 'Carbon Design System', url: 'https://carbondesignsystem.com' },
            license: 'independent-inspired-interpretation',
            attribution: 'After IBM Carbon.',
            researchedAt: '2026-10-23',
            maintainer: 'test',
          },
        } as PackManifest,
      },
    ]),
    [],
  );
  // Words that only contain a term aren't the term.
  assert.deepEqual(
    audit([
      {
        kind,
        manifest: scheme({
          id: 'interface-grey',
          name: 'Interface Grey',
          description: 'Nordic carbonate.',
        }),
      },
    ]),
    [],
  );
});

test("the branded-name audit refuses a Research record's palette under another name", () => {
  const manifest = scheme({
    id: 'arctic-night',
    name: 'Arctic Night',
    anchors: {
      dark: { canvas: '#2e3440', text: '#eceff4', accent: '#81a1c1', secondary: '#a3be8c' },
    },
  });
  assert.deepEqual(audit([{ kind: 'color-scheme', manifest }]), ['arctic-night research-palette']);
  const one = scheme({
    id: 'arctic-day',
    name: 'Arctic Day',
    anchors: {
      dark: { canvas: '#2e3440', text: '#ffffff', accent: '#81a1c1', secondary: '#a3be8c' },
    },
  });
  assert.deepEqual(audit([{ kind: 'color-scheme', manifest: one }]), []);
});

test('the typeface rule refuses a language naming a typeface in its tokens or its stylesheet', () => {
  const language = (tokens: Record<string, string>) =>
    ({
      id: 'glass-ink',
      name: 'Glass Ink',
      description: 'A test language.',
      tier: 'extended',
      provenance: {
        source: { name: 'Test', url: 'https://example.com' },
        license: 'first-party',
        attribution: 'Test.',
        researchedAt: '2026-10-23',
        maintainer: 'test',
      },
      tokens,
    }) as unknown as PackManifest;
  const kind = 'design-language' as const;
  const clean = language({ texture: 'none' });
  assert.deepEqual(audit([{ kind, manifest: clean }]), []);
  assert.deepEqual(
    audit([
      { kind, manifest: clean, stylesheetText: '[data-ui-slot="action"]{border-radius:2px}' },
    ]),
    [],
  );
  // A token that names one.
  assert.deepEqual(
    audit([{ kind, manifest: language({ texture: 'none', note: 'Frutiger LT' }) }]),
    ['glass-ink typeface-reference'],
  );
  // A stylesheet that names one, in any case.
  assert.deepEqual(
    audit([
      {
        kind,
        manifest: clean,
        stylesheetText: '[data-ui-slot="action"]{font-family:"Frutiger LT", sans-serif}',
      },
    ]),
    ['glass-ink typeface-reference'],
  );
  assert.deepEqual(
    audit([
      { kind, manifest: clean, stylesheetText: '[data-ui-slot="action"]{font-family:helvetica}' },
    ]),
    ['glass-ink typeface-reference'],
  );
  // The pack's own id, in its boundary selector, isn't a reference.
  assert.deepEqual(
    audit(
      [
        {
          kind,
          manifest: { ...clean, id: 'frutiger-aero' } as PackManifest,
          stylesheetText: '@scope ([data-design-language="frutiger-aero"]) {}',
        },
      ],
      { 'frutiger-aero': { Frutiger: 'reviewed', Aero: 'reviewed' } },
    ),
    [],
  );
});

test('the branded-name audit refuses a profile named for a typeface it references, and stale reviews', () => {
  const profile = {
    id: 'futura-display',
    name: 'Futura Display',
    description: 'Geometric headings.',
    tier: 'extended',
    provenance: {
      source: { name: 'Test', url: 'https://example.com' },
      license: 'provided-by-operating-system',
      attribution: 'Test.',
      researchedAt: '2026-10-23',
      maintainer: 'test',
    },
    roles: { display: { 'font-family': 'Futura, "Century Gothic", sans-serif' } },
  } as unknown as TypographyManifest;
  assert.deepEqual(audit([{ kind: 'typography', manifest: profile }]), [
    'futura-display branded-name',
    'futura-display typeface-name',
  ]);
  assert.deepEqual(
    audit([{ kind: 'typography', manifest: profile }], {
      'futura-display': { Futura: 'a test exception' },
    }),
    [],
  );
  assert.deepEqual(audit([], { 'gone-pack': { Futura: 'nothing matches it anymore' } }), [
    'gone-pack stale-review',
  ]);
});

test('a recipe for a composition still in progress is kept in the file and left out of the offer, until it is ready (A2)', () => {
  const recipes = readRecipes(REPO_ROOT);
  const offered = offeredRecipes(recipes);
  // Every recipe's composition is ready now: shell's Shell (Shell P2) and neon-maker's Kinetic
  // Cosmos (KC P2), so the file is offered whole.
  assert.deepEqual(
    recipes.filter((recipe) => !offered.includes(recipe)).map(({ id }) => id),
    [],
  );
  assert.equal(offered.length, recipes.length);
  // Any recipe whose composition is ready is offered as the file has it.
  const ready = {
    ...recipes[0]!,
    id: 'ready',
    selection: { ...recipes[0]!.selection, variant: 'obsidian-atelier' },
  };
  const pending = {
    ...ready,
    id: 'pending',
    selection: { ...ready.selection, variant: 'flux' },
  };
  // Every first-party composition is ready (Flux, the last, flipped): both are offered with the
  // ledger's statuses, and the one in progress is held back with a ledger that has one (A2).
  assert.deepEqual(
    offeredRecipes([ready, pending]).map(({ id }) => id),
    ['ready', 'pending'],
  );
  assert.deepEqual(
    offeredRecipes([ready, pending], (id) => (id === 'flux' ? 'pending' : 'ready')).map(
      ({ id }) => id,
    ),
    ['ready'],
  );
});
