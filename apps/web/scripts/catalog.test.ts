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

test('every hand-authored scheme ships in its approved tier, and the generated four wait for PR 3', async () => {
  const entries = catalogEntries(await sources()).filter(({ axis }) => axis === 'colorScheme');
  const shipping = entries.filter(({ status }) => status === 'shipping');
  for (const scheme of COLOR_SCHEMES as readonly SeedEntry[]) {
    const entry = entries.find(({ id }) => id === scheme.id);
    if (GENERATED_SCHEMES.has(scheme.id)) {
      assert.equal(entry, undefined, `${scheme.id} is a generated scheme, seeded in PR 3`);
      continue;
    }
    assert.ok(entry, `${scheme.id} is in the catalog`);
    assert.equal(entry.tier, scheme.status, `${scheme.id}'s tier`);
    assert.equal(entry.status, scheme.status === 'research' ? 'research' : 'shipping');
  }
  assert.deepEqual(tally(shipping), { stable: 18, extended: 6, experimental: 1 });
  assert.equal(entries.filter(({ status }) => status === 'research').length, 23);
});

test('every typography profile ships in its approved tier, from OS stacks with no font file', async () => {
  const read = await sources();
  const entries = catalogEntries(read).filter(({ axis }) => axis === 'typography');
  assert.deepEqual(tally(entries), { stable: 6, extended: 2 });
  for (const profile of TYPOGRAPHY_PROFILES as readonly SeedEntry[]) {
    const entry = entries.find(({ id }) => id === profile.id);
    assert.equal(entry?.tier, profile.status, `${profile.id}'s tier`);
    assert.equal(entry?.license, 'provided-by-operating-system');
    const pack = read.registry.packs.typography.get(profile.id)!;
    assert.deepEqual(pack.manifest.fontAssets, []);
    assert.deepEqual(pack.fonts, []);
  }
});

test("seeded schemes keep the prototype anchors exactly, and anchor-v2 replaces PR 2a's nudges", async () => {
  const read = await sources();
  for (const scheme of COLOR_SCHEMES as readonly (SeedEntry & {
    modes: Record<string, Record<string, string>>;
  })[]) {
    const pack = read.registry.packs.colorScheme.get(scheme.id);
    if (!pack) continue;
    for (const mode of ['light', 'dark'] as const) {
      const seeded = scheme.modes[mode];
      const anchors: Record<string, string> | undefined = pack.manifest.anchors?.[mode];
      assert.equal(
        Boolean(anchors),
        Boolean(seeded),
        `${scheme.id} covers ${mode} as the seed does`,
      );
      if (!seeded || !anchors) continue;
      const expected: Record<string, string | undefined> = {
        canvas: seeded.canvas,
        text: seeded['text-primary'],
        accent: seeded.accent,
        secondary: seeded.information,
      };
      assert.deepEqual(anchors, expected, `${scheme.id}'s ${mode} anchors`);
    }
    assert.equal(pack.manifest.derivation, 'anchor-v2');
    assert.equal(pack.manifest.version, '1.1.0', scheme.id);
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
      assert.ok(derivation.includes(`${role} ${to} back to ${from}`), `${scheme.id} ${role}`);
    }
    if (!nudges) assert.doesNotMatch(derivation, /PR 2a/, scheme.id);
  }
});

test('the upstream palettes keep their credit under anchor-v2, which moves derived roles only', async () => {
  const read = await sources();
  const zinc = read.registry.packs.colorScheme.get('zinc')!.manifest;
  assert.equal(zinc.provenance.license, 'MIT');
  assert.match(zinc.provenance.attribution, /Tailwind Labs/);
  assert.match(zinc.provenance.derivation!, /Tailwind CSS v3\.4\.17 zinc-50, zinc-900, zinc-600/);
  assert.match(zinc.provenance.derivation!, /The anchors stay as credited/);
  assert.deepEqual(zinc.anchors!.light, {
    canvas: '#fafafa',
    text: '#18181b',
    accent: '#52525b',
    secondary: '#7c3aed',
  });
  for (const set of Object.values(zinc.adjustments ?? {})) {
    for (const role of ['canvas', 'text-primary', 'accent', 'information'])
      assert.equal((set as Record<string, unknown>)[role], undefined, role);
  }
});

test('the defaults and the eight recipes are the review lab catalog', () => {
  assert.deepEqual({ ...PLATFORM_DEFAULTS }, { ...APPEARANCE_DEFAULTS });
  const recipes = readRecipes(REPO_ROOT);
  assert.deepEqual(recipes, JSON.parse(JSON.stringify(APPEARANCE_RECIPES)));
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
  assert.deepEqual(ids('q=sage'), ['botanical-sage', 'warm-parchment']);
  assert.deepEqual(ids('q=sage botanical'), ['botanical-sage']);
  assert.deepEqual(ids('license=MIT'), ['oled-black', 'zinc']);
  assert.equal(ids('tier=research').length, 23);
  assert.ok(ids('axis=scheme&mode=light').every((id) => id !== 'oled-black' && id !== 'neon-city'));
  assert.deepEqual(ids('axis=scheme&tier=experimental'), ['neon-city']);
  assert.deepEqual(ids('status=excluded'), []);
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
  const zinc = unavailable(read.registry, entries, 'zinc').join('\n');
  assert.match(zinc, /Tier: Extended/);
  assert.match(
    zinc,
    /Source: Tailwind CSS v3\.4\.17 colors, https:\/\/github\.com\/tailwindlabs\/tailwindcss\/blob\/v3\.4\.17\/src\/public\/colors\.js/,
  );
  assert.match(zinc, /Version: 1\.1\.0/);
  assert.match(zinc, /License: MIT/);
  assert.match(zinc, /Attribution: Tailwind Labs/);
  assert.match(zinc, /Copyright: Copyright \(c\) Tailwind Labs, Inc\./);
  assert.match(zinc, /Status: shipping/);
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
  assert.equal(report.entries.length, 46 + 27 + 23);
  const aero = report.entries.find(({ id }) => id === 'frutiger-aero')!;
  assert.deepEqual(aero.names, ['Aero', 'Frutiger']);
  assert.ok(aero.notes.every((note) => note.includes('reviewed')));
  const zinc = report.entries.find(({ id }) => id === 'zinc')!;
  assert.equal(zinc.status, 'upstream');
  assert.deepEqual(zinc.names, ['Tailwind']);
  // Both Tailwind-derived schemes carry Tailwind CSS v3.4.17's values, credited under MIT.
  for (const id of ['zinc', 'oled-black']) {
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
