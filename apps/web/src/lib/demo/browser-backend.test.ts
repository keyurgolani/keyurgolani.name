import test from 'node:test';
import assert from 'node:assert/strict';
import type { StudioBackend } from '../studio/backend';
import {
  browserBackend,
  DEMO_DRAFT_ID,
  LOCAL_DRAFT_ID,
  NOT_STARTED,
  RESET_WHILE_CHECKED,
  storedSelection,
  storedWorking,
  type ImportOptions,
  type Importer,
} from './browser-backend';
import type { ImportInput, ImportResult } from './import';
import { runImport } from './import/pipeline';
import { CANARY, EXAMPLE, HOSTILE_FIXTURES, pairFiles } from './import/test-support/hostile';
import { demoStore, SELECTION_KEY, WORKING_KEY } from './storage';
import { CATALOG, DEFAULTS, FakeStorage, SCHEME_MODES, UNIT } from './test-support';

// Demo Studio's browser backend (#9): the StudioBackend over the bundled
// sample, which takes appearance edits alone, keeps them in the demo's own
// storage, and reaches no server.

/** The import's own pipeline, as the worker runs it, recording each pair it's handed. */
function importer() {
  const calls: (readonly ImportInput[])[] = [];
  const run: Importer = async (files) => {
    calls.push(files);
    return runImport(files);
  };
  return { run, calls };
}

/** An importer that answers only once the test releases it, as a slow worker would. */
function gated() {
  const calls: { files: readonly ImportInput[]; options?: ImportOptions }[] = [];
  const waiting: (() => void)[] = [];
  const run: Importer = (files, options) => {
    calls.push({ files, ...(options ? { options } : {}) });
    return new Promise<ImportResult>((resolve) => waiting.push(() => resolve(runImport(files))));
  };
  /** Lets every import the worker holds answer, and waits for their callers to go on. */
  const release = async () => {
    for (const answer of waiting.splice(0)) answer();
    await new Promise((resolve) => setTimeout(resolve, 0));
  };
  return { run, calls, release };
}

function setup(
  initial = DEFAULTS,
  {
    local = new FakeStorage(),
    session = new FakeStorage(),
    checks = importer() as { run: Importer; calls: (readonly ImportInput[])[] },
  } = {},
) {
  const store = demoStore(local, session);
  const backend = browserBackend({
    unit: UNIT,
    catalog: CATALOG,
    schemeModes: SCHEME_MODES,
    defaults: DEFAULTS,
    store,
    initial,
    now: () => new Date('2026-10-24T00:00:00.000Z'),
    importer: checks.run,
  });
  return { backend, local, session, store, calls: checks.calls };
}

const example = () => pairFiles(EXAMPLE.portfolio);
const decoded = (files: readonly ImportInput[]) =>
  files.map(({ bytes }) => new TextDecoder().decode(bytes));

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

test('until an import the sample is the source, and nothing saves over it', async () => {
  const { backend, session, calls } = setup();
  assert.equal(backend.localSources(), null);
  assert.deepEqual(backend.sources(), {
    portfolio: { name: 'portfolio.yml', format: 'yaml', text: 'schemaVersion: 3\n' },
    site: { name: 'site.yml', format: 'yaml', text: 'schemaVersion: 2\n' },
  });
  assert.deepEqual(
    await backend.saveDraft({
      draftId: DEMO_DRAFT_ID,
      expectedVersion: 1,
      documents: UNIT.documents,
    }),
    { kind: 'failed', code: 'not_offered', message: NOT_STARTED },
  );
  assert.deepEqual(calls, []);
  assert.deepEqual([...session.items.keys()], []);
});

