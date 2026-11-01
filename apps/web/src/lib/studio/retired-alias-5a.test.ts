import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_VISITOR_CONTROLS,
  resolveAppearance,
  visitorAppearanceModel,
} from '@portfolio/appearance';
import { APPEARANCE_REGISTRY } from '~/lib/appearance-registry';
import { localRegistries } from '~/lib/local-catalog';
import { localCatalog } from '~/server/local-catalog';
import { demoSelectionOf } from '~/server/demo-studio';
import { appearanceCatalog } from '~/server/studio-appearance';
import { sampleQuery } from '../sample-query';
import { selectionFrom, selectionQuery, type DemoSelection } from '../demo/url-state';
import { browserBackend } from '../demo/browser-backend';
import { exportUnit } from '../demo/export';
import { runImport } from '../demo/import/pipeline';
import { bytes, EXAMPLE } from '../demo/import/test-support/hostile';
import {
  CATALOG as DEMO_CATALOG,
  DEFAULTS,
  FakeStorage,
  SCHEME_MODES,
  UNIT,
} from '../demo/test-support';
import { demoStore } from '../demo/storage';
import {
  appearanceEdits,
  appearanceOfSite,
  canonicalState,
  canonicalValue,
  inPlaceAppearance,
  optionNote,
  type AppearanceCatalog,
  type AppearanceState,
} from './appearance';
import type { RevisionDetail } from './backend';
import { publishSummary } from './publish-summary';
import { offeredRecipes, type Recipe } from './recipes';
import { revisionChanges } from './revision-diff';
import { BASE_REVISION, draft, LIVE_REVISION } from './test-support';

// LANG-5a on the color scheme and typography axes, where LANG-1 had only
// languages: a retired scheme's or typography profile's id reads as its
// survivor in Studio, Demo, recipes, the URL, the cookie, the publish
// summary, the history compare, and the visitor control, and never lists as
// an option, a count, or a recipe of its own.

const CATALOG = appearanceCatalog();
const SCHEMES = {
  bookcloth: 'paper-ink',
  'earthy-clay': 'desert-terracotta',
  zinc: 'graphite',
} as const;
const TYPOGRAPHY = { 'literary-reading': 'editorial-serif' } as const;
/** Each retired id's notice, as the records say what changed at the merge. */
const NOTICES = {
  bookcloth:
    "bookcloth was merged into paper-ink and follows its updates; bookcloth now resolves to paper-ink's dove-grey stock; its cloth inks survive in paper-ink's categorical set.",
  'earthy-clay':
    'earthy-clay was merged into desert-terracotta and follows its updates; at the merge, its olive second color became ochre, and its clay accent a brighter terracotta.',
  zinc: 'zinc is now graphite; at the merge, its violet second color became copper brown, and its dark mode a slightly lighter charcoal.',
  'literary-reading':
    'literary-reading was merged into editorial-serif and follows its updates; at the merge, its serif became an old-style face (Iowan Old Style on Apple devices) and its labels a neutral sans.',
} as const;

const entryOf = (catalog: AppearanceCatalog, axis: 'colorScheme' | 'typography') =>
  catalog.axes.find((entry) => entry.axis === axis)!;

const SITE = (colorScheme: string, typography = 'humanist-ui') => ({
  schemaVersion: 2,
  appearance: {
    variant: 'editorial-evidence',
    designLanguage: 'platform-neutral',
    colorScheme,
    typography,
    displayMode: 'system',
  },
  visitorControls: {
    variant: 'locked',
    designLanguage: 'locked',
    colorScheme: 'selectable',
    typography: 'selectable',
    displayMode: 'selectable',
  },
});

