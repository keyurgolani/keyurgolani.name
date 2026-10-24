// The identity rows' checks (ci/lib/identity.mjs, #12). The fixtures are a
// built server's own answers, read-only on the rehearsal's migrated pair at
// https://jane-rehearsal.test and demo at https://demo.jane-rehearsal.test,
// cut to the head tags the checks read; each case below breaks one thing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BUILD_LEAKS, identityProblems, ogImagePath, pageIdentity } from './lib/identity.mjs';

const read = (name) =>
  readFileSync(new URL(`./fixtures/identity/${name}`, import.meta.url), 'utf8');
const answers = (profile) => ({
  page: {
    status: 200,
    body: read(`${profile}.html`),
    headers: { 'x-robots-tag': profile === 'demo' ? 'noindex' : undefined },
  },
  sitemap: { status: 200, body: read(`${profile}.sitemap.xml`) },
  robots: { status: 200, body: read(`${profile}.robots.txt`) },
  feed:
    profile === 'demo'
      ? { status: 404, body: read('demo.feed.xml') }
      : { status: 200, body: read(`${profile}.feed.xml`) },
  ogImage: { status: 200, headers: { 'content-type': 'image/png' } },
});
const ORIGIN = 'https://jane-rehearsal.test';
const DEMO = 'https://demo.jane-rehearsal.test';
const owner = (change = (a) => a) =>
  identityProblems({
    profile: 'owner',
    origin: ORIGIN,
    name: 'Jane Rehearsal',
    forbidden: ['Anamika Devi'],
    ...change(answers('read-only')),
  });
const demo = (change = (a) => a) =>
  identityProblems({
    profile: 'demo',
    origin: DEMO,
    name: 'Anamika Devi',
    forbidden: ['Jane Rehearsal'],
    ...change(answers('demo')),
  });
const edit = (key, from, to) => (a) => ({
  ...a,
  [key]: { ...a[key], body: a[key].body.replace(from, to) },
});

test("a built server's own answers pass, under owner and read-only, and under demo", () => {
  assert.deepEqual(owner(), []);
  assert.deepEqual(
    identityProblems({
      profile: 'read-only',
      origin: ORIGIN,
      name: 'Jane Rehearsal',
      forbidden: ['Anamika Devi'],
      ...answers('read-only'),
    }),
    [],
  );
  assert.deepEqual(demo(), []);
});

