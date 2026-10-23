import test from 'node:test';
import assert from 'node:assert/strict';
import { REGISTRY_ID_PATTERN } from '@portfolio/schema';
import { setLiveComposition } from './config-store';
import { rendersWorkPage } from '../lib/work-page';
import {
  experiencePattern,
  isExperiencePath,
  isWorkPage,
  SAMPLE_PATTERN,
  segmentFor,
} from './experience';
import { EXPERIENCE_ID, EXPERIENCE_SEGMENT } from './route-header';

// Which experience segment a visitor page renders in (#6, Slice 2), from
// memory alone: the live composition config-store holds, and under demo,
// /sample's `variant` parameter, both checked against what the build
// registers.

const shared = { work: 'shared' } as const;
const REGISTERED = [
  { manifest: { id: 'fallback', routes: shared } },
  { manifest: { id: 'acme-tiles', routes: shared } },
  { manifest: { id: 'acme-notes', routes: shared } },
];

const query = (text = '') => new URLSearchParams(text);

test('an experience segment sits at /_experience/<id>, its route catching every path below, for any id the registry takes', () => {
  assert.equal(EXPERIENCE_SEGMENT, '_experience');
  assert.equal(experiencePattern('acme-tiles'), '/_experience/acme-tiles/[[...route]]');
  // next.config.ts matches proxy.ts's mark of one whole against EXPERIENCE_ID.
  assert.equal(`^${EXPERIENCE_ID}$`, REGISTRY_ID_PATTERN.source);
  assert.equal(REGISTRY_ID_PATTERN.flags, '');
});

test("an experience segment's own path is one in any case or encoding, and nothing else is", () => {
  for (const path of [
    '/_experience',
    '/_experience/fallback',
    '/_experience/fallback/work/tide-tables',
    '/%5Fexperience/fallback',
    '/%5fexperience',
    '/_EXPERIENCE/fallback',
    '/_Experience',
    '/_experience%2Ffallback',
    '/%5Fexperience%2Ffallback%2Fwork',
    '/_experience.rsc',
    '//_experience/fallback',
  ]) {
    assert.ok(isExperiencePath(path), path);
  }
  for (const path of [
    '/',
    '/experience',
    '/_experiences',
    '/_experience-x',
    '/work/_experience',
    '/sample/_experience',
    '/_portfolio/variant/fallback.css',
    '/%E0%A4%A',
  ]) {
    assert.equal(isExperiencePath(path), false, path);
  }
});

test("under owner and read-only it's the live composition, whatever the query says", (t) => {
  t.after(() => setLiveComposition(undefined));
  for (const profile of ['owner', 'read-only'] as const) {
    for (const [pattern, segments] of [
      ['/', []],
      ['/[...view]', ['notes']],
      ['/work/[slug]/[...view]', ['work', 'tide-tables', 'credits']],
    ] as const) {
      setLiveComposition('acme-tiles');
      assert.equal(
        segmentFor({ profile, pattern, segments, query: query('variant=acme-notes') }, REGISTERED),
        'acme-tiles',
        `${profile} ${pattern}`,
      );
      // None yet, or one this build doesn't register: the fallback composition.
      for (const live of [undefined, 'acme-gone', 'fallback']) {
        setLiveComposition(live);
        assert.equal(
          segmentFor({ profile, pattern, segments, query: query() }, REGISTERED),
          'fallback',
          `${profile} ${pattern} ${live}`,
        );
      }
    }
  }
});

test("under demo, /sample's ?variant= names one registered variant, any other value is the fallback composition's, and only /sample reads it", (t) => {
  t.after(() => setLiveComposition(undefined));
  setLiveComposition('acme-tiles');
  const sample = (text: string) =>
    segmentFor(
      { profile: 'demo', pattern: SAMPLE_PATTERN, segments: ['sample'], query: query(text) },
      REGISTERED,
    );
  assert.equal(sample(''), 'acme-tiles', "the sample site's own selection");
  assert.equal(sample('variant=acme-notes'), 'acme-notes');
  for (const text of [
    'variant=acme-gone',
    'variant=fallback',
    'variant=',
    'variant=acme-notes&variant=acme-tiles',
    'variant=ACME-NOTES',
  ]) {
    assert.equal(sample(text), 'fallback', text);
  }
  assert.equal(
    segmentFor(
      { profile: 'demo', pattern: '/', segments: [], query: query('variant=acme-notes') },
      REGISTERED,
    ),
    'acme-tiles',
    'the site root ignores it',
  );
  // /sample is demo's alone: another profile never reads the parameter.
  assert.equal(
    segmentFor(
      {
        profile: 'read-only',
        pattern: SAMPLE_PATTERN,
        segments: ['sample'],
        query: query('variant=acme-notes'),
      },
      REGISTERED,
    ),
    'acme-tiles',
  );
});

