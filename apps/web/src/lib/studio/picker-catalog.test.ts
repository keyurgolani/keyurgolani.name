import assert from 'node:assert/strict';
import test from 'node:test';
import { COMPOSITION_FAMILIES } from '@portfolio/variant-contract/studio-catalog';
import { EXCLUDED_PACKS } from '~/lib/generated/excluded-packs';
import { appearanceCatalog } from '~/server/studio-appearance';
import type { CatalogOption } from './appearance';
import { FAMILIES, familyCounts } from './catalog-filter';
import {
  ACCESSIBLE_CHARACTER,
  COMPOSITION_FAMILY,
  compositionFamilyCounts,
  compositionOptions,
  readyFirst,
  schemePlacement,
  typeRowOf,
  UPCOMING_COMPOSITIONS,
} from './picker-catalog';
import { offeredRecipes } from './recipes';
import {
  TYPE_STILL_TEXT,
  typeStillsByPack,
  typeStyleOf,
  withoutFamilies,
  type TypeStillRecord,
  type TypeStillRef,
  type TypeStills,
} from './type-stills';
import typeStillRecord from '../../../studio-stills/type/stills.json' with { type: 'json' };

// The grown pickers' data (P-5): the counts and families the round 5b
// mockups draw, held to the catalog this build has.

const catalog = appearanceCatalog();
const axis = (id: string) => catalog.axes.find((entry) => entry.axis === id)!;

const option = (id: string, extra: Partial<CatalogOption> = {}): CatalogOption => ({
  id,
  name: id,
  description: null,
  tier: null,
  provenance: [],
  performance: null,
  access: null,
  status: 'ready',
  statusLabel: null,
  ...extra,
});

test('the composition families are the picker chips, and every listed composition has one', () => {
  assert.deepEqual(
    FAMILIES.variant.map(({ id }) => id),
    [...COMPOSITION_FAMILIES],
  );
  for (const each of compositionOptions(catalog)) {
    assert.equal(each.family, COMPOSITION_FAMILY[each.id], each.id);
  }
});

test('the composition picker lists the 15, ready first, the ones in progress disabled with nothing to draw', () => {
  const options = compositionOptions(catalog);
  const ids = options.map(({ id }) => id);
  assert.equal(new Set(ids).size, ids.length, 'no composition is listed twice');
  assert.equal(options.length, 15);
  assert.equal(
    options.find(({ id }) => id === 'flux')?.family,
    'stage',
    'flux, registered, in the stage family',
  );
  assert.ok(!ids.includes('fallback'), 'the fallback composition is no selection');
  assert.ok(
    options.some(({ status }) => status !== 'pending'),
    'something is ready',
  );
  // Every ready composition before every one in progress, none in progress included (every
  // first-party one is ready now; the synthetic cases below hold the order with some).
  const held = options.map(({ status }) => status === 'pending');
  assert.deepEqual(
    held,
    [...held].sort(),
    'every ready composition comes before every one in progress',
  );
  for (const each of options) {
    assert.ok(each.family, `${each.id} has a family`);
    if (each.status === 'pending') assert.equal(each.statusLabel, 'In progress', each.id);
  }
  // The registered ones are the catalog's own, so the picker invents nothing about them.
  const registered = axis('variant').options;
  for (const each of registered) {
    assert.deepEqual(
      { ...options.find(({ id }) => id === each.id)!, family: undefined },
      { ...each, family: undefined },
    );
  }
  // An upcoming one has no drawing, still, performance line or access line to show. One a
  // package has registered is the catalog's, listed in its place, so it's held above instead.
  for (const { id } of UPCOMING_COMPOSITIONS.filter(
    (entry) => !registered.some((each) => each.id === entry.id),
  )) {
    const upcoming = options.find((each) => each.id === id)!;
    assert.equal(upcoming.status, 'pending');
    assert.equal(upcoming.still, null);
    assert.equal(upcoming.performance, null);
    assert.ok(upcoming.signature, `${id} says its idiom`);
  }
});

