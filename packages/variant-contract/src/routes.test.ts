import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { VariantManifest, ViewDeclaration } from './manifest-schema';
import { dispatch, href, idFor, normalizeBasePath, routeHref, type RouteTarget } from './routes';
import { matchPathView, PARAM_VALUE_MAX_LENGTH, RESERVED_SEGMENTS } from './segments';
import { validateManifest } from './validate-manifest';

// Routes (#5, Slice 1, item 3): dispatch() turns a path into home, work, or a
// view, honoring the site's toggles; href() writes the URL back under any
// base path, including #7's preview prefix; idFor() gives stable DOM ids.

function load(id: string, views: readonly ViewDeclaration[]): VariantManifest {
  const raw = JSON.parse(
    readFileSync(new URL('./__fixtures__/manifest.json', import.meta.url), 'utf8'),
  );
  raw.id = id;
  raw.routes.views = views;
  const result = validateManifest(raw, { packageName: '@acme/ocean' });
  assert.ok(result.ok, JSON.stringify(result.diagnostics));
  return result.manifest;
}

const CHAPTERS: ViewDeclaration = {
  id: 'chapters',
  under: 'home',
  type: 'path',
  segment: 'chapters/{chapter}',
};
const NOTES: ViewDeclaration = { id: 'notes', under: 'work', type: 'path', segment: 'notes' };
const ANCHOR: ViewDeclaration = {
  id: 'chapter-anchor',
  under: 'home',
  type: 'fragment',
  segment: 'chapter-{chapter}',
};
const OCEAN = load('acme-ocean', [CHAPTERS, NOTES, ANCHOR]);
const REEF = load('acme-reef', [
  { id: 'reels', under: 'home', type: 'path', segment: 'reels/{reel}' },
  { id: 'credits', under: 'work', type: 'path', segment: 'credits' },
]);

const go = (segments: string[], extra: Partial<Parameters<typeof dispatch>[0]> = {}) =>
  dispatch({ segments, manifest: OCEAN, installed: [OCEAN, REEF], ...extra });

test('the root is home, /work/<slug> is work, and declared path views render', () => {
  assert.deepEqual(go([]), { kind: 'render', target: { route: 'home' } });
  assert.deepEqual(go(['work', 'tide-tables']), {
    kind: 'render',
    target: { route: 'work', slug: 'tide-tables' },
  });
  assert.deepEqual(go(['chapters', 'three']), {
    kind: 'render',
    target: { route: 'view', view: CHAPTERS, params: { chapter: 'three' } },
  });
  assert.deepEqual(go(['work', 'tide-tables', 'notes']), {
    kind: 'render',
    target: { route: 'view', view: NOTES, params: {}, slug: 'tide-tables' },
  });
});

test('anything else is not found, including fragment views as paths and odd segments', () => {
  for (const segments of [
    ['chapters'],
    ['chapters', 'three', 'four'],
    ['chapter-three'],
    ['work'],
    ['work', 'Tide'],
    ['work', '..'],
    ['chapters', '..'],
    ['chapters', 'Three'],
    ['notes'],
    ['api', 'ready'],
  ]) {
    assert.deepEqual(go(segments), { kind: 'not-found' }, segments.join('/'));
  }
});

test('a placeholder value or a work slug is at most 64 characters, as a content id is', () => {
  assert.equal(PARAM_VALUE_MAX_LENGTH, 64);
  const longest = 'a'.repeat(PARAM_VALUE_MAX_LENGTH);
  const over = `${longest}b`;
  assert.deepEqual(go(['chapters', longest]), {
    kind: 'render',
    target: { route: 'view', view: CHAPTERS, params: { chapter: longest } },
  });
  for (const segments of [
    ['chapters', over],
    ['chapters', 'x'.repeat(8000)],
    ['work', over],
    ['work', over, 'notes'],
    // Only acme-reef declares reels/{reel}: a long value redirects no more than it renders.
    ['reels', over],
  ]) {
    assert.deepEqual(go(segments), { kind: 'not-found' }, `${segments[0]} ${segments[1]!.length}`);
  }
  // href writes no value dispatch wouldn't read back.
  assert.throws(() => href({ route: 'work', slug: over }), TypeError);
  assert.throws(
    () => href({ route: 'view', view: CHAPTERS, params: { chapter: over } }),
    TypeError,
  );
  assert.throws(() => href({ route: 'view', view: ANCHOR, params: { chapter: over } }), TypeError);
});

