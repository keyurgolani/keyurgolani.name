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

// LANG-1 in Studio, Demo, recipes, the URL, the publish summary, and the
// history compare: a retired design language's id reads as its survivor
// everywhere, and never lists as an option, a count, or a recipe of its own.

const CATALOG = appearanceCatalog();
const RETIRED = {
  'ant-inspired': 'primer-inspired',
  'atlassian-inspired': 'utility-dense',
  'polaris-inspired': 'spectrum-2-inspired',
  'radix-inspired': 'spectrum-2-inspired',
} as const;

const languages = (catalog: AppearanceCatalog) =>
  catalog.axes.find(({ axis }) => axis === 'designLanguage')!;

test("Studio's catalog lists 33 languages, no retired one, and maps each retired id to its survivor", () => {
  const entry = languages(CATALOG);
  const ids = entry.options.map(({ id }) => id);
  assert.equal(ids.length, 33);
  for (const [id, survivor] of Object.entries(RETIRED)) {
    assert.ok(!ids.includes(id), `${id} is an option`);
    assert.ok(ids.includes(survivor));
    assert.equal(entry.aliases?.[id], survivor);
    assert.equal(canonicalValue(CATALOG, 'designLanguage', id), survivor);
  }
  // The family chips add up: every option files under one family, and the families sum to 33.
  const families = new Map<string, number>();
  for (const option of entry.options) {
    assert.ok(option.family, `${option.id} has no family`);
    families.set(option.family, (families.get(option.family) ?? 0) + 1);
  }
  assert.equal(
    [...families.values()].reduce((sum, count) => sum + count, 0),
    33,
  );
  assert.equal(entry.options.find(({ id }) => id === 'utility-dense')?.family, 'quiet');
  // The other axes' retired ids are LANG-5a's, exactly (retired-alias-5a.test.ts), and none of them is a language's.
  const others = Object.fromEntries(
    CATALOG.axes
      .filter(({ axis }) => axis !== 'designLanguage')
      .map(({ axis, aliases }) => [axis, Object.keys(aliases ?? {}).sort()]),
  );
  assert.deepEqual(others, {
    variant: [],
    colorScheme: ['bookcloth', 'earthy-clay', 'zinc'],
    typography: ['literary-reading'],
    displayMode: [],
  });
});

const SITE = (designLanguage: string, colorScheme = 'warm-parchment') => ({
  schemaVersion: 2,
  appearance: {
    variant: 'editorial-evidence',
    designLanguage,
    colorScheme,
    typography: 'humanist-ui',
    displayMode: 'system',
  },
  visitorControls: {
    variant: 'locked',
    designLanguage: 'locked',
    colorScheme: 'selectable',
    typography: 'locked',
    displayMode: 'selectable',
  },
});

test('Studio shows a stored alias as its survivor, checked, with nothing to save (option a)', () => {
  const saved = canonicalState(CATALOG, appearanceOfSite(SITE('polaris-inspired')))!;
  assert.equal(saved.selection.designLanguage, 'spectrum-2-inspired');
  assert.deepEqual(appearanceEdits(saved, saved), []);
  const note = optionNote(CATALOG, 'designLanguage', 'polaris-inspired');
  assert.equal(note.option?.id, 'spectrum-2-inspired');
  assert.equal(note.fallback, null, 'an alias is no fallback');
  // The frame swaps the survivor's stylesheet in place.
  const raw = appearanceOfSite(SITE('ant-inspired'))!;
  const shown = inPlaceAppearance(CATALOG, raw.selection);
  assert.equal(shown?.designLanguage.id, 'primer-inspired');
  // A state with no alias is the same object, so nothing re-renders for it.
  const plain = appearanceOfSite(SITE('primer-inspired'));
  assert.equal(canonicalState(CATALOG, plain), plain);
});

test('a save of another axis leaves the alias alone; a save of the language writes what was picked', () => {
  const saved = canonicalState(CATALOG, appearanceOfSite(SITE('radix-inspired')))!;
  const scheme: AppearanceState = {
    ...saved,
    selection: { ...saved.selection, colorScheme: 'neutral-slate' },
  };
  assert.deepEqual(appearanceEdits(saved, scheme), [
    { document: 'site', pointer: '/appearance/colorScheme', op: 'set', value: 'neutral-slate' },
  ]);
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

test('the publish summary reads aliases on both sides: an alias against its survivor is no change', () => {
  for (const [from, to] of [
    ['ant-inspired', 'primer-inspired'],
    ['primer-inspired', 'ant-inspired'],
    ['radix-inspired', 'polaris-inspired'],
  ] as const) {
    const summary = publishSummary({
      draft: draftWith(SITE(to)),
      live: LIVE,
      liveSite: SITE(from),
      catalog: CATALOG,
      blocker: null,
    });
    assert.deepEqual(summary.rows, [], `${from} to ${to}`);
  }
  // A real change still shows, by the survivor's name.
  const changed = publishSummary({
    draft: draftWith(SITE('carbon-inspired')),
    live: LIVE,
    liveSite: SITE('ant-inspired'),
    catalog: CATALOG,
    blocker: null,
  });
  assert.deepEqual(changed.rows, [
    { label: languages(CATALOG).label, value: 'Primer Inspired → Carbon Inspired' },
  ]);
});

function revision(revisionId: string, designLanguage: string): RevisionDetail {
  const site = SITE(designLanguage);
  return {
    revisionId,
    createdAt: '2026-10-23T12:00:00.000Z',
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
        sourceText: `designLanguage: ${designLanguage}\n`,
        model: site,
      },
    },
  };
}