test('the composition chips count ready compositions only, add up to All, and a family with none ready has no chip', () => {
  const options = compositionOptions(catalog);
  const [all, ...families] = compositionFamilyCounts(options);
  const ready = options.filter(({ status }) => status !== 'pending');
  assert.equal(all!.count, ready.length);
  assert.equal(
    families.reduce((sum, family) => sum + family.count, 0),
    all!.count,
  );
  for (const family of FAMILIES.variant) {
    const count = ready.filter((each) => each.family === family.id).length;
    const chip = families.find(({ id }) => id === family.id);
    assert.equal(chip?.count ?? 0, count, family.id);
    if (count === 0) assert.equal(chip, undefined, `${family.id} has nothing ready, so no chip`);
  }
  // Synthetic: a family whose only composition is in progress has no chip.
  assert.deepEqual(
    compositionFamilyCounts([
      option('a', { family: 'print' }),
      option('b', { family: 'technical', status: 'pending', statusLabel: 'In progress' }),
      option('c', { family: 'stage' }),
      option('d', { family: 'stage' }),
    ]).map(({ id, count }) => `${id} ${count}`),
    ['all 3', 'print 1', 'stage 2'],
  );
});

test('an upcoming composition a build registers is listed once, as the registered one, in its place', () => {
  const [first, ...others] = UPCOMING_COMPOSITIONS;
  const registered = option(first!.id, {
    name: `${first!.name}, registered`,
    signature: 'Its own',
  });
  const options = compositionOptions({
    axes: [{ axis: 'variant', label: 'Composition', fallback: 'fallback', options: [registered] }],
  });
  const listed = options.filter(({ id }) => id === first!.id);
  assert.equal(listed.length, 1, `${first!.id} is listed once`);
  // The registered option, as the catalog has it, keeping its family: never the upcoming entry.
  assert.deepEqual(listed[0], { ...registered, family: COMPOSITION_FAMILY[first!.id] });
  // The other upcoming ones stay in progress after it.
  assert.deepEqual(
    options.map(({ id, status }) => `${id} ${status}`),
    [`${first!.id} ready`, ...others.map(({ id }) => `${id} pending`)],
  );
});

test('ready first keeps each group in its own order', () => {
  const pending = { status: 'pending' as const };
  const ready = { status: 'ready' as const };
  assert.deepEqual(
    readyFirst([
      { id: 1, ...pending },
      { id: 2, ...ready },
      { id: 3, ...pending },
      { id: 4, ...ready },
    ]).map(({ id }) => id),
    [2, 4, 1, 3],
  );
});

test('the recipes offered are only those whose composition is ready, and none names an upcoming one', () => {
  const recipes = offeredRecipes(catalog);
  const ready = new Set(
    compositionOptions(catalog)
      .filter(({ status }) => status !== 'pending')
      .map(({ id }) => id),
  );
  assert.ok(recipes.length > 0);
  for (const recipe of recipes) assert.ok(ready.has(recipe.selection.variant), recipe.id);
});

test('the pack pickers offer 33 languages, 34 schemes and 15 typography packs, and a retired id is never an option or a count', () => {
  const counts = Object.fromEntries(
    ['designLanguage', 'colorScheme', 'typography'].map((id) => [id, axis(id).options.length]),
  );
  // After LANG-5a: three schemes and one typography pack retired as aliases, and an image-derived
  // scheme waiting for the owner's acceptance (#20), which isn't offered until then.
  assert.deepEqual(counts, { designLanguage: 33, colorScheme: 34, typography: 15 });
  const offered = new Set(axis('colorScheme').options.map(({ id }) => id));
  for (const pack of EXCLUDED_PACKS.filter(({ kind }) => kind === 'color-scheme')) {
    assert.ok(!offered.has(pack.id), `${pack.id} is left out of the build, and not offered`);
  }
  for (const id of ['designLanguage', 'colorScheme', 'typography'] as const) {
    const entry = axis(id);
    const ids = new Set(entry.options.map((each) => each.id));
    for (const alias of Object.keys(entry.aliases ?? {})) {
      assert.ok(!ids.has(alias), `${id} lists the retired ${alias}`);
    }
  }
  // The language chips add up to the 33, with no retired id among them.
  const [all] = familyCounts('designLanguage', axis('designLanguage').options);
  assert.equal(all!.count, 33);
  assert.ok(
    Object.keys(axis('designLanguage').aliases ?? {}).length > 0,
    'the build has retired languages',
  );
});