test('under owner and read-only, every identity field follows the origin it was given', () => {
  const cases = [
    [
      edit('page', `href="${ORIGIN}/"`, 'href="http://localhost:3000/"'),
      /canonical link is \["http:\/\/localhost:3000\/"\]/,
    ],
    [
      edit('page', `og:url" content="${ORIGIN}"`, 'og:url" content="https://example.com"'),
      /og:url is \["https:\/\/example\.com"\]/,
    ],
    [
      edit('page', `og:image" content="${ORIGIN}`, 'og:image" content="http://0.0.0.0:3000'),
      /Open Graph image is/,
    ],
    [
      edit('sitemap', `<loc>${ORIGIN}/`, '<loc>http://127.0.0.1:3000/'),
      /the sitemap lists http:\/\/127\.0\.0\.1:3000\//,
    ],
    [
      edit('robots', `Host: ${ORIGIN}`, 'Host: https://example.com'),
      /robots\.txt's Host is https:\/\/example\.com/,
    ],
    [
      edit('robots', `Sitemap: ${ORIGIN}/sitemap.xml`, 'Sitemap: /app/apps/web/sitemap.xml'),
      /robots\.txt's Sitemap is \/app\/apps\/web\/sitemap\.xml/,
    ],
    [
      edit('feed', `<link>${ORIGIN}</link>`, '<link>https://web:3000</link>'),
      /the feed's link is https:\/\/web:3000/,
    ],
    [edit('feed', `${ORIGIN}/feed.xml`, 'https://example.com/feed.xml'), /the feed's self link/],
    [
      edit(
        'feed',
        `<guid isPermaLink="false">${ORIGIN}/#`,
        '<guid isPermaLink="false">http://localhost/#',
      ),
      /a feed item's guid is http:\/\/localhost\/#/,
    ],
    [
      edit('page', `"url":"${ORIGIN}","image"`, '"url":"https://example.com","image"'),
      /JSON-LD's Person url is https:\/\/example\.com/,
    ],
    [
      edit('page', `"image":"${ORIGIN}/media`, '"image":"file:///var/lib/portfolio/media'),
      /JSON-LD's Person image is file:/,
    ],
  ];
  for (const [change, want] of cases) {
    const problems = owner(change);
    assert.ok(
      problems.some((p) => want.test(p)),
      `${want}: ${problems.join(' | ')}`,
    );
  }
});

test('under owner and read-only, the name is the fixture identity, never the sample persona', () => {
  const swapped = owner(
    edit(
      'page',
      /"@type":"Person","name":"Jane Rehearsal"/,
      '"@type":"Person","name":"Anamika Devi"',
    ),
  );
  assert.ok(
    swapped.some((p) => /JSON-LD's Person is "Anamika Devi", not Jane Rehearsal/.test(p)),
    swapped.join(' | '),
  );
  assert.ok(
    swapped.some((p) => /names Anamika Devi/.test(p)),
    'the persona is a leak too',
  );
  const title = owner(edit('page', '<title>Jane Rehearsal', '<title>Anamika Devi'));
  assert.ok(
    title.some((p) => /^title names Anamika Devi/.test(p)),
    title.join(' | '),
  );
  const site = owner(
    edit(
      'page',
      '"author":{"@type":"Person","name":"Jane Rehearsal"}',
      '"author":{"@type":"Person","name":"Someone"}',
    ),
  );
  assert.ok(
    site.some((p) => /JSON-LD's WebSite names "Someone"/.test(p)),
    site.join(' | '),
  );
  const none = owner(edit('page', /<script type="application\/ld\+json">[\s\S]*?<\/script>/g, ''));
  assert.ok(none.includes('the page carries no Person JSON-LD'), none.join(' | '));
  // A link the content names stays the author's: sameAs and an item's link aren't held to the origin.
  assert.match(read('read-only.html'), /"sameAs":\["https:\/\/github\.com\/anamika"/);
  assert.match(
    read('read-only.feed.xml'),
    /<link>https:\/\/example\.com\/incident-history\/24<\/link>/,
  );
});

test("given the identity's title, every title the page carries holds it, never the sample persona's", () => {
  const titled = (change) => owner((a) => ({ ...change(a), title: 'Jane Rehearsal' }));
  assert.deepEqual(
    titled((a) => a),
    [],
  );
  // The guide's identity step changed identity.name but left meta.title the sample's.
  const kept = titled(edit('page', /Jane Rehearsal — Portfolio/g, 'Anamika Devi — Portfolio'));
  for (const want of [
    /^the title is "Anamika Devi — Portfolio", not the identity's Jane Rehearsal/,
    /^a title meta tag is "Anamika Devi — Portfolio", not the identity's Jane Rehearsal/,
    /^title names Anamika Devi/,
  ]) {
    assert.ok(
      kept.some((p) => want.test(p)),
      `${want}: ${kept.join(' | ')}`,
    );
  }
  // One title tag left behind is enough to fail.
  const one = titled(
    edit(
      'page',
      'name="twitter:title" content="Jane Rehearsal — Portfolio"',
      'name="twitter:title" content="Anamika Devi — Portfolio"',
    ),
  );
  assert.ok(
    one.some((p) => /^a title meta tag is "Anamika Devi/.test(p)),
    one.join(' | '),
  );
  const untagged = titled(
    edit('page', /<meta (property|name)="(og:title|og:site_name|twitter:title)"[^>]*>/g, ''),
  );
  assert.ok(
    untagged.includes('the page carries no og:title, twitter:title, or og:site_name'),
    untagged.join(' | '),
  );
});

test("given the sample's pictures, an Open Graph image that is one of them fails", () => {
  const SAMPLE_OG = 'a'.repeat(64);
  const pictured = (sha256) =>
    owner((a) => ({
      ...a,
      ogImage: { ...a.ogImage, sha256 },
      sampleImages: [SAMPLE_OG],
    }));
  assert.deepEqual(pictured('b'.repeat(64)), []);
  assert.ok(
    pictured(SAMPLE_OG).some((p) => /^the Open Graph image is the sample's own picture/.test(p)),
    pictured(SAMPLE_OG).join(' | '),
  );
  // Unread bytes can't pass for someone else's picture.
  assert.ok(pictured(undefined).some((p) => /bytes weren't read/.test(p)));
  // An og:image that points at the sample's placed picture, not the card, fails on its URL.
  const placed = owner(
    edit(
      'page',
      /content="https:\/\/jane-rehearsal\.test\/opengraph-image[^"]*"/g,
      `content="${ORIGIN}/media/og-image/w1200.png"`,
    ),
  );
  assert.ok(
    placed.some((p) => p.startsWith(`the Open Graph image is ["${ORIGIN}/media/og-image`)),
    placed.join(' | '),
  );
});

test('the image must answer as an image, and an empty sitemap or a missing feed fails', () => {
  assert.ok(
    owner((a) => ({
      ...a,
      ogImage: { status: 404, headers: { 'content-type': 'text/html' } },
    })).some((p) => /Open Graph image answered 404/.test(p)),
  );
  assert.ok(owner(edit('sitemap', /<url>[\s\S]*<\/url>/, '')).includes('the sitemap lists no URL'));
  assert.ok(
    owner((a) => ({ ...a, feed: { status: 404, body: '' } })).includes('/feed.xml answered 404'),
  );
});

test('under demo the site is the sample alone, on the demo origin, out of search', () => {
  const cases = [
    [edit('page', '<title>Anamika Devi', '<title>Jane Rehearsal'), /the title is/],
    [
      edit(
        'page',
        '</head>',
        '<script type="application/ld+json">{"@type":"Person","name":"Anamika Devi"}</script></head>',
      ),
      /JSON-LD blocks; demo carries none/,
    ],
    [
      edit('page', '</head>', '<meta name="description" content="by Jane Rehearsal"></head>'),
      /the page names Jane Rehearsal/,
    ],
    [
      edit('sitemap', '</urlset>', `<url><loc>${DEMO}/</loc></url></urlset>`),
      /the sitemap lists 1 URLs/,
    ],
    [
      edit('robots', 'Allow: /', `Allow: /\nSitemap: ${DEMO}/sitemap.xml`),
      /robots\.txt names Sitemap/,
    ],
    [
      (a) => ({ ...a, feed: { status: 200, body: '<rss/>' } }),
      /\/feed\.xml answered 200; demo has no feed/,
    ],
    [(a) => ({ ...a, page: { ...a.page, headers: {} } }), /X-Robots-Tag is unset, not noindex/],
    [edit('page', `href="${DEMO}/"`, 'href="https://jane-rehearsal.test/"'), /canonical link/],
  ];
  for (const [change, want] of cases) {
    const problems = demo(change);
    assert.ok(
      problems.some((p) => want.test(p)),
      `${want}: ${problems.join(' | ')}`,
    );
  }
});

test('the head is read from its tags, and the image path from og:image', () => {
  const head = pageIdentity(read('read-only.html'));
  assert.equal(head.title, 'Jane Rehearsal — Portfolio');
  assert.deepEqual(head.canonical, [`${ORIGIN}/`]);
  assert.equal(head.jsonLd.length, 3);
  assert.match(ogImagePath(read('read-only.html'), ORIGIN), /^\/opengraph-image-\w+\?\w+$/);
  assert.equal(ogImagePath(read('read-only.html'), DEMO), null);
  for (const leak of ['example.com', 'localhost', '/app/', '/var/lib/portfolio'])
    assert.ok(BUILD_LEAKS.includes(leak));
});