test("the history compare reads aliases on both sides in what's derived, and keeps the authored text", () => {
  for (const [from, to] of [
    ['atlassian-inspired', 'utility-dense'],
    ['utility-dense', 'atlassian-inspired'],
  ] as const) {
    const changes = revisionChanges(
      revision(BASE_REVISION, from),
      revision(LIVE_REVISION, to),
      CATALOG,
    );
    assert.deepEqual(changes.derived, [], `${from} to ${to}`);
    // The authored diff is the text as the owner wrote it.
    assert.equal(changes.authored.length, 1);
  }
  const plain = revisionChanges(
    revision(BASE_REVISION, 'atlassian-inspired'),
    revision(LIVE_REVISION, 'utility-dense'),
  );
  assert.equal(plain.derived.length, 1, 'without the catalog it compares the ids');
});

test('recipes list and apply only survivors, even for a recipe that names a retired id', () => {
  const recipe: Recipe = {
    id: 'old-recipe',
    name: 'Old Recipe',
    description: 'Names a retired language.',
    selection: {
      variant: 'editorial-evidence',
      designLanguage: 'ant-inspired',
      colorScheme: 'warm-parchment',
      typography: 'humanist-ui',
      displayMode: 'system',
    },
  };
  const [offered] = offeredRecipes(CATALOG, () => true, [recipe]);
  assert.equal(offered?.selection.designLanguage, 'primer-inspired');
  for (const each of offeredRecipes(CATALOG)) {
    assert.ok(!Object.hasOwn(RETIRED, each.selection.designLanguage), each.id);
  }
});

/** The demo catalog with a retired language, for the URL and backend tests. */
const DEMO: AppearanceCatalog = {
  axes: DEMO_CATALOG.axes.map((entry) =>
    entry.axis === 'designLanguage'
      ? {
          ...entry,
          options: [
            ...entry.options,
            { ...entry.options[0]!, id: 'primer-inspired', name: 'Primer Inspired' },
          ],
          aliases: { 'ant-inspired': 'primer-inspired' },
        }
      : entry,
  ),
};
const RULES = { catalog: DEMO, schemeModes: SCHEME_MODES };

test("Demo Studio's URL reads an old link's retired id as its survivor, and writes only the survivor", () => {
  const selection = selectionFrom(new URLSearchParams('language=ant-inspired'), DEFAULTS, RULES);
  assert.equal(selection.designLanguage, 'primer-inspired');
  const stored: DemoSelection = { ...DEFAULTS, designLanguage: 'ant-inspired' };
  assert.equal(selectionQuery(stored, RULES).get('language'), 'primer-inspired');
});

test("Demo Studio's backend stores a retired id's survivor, never the alias", async () => {
  const backend = browserBackend({
    unit: UNIT,
    store: demoStore(new FakeStorage(), new FakeStorage()),
    defaults: DEFAULTS,
    catalog: DEMO,
    schemeModes: SCHEME_MODES,
  });
  const result = await backend.applyEdits({
    draftId: 'demo-sample',
    expectedVersion: backend.version(),
    edits: [
      { document: 'site', pointer: '/appearance/designLanguage', op: 'set', value: 'ant-inspired' },
    ],
  });
  assert.equal(result.kind, 'saved');
  assert.equal(backend.selection().designLanguage, 'primer-inspired');
});

test("/sample's query reads a retired id as its survivor and canonicalizes the link to it", () => {
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
  const read = sampleQuery(new URLSearchParams('language=polaris-inspired'), site);
  assert.equal(read.query.language, 'spectrum-2-inspired');
});

test('the visitor control offers only survivors, and shows a published alias as its survivor', () => {
  const visitorControls = {
    variant: 'locked',
    designLanguage: 'selectable',
    colorScheme: 'selectable',
    typography: 'locked',
    displayMode: 'selectable',
  } as const;
  const appearance = resolveAppearance({
    published: { ...SITE('ant-inspired').appearance, displayMode: 'system' },
    visitorControls,
    motionPolicy: 'respect-os',
    profile: 'owner',
    registry: APPEARANCE_REGISTRY,
  });
  const model = visitorAppearanceModel({
    registry: APPEARANCE_REGISTRY,
    appearance,
    visitorControls,
    profile: 'owner',
  });
  const language = model.controls.find(({ axis }) => axis === 'designLanguage')!;
  assert.equal(language.value, 'primer-inspired');
  const values = language.groups.flatMap(({ choices }) => choices.map(({ value }) => value));
  assert.equal(values.length, 33);
  for (const id of Object.keys(RETIRED)) assert.ok(!values.includes(id), `${id} is offered`);
});

test("Demo Studio's local frame resolves an imported pair's retired id as its survivor", () => {
  const registries = localRegistries(localCatalog());
  const resolved = resolveAppearance({
    published: { ...SITE('atlassian-inspired').appearance, displayMode: 'system' },
    visitorControls: DEFAULT_VISITOR_CONTROLS,
    motionPolicy: 'respect-os',
    profile: 'demo',
    registry: registries.appearance,
  });
  assert.equal(resolved.selection.designLanguage, 'utility-dense');
  assert.deepEqual(resolved.fallbackAxes, []);
  assert.deepEqual(
    resolved.diagnostics.map(({ code, message }) => [code, message]),
    // utility-dense has evolved since the merge (LANG-2), so the alias follows its updates.
    [
      [
        'appearance.alias',
        'atlassian-inspired was merged into utility-dense and follows its updates.',
      ],
    ],
  );
});

test('Demo Studio opens a reference or sample site that names a retired id on its survivor', () => {
  const defaults = demoSelectionOf(CATALOG, SITE('radix-inspired'));
  assert.equal(defaults.designLanguage, 'spectrum-2-inspired');
  assert.equal(defaults.colorScheme, 'warm-parchment');
});