test('every scheme sits on the one-axis chips or in Generated, and an Accessible one keeps its tag (ruling Q2)', () => {
  const schemes = axis('colorScheme').options;
  for (const scheme of schemes) {
    const placed = schemePlacement(scheme);
    assert.ok(placed.generated || placed.character, `${scheme.id} has a character or is generated`);
    assert.equal(placed.accessible, scheme.family === 'accessible', scheme.id);
  }
  // Each Accessible scheme this module gives a character is a scheme the build has, filed Accessible.
  for (const id of Object.keys(ACCESSIBLE_CHARACTER)) {
    assert.equal(schemes.find((each) => each.id === id)?.family, 'accessible', id);
  }
});

test("a system pack never gets a still and says System font; a self-hosted pack shows the stills the record lists, and none until they're shot", () => {
  const packs = axis('typography').options;
  const rows = packs.map((pack) => [pack, typeRowOf(pack)!] as const);
  const hosted = rows.filter(([, row]) => row.source === 'self-hosted');
  const system = rows.filter(([, row]) => row.source === 'system');
  // technical-sans-mono self-hosts IBM Plex Mono 500 and 600 (Mono (b), lead A, 2026-10-30).
  assert.equal(hosted.length, 9);
  assert.equal(system.length, 6);
  for (const [pack, row] of system) {
    assert.equal(row.stills, null, pack.id);
    assert.equal(row.label, 'System font', pack.id);
    assert.equal(
      row.source === 'system' && row.stack,
      pack.specimen?.kind === 'type' && pack.specimen.display,
    );
  }
  const record = typeStillRecord as TypeStillRecord;
  const recorded = new Set(record.stills.map(({ pack }) => pack));
  for (const [pack, row] of hosted) {
    const style = typeStyleOf(pack.specimen?.kind === 'type' ? pack.specimen.display : '');
    assert.equal(row.style, style, pack.id);
    // Both stills when the record lists them, else none: never a web font in their place.
    assert.equal(row.stills !== null, recorded.has(pack.id), pack.id);
  }
  // A system specimen's row ignores any still it's handed: it sets its own stack.
  const handed = typeRowOf(
    option('system-pack', {
      specimen: {
        kind: 'type',
        display: 'Georgia, serif',
        body: 'Georgia, serif',
        displayWeight: '700',
        style: 'serif',
        source: 'system',
        stills: typeStillsByPack(SHOT, NAMES).get('swiss-grotesque')!,
      },
    }),
  )!;
  assert.equal(handed.stills, null);
});

/** A shot record of one pack, for the stills a row draws. */
const SHOT = {
  stills: (['aa', 'line'] as const).map((role) => ({
    pack: 'swiss-grotesque',
    role,
    file: `swiss-grotesque.${role}.png`,
    text: TYPE_STILL_TEXT[role],
    width: role === 'aa' ? 40 : 124,
    height: role === 'aa' ? 34 : 18,
    pixelWidth: role === 'aa' ? 80 : 248,
    pixelHeight: role === 'aa' ? 68 : 36,
    bytes: 1000,
    sha256: `${role === 'aa' ? 'a' : 'b'}`.repeat(64),
    face: {
      role: role === 'aa' ? 'display' : 'body',
      family: 'Archivo',
      weight: 900,
      style: 'normal' as const,
      tracking: '-0.03em',
    },
    sources: [],
  })),
};
const NAMES = { 'swiss-grotesque': { name: 'Swiss Grotesque', style: 'sans' as const } };

