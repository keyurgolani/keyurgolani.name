import assert from 'node:assert/strict';
import test from 'node:test';
import { linkedPaths, MAX_LINKS, viewPages, type ViewRoutes } from './view-pages';

// The canary's reach, on planted sites: what hidden.spec.ts reads beside /, and the proof that
// it can still fail. A tool shown on a declared view within two links of / is read; the same
// tool on a view no link reaches, or three links away, is not, so the spec's check that the
// visible tool rendered fails for it; and a composition that declares no view reads / alone,
// whatever pages its site has.

const TOOL = 'visible-tools';

const CHAPTERS: ViewRoutes = {
  routes: {
    views: [
      { under: 'home', type: 'path', segment: 'chapters/{chapter}' },
      { under: 'home', type: 'path', segment: 'back-matter' },
      { under: 'work', type: 'path', segment: 'notes' },
    ],
  },
};
const NO_VIEWS: ViewRoutes = { routes: { views: [] } };

const link = (path: string) => `<a href="${path}?variant=x&amp;mode=light#frag">${path}</a>`;

/** A planted site: each path's HTML. */
function site(pages: Record<string, string>) {
  const asked: string[] = [];
  const get = async (path: string) => {
    asked.push(path);
    return Object.hasOwn(pages, path) ? pages[path]! : null;
  };
  return { home: pages['/']!, get, asked };
}

/** The canary's check, as hidden.spec.ts runs it: the tool on / or a page the reach reads. */
async function reaches(manifest: ViewRoutes, pages: Record<string, string>) {
  const { home, get, asked } = site(pages);
  const read = await viewPages(manifest, home, get);
  return { found: [home, ...read.map((p) => p.html)].join('\n').includes(TOOL), read, asked };
}

test('a tool on a view one or two links from / is read', async () => {
  const one = await reaches(CHAPTERS, {
    '/': `<main>${link('/chapters/now')}</main>`,
    '/chapters/now': `<p>${TOOL}</p>`,
  });
  assert.equal(one.found, true);
  const two = await reaches(CHAPTERS, {
    '/': link('/chapters/first'),
    '/chapters/first': link('/back-matter'),
    '/back-matter': `<p>${TOOL}</p>`,
  });
  assert.equal(two.found, true);
  assert.deepEqual(
    two.read.map((p) => p.path),
    ['/chapters/first', '/back-matter'],
  );
  assert.equal(MAX_LINKS, 2);
});

test('planted: a tool on a view no link from / reaches fails the check', async () => {
  const hidden = await reaches(CHAPTERS, {
    '/': link('/chapters/first'),
    '/chapters/first': '<p>nothing here</p>',
    '/chapters/hidden': `<p>${TOOL}</p>`,
  });
  assert.equal(hidden.found, false, 'the canary must not find a tool no link reaches');
  assert.ok(!hidden.asked.includes('/chapters/hidden'), 'and never asks for that page');
});

test('planted: a tool three links from / fails the check', async () => {
  const far = await reaches(CHAPTERS, {
    '/': link('/chapters/a'),
    '/chapters/a': link('/chapters/b'),
    '/chapters/b': link('/back-matter'),
    '/back-matter': `<p>${TOOL}</p>`,
  });
  assert.equal(far.found, false);
});

test('only declared views under home count: a work page, a work view, or an undeclared path is never read', async () => {
  const other = await reaches(CHAPTERS, {
    '/': [
      link('/work/kit'),
      link('/work/kit/notes'),
      link('/elsewhere'),
      link('//host.test/chapters/x'),
    ].join(''),
    '/work/kit': `<p>${TOOL}</p>`,
    '/work/kit/notes': `<p>${TOOL}</p>`,
    '/elsewhere': `<p>${TOOL}</p>`,
  });
  assert.equal(other.found, false);
  assert.deepEqual(other.asked, []);
});

test('a composition with no views reads / alone, whatever its site links', async () => {
  const plain = await reaches(NO_VIEWS, {
    '/': link('/chapters/now'),
    '/chapters/now': `<p>${TOOL}</p>`,
  });
  assert.equal(plain.found, false);
  assert.deepEqual(plain.asked, []);
});

test('links are read as same-origin paths without query or fragment', () => {
  assert.deepEqual(
    linkedPaths(`${link('/chapters/a')}<a href="/">x</a><a href="https://x.test/">y</a>`),
    ['/chapters/a', '/'],
  );
});