test("an import #4's validator takes becomes the local source, in this tab's sessionStorage alone, and a reload in the tab brings it back", async () => {
  const { backend, local, session, calls } = setup();
  const files = example();
  const result = await backend.importFiles(files);
  assert.equal(result?.kind, 'imported');
  assert.equal(calls.length, 1);
  assert.equal(calls[0], files);
  const sources = backend.localSources();
  assert.ok(sources);
  assert.equal(sources.portfolio.text, EXAMPLE.portfolio);
  assert.equal(sources.site.text, EXAMPLE.site);
  // The documents' own names, never the files'.
  assert.equal(sources.portfolio.name.includes(CANARY), false);
  assert.deepEqual(backend.sources(), sources);
  assert.deepEqual([...session.items.keys()], [WORKING_KEY]);
  assert.deepEqual([...local.items.keys()], []);
  const working = await backend.workingDraft();
  const draft = working.kind === 'read' ? working.value! : assert.fail();
  assert.equal(draft.draftId, LOCAL_DRAFT_ID);
  assert.equal(draft.baseRevisionId, null);
  assert.equal(draft.documents.portfolio.sourceText, EXAMPLE.portfolio);
  assert.ok(draft.documents.portfolio.model, "the validator's model");
  // Another page in the same tab reads it back, by shape alone.
  const again = setup(DEFAULTS, { local, session });
  assert.deepEqual(again.backend.localSources(), sources);
  assert.deepEqual(again.calls, []);
});

test('a refused import changes nothing, and neither does a second that is refused after one that imported', async () => {
  const { backend, session } = setup();
  const bomb = HOSTILE_FIXTURES.find(({ expect }) => expect === 'parse_limits')!;
  assert.equal((await backend.importFiles(bomb.files))?.kind, 'refused');
  assert.equal(backend.localSources(), null);
  assert.deepEqual([...session.items.keys()], []);
  await backend.importFiles(example());
  const first = backend.localSources();
  const stored = session.getItem(WORKING_KEY);
  const invalid = HOSTILE_FIXTURES.find(({ expect }) => expect === 'invalid')!;
  assert.equal((await backend.importFiles(invalid.files))?.kind, 'refused');
  assert.equal(backend.localSources(), first);
  assert.equal(session.getItem(WORKING_KEY), stored);
});

test("startDraft starts the local source from the sample's documents, and saveDraft replaces it only with documents the validator takes, at the version it names", async () => {
  const { backend, calls } = setup();
  const started = await backend.startDraft();
  const draft = started.kind === 'saved' ? started.draft : assert.fail(JSON.stringify(started));
  assert.equal(draft.draftId, LOCAL_DRAFT_ID);
  assert.equal(draft.baseRevisionId, null);
  assert.equal(draft.documents.site.sourceText, UNIT.documents.site.sourceText);
  // A second start keeps what there is.
  assert.deepEqual(await backend.startDraft(), started);
  const documents = {
    portfolio: { format: 'yaml' as const, sourceText: EXAMPLE.portfolio },
    site: { format: 'yaml' as const, sourceText: EXAMPLE.site },
  };
  // A stale version, or the sample's draft, is no save.
  const conflict = await backend.saveDraft({
    draftId: LOCAL_DRAFT_ID,
    expectedVersion: 1,
    documents,
  });
  assert.equal(conflict.kind, 'conflict');
  const other = await backend.saveDraft({
    draftId: DEMO_DRAFT_ID,
    expectedVersion: draft.version,
    documents,
  });
  assert.equal(other.kind === 'failed' && other.code, 'not_found');
  assert.deepEqual(calls, []);
  // Documents the validator refuses: nothing changes, and the message repeats nothing from them.
  const refused = await backend.saveDraft({
    draftId: LOCAL_DRAFT_ID,
    expectedVersion: draft.version,
    documents: {
      ...documents,
      portfolio: {
        format: 'yaml',
        sourceText: `schemaVersion: 3\nidentity: { name: ${CANARY} }\n`,
      },
    },
  });
  assert.equal(refused.kind === 'failed' && refused.code, 'validation_failed');
  assert.equal(JSON.stringify(refused).includes(CANARY), false);
  assert.equal(backend.localSources()?.site.text, UNIT.documents.site.sourceText);
  // And documents it takes, checked in the worker as the bytes of their own text.
  const saved = await backend.saveDraft({
    draftId: LOCAL_DRAFT_ID,
    expectedVersion: draft.version,
    documents,
  });
  assert.equal(saved.kind, 'saved');
  assert.deepEqual(decoded(calls.at(-1)!), [EXAMPLE.portfolio, EXAMPLE.site]);
  assert.equal(backend.localSources()?.portfolio.text, EXAMPLE.portfolio);
  assert.equal(saved.kind === 'saved' && saved.draft.version, draft.version + 1);
});