test('matchPathView reads a path view the way dispatch does, and a fragment view never', () => {
  assert.deepEqual(matchPathView(CHAPTERS, 'home', ['chapters', 'three']), { chapter: 'three' });
  assert.deepEqual(matchPathView(NOTES, 'work', ['notes']), {});
  assert.equal(matchPathView(CHAPTERS, 'work', ['chapters', 'three']), null);
  assert.equal(matchPathView(CHAPTERS, 'home', ['chapters']), null);
  assert.equal(matchPathView(CHAPTERS, 'home', ['chapters', 'Three']), null);
  assert.equal(matchPathView(ANCHOR, 'home', ['chapter-three']), null);
});

test("the site's toggles turn routes off, but never home", () => {
  const toggles = {
    home: { enabled: false },
    work: { enabled: false },
    chapters: { enabled: false },
  };
  assert.deepEqual(go([], { toggles }), { kind: 'render', target: { route: 'home' } });
  assert.deepEqual(go(['work', 'tide-tables'], { toggles }), { kind: 'not-found' });
  assert.deepEqual(go(['chapters', 'three'], { toggles }), { kind: 'not-found' });
  assert.deepEqual(
    go(['chapters', 'three'], { toggles: { chapters: { enabled: true } } }).kind,
    'render',
  );
});

test('a view only another installed variant declares redirects to its canonical parent', () => {
  assert.deepEqual(go(['reels', 'one']), { kind: 'redirect', location: '/' });
  assert.deepEqual(
    go(['work', 'tide-tables', 'credits'], {
      basePath: '/sample',
      query: { variant: 'acme-ocean' },
    }),
    {
      kind: 'redirect',
      location: '/sample/work/tide-tables?variant=acme-ocean',
    },
  );
  // Under #7's preview prefix, the redirect stays inside the grant.
  assert.deepEqual(go(['reels', 'one'], { basePath: '/preview/g_7Hk-2' }), {
    kind: 'redirect',
    location: '/preview/g_7Hk-2',
  });
  assert.deepEqual(
    go(['work', 'tide-tables', 'credits'], {
      basePath: '/preview/g_7Hk-2',
      query: { variant: 'acme-ocean' },
    }),
    { kind: 'redirect', location: '/preview/g_7Hk-2/work/tide-tables?variant=acme-ocean' },
  );
  // Without the other variant installed, it's just missing.
  assert.deepEqual(go(['reels', 'one'], { installed: [OCEAN] }), { kind: 'not-found' });
  // A view of the rendering variant that's turned off doesn't redirect.
  assert.deepEqual(go(['chapters', 'one'], { toggles: { chapters: { enabled: false } } }), {
    kind: 'not-found',
  });
});

const TARGETS: readonly [RouteTarget, string, string, string][] = [
  // target, at the root, under /sample, under a preview grant
  [{ route: 'home' }, '/', '/sample', '/preview/g_7Hk-2'],
  [
    { route: 'work', slug: 'tide-tables' },
    '/work/tide-tables',
    '/sample/work/tide-tables',
    '/preview/g_7Hk-2/work/tide-tables',
  ],
  [
    { route: 'view', view: CHAPTERS, params: { chapter: 'three' } },
    '/chapters/three',
    '/sample/chapters/three',
    '/preview/g_7Hk-2/chapters/three',
  ],
  [
    { route: 'view', view: NOTES, params: {}, slug: 'tide-tables' },
    '/work/tide-tables/notes',
    '/sample/work/tide-tables/notes',
    '/preview/g_7Hk-2/work/tide-tables/notes',
  ],
  [
    { route: 'view', view: ANCHOR, params: { chapter: 'three' } },
    '/#chapter-three',
    '/sample#chapter-three',
    '/preview/g_7Hk-2#chapter-three',
  ],
];