test("a work's own page is /work/<slug>, or /sample/work/<slug>, and no view below one (#10b)", () => {
  for (const [pattern, segments] of [
    ['/work/[slug]', ['work', 'tide-tables']],
    [SAMPLE_PATTERN, ['sample', 'work', 'tide-tables']],
  ] as const) {
    assert.ok(isWorkPage({ pattern, segments }), segments.join('/'));
  }
  for (const [pattern, segments] of [
    ['/', []],
    ['/[...view]', ['notes']],
    ['/work/[slug]/[...view]', ['work', 'tide-tables', 'credits']],
    [SAMPLE_PATTERN, ['sample']],
    [SAMPLE_PATTERN, ['sample', 'work']],
    [SAMPLE_PATTERN, ['sample', 'notes', 'tide-tables']],
    [SAMPLE_PATTERN, ['sample', 'work', 'tide-tables', 'credits']],
  ] as const) {
    assert.equal(isWorkPage({ pattern, segments }), false, segments.join('/'));
  }
});

test("a work's own page goes to the fallback composition's segment when the composition says routes.work: shared, and stays in one that says bespoke (#10b)", (t) => {
  t.after(() => setLiveComposition(undefined));
  const registered = [
    ...REGISTERED,
    { manifest: { id: 'acme-pages', routes: { work: 'bespoke' } } },
  ] as const;
  const work = ['work', 'tide-tables'];
  for (const profile of ['owner', 'read-only'] as const) {
    const at = (pattern: string, segments: readonly string[]) =>
      segmentFor({ profile, pattern, segments, query: query() }, registered);
    setLiveComposition('acme-pages');
    assert.equal(at('/work/[slug]', work), 'acme-pages', profile);
    setLiveComposition('acme-tiles');
    assert.equal(at('/work/[slug]', work), 'fallback', profile);
    // Its home and the views below a work stay its own.
    assert.equal(at('/', []), 'acme-tiles', profile);
    assert.equal(at('/work/[slug]/[...view]', [...work, 'credits']), 'acme-tiles', profile);
    for (const live of [undefined, 'acme-gone']) {
      setLiveComposition(live);
      assert.equal(at('/work/[slug]', work), 'fallback', `${profile} ${live}`);
    }
  }
  // Under demo, the composition ?variant= names takes the same rule.
  setLiveComposition('acme-tiles');
  const sample = (segments: readonly string[], text = '') =>
    segmentFor(
      { profile: 'demo', pattern: SAMPLE_PATTERN, segments, query: query(text) },
      registered,
    );
  assert.equal(sample(['sample', ...work]), 'fallback', "the sample site's own selection");
  assert.equal(sample(['sample', ...work], 'variant=acme-pages'), 'acme-pages');
  assert.equal(sample(['sample', ...work], 'variant=acme-notes'), 'fallback');
  assert.equal(sample(['sample', ...work, 'credits'], 'variant=acme-notes'), 'acme-notes');
  assert.equal(sample(['sample'], 'variant=acme-notes'), 'acme-notes');
});

test("the work page's rule: the fallback composition and a bespoke work route render it, a shared one doesn't (#10b)", () => {
  assert.equal(rendersWorkPage({ id: 'fallback', routes: { work: 'shared' } }), true);
  assert.equal(rendersWorkPage({ id: 'acme-pages', routes: { work: 'bespoke' } }), true);
  assert.equal(rendersWorkPage({ id: 'acme-tiles', routes: { work: 'shared' } }), false);
});