test("Studio's catalog lists 34 schemes and 15 typography profiles, no retired one, and maps each retired id to its survivor", () => {
  for (const [axis, retired, count] of [
    ['colorScheme', SCHEMES, 34],
    ['typography', TYPOGRAPHY, 15],
  ] as const) {
    const entry = entryOf(CATALOG, axis);
    const ids = entry.options.map(({ id }) => id);
    assert.equal(ids.length, count, axis);
    assert.deepEqual(entry.aliases, retired, axis);
    for (const [id, survivor] of Object.entries(retired)) {
      assert.ok(!ids.includes(id), `${id} is an option`);
      assert.ok(ids.includes(survivor), `${survivor} is not an option`);
      assert.equal(canonicalValue(CATALOG, axis, id), survivor);
    }
  }
});

test('Studio shows a stored scheme or typography alias as its survivor, checked, with nothing to save', () => {
  const site = SITE('zinc', 'literary-reading');
  const saved = canonicalState(CATALOG, appearanceOfSite(site))!;
  assert.equal(saved.selection.colorScheme, 'graphite');
  assert.equal(saved.selection.typography, 'editorial-serif');
  assert.deepEqual(appearanceEdits(saved, saved), []);
  for (const [axis, id, survivor] of [
    ['colorScheme', 'earthy-clay', 'desert-terracotta'],
    ['typography', 'literary-reading', 'editorial-serif'],
  ] as const) {
    const note = optionNote(CATALOG, axis, id);
    assert.equal(note.option?.id, survivor, id);
    assert.equal(note.fallback, null, 'an alias is no fallback');
  }
  // The frame swaps in the survivors' stylesheets in place.
  const shown = inPlaceAppearance(
    CATALOG,
    appearanceOfSite(SITE('bookcloth', 'literary-reading'))!.selection,
  );
  assert.equal(shown?.colorScheme.id, 'paper-ink');
  assert.equal(shown?.typography.id, 'editorial-serif');
});

test('a save of another axis leaves a scheme alias alone; a save of the scheme writes what was picked', () => {
  const saved = canonicalState(CATALOG, appearanceOfSite(SITE('bookcloth', 'literary-reading')))!;
  const language: AppearanceState = {
    ...saved,
    selection: { ...saved.selection, designLanguage: 'carbon-inspired' },
  };
  assert.deepEqual(appearanceEdits(saved, language), [
    {
      document: 'site',
      pointer: '/appearance/designLanguage',
      op: 'set',
      value: 'carbon-inspired',
    },
  ]);
  const scheme: AppearanceState = {
    ...saved,
    selection: { ...saved.selection, colorScheme: 'signal-paper', typography: 'book-serif' },
  };
  assert.deepEqual(appearanceEdits(saved, scheme), [
    { document: 'site', pointer: '/appearance/colorScheme', op: 'set', value: 'signal-paper' },
    { document: 'site', pointer: '/appearance/typography', op: 'set', value: 'book-serif' },
  ]);
});

const draftWith = (site: unknown) => {
  const base = draft(16);
  return {
    ...base,
    documents: { ...base.documents, site: { ...base.documents.site, model: site } },
  };
};
const LIVE = {
  state: 'live' as const,
  liveRevisionId: LIVE_REVISION,
  servingRevisionId: LIVE_REVISION,
  seq: 12,
};

test('the publish summary reads scheme and typography aliases on both sides: an alias against its survivor is no change', () => {
  for (const [from, to] of [
    [SITE('bookcloth'), SITE('paper-ink')],
    [SITE('graphite'), SITE('zinc')],
    [SITE('warm-parchment', 'literary-reading'), SITE('warm-parchment', 'editorial-serif')],
  ] as const) {
    const summary = publishSummary({
      draft: draftWith(to),
      live: LIVE,
      liveSite: from,
      catalog: CATALOG,
      blocker: null,
    });
    assert.deepEqual(summary.rows, [], JSON.stringify([from.appearance, to.appearance]));
  }
  const changed = publishSummary({
    draft: draftWith(SITE('signal-paper')),
    live: LIVE,
    liveSite: SITE('earthy-clay'),
    catalog: CATALOG,
    blocker: null,
  });
  assert.deepEqual(changed.rows, [
    { label: entryOf(CATALOG, 'colorScheme').label, value: 'Desert Terracotta → Signal Paper' },
  ]);
});