test('href writes each route under the root, /sample, and a preview grant', () => {
  for (const [target, root, sample, preview] of TARGETS) {
    assert.equal(href(target), root);
    assert.equal(href(target, { basePath: '/' }), root);
    assert.equal(href(target, { basePath: '/sample' }), sample);
    assert.equal(href(target, { basePath: '/preview/g_7Hk-2' }), preview);
  }
});

test('dispatch and href agree: every path href writes dispatches back to its target', () => {
  for (const basePath of ['', '/sample', '/preview/g_7Hk-2']) {
    for (const [target] of TARGETS) {
      if (target.route === 'view' && target.view.type === 'fragment') continue;
      const url = href(target, { basePath });
      const path = url.slice(basePath.length).replace(/^\/$/, '');
      const segments = path.split('/').filter(Boolean);
      assert.deepEqual(go(segments, { basePath }), { kind: 'render', target }, url);
    }
  }
});

test('href keeps the query, before any fragment, in a stable order', () => {
  assert.equal(
    href({ route: 'home' }, { basePath: '/sample', query: { variant: 'acme-ocean', a: 'b c' } }),
    '/sample?a=b+c&variant=acme-ocean',
  );
  assert.equal(
    href({ route: 'view', view: ANCHOR, params: { chapter: 'two' } }, { query: { variant: 'x' } }),
    '/?variant=x#chapter-two',
  );
});

test('routeHref links from a render input: its base path, query, and id prefix', () => {
  const sample = { basePath: '/sample', query: { variant: 'acme-ocean' }, ids: { prefix: 'pv-' } };
  const preview = { basePath: '/preview/g_7Hk-2', query: {}, ids: { prefix: '' } };
  const chapter: RouteTarget = { route: 'view', view: CHAPTERS, params: { chapter: 'three' } };
  const anchor: RouteTarget = { route: 'view', view: ANCHOR, params: { chapter: 'three' } };
  assert.equal(routeHref(sample, { route: 'home' }), '/sample?variant=acme-ocean');
  assert.equal(routeHref(sample, chapter), '/sample/chapters/three?variant=acme-ocean');
  assert.equal(routeHref(sample, anchor), '/sample?variant=acme-ocean#pv-chapter-three');
  assert.equal(routeHref(preview, chapter), '/preview/g_7Hk-2/chapters/three');
  assert.equal(
    routeHref(preview, { route: 'view', view: NOTES, params: {}, slug: 'tide-tables' }),
    '/preview/g_7Hk-2/work/tide-tables/notes',
  );
  // What it writes, dispatch reads back to the same target.
  const segments = routeHref(preview, chapter).slice('/preview/g_7Hk-2/'.length).split('/');
  assert.deepEqual(go(segments, { basePath: preview.basePath }), {
    kind: 'render',
    target: chapter,
  });
});

test('href refuses what it could only write wrong', () => {
  assert.throws(() => href({ route: 'home' }, { basePath: 'sample' }), TypeError);
  assert.throws(() => href({ route: 'home' }, { basePath: '/sample/' }), TypeError);
  assert.throws(() => href({ route: 'home' }, { basePath: '/a?b' }), TypeError);
  assert.throws(() => href({ route: 'work', slug: '../x' }), TypeError);
  assert.throws(() => href({ route: 'view', view: CHAPTERS, params: {} }), TypeError);
  assert.throws(() => href({ route: 'view', view: NOTES, params: {} }), TypeError);
  assert.equal(normalizeBasePath('/'), '');
});

