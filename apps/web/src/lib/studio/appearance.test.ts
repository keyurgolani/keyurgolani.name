import test from 'node:test';
import assert from 'node:assert/strict';
import {
  appearanceEdits,
  appearanceFindings,
  appearanceOf,
  appearanceOfSite,
  optionNote,
  type AppearanceCatalog,
} from './appearance';
import type { StudioDraft } from './documents';
import { BLOCKING, draft } from './test-support';

// The Appearance workspace's model (#8, Slice 5): five axes read from the
// draft's site model, one edit per changed axis or visitor control, and
// what renders in place of a value the build doesn't offer.

const SITE_MODEL = {
  schemaVersion: 2,
  appearance: {
    variant: 'editorial-evidence',
    designLanguage: 'platform-neutral',
    colorScheme: 'warm-parchment',
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
};

function withSite(model: unknown, diagnostics = draft(1).documents.site.diagnostics): StudioDraft {
  const base = draft(1);
  return {
    ...base,
    documents: { ...base.documents, site: { ...base.documents.site, model, diagnostics } },
  };
}

const CATALOG: AppearanceCatalog = {
  axes: [
    {
      axis: 'variant',
      label: 'Composition',
      fallback: 'fallback',
      options: [
        {
          id: 'editorial-evidence',
          name: 'Editorial Evidence',
          description: null,
          tier: null,
          provenance: [],
          performance: null,
          access: null,
          status: 'ready',
          statusLabel: null,
        },
      ],
    },
    {
      axis: 'colorScheme',
      label: 'Color scheme',
      fallback: 'warm-parchment',
      options: [
        {
          id: 'warm-parchment',
          name: 'Warm Parchment',
          description: null,
          tier: 'stable',
          provenance: [],
          performance: null,
          access: null,
          status: 'ready',
          statusLabel: null,
        },
      ],
    },
  ],
};

test("the workspace reads the saved draft's five axes and their visitor controls from its site model", () => {
  const state = appearanceOf(withSite(SITE_MODEL))!;
  assert.deepEqual(state.selection, SITE_MODEL.appearance);
  assert.deepEqual(state.controls, SITE_MODEL.visitorControls);
  assert.equal(appearanceOf(withSite(null)), null, "a site that doesn't parse has none");
});

test("before any draft, the workspace reads the live revision's site model the same way", () => {
  assert.deepEqual(appearanceOfSite(SITE_MODEL), appearanceOf(withSite(SITE_MODEL)));
  assert.equal(appearanceOfSite(null), null);
  assert.equal(appearanceOfSite({ schemaVersion: 2 }), null, 'a site with no appearance has none');
});

test('a change to one axis edits that pointer alone, and leaves the other four as they are', () => {
  const saved = appearanceOf(withSite(SITE_MODEL))!;
  assert.deepEqual(appearanceEdits(saved, saved), []);
  const next = {
    selection: { ...saved.selection, colorScheme: 'cool-slate' },
    controls: { ...saved.controls, typography: 'selectable' as const },
  };
  assert.deepEqual(appearanceEdits(saved, next), [
    { document: 'site', pointer: '/appearance/colorScheme', op: 'set', value: 'cool-slate' },
    { document: 'site', pointer: '/visitorControls/typography', op: 'set', value: 'selectable' },
  ]);
});

test("a value the build offers is described; one it doesn't names what renders in its place", () => {
  assert.equal(
    optionNote(CATALOG, 'variant', 'editorial-evidence').option?.name,
    'Editorial Evidence',
  );
  assert.deepEqual(optionNote(CATALOG, 'variant', 'retired-variant'), {
    option: null,
    fallback: 'the fallback composition',
  });
  assert.deepEqual(optionNote(CATALOG, 'colorScheme', 'research-scheme'), {
    option: null,
    fallback: 'Warm Parchment',
  });
});

test("the findings before publish are the validator's own on the site's appearance and visitor controls", () => {
  const onAppearance = {
    ...BLOCKING,
    document: 'site',
    pointer: '/appearance/variant',
    code: 'variant.unavailable',
  };
  const onControls = {
    ...BLOCKING,
    document: 'site',
    pointer: '/visitorControls',
    code: 'schema.invalid',
  };
  // A scheme the save couldn't generate, at the input it resolved (K-2 delta review K2-L1).
  const onInput = {
    ...BLOCKING,
    document: 'site',
    pointer: '/appearanceInputs/hct-tonal',
    code: 'scheme.ungenerated',
  };
  const elsewhere = { ...BLOCKING, document: 'site', pointer: '/features/feed' };
  const lookalike = { ...BLOCKING, document: 'site', pointer: '/appearanceInputsExtra' };
  const found = appearanceFindings(
    withSite(SITE_MODEL, [onAppearance, onControls, onInput, elsewhere, lookalike]),
  );
  assert.deepEqual(found, [onAppearance, onControls, onInput]);
});