function revision(revisionId: string, colorScheme: string, typography: string): RevisionDetail {
  return {
    revisionId,
    createdAt: '2026-10-29T12:00:00.000Z',
    createdBy: 'owner',
    compatible: true,
    manifest: {
      parentRevisionId: null,
      source: { kind: 'import' },
      rendering: { variant: { id: 'editorial-evidence', version: '1.0.0' }, packs: [] },
      snapshots: {},
    },
    documents: {
      portfolio: { format: 'yaml', sourceText: 'schemaVersion: 3\n', model: { schemaVersion: 3 } },
      site: {
        format: 'yaml',
        sourceText: `colorScheme: ${colorScheme}\ntypography: ${typography}\n`,
        model: SITE(colorScheme, typography),
      },
    },
  };
}

test("the history compare reads scheme and typography aliases in what's derived, and keeps the authored text", () => {
  const changes = revisionChanges(
    revision(BASE_REVISION, 'earthy-clay', 'literary-reading'),
    revision(LIVE_REVISION, 'desert-terracotta', 'editorial-serif'),
    CATALOG,
  );
  assert.deepEqual(changes.derived, []);
  assert.ok(changes.authored.length > 0, 'the authored diff is the text as written');
  const plain = revisionChanges(
    revision(BASE_REVISION, 'earthy-clay', 'literary-reading'),
    revision(LIVE_REVISION, 'desert-terracotta', 'editorial-serif'),
  );
  assert.equal(plain.derived.length, 2, 'without the catalog it compares the ids');
});

test('recipes list and apply only survivors, even for a recipe that names a retired scheme or profile', () => {
  const recipe: Recipe = {
    id: 'old-recipe',
    name: 'Old Recipe',
    description: 'Names a retired scheme and typography profile.',
    selection: {
      variant: 'editorial-evidence',
      designLanguage: 'platform-neutral',
      colorScheme: 'earthy-clay',
      typography: 'literary-reading',
      displayMode: 'system',
    },
  };
  const [offered] = offeredRecipes(CATALOG, () => true, [recipe]);
  assert.equal(offered?.selection.colorScheme, 'desert-terracotta');
  assert.equal(offered?.selection.typography, 'editorial-serif');
  for (const each of offeredRecipes(CATALOG)) {
    assert.ok(!Object.hasOwn(SCHEMES, each.selection.colorScheme), each.id);
    assert.ok(!Object.hasOwn(TYPOGRAPHY, each.selection.typography), each.id);
  }
});

/** The demo catalog with a retired scheme and typography profile, for the URL and backend tests. */
const DEMO: AppearanceCatalog = {
  axes: DEMO_CATALOG.axes.map((entry) =>
    entry.axis === 'colorScheme'
      ? {
          ...entry,
          options: [...entry.options, { ...entry.options[0]!, id: 'paper-ink', name: 'Paper Ink' }],
          aliases: { bookcloth: 'paper-ink' },
        }
      : entry.axis === 'typography'
        ? {
            ...entry,
            options: [
              ...entry.options,
              { ...entry.options[0]!, id: 'editorial-serif', name: 'Editorial Serif' },
            ],
            aliases: { 'literary-reading': 'editorial-serif' },
          }
        : entry,
  ),
};
const RULES = {
  catalog: DEMO,
  schemeModes: { ...SCHEME_MODES, 'paper-ink': ['light', 'dark'] },
};

test("Demo Studio's URL reads an old link's retired scheme and profile as their survivors, and writes only the survivors", () => {
  const selection = selectionFrom(
    new URLSearchParams('scheme=bookcloth&type=literary-reading'),
    DEFAULTS,
    RULES,
  );
  assert.equal(selection.colorScheme, 'paper-ink');
  assert.equal(selection.typography, 'editorial-serif');
  const stored: DemoSelection = {
    ...DEFAULTS,
    colorScheme: 'bookcloth',
    typography: 'literary-reading',
  };
  const query = selectionQuery(stored, RULES);
  assert.equal(query.get('scheme'), 'paper-ink');
  assert.equal(query.get('type'), 'editorial-serif');
});