test('the reserved first segments include every host route and metadata file', () => {
  // The host's own test checks its route table against the list too.
  for (const segment of [
    'studio',
    'api',
    '_next',
    '_fixtures',
    '_portfolio',
    '_experience',
    'sample',
    'preview',
    'work',
    'admin',
    'variants',
    'feed.xml',
    'robots.txt',
    'sitemap.xml',
  ]) {
    assert.ok(RESERVED_SEGMENTS.includes(segment), segment);
  }
});

test('idFor uses the stable id, else kind and index, and suffixes repeats', () => {
  const taken = new Set<string>();
  const id = (item: { id?: string; kind: string }, index: number) => idFor(item, index, { taken });
  assert.equal(id({ id: 'essays', kind: 'writings' }, 0), 'essays');
  assert.equal(id({ id: 'essays', kind: 'writings' }, 1), 'essays--2');
  assert.equal(id({ id: 'essays', kind: 'writings' }, 2), 'essays--3');
  assert.equal(id({ kind: 'gallery' }, 3), 'gallery--3');
  assert.equal(id({ kind: '@acme/photo/shows' }, 4), 'acme-photo-shows--4');
  // `main` is the variant's <main>, so a section never takes it.
  assert.equal(id({ id: 'main', kind: 'lede' }, 5), 'lede--5');
  // Never the title.
  assert.equal(id({ id: 'Not An Id', kind: 'quote', title: 'My Quote' } as never, 6), 'quote--6');
});

test("idFor's ids don't depend on the order they're asked for", () => {
  // A fallback or a repeat has two hyphens in a row, which no content id has.
  const items = [
    { kind: 'gallery' },
    { id: 'gallery-0', kind: 'gallery' },
    { id: 'gallery--0', kind: 'gallery' },
  ];
  const forward = new Set<string>();
  const backward = new Set<string>();
  const ids = items.map((item, index) => idFor(item, index, { taken: forward }));
  const reversed = items
    .map((item, index) => [item, index] as const)
    .reverse()
    .map(([item, index]) => idFor(item, index, { taken: backward }))
    .reverse();
  assert.deepEqual(ids, ['gallery--0', 'gallery-0', 'gallery--2']);
  assert.deepEqual(reversed, ids);
});

test("idFor and fragment hrefs carry the render's id prefix, so compositions can share a document", () => {
  const taken = new Set<string>();
  assert.equal(idFor({ id: 'essays', kind: 'writings' }, 0, { taken, prefix: 'pv-' }), 'pv-essays');
  assert.equal(idFor({ id: 'essays', kind: 'writings' }, 0, { taken, prefix: 'st-' }), 'st-essays');
  assert.equal(
    idFor({ id: 'essays', kind: 'writings' }, 1, { taken, prefix: 'pv-' }),
    'pv-essays--2',
  );
  assert.equal(
    href({ route: 'view', view: ANCHOR, params: { chapter: 'two' } }, { idPrefix: 'pv-' }),
    '/#pv-chapter-two',
  );
  assert.equal(
    href({ route: 'view', view: CHAPTERS, params: { chapter: 'two' } }, { idPrefix: 'pv-' }),
    '/chapters/two',
  );
});

test('a literal segment beats a placeholder, whatever order the manifest lists them in', () => {
  const NOTE: ViewDeclaration = {
    id: 'note',
    under: 'home',
    type: 'path',
    segment: 'notes/{note}',
  };
  const ARCHIVE: ViewDeclaration = {
    id: 'archive',
    under: 'home',
    type: 'path',
    segment: 'notes/archive',
  };
  for (const views of [
    [NOTE, ARCHIVE],
    [ARCHIVE, NOTE],
  ]) {
    const manifest = load('acme-notes', views);
    const at = (segments: string[]) => dispatch({ segments, manifest });
    assert.deepEqual(at(['notes', 'archive']), {
      kind: 'render',
      target: { route: 'view', view: ARCHIVE, params: {} },
    });
    assert.deepEqual(at(['notes', 'tuesday']), {
      kind: 'render',
      target: { route: 'view', view: NOTE, params: { note: 'tuesday' } },
    });
  }
});