test("an appearance edit names the local source's draft once there is one, and the selection stays apart from its documents", async () => {
  const { backend } = setup();
  await backend.importFiles(example());
  const version = backend.version();
  const stale = await backend.applyEdits({
    draftId: DEMO_DRAFT_ID,
    expectedVersion: version,
    edits: [set('variant', 'acme-orbit')],
  });
  assert.equal(stale.kind === 'failed' && stale.code, 'not_found');
  const saved = await backend.applyEdits({
    draftId: LOCAL_DRAFT_ID,
    expectedVersion: version,
    edits: [set('variant', 'acme-orbit')],
  });
  assert.equal(saved.kind, 'saved');
  assert.equal(backend.selection().variant, 'acme-orbit');
  assert.equal(backend.localSources()?.site.text, EXAMPLE.site);
});

test('a full reset drops the local source with every portfolio-demo: key, and the sample is the source again', async () => {
  const { backend, session } = setup();
  await backend.importFiles(example());
  backend.resetAll();
  assert.equal(backend.localSources(), null);
  assert.deepEqual([...session.items.keys()], []);
  const working = await backend.workingDraft();
  assert.equal(working.kind === 'read' && working.value?.draftId, DEMO_DRAFT_ID);
});

test("a working copy that isn't one reads as none, and is never parsed as a document", () => {
  const session = new FakeStorage();
  const store = demoStore(new FakeStorage(), session);
  assert.equal(storedWorking(store), null);
  for (const text of [
    'copy',
    '{}',
    JSON.stringify({ sources: { portfolio: { name: 'p', format: 'yaml', text: 'x' } } }),
    JSON.stringify({
      sources: {
        portfolio: { name: 'p', format: 'xml', text: 'x' },
        site: { name: 's', format: 'yaml', text: 'y' },
      },
    }),
  ]) {
    session.setItem(WORKING_KEY, text);
    assert.equal(storedWorking(store), null, text);
  }
  const sources = {
    portfolio: { name: 'portfolio.yml', format: 'yaml', text: 'a: [' },
    site: { name: 'site.json', format: 'json', text: '{' },
  };
  session.setItem(WORKING_KEY, JSON.stringify({ sources }));
  assert.deepEqual(storedWorking(store), sources);
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

test("while the reference shows, an edit or an axis reset stays in the page, so a bare /studio still opens the sample's own selection", async () => {
  const { backend, local } = setup();
  const edit = (value: string) =>
    backend.applyEdits({
      draftId: DEMO_DRAFT_ID,
      expectedVersion: backend.version(),
      edits: [set('displayMode', value)],
    });
  // The sample's own choice, kept.
  assert.equal((await edit('dark')).kind, 'saved');
  const sample = local.items.get(SELECTION_KEY);
  assert.equal(JSON.parse(sample!).displayMode, 'dark');

  const own = { ...DEFAULTS, variant: 'acme-orbit' };
  backend.showSource(own);
  assert.equal((await edit('light')).kind, 'saved');
  assert.equal(backend.selection().displayMode, 'light');
  assert.equal(backend.selection().variant, 'acme-orbit');
  backend.resetAxis('displayMode');
  assert.equal(local.items.get(SELECTION_KEY), sample, "the reference's look is never stored");

  // Back on the sample, an edit is kept again.
  backend.showSource(null);
  assert.equal((await edit('light')).kind, 'saved');
  assert.deepEqual(JSON.parse(local.items.get(SELECTION_KEY)!), {
    ...DEFAULTS,
    displayMode: 'light',
  });
});

test('an import still in the worker when Reset demo comes keeps nothing: no local source, no working copy, and nothing to report (F2)', async () => {
  const worker = gated();
  const { backend, session } = setup(DEFAULTS, { checks: { run: worker.run, calls: [] } });
  const controller = new AbortController();
  const pending = backend.importFiles(example(), { signal: controller.signal });
  // The signal goes to the worker's import, which stops on it.
  assert.equal(worker.calls[0]?.options?.signal, controller.signal);
  backend.resetAll();
  await worker.release();
  assert.equal(await pending, null);
  assert.equal(backend.localSources(), null);
  assert.deepEqual([...session.items.keys()], []);
  assert.equal(await backend.report(), null);
  const working = await backend.workingDraft();
  assert.equal(working.kind === 'read' && working.value?.draftId, DEMO_DRAFT_ID);
  // One that starts after the reset is kept as ever.
  const next = backend.importFiles(example());
  await worker.release();
  assert.equal((await next)?.kind, 'imported');
  assert.ok(backend.localSources());
});

test('a save still in the worker when Reset demo comes saves nothing, and says so (F2)', async () => {
  const worker = gated();
  const { backend, session } = setup(DEFAULTS, { checks: { run: worker.run, calls: [] } });
  const started = await backend.startDraft();
  const draft = started.kind === 'saved' ? started.draft : assert.fail();
  const pending = backend.saveDraft({
    draftId: LOCAL_DRAFT_ID,
    expectedVersion: draft.version,
    documents: {
      portfolio: { format: 'yaml', sourceText: EXAMPLE.portfolio },
      site: { format: 'yaml', sourceText: EXAMPLE.site },
    },
  });
  backend.resetAll();
  await worker.release();
  assert.deepEqual(await pending, {
    kind: 'failed',
    code: 'not_found',
    message: RESET_WHILE_CHECKED,
  });
  assert.equal(backend.localSources(), null);
  assert.deepEqual([...session.items.keys()], []);
});

test("report() gives an import's own answer, and checks a working copy a reload brought back in the worker once, so its findings and notices show again (F6)", async () => {
  const { backend, local, session, calls } = setup();
  assert.equal(await backend.report(), null);
  const imported = await backend.importFiles(example());
  assert.equal(imported?.kind, 'imported');
  assert.equal(calls.length, 1);
  // The import's own answer, with no second check.
  assert.equal(await backend.report(), imported);
  assert.equal(calls.length, 1);
  // A reload: the copy reads back by shape, and nothing checks it until it's asked for.
  const again = setup(DEFAULTS, { local, session });
  assert.deepEqual(again.calls, []);
  const kept = await again.backend.report();
  assert.equal(kept?.kind, 'imported');
  assert.deepEqual(kept, imported);
  assert.equal(again.calls.length, 1);
  assert.deepEqual(decoded(again.calls[0]!), [EXAMPLE.portfolio, EXAMPLE.site]);
  // Once per copy: a task opened again reads the same answer.
  assert.equal(await again.backend.report(), kept);
  assert.equal(again.calls.length, 1);
  again.backend.resetAll();
  assert.equal(await again.backend.report(), null);
});

test("a kept copy's check that couldn't run is tried again the next time, and one the worker refuses stays refused (F6)", async () => {
  const session = new FakeStorage();
  const first = setup(DEFAULTS, { session });
  await first.backend.importFiles(example());
  let answer: ImportResult = { kind: 'refused', code: 'worker_unavailable', diagnostics: [] };
  const calls: (readonly ImportInput[])[] = [];
  const flaky: Importer = async (files) => {
    calls.push(files);
    return answer;
  };
  const { backend } = setup(DEFAULTS, { session, checks: { run: flaky, calls } });
  assert.equal((await backend.report())?.kind, 'refused');
  await new Promise((resolve) => setTimeout(resolve, 0));
  answer = runImport(example());
  assert.equal((await backend.report())?.kind, 'imported');
  assert.equal(calls.length, 2);
  assert.equal((await backend.report())?.kind, 'imported');
  assert.equal(calls.length, 2);
});