test("Demo Studio's backend stores a retired scheme's and profile's survivors, never the aliases", async () => {
  const backend = browserBackend({
    unit: UNIT,
    store: demoStore(new FakeStorage(), new FakeStorage()),
    defaults: DEFAULTS,
    catalog: DEMO,
    schemeModes: RULES.schemeModes,
  });
  const result = await backend.applyEdits({
    draftId: 'demo-sample',
    expectedVersion: backend.version(),
    edits: [
      { document: 'site', pointer: '/appearance/colorScheme', op: 'set', value: 'bookcloth' },
      { document: 'site', pointer: '/appearance/typography', op: 'set', value: 'literary-reading' },
    ],
  });
  assert.equal(result.kind, 'saved');
  assert.equal(backend.selection().colorScheme, 'paper-ink');
  assert.equal(backend.selection().typography, 'editorial-serif');
});

test("/sample's query reads a retired scheme and profile as their survivors and canonicalizes the link to them", () => {
  const site = {
    appearance: {
      variant: 'editorial-evidence',
      designLanguage: 'platform-neutral',
      colorScheme: 'warm-parchment',
      typography: 'humanist-ui',
      displayMode: 'system' as const,
    },
    visitorControls: {
      variant: 'locked' as const,
      designLanguage: 'locked' as const,
      colorScheme: 'selectable' as const,
      typography: 'locked' as const,
      displayMode: 'selectable' as const,
    },
    motionPolicy: 'respect-os' as const,
  };
  const read = sampleQuery(new URLSearchParams('scheme=zinc&type=literary-reading'), site);
  assert.equal(read.query.scheme, 'graphite');
  assert.equal(read.query.type, 'editorial-serif');
});

const OWNER_CONTROLS = {
  variant: 'locked',
  designLanguage: 'locked',
  colorScheme: 'selectable',
  typography: 'selectable',
  displayMode: 'selectable',
} as const;

test('the visitor control offers only surviving schemes and profiles, and shows a published alias as its survivor', () => {
  const appearance = resolveAppearance({
    published: SITE('earthy-clay', 'literary-reading').appearance as never,
    visitorControls: OWNER_CONTROLS,
    motionPolicy: 'respect-os',
    profile: 'owner',
    registry: APPEARANCE_REGISTRY,
  });
  assert.deepEqual(
    appearance.diagnostics.map(({ code, message }) => [code, message]),
    [
      ['appearance.alias', NOTICES['earthy-clay']],
      ['appearance.alias', NOTICES['literary-reading']],
    ],
  );
  assert.deepEqual(appearance.fallbackAxes, []);
  const model = visitorAppearanceModel({
    registry: APPEARANCE_REGISTRY,
    appearance,
    visitorControls: OWNER_CONTROLS,
    profile: 'owner',
  });
  // The three generator schemes render nothing without the owner's input, so they aren't offered.
  for (const [axis, retired, survivor, count] of [
    ['colorScheme', SCHEMES, 'desert-terracotta', 31],
    ['typography', TYPOGRAPHY, 'editorial-serif', 15],
  ] as const) {
    const control = model.controls.find((each) => each.axis === axis)!;
    assert.equal(control.value, survivor, axis);
    const values = control.groups.flatMap(({ choices }) => choices.map(({ value }) => value));
    assert.equal(values.length, count, axis);
    for (const id of Object.keys(retired)) assert.ok(!values.includes(id), `${id} is offered`);
  }
});