test('a still is sized in rem from its CSS size, served at its hashed name, with the pack, the role it shows and its character as alt', () => {
  const stills: TypeStills = typeStillsByPack(SHOT, NAMES).get('swiss-grotesque')!;
  assert.deepEqual(stills.aa, {
    url: `/_portfolio/studio/swiss-grotesque-aa.${'a'.repeat(12)}.png`,
    widthRem: 2.5,
    heightRem: 34 / 16,
    bytes: 1000,
    alt: 'Swiss Grotesque: its display face, sans',
    face: 'display',
    caption: 'its display face',
  } satisfies TypeStillRef);
  assert.equal(stills.line.alt, 'Swiss Grotesque: its body face, sans');
  // The role map's own words, where a pack's signature role differs: Field Serif's quote face.
  const field = typeStillsByPack(
    { stills: SHOT.stills.map((still) => ({ ...still, pack: 'field-serif' })) },
    { 'field-serif': { name: 'Field Serif', style: 'serif' } },
  ).get('field-serif')!;
  assert.equal(field.aa.alt, 'Field Serif: its quote face, serif');
  assert.equal(field.aa.caption, 'its quote face');
  assert.equal(field.line.caption, 'its display face');
  // At a 16px root "Aa" stands 34px and the line 18px, the row's own geometry, so neither scales.
  assert.equal(stills.line.heightRem, 18 / 16);
  assert.equal(stills.line.widthRem, 124 / 16);
  // A pack missing one of its two stills gets none, and a pack the build doesn't offer is skipped.
  assert.equal(typeStillsByPack({ stills: SHOT.stills.slice(0, 1) }, NAMES).size, 0);
  assert.equal(typeStillsByPack(SHOT, {}).size, 0);
});

test("a pack's style is its display stack's generic family", () => {
  assert.equal(typeStyleOf('"JetBrains Mono", Menlo, monospace'), 'mono');
  assert.equal(typeStyleOf('"Fraunces", Georgia, serif'), 'serif');
  assert.equal(typeStyleOf('"Archivo", "Helvetica Neue", Arial, sans-serif'), 'sans');
  assert.equal(typeStyleOf('system-ui'), 'sans');
});

test("Studio's specimen stacks drop the families a pack hosts, quoted or not, in any case, and keep a generic family", () => {
  // Field Serif hosts "Fraunces" and "Fraunces Italic", its quote face under its own name.
  const hosted = ['Fraunces', 'Fraunces Italic', 'Inter'];
  assert.equal(
    withoutFamilies('"Fraunces Italic", Palatino, "Palatino Linotype", Georgia, serif', hosted),
    'Palatino, "Palatino Linotype", Georgia, serif',
  );
  assert.equal(
    withoutFamilies('"Fraunces", Palatino, "Palatino Linotype", Georgia, serif', hosted),
    'Palatino, "Palatino Linotype", Georgia, serif',
  );
  // "Fraunces" hosted doesn't take "Fraunces Italic" with it, nor the other way round.
  assert.equal(
    withoutFamilies('"Fraunces Italic", serif', ['Fraunces']),
    '"Fraunces Italic", serif',
  );
  assert.equal(withoutFamilies('Fraunces, serif', ['Fraunces Italic']), 'Fraunces, serif');
  // A stack of hosted families alone never comes back empty: it becomes the generic family
  // its style names, and with no generic family in it typeStyleOf reads it as sans.
  assert.equal(withoutFamilies('"Fraunces", "Fraunces Italic"', hosted), 'sans-serif');
  assert.equal(withoutFamilies("'JetBrains Mono'", ['JetBrains Mono']), 'sans-serif');
  // A generic family is never a hosted one, so a stack that ends in one keeps it.
  assert.equal(withoutFamilies('"Fraunces", serif', hosted), 'serif');
  assert.equal(withoutFamilies("'JetBrains Mono', monospace", ['JetBrains Mono']), 'monospace');
  // Case doesn't hide a hosted family, in the stack or in the hosted list.
  assert.equal(
    withoutFamilies('"FRAUNCES", fraunces italic, Georgia, serif', hosted),
    'Georgia, serif',
  );
  assert.equal(withoutFamilies('"Inter", Arial, sans-serif', ['inter']), 'Arial, sans-serif');
  // Nothing hosted: the stack as it was.
  assert.equal(withoutFamilies('"Inter", Arial, sans-serif', []), '"Inter", Arial, sans-serif');
});
