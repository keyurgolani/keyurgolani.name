import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { VariantManifest, ViewDeclaration } from './manifest-schema';
import { dispatch, href, idFor, normalizeBasePath, type RouteTarget } from './routes';
import { RESERVED_SEGMENTS } from './segments';
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
  for (const segment of [
    'studio',
    'api',
    '_next',
    'sample',
    'preview',
    'work',
    'feed.xml',
    'robots.txt',
    'sitemap.xml',
  ]) {
    assert.ok(RESERVED_SEGMENTS.includes(segment), segment);
  }
});

test('idFor uses the stable id, else kind and index, and suffixes repeats', () => {
  const taken = new Set<string>();
  assert.equal(idFor({ id: 'essays', kind: 'writings' }, 0, taken), 'essays');
  assert.equal(idFor({ id: 'essays', kind: 'writings' }, 1, taken), 'essays-2');
  assert.equal(idFor({ id: 'essays', kind: 'writings' }, 2, taken), 'essays-3');
  assert.equal(idFor({ kind: 'gallery' }, 3, taken), 'gallery-3');
  assert.equal(idFor({ kind: '@acme/photo/shows' }, 4, taken), 'acme-photo-shows-4');
  // `main` is the variant's <main>, so a section never takes it.
  assert.equal(idFor({ id: 'main', kind: 'lede' }, 5, taken), 'lede-5');
  // Never the title.
  assert.equal(
    idFor({ id: 'Not An Id', kind: 'quote', title: 'My Quote' } as never, 6, taken),
    'quote-6',
  );
});
