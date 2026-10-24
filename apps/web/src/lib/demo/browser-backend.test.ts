import test from 'node:test';
import assert from 'node:assert/strict';
import type { StudioBackend } from '../studio/backend';
import { browserBackend, DEMO_DRAFT_ID, NOT_OFFERED, storedSelection } from './browser-backend';
import { demoStore, SELECTION_KEY } from './storage';
import { CATALOG, DEFAULTS, FakeStorage, SCHEME_MODES, UNIT } from './test-support';

// Demo Studio's browser backend (#9): the StudioBackend over the bundled
// sample, which takes appearance edits alone, keeps them in the demo's own
// storage, and reaches no server.

function setup(initial = DEFAULTS) {
  const local = new FakeStorage();
  const session = new FakeStorage();
  const store = demoStore(local, session);
  const backend = browserBackend({
    unit: UNIT,
    catalog: CATALOG,
    schemeModes: SCHEME_MODES,
    defaults: DEFAULTS,
    store,
    initial,
    now: () => new Date('2026-10-24T00:00:00.000Z'),
  });
  return { backend, local, session, store };
}

const set = (axis: string, value: unknown) => ({
  document: 'site' as const,
  pointer: `/appearance/${axis}`,
  op: 'set' as const,
  value,
});

test('it implements the base StudioBackend alone, and reaches no server', async (t) => {
  const fetched = t.mock.method(globalThis, 'fetch', () =>
    assert.fail('the demo backend fetches nothing'),
  );
  const { backend } = setup();
  const base: StudioBackend = backend;
  for (const name of ['publish', 'rollback', 'history', 'revisions', 'revision']) {
    assert.equal(name in base, false, name);
  }
  assert.equal(await backend.session(), true);
  assert.deepEqual(await backend.live(), {
    kind: 'read',
    value: {
      state: 'live',
      liveRevisionId: UNIT.revisionId,
      servingRevisionId: UNIT.revisionId,
      seq: null,
    },
  });
  assert.equal(await backend.signOut('keep'), false);
  assert.equal(fetched.mock.callCount(), 0);
});

test('the working draft is the sample with the selection on its site appearance', async () => {
  const { backend } = setup({ ...DEFAULTS, variant: 'acme-orbit' });
  const working = await backend.workingDraft();
  assert.equal(working.kind, 'read');
  const draft = working.kind === 'read' ? working.value! : assert.fail();
  assert.equal(draft.draftId, DEMO_DRAFT_ID);
  assert.equal(draft.baseRevisionId, UNIT.revisionId);
  assert.equal(draft.documents.portfolio, UNIT.documents.portfolio);
  assert.deepEqual((draft.documents.site.model as { appearance: unknown }).appearance, {
    ...DEFAULTS,
    variant: 'acme-orbit',
  });
  // The sample's own documents are never changed in place.
  assert.equal(
    (UNIT.documents.site.model as { appearance: { variant: string } }).appearance.variant,
    'acme-default',
  );
});

test('saving or starting a draft is not offered', async () => {
  const { backend } = setup();
  const failure = { kind: 'failed', code: 'not_offered', message: NOT_OFFERED };
  assert.deepEqual(await backend.startDraft(), failure);
  assert.deepEqual(
    await backend.saveDraft({
      draftId: DEMO_DRAFT_ID,
      expectedVersion: 1,
      documents: UNIT.documents,
    }),
    failure,
  );
});

test('an edit sets one /appearance/<axis> of the site to a value the catalog offers, and is kept in the demo storage', async () => {
  const { backend, local } = setup();
  const result = await backend.applyEdits({
    draftId: DEMO_DRAFT_ID,
    expectedVersion: 1,
    edits: [set('variant', 'acme-gallery'), set('displayMode', 'dark')],
  });
  assert.equal(result.kind, 'saved');
  assert.equal(result.kind === 'saved' && result.draft.version, 2);
  assert.deepEqual(backend.selection(), {
    ...DEFAULTS,
    variant: 'acme-gallery',
    displayMode: 'dark',
  });
  assert.deepEqual(JSON.parse(local.items.get(SELECTION_KEY)!), backend.selection());
});

