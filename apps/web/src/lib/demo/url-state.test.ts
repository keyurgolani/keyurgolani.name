import test from 'node:test';
import assert from 'node:assert/strict';
import { QUERY_KEYS } from '@portfolio/appearance';
import { CATALOG, DEFAULTS, SCHEME_MODES } from './test-support';
import {
  carriesSelection,
  caseStudySlug,
  frameKind,
  frameSource,
  holdsMotion,
  loadSelection,
  modeFits,
  pageOfRoute,
  pageRoute,
  selectionFrom,
  selectionProblem,
  selectionSteps,
  selectionQuery,
  sourceAfterImport,
  sourceFrom,
  studioLocation,
  taskFragment,
} from './url-state';

// Demo Studio's selection in the URL (#9): #19's query keys, checked
// against the catalog the page was given, falling back axis by axis.

const RULES = { catalog: CATALOG, schemeModes: SCHEME_MODES };
const query = (text: string) => new URLSearchParams(text);

test("the Studio URL and its frame's speak #19's query keys, the ones /sample reads", () => {
  const all = selectionQuery(
    {
      variant: 'acme-orbit',
      designLanguage: 'platform-neutral',
      colorScheme: 'warm-parchment',
      typography: 'humanist-ui',
      displayMode: 'dark',
    },
    RULES,
  );
  assert.deepEqual([...all.keys()], Object.values(QUERY_KEYS));
  assert.equal(
    all.toString(),
    'variant=acme-orbit&language=platform-neutral&scheme=warm-parchment&type=humanist-ui&mode=dark',
  );
});

test('a value the catalog offers counts on its own axis, and anything else keeps the fallback there', () => {
  assert.deepEqual(selectionFrom(query('variant=acme-gallery&mode=dark'), DEFAULTS, RULES), {
    ...DEFAULTS,
    variant: 'acme-gallery',
    displayMode: 'dark',
  });
  for (const text of [
    'variant=fallback',
    'variant=canary-variant',
    'variant=',
    'variant=acme-orbit&variant=acme-orbit',
    'variant=ACME-ORBIT',
    'mode=sepia',
    'language=humanist-ui',
    'designLanguage=platform-neutral',
  ]) {
    assert.deepEqual(selectionFrom(query(text), DEFAULTS, RULES), DEFAULTS, text);
  }
});

test('a scheme and a mode go together: a mode the scheme lacks gives way', () => {
  assert.equal(modeFits(SCHEME_MODES, 'night-only', 'light'), false);
  assert.equal(modeFits(SCHEME_MODES, 'night-only', 'system'), true);
  assert.equal(modeFits(SCHEME_MODES, 'night-only', 'high-contrast'), true);
  assert.equal(modeFits(SCHEME_MODES, 'unknown-scheme', 'light'), true);
  assert.deepEqual(selectionFrom(query('scheme=night-only&mode=light'), DEFAULTS, RULES), {
    ...DEFAULTS,
    colorScheme: 'night-only',
  });
  assert.match(
    selectionProblem(RULES, { ...DEFAULTS, colorScheme: 'night-only' }, 'displayMode', 'light') ??
      '',
    /no light mode/,
  );
  assert.match(
    selectionProblem(RULES, { ...DEFAULTS, displayMode: 'light' }, 'colorScheme', 'night-only') ??
      '',
    /no light mode/,
  );
  assert.match(
    selectionProblem(RULES, DEFAULTS, 'variant', 'canary-variant') ?? '',
    /doesn't offer/,
  );
  assert.equal(selectionProblem(RULES, DEFAULTS, 'variant', 'acme-orbit'), null);
});