test("a visitor's cookie that names a retired scheme or profile applies its survivor, with no owner diagnostic", () => {
  const resolved = resolveAppearance({
    published: SITE('warm-parchment').appearance as never,
    visitorControls: OWNER_CONTROLS,
    motionPolicy: 'respect-os',
    profile: 'owner',
    registry: APPEARANCE_REGISTRY,
    visitor: { cookie: 'scheme=zinc&type=literary-reading' },
  });
  assert.equal(resolved.selection.colorScheme, 'graphite');
  assert.equal(resolved.selection.typography, 'editorial-serif');
  assert.deepEqual(resolved.visitorAxes, ['colorScheme', 'typography']);
  assert.deepEqual(resolved.diagnostics, []);
});

test('each retired scheme and profile has its notice, saying what changed at the merge, never that it looks the same', () => {
  for (const [id, notice] of Object.entries(NOTICES)) {
    const axis = Object.hasOwn(TYPOGRAPHY, id) ? 'typography' : 'colorScheme';
    const resolved = resolveAppearance({
      published: { ...SITE('warm-parchment').appearance, [axis]: id } as never,
      visitorControls: DEFAULT_VISITOR_CONTROLS,
      motionPolicy: 'respect-os',
      profile: 'owner',
      registry: APPEARANCE_REGISTRY,
    });
    assert.deepEqual(
      resolved.diagnostics.map(({ code, axis: on, message }) => [code, on, message]),
      [['appearance.alias', axis, notice]],
    );
    assert.doesNotMatch(notice, /looks the same/);
  }
});

test("Demo Studio's local frame resolves an imported pair's retired scheme and profile as their survivors", () => {
  const registries = localRegistries(localCatalog());
  const resolved = resolveAppearance({
    published: SITE('bookcloth', 'literary-reading').appearance as never,
    visitorControls: DEFAULT_VISITOR_CONTROLS,
    motionPolicy: 'respect-os',
    profile: 'demo',
    registry: registries.appearance,
  });
  assert.equal(resolved.selection.colorScheme, 'paper-ink');
  assert.equal(resolved.selection.typography, 'editorial-serif');
  assert.deepEqual(resolved.fallbackAxes, []);
  assert.deepEqual(
    resolved.diagnostics.map(({ code, message }) => [code, message]),
    [
      ['appearance.alias', NOTICES.bookcloth],
      ['appearance.alias', NOTICES['literary-reading']],
    ],
  );
});

test("Demo Studio's export keeps a retired id as its source wrote it, and the export imports and renders as the survivor", () => {
  const site = EXAMPLE.site.replace(/^( {2}colorScheme: ).+$/m, '$1earthy-clay');
  assert.match(site, /^ {2}colorScheme: earthy-clay$/m, 'the example names a scheme to swap');
  const sources = {
    portfolio: { text: EXAMPLE.portfolio, format: 'yaml' as const, name: 'portfolio.yml' },
    site: { text: site, format: 'yaml' as const, name: 'site.yml' },
  };
  const exported = exportUnit({ sources }, 'yaml');
  const siteFile = exported.files.find(({ name }) => name === 'site.yml')!;
  assert.match(siteFile.text, /^ {2}colorScheme: earthy-clay$/m, 'nothing rewrites the alias');
  const imported = runImport([
    { name: 'a', bytes: bytes(exported.files[0]!.text) },
    { name: 'b', bytes: bytes(siteFile.text) },
  ]);
  assert.equal(imported.kind, 'imported');
  assert.ok(imported.kind === 'imported');
  const model = imported.unit.models.site;
  assert.equal(model.appearance.colorScheme, 'earthy-clay');
  const resolved = resolveAppearance({
    published: model.appearance,
    visitorControls: DEFAULT_VISITOR_CONTROLS,
    motionPolicy: 'respect-os',
    profile: 'demo',
    registry: localRegistries(localCatalog()).appearance,
  });
  assert.equal(resolved.selection.colorScheme, 'desert-terracotta');
});

test('Demo Studio opens a reference or sample site that names a retired scheme or profile on its survivors', () => {
  const defaults = demoSelectionOf(CATALOG, SITE('zinc', 'literary-reading'));
  assert.equal(defaults.colorScheme, 'graphite');
  assert.equal(defaults.typography, 'editorial-serif');
});