test('anything else is refused whole, and changes nothing', async () => {
  const { backend, local, session } = setup();
  for (const edits of [
    [{ document: 'portfolio' as const, pointer: '/identity/name', op: 'set' as const, value: 'X' }],
    [{ document: 'media' as const, pointer: '/assets/0', op: 'delete' as const }],
    [
      {
        document: 'site' as const,
        pointer: '/visitorControls/variant',
        op: 'set' as const,
        value: 'selectable',
      },
    ],
    [{ document: 'site' as const, pointer: '/appearance/variant', op: 'delete' as const }],
    [{ document: 'site' as const, pointer: '/appearance', op: 'set' as const, value: {} }],
    [
      {
        document: 'site' as const,
        pointer: '/appearance/motion',
        op: 'set' as const,
        value: 'reduce',
      },
    ],
    [
      {
        document: 'site' as const,
        pointer: '/appearance/variant/0',
        op: 'set' as const,
        value: 'x',
      },
    ],
    [set('variant', 42)],
    // An appearance pointer and a value the catalog offers, on another document or by another op.
    [
      {
        document: 'portfolio' as const,
        pointer: '/appearance/variant',
        op: 'set' as const,
        value: 'acme-orbit',
      },
    ],
    [
      {
        document: 'site' as const,
        pointer: '/appearance/variant',
        op: 'delete' as const,
        value: 'acme-orbit',
      },
    ],
    // One edit it can't take refuses the batch, the good one with it.
    [set('variant', 'acme-orbit'), set('visitorControls', 'selectable')],
  ]) {
    const result = await backend.applyEdits({ draftId: DEMO_DRAFT_ID, expectedVersion: 1, edits });
    assert.equal(result.kind, 'failed', JSON.stringify(edits));
    assert.equal(result.kind === 'failed' && result.code, 'not_offered', JSON.stringify(edits));
  }
  for (const [axis, value] of [
    ['variant', 'canary-variant'],
    ['variant', 'fallback'],
    ['variant', 'acme-default'],
    ['colorScheme', 'generated-seed'],
    ['displayMode', 'sepia'],
  ] as const) {
    const result = await backend.applyEdits({
      draftId: DEMO_DRAFT_ID,
      expectedVersion: 1,
      edits: [set(axis, value)],
    });
    assert.equal(result.kind === 'failed' && result.code, 'validation_failed', `${axis} ${value}`);
  }
  // A scheme with no light mode, against light.
  const light = await backend.applyEdits({
    draftId: DEMO_DRAFT_ID,
    expectedVersion: 1,
    edits: [set('displayMode', 'light'), set('colorScheme', 'night-only')],
  });
  assert.equal(light.kind === 'failed' && light.code, 'validation_failed');
  assert.deepEqual(backend.selection(), DEFAULTS);
  assert.equal(backend.version(), 1);
  assert.equal(local.items.size + session.items.size, 0);
});

test('another draft or a stale version is no edit: the newer one comes back', async () => {
  const { backend } = setup();
  const other = await backend.applyEdits({
    draftId: 'draft-1',
    expectedVersion: 1,
    edits: [set('variant', 'acme-orbit')],
  });
  assert.equal(other.kind === 'failed' && other.code, 'not_found');
  await backend.applyEdits({
    draftId: DEMO_DRAFT_ID,
    expectedVersion: 1,
    edits: [set('variant', 'acme-orbit')],
  });
  const stale = await backend.applyEdits({
    draftId: DEMO_DRAFT_ID,
    expectedVersion: 1,
    edits: [set('variant', 'acme-gallery')],
  });
  assert.equal(stale.kind, 'conflict');
  assert.equal(stale.kind === 'conflict' && stale.theirs.version, 2);
  assert.equal(backend.selection().variant, 'acme-orbit');
});

test('an axis reset puts that axis back and leaves the other four as they are', async () => {
  const { backend } = setup({
    variant: 'acme-orbit',
    designLanguage: 'platform-neutral',
    colorScheme: 'night-only',
    typography: 'humanist-ui',
    displayMode: 'dark',
  });
  assert.deepEqual(backend.resetAxis('variant'), {
    variant: DEFAULTS.variant,
    designLanguage: 'platform-neutral',
    colorScheme: 'night-only',
    typography: 'humanist-ui',
    displayMode: 'dark',
  });
  assert.deepEqual(backend.resetAxis('displayMode'), { ...DEFAULTS, colorScheme: 'night-only' });
});

test('a full reset clears every portfolio-demo: key and brings back the sample', async () => {
  const { backend, local, session } = setup();
  await backend.applyEdits({
    draftId: DEMO_DRAFT_ID,
    expectedVersion: 1,
    edits: [set('variant', 'acme-orbit')],
  });
  session.setItem('portfolio-demo:v1:working', 'copy');
  local.setItem('portfolio-studio:journal:v1', 'owner');
  assert.deepEqual(backend.resetAll(), DEFAULTS);
  assert.deepEqual([...local.items.keys()], ['portfolio-studio:journal:v1']);
  assert.deepEqual([...session.items.keys()], []);
});

test('a stored selection reads back through the catalog, axis by axis', () => {
  const store = demoStore(new FakeStorage(), new FakeStorage());
  const rules = { catalog: CATALOG, schemeModes: SCHEME_MODES };
  assert.equal(storedSelection(store, DEFAULTS, rules), null);
  store.write(SELECTION_KEY, 'not json');
  assert.equal(storedSelection(store, DEFAULTS, rules), null);
  store.write(
    SELECTION_KEY,
    JSON.stringify({ variant: 'acme-orbit', typography: 'gone', displayMode: 7 }),
  );
  assert.deepEqual(storedSelection(store, DEFAULTS, rules), {
    ...DEFAULTS,
    variant: 'acme-orbit',
  });
});

test("showing the reference takes its own selection as the reset target, stores none of it, and a full reset goes back to the sample's (#9)", () => {
  const { backend, local, session } = setup();
  const own = { ...DEFAULTS, variant: 'acme-orbit' };
  assert.deepEqual(backend.showSource(own), own);
  assert.deepEqual(backend.selection(), own);
  assert.equal(local.length + session.length, 0, 'nothing stored: a reload opens on the sample');
  // An axis resets to the reference's own while it shows.
  assert.deepEqual(backend.showSource(own, { ...own, variant: DEFAULTS.variant }), {
    ...own,
    variant: DEFAULTS.variant,
  });
  assert.deepEqual(backend.resetAxis('variant'), own);
  // Back to the sample: its own selection, and its resets again.
  assert.deepEqual(backend.showSource(null), DEFAULTS);
  backend.showSource(own);
  assert.deepEqual(backend.resetAll(), DEFAULTS);
  assert.deepEqual(backend.resetAxis('variant'), DEFAULTS);
});