test('a page load takes the URL, then the stored selection on a bare /studio alone, then the sample', () => {
  const stored = { ...DEFAULTS, variant: 'acme-gallery' };
  assert.deepEqual(
    loadSelection({ search: query('mode=dark'), stored, defaults: DEFAULTS, rules: RULES }),
    {
      selection: { ...DEFAULTS, displayMode: 'dark' },
      from: 'url',
    },
  );
  assert.deepEqual(loadSelection({ search: query(''), stored, defaults: DEFAULTS, rules: RULES }), {
    selection: stored,
    from: 'stored',
  });
  // Any query at all is no bare visit, even one that carries no selection.
  assert.deepEqual(
    loadSelection({ search: query('x=1'), stored, defaults: DEFAULTS, rules: RULES }),
    {
      selection: DEFAULTS,
      from: 'default',
    },
  );
  assert.deepEqual(
    loadSelection({ search: query(''), stored: null, defaults: DEFAULTS, rules: RULES }),
    {
      selection: DEFAULTS,
      from: 'default',
    },
  );
  // A stored value the catalog no longer offers falls back on its axis.
  assert.deepEqual(
    loadSelection({
      search: query(''),
      stored: { ...stored, typography: 'gone-pack' },
      defaults: DEFAULTS,
      rules: RULES,
    }).selection,
    stored,
  );
  assert.equal(carriesSelection(query('type=humanist-ui')), true);
  assert.equal(carriesSelection(query('typography=humanist-ui')), false);
});

test("a value the catalog doesn't offer, such as the sample's own unregistered composition, stays out of every URL", () => {
  assert.equal(
    selectionQuery(DEFAULTS, RULES).toString(),
    'language=platform-neutral&scheme=warm-parchment&type=humanist-ui&mode=system',
  );
});

test('a frame reloaded for a scheme, type, or language loads held still, and a composition plays again (DEM-2)', () => {
  const orbit = { ...DEFAULTS, variant: 'acme-orbit' };
  // Held still wins over reduced, being lower.
  assert.equal(
    frameSource(orbit, RULES, { holdMotion: true, reduceMotion: true }),
    `${frameSource(orbit, RULES)}&motion=static`,
  );
  // The first load, and a composition's change, play.
  assert.equal(holdsMotion(null, orbit, true), false);
  assert.equal(holdsMotion(orbit, { ...orbit, variant: 'acme-ocean' }, true), false);
  // Each pack axis holds.
  for (const axis of ['colorScheme', 'typography', 'designLanguage'] as const) {
    assert.equal(holdsMotion(orbit, { ...orbit, [axis]: 'another' }, false), true, axis);
  }
  // Another change keeps what it was.
  const dark = { ...orbit, displayMode: 'dark' };
  assert.equal(holdsMotion(orbit, dark, false), false);
  assert.equal(holdsMotion(orbit, dark, true), true);
});

test('the frame loads /sample on the same origin with the selection, and motion=reduce only when asked', () => {
  const chosen = { ...DEFAULTS, variant: 'acme-orbit', displayMode: 'dark' };
  assert.equal(
    frameSource(chosen, RULES),
    '/sample?variant=acme-orbit&language=platform-neutral&scheme=warm-parchment&type=humanist-ui&mode=dark',
  );
  assert.equal(
    frameSource(chosen, RULES, { reduceMotion: true }),
    '/sample?variant=acme-orbit&language=platform-neutral&scheme=warm-parchment&type=humanist-ui&mode=dark&motion=reduce',
  );
  assert.equal(frameSource(DEFAULTS, { catalog: { axes: [] } }), '/sample');
  for (const each of [chosen, DEFAULTS]) {
    assert.match(frameSource(each, RULES), /^\/sample(?:\?|$)/);
    assert.doesNotMatch(frameSource(each, RULES), /preview|grant/);
  }
});

test("Studio's own URL keeps its path and its task, with the selection in between", () => {
  assert.equal(
    studioLocation('/studio', '#preview', { ...DEFAULTS, displayMode: 'dark' }, RULES),
    '/studio?language=platform-neutral&scheme=warm-parchment&type=humanist-ui&mode=dark#preview',
  );
  assert.equal(studioLocation('/studio', '', DEFAULTS, { catalog: { axes: [] } }), '/studio');
});

