import test from 'node:test';
import assert from 'node:assert/strict';
import { QUERY_KEYS } from '@portfolio/appearance';
import { CATALOG, DEFAULTS, SCHEME_MODES } from './test-support';
import {
  carriesSelection,
  frameSource,
  loadSelection,
  modeFits,
  selectionFrom,
  selectionProblem,
  selectionQuery,
  sourceFrom,
  studioLocation,
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