test('the URL names the reference only when the page has one, and only as exactly source=reference (#9)', () => {
  assert.equal(sourceFrom(query('source=reference'), true), 'reference');
  for (const text of [
    '',
    'source=sample',
    'source=Reference',
    'source=reference&source=reference',
    'source=local',
  ]) {
    assert.equal(sourceFrom(query(text), true), 'sample', text);
  }
  // A demo with no reference opens the sample, whatever the URL asks.
  assert.equal(sourceFrom(query('source=reference'), false), 'sample');
});

test('the Studio URL carries source=reference while the reference shows, and its frame /reference with no source key', () => {
  assert.equal(
    studioLocation('/studio', '#appearance', DEFAULTS, { catalog: { axes: [] } }, 'reference'),
    '/studio?source=reference#appearance',
  );
  assert.equal(
    studioLocation('/studio', '', DEFAULTS, { catalog: { axes: [] } }, 'sample'),
    '/studio',
  );
  const sample = frameSource(DEFAULTS, RULES);
  const reference = frameSource(DEFAULTS, RULES, { source: 'reference' });
  assert.match(sample, /^\/sample(?:\?|$)/);
  assert.equal(reference, sample.replace(/^\/sample/, '/reference'));
  assert.doesNotMatch(reference, /source=/);
  assert.equal(
    frameSource(DEFAULTS, RULES, { source: 'reference', reduceMotion: true }),
    frameSource(DEFAULTS, RULES, { reduceMotion: true }).replace(/^\/sample/, '/reference'),
  );
  // A source key in the Studio URL is no selection: a stored one still waits for a bare visit.
  assert.equal(carriesSelection(query('source=reference')), false);
});

test("the URL keeps the task a `task` query opened, as its fragment, once the selection's query takes the query's place", () => {
  assert.equal(taskFragment('?task=content', ''), '#content');
  assert.equal(taskFragment('?variant=acme-orbit&task=appearance', ''), '#appearance');
  // A fragment the URL has wins, as the shell reads it first.
  assert.equal(taskFragment('?task=content', '#preview'), '#preview');
  assert.equal(taskFragment('', ''), '');
  // Nothing but a task's id goes into the fragment.
  for (const search of [
    '?task=',
    '?task=Content',
    '?task=%3Cimg%3E',
    '?task=a%23b',
    '?task=../x',
  ]) {
    assert.equal(taskFragment(search, ''), '', search);
  }
  assert.equal(
    studioLocation('/studio', taskFragment('?task=content', ''), DEFAULTS, {
      catalog: { axes: [] },
    }),
    '/studio#content',
  );
});

test("Demo Studio's frame is the reference while the visitor asked for it, else their imported pair, else the sample, and a new import switches off the reference", () => {
  type State = { source: 'sample' | 'reference'; imported: boolean };
  const shows = ({ source, imported }: State) => frameKind(source, imported);
  const importLands = (state: State): State => ({
    source: sourceAfterImport(state.source, true),
    imported: true,
  });
  // The sample alone.
  let state: State = { source: 'sample', imported: false };
  assert.equal(shows(state), 'sample');
  // The reference asked for, with no import.
  state = { ...state, source: 'reference' };
  assert.equal(shows(state), 'reference');
  // An import, with no reference asked for.
  assert.equal(shows(importLands({ source: 'sample', imported: false })), 'local');
  // The reference asked for, then an import lands: the frame is local, and the reference is off.
  state = importLands(state);
  assert.deepEqual(state, { source: 'sample', imported: true });
  assert.equal(shows(state), 'local');
  // The reference asked for again while the pair is there: the reference, and back, the pair.
  state = { ...state, source: 'reference' };
  assert.equal(shows(state), 'reference');
  state = { ...state, source: 'sample' };
  assert.equal(shows(state), 'local');
  // Reset demo: no pair, the sample's source, the sample.
  state = { source: 'sample', imported: false };
  assert.equal(shows(state), 'sample');
  // No import landing, a refusal or a reset's null, leaves the source as it was.
  assert.equal(sourceAfterImport('reference', false), 'reference');
  assert.equal(sourceAfterImport('sample', false), 'sample');
});

test('a move across axes goes in an order each step passes: a scheme that lacks the mode passes through System', () => {
  const steps = (from: typeof DEFAULTS, to: typeof DEFAULTS) => selectionSteps(RULES, from, to);
  assert.deepEqual(steps(DEFAULTS, DEFAULTS), []);
  assert.deepEqual(steps(DEFAULTS, { ...DEFAULTS, variant: 'acme-orbit' }), [
    { axis: 'variant', value: 'acme-orbit' },
  ]);
  const light = { ...DEFAULTS, displayMode: 'light' };
  const night = { ...light, colorScheme: 'night-only', displayMode: 'dark' };
  assert.deepEqual(steps(light, night), [
    { axis: 'displayMode', value: 'system' },
    { axis: 'colorScheme', value: 'night-only' },
    { axis: 'displayMode', value: 'dark' },
  ]);
  // Each step, applied in turn, is one the rules accept.
  let at: typeof DEFAULTS = light;
  for (const step of steps(light, night)) {
    assert.equal(selectionProblem(RULES, at, step.axis, step.value), null, step.axis);
    at = { ...at, [step.axis]: step.value };
  }
  assert.deepEqual(at, night);
});

test('a composition still in progress (A2) is never set by a URL, a stored selection or a pick', () => {
  const pending = {
    ...RULES,
    catalog: {
      axes: CATALOG.axes.map((entry) =>
        entry.axis === 'variant'
          ? {
              ...entry,
              options: entry.options.map((each) =>
                each.id === 'acme-gallery'
                  ? { ...each, status: 'pending' as const, statusLabel: 'In progress' }
                  : each,
              ),
            }
          : entry,
      ),
    },
  };
  assert.deepEqual(selectionFrom(query('variant=acme-gallery'), DEFAULTS, pending), DEFAULTS);
  assert.deepEqual(
    loadSelection({
      search: query(''),
      stored: { ...DEFAULTS, variant: 'acme-gallery' },
      defaults: DEFAULTS,
      rules: pending,
    }).selection,
    DEFAULTS,
  );
  assert.equal(
    selectionProblem(pending, DEFAULTS, 'variant', 'acme-gallery'),
    "acme-gallery is in progress, so it can't be picked yet.",
  );
  assert.equal(selectionProblem(pending, DEFAULTS, 'variant', 'acme-orbit'), null);
});

test('the page switch keeps the selection: Home, its Work section, or a case study by slug', () => {
  const rules = { catalog: CATALOG, schemeModes: SCHEME_MODES };
  const home = frameSource(DEFAULTS, rules);
  assert.match(home, /^\/sample(?:\?|$)/);
  const query = home.slice('/sample'.length);
  assert.equal(frameSource(DEFAULTS, rules, { page: { kind: 'work' } }), `/sample${query}#work`);
  assert.equal(
    frameSource(DEFAULTS, rules, { page: { kind: 'case', slug: 'small-traces' } }),
    `/sample/work/small-traces${query}`,
  );
  assert.equal(pageRoute({ kind: 'case', slug: 'small-traces' }), '/work/small-traces');
  assert.equal(pageRoute({ kind: 'work' }), '/');
  assert.equal(pageOfRoute('/work/small-traces'), 'case');
  assert.equal(pageOfRoute('/'), 'home');
  assert.equal(
    caseStudySlug({
      signature: 'kit',
      works: [
        { id: 'other', slug: 'other', caseStudy: {} },
        { id: 'kit', slug: 'postmortem-template-kit', caseStudy: {} },
      ],
    }),
    'postmortem-template-kit',
  );
  assert.equal(caseStudySlug({ works: [{ id: 'a', slug: 'a' }] }), null);
  assert.equal(caseStudySlug(null), null);
});
