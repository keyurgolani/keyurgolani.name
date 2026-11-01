import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { stylesheetHrefs, type GeneratedScheme } from '@portfolio/appearance';
import { compileGeneratedScheme } from '@portfolio/appearance/node';
import { readPair } from '@portfolio/schema/node';
import { PREVIEW_STATUS_DOCUMENT } from '~/preview/status';
import { GET as liveRoute } from '../app/(site)/%5Fportfolio/scheme/[file]/route';
import { GET as previewRoute } from '../app/(preview)/preview-assets/[grant]/%5Fappearance/[file]/route';
import type { LiveRevision } from './catalog-port';
import { readDeploymentConfig } from './config';
import { setDeploymentState } from './config-store';
import {
  compileCount,
  liveSchemeSheets,
  liveStylesheets,
  previewStylesheets,
  SCHEME_URL,
} from './generated-schemes';
import { previewCsp } from './preview-headers';
import { frameAppearance } from './preview-page';
import type { OpenedGrant, PreviewGrantsPort } from './preview-port';

// A generated scheme's stylesheet (#20): /_portfolio/scheme/<file> serves
// what the live revision's stored schemes compile to, and nothing a request
// names otherwise; /preview-assets/<grant>/_appearance/<file> serves what
// the grant's subject stored, only while the grant is active.

const ORIGIN = 'https://rowan.test';
const GRANT = 'AAAAAAAAAAAAAAAAAAAAAA';

/** brand-seed's reference record (#20 PR 3), as a revision's snapshots/schemes.json holds it. */
function storedBrandSeed() {
  const record = JSON.parse(
    readFileSync(
      new URL('../../../../packages/appearance-schemes/generated/brand-seed.json', import.meta.url),
      'utf8',
    ),
  ) as {
    result: {
      generator: { id: string; version: number };
      input: { seedColor: string };
      tokens: GeneratedScheme;
    };
  };
  return {
    generator: record.result.generator,
    inputsHash: createHash('sha256').update(record.result.input.seedColor).digest('hex'),
    tokens: record.result.tokens,
  };
}

const STORED = storedBrandSeed();

/** Another site's brand-seed: the same generator, another seed's canvas. */
const OTHER = {
  ...STORED,
  inputsHash: 'f'.repeat(64),
  tokens: { ...STORED.tokens, light: { ...STORED.tokens.light, canvas: '#fafafa' } },
};

/** `<id>.<sha256-12>.css` for `tokens`, as the route names what it compiles. */
function nameOf(tokens: GeneratedScheme, id = 'brand-seed') {
  const css = compileGeneratedScheme(id, tokens);
  return { css, name: `${id}.${createHash('sha256').update(css).digest('hex').slice(0, 12)}.css` };
}

const PAIR = (() => {
  const result = readPair({
    portfolio: fileURLToPath(new URL('../../../../portfolio.example.yml', import.meta.url)),
    site: fileURLToPath(new URL('../../../../site.example.yml', import.meta.url)),
  });
  assert.ok(result.ok);
  return result.pair;
})();

function revision(id: string, schemes: unknown): LiveRevision {
  return {
    state: 'live',
    revisionId: id,
    unitHash: `hash-${id}`,
    unit: {
      portfolio: PAIR.portfolio,
      site: PAIR.site,
      snapshots: schemes === undefined ? {} : { schemes },
    },
  };
}

/** `profile`, its live revision `live()`, and under owner the grants `previews`. */
function deploy(
  t: TestContext,
  live: () => LiveRevision,
  { profile = 'read-only', previews }: { profile?: string; previews?: PreviewGrantsPort } = {},
) {
  const read = readDeploymentConfig(
    {
      NODE_ENV: 'production',
      PORTFOLIO_PROFILE: profile,
      PORTFOLIO_ORIGIN: ORIGIN,
      ...(profile === 'demo' ? {} : { PORTFOLIO_SOURCE_DIR: '/srv/config' }),
      ...(profile === 'owner' ? { PORTFOLIO_OWNER_PROVIDER: 'none' } : {}),
    },
    { cwd: '/' },
  );
  assert.ok(read.ok, JSON.stringify(read.issues));
  setDeploymentState({
    config: read.config,
    catalog: { getLive: async () => live() },
    dispatch: () => assert.fail('no operation runs'),
    degraded: [],
    ...(previews ? { previews } : {}),
  });
  t.after(() => setDeploymentState(undefined));
}

/** The public route's answer for `path` below SCHEME_URL, as sent, with Next's decoded `file`. */
async function fetchLive(sent: string, method = 'GET') {
  let file: string;
  try {
    file = decodeURIComponent(sent);
  } catch {
    file = sent;
  }
  return liveRoute(new Request(`${ORIGIN}${SCHEME_URL}${sent}`, { method }), {
    params: Promise.resolve({ file }),
  });
}

async function assertNotFound(response: Response, what: string) {
  assert.equal(response.status, 404, what);
  assert.equal(response.headers.get('cache-control'), 'no-store', what);
  assert.equal(response.headers.get('content-type'), 'text/plain; charset=utf-8', what);
  assert.equal(await response.text(), 'Not found.', what);
}

test("the public route serves a live revision's generated scheme, compiled from its stored sets, immutable, and HEAD the same headers with no body (#20)", async (t) => {
  deploy(t, () => revision('r1', { 'brand-seed': STORED }));
  const { css, name } = nameOf(STORED.tokens);
  const response = await fetchLive(name);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'text/css; charset=utf-8');
  assert.equal(response.headers.get('cache-control'), 'public, max-age=31536000, immutable');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  const body = await response.text();
  assert.equal(body, css);
  assert.match(body, /\[data-color-scheme="brand-seed"\]/);
  assert.ok(body.includes(STORED.tokens.light.canvas), 'its stored canvas renders');
  const head = await fetchLive(name, 'HEAD');
  assert.equal(head.status, 200);
  assert.deepEqual([...head.headers], [...response.headers]);
  assert.equal(await head.text(), '');
});

test('a wrong, missing, or malformed hash, or any other spelling of a name, is the same no-store 404 (#20)', async (t) => {
  deploy(t, () => revision('r1', { 'brand-seed': STORED }));
  const { name } = nameOf(STORED.tokens);
  const hash = name.slice('brand-seed.'.length, -'.css'.length);
  const refused = [
    'brand-seed.css',
    'brand-seed..css',
    `brand-seed.${'0'.repeat(12)}.css`,
    `brand-seed.${hash.slice(0, 11)}.css`,
    `brand-seed.${hash}0.css`,
    `brand-seed.${hash.toUpperCase()}.css`,
    `brand-seed.${hash}.css.map`,
    `brand-seed.${hash}.CSS`,
    `brand-seed.${hash}`,
    `${hash}.css`,
    `brand-seed..${hash}.css`,
    `x.brand-seed.${hash}.css`,
    `Brand-seed.${hash}.css`,
    `warm-parchment.${hash}.css`,
    // Percent-encoded: a dot, a slash, a letter, and the whole name.
    `brand-seed%2E${hash}.css`,
    `brand-seed.${hash}%2Ecss`,
    `..%2Fbrand-seed.${hash}.css`,
    `%62rand-seed.${hash}.css`,
    encodeURIComponent(name).replace(/\./g, '%2E'),
    // A trailing slash: a file has no path below it.
    `${name}/`,
    '',
  ];
  for (const sent of refused) await assertNotFound(await fetchLive(sent), sent);
  // The name the route serves is exactly the one sent, decoded the same.
  assert.equal((await fetchLive(name)).status, 200);
  const mismatched = await liveRoute(new Request(`${ORIGIN}${SCHEME_URL}${name}`), {
    params: Promise.resolve({ file: `x${name}` }),
  });
  await assertNotFound(mismatched, 'a parameter other than the path');
});

test('dot segments, plain or percent-encoded, normalize before routing, so they reach only the canonical name and its own bytes (#20)', async (t) => {
  deploy(t, () => revision('r1', { 'brand-seed': STORED }));
  const { css, name } = nameOf(STORED.tokens);
  for (const spelled of [
    `x/../${name}`,
    `./${name}`,
    `x/%2e%2e/${name}`,
    `x/%2E%2E/${name}`,
    `%2e/${name}`,
    `../scheme/${name}`,
  ]) {
    // The URL parser, which every request goes through first, leaves the canonical path.
    const url = new URL(`${ORIGIN}${SCHEME_URL}${spelled}`);
    assert.equal(url.pathname, `${SCHEME_URL}${name}`, spelled);
    const response = await liveRoute(new Request(url), { params: Promise.resolve({ file: name }) });
    assert.equal(response.status, 200, spelled);
    assert.equal(await response.text(), css, spelled);
  }
  // One that climbs out of the route leaves it, for another prefix's rules.
  assert.equal(
    new URL(`${ORIGIN}${SCHEME_URL}../pack/${name}`).pathname,
    `/_portfolio/pack/${name}`,
  );
});

test("another site's scheme, an unchecked entry's, and a scheme the live revision doesn't store are 404 on the public route (#20)", async (t) => {
  let current = revision('r1', { 'brand-seed': STORED });
  deploy(t, () => current);
  await assertNotFound(await fetchLive(nameOf(OTHER.tokens).name), "another site's");
  // An entry storedSchemes() leaves out serves nothing, even at the name its tokens compile to.
  current = revision('r2', {
    'brand-seed': { ...STORED, generator: { id: 'brand-seed', version: 9 } },
  });
  await assertNotFound(await fetchLive(nameOf(STORED.tokens).name), 'a stale generator version');
  current = revision('r3', undefined);
  await assertNotFound(await fetchLive(nameOf(STORED.tokens).name), 'no stored schemes');
  // No live revision at all, and a catalog that can't be read.
  current = { state: 'empty', revisionId: null, unitHash: null, unit: null };
  await assertNotFound(await fetchLive(nameOf(STORED.tokens).name), 'no live revision');
});

test("a hash an earlier live revision served is a 404 once a publish replaces it, not a redirect, and each revision's schemes compile once (#20)", async (t) => {
  let current = revision('r1', { 'brand-seed': STORED });
  deploy(t, () => current);
  const before = nameOf(STORED.tokens).name;
  const after = nameOf(OTHER.tokens).name;
  const start = compileCount.value;
  for (let index = 0; index < 20; index++) assert.equal((await fetchLive(before)).status, 200);
  assert.equal(compileCount.value - start, 1, "a flood compiles the revision's scheme once");
  current = revision('r2', { 'brand-seed': OTHER });
  const stale = await fetchLive(before);
  await assertNotFound(stale, 'the earlier revision');
  assert.equal(stale.headers.get('location'), null);
  assert.equal((await fetchLive(after)).status, 200);
  assert.equal(compileCount.value - start, 2, 'the publish compiles once more');
  // A rollback to the first revision's schemes serves its name again, and only its.
  current = revision('r1', { 'brand-seed': STORED });
  assert.equal((await fetchLive(before)).status, 200);
  await assertNotFound(await fetchLive(after), 'the rolled-back revision');
});

test("the public route never serves a draft's or a grant's scheme: only the live revision's (#20)", async (t) => {
  const opened = { schemes: { 'brand-seed': OTHER } } as unknown as OpenedGrant;
  deploy(t, () => revision('r1', { 'brand-seed': STORED }), {
    profile: 'owner',
    previews: grants(new Map([[GRANT, opened]])),
  });
  // The grant's scheme is served under the grant...
  const draft = nameOf(OTHER.tokens).name;
  assert.equal((await fetchPreview(GRANT, draft)).status, 200);
  // ...and never from the public origin's route.
  await assertNotFound(await fetchLive(draft), "the grant's scheme on the public route");
});

/** A grants port whose open() answers each grant's OpenedGrant, or null for any other. */
function grants(opened: ReadonlyMap<string, OpenedGrant>, calls: string[] = []): PreviewGrantsPort {
  return {
    admit: async (grant) => opened.has(grant),
    open: async (grant) => {
      calls.push(grant);
      return opened.get(grant) ?? null;
    },
    channel: () => assert.fail('no channel opens'),
    asset: () => assert.fail('no rendition is read'),
    previewable: () => assert.fail('nothing is offered'),
  };
}

async function fetchPreview(grant: string, sent: string, method = 'GET') {
  return previewRoute(
    new Request(`${ORIGIN}/preview-assets/${grant}/_appearance/${sent}`, { method }),
    { params: Promise.resolve({ grant, file: decodeURIComponent(sent) }) },
  );
}

async function assertStatusDocument(response: Response, what: string) {
  assert.equal(response.status, 404, what);
  assert.equal(response.headers.get('cache-control'), 'private, no-store', what);
  assert.equal(await response.text(), PREVIEW_STATUS_DOCUMENT, what);
}

test("the preview route serves only the active grant's own stored scheme, private and no-store, and everything else the status document (#20)", async (t) => {
  const calls: string[] = [];
  const opened = new Map<string, OpenedGrant>([
    [GRANT, { schemes: { 'brand-seed': OTHER } } as unknown as OpenedGrant],
    ['CCCCCCCCCCCCCCCCCCCCCC', {} as OpenedGrant],
  ]);
  deploy(t, () => revision('r1', { 'brand-seed': STORED }), {
    profile: 'owner',
    previews: grants(opened, calls),
  });
  const own = nameOf(OTHER.tokens);
  const response = await fetchPreview(GRANT, own.name);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'text/css; charset=utf-8');
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal(await response.text(), own.css);
  const head = await fetchPreview(GRANT, own.name, 'HEAD');
  assert.deepEqual([...head.headers], [...response.headers]);
  assert.equal(await head.text(), '');
  // The live revision's scheme isn't the grant's; a grant with none has
  // none; a revoked, expired, or unknown grant gets nothing; and a name of
  // another shape is never read.
  await assertStatusDocument(await fetchPreview(GRANT, nameOf(STORED.tokens).name), 'live');
  await assertStatusDocument(
    await fetchPreview('CCCCCCCCCCCCCCCCCCCCCC', own.name),
    'a grant with no schemes',
  );
  await assertStatusDocument(await fetchPreview('BBBBBBBBBBBBBBBBBBBBBB', own.name), 'ended');
  const before = calls.length;
  for (const sent of [`brand-seed%2E${own.name.slice(11)}`, 'brand-seed.css', `${own.name}.map`]) {
    await assertStatusDocument(await fetchPreview(GRANT, sent), sent);
  }
  assert.equal(calls.length, before, 'a malformed name opens no grant');
});

test("a grant's schemes compile once per grant and scheme, by its digest, however often open() reads them afresh, and never serve another grant (#20)", async (t) => {
  const first = 'DDDDDDDDDDDDDDDDDDDDDD';
  const second = 'EEEEEEEEEEEEEEEEEEEEEE';
  // Every open() reads the grant's schemes into a new object, as #10's
  // readDerivedSchemes() will for a draft's pinned version.
  const port: PreviewGrantsPort = {
    admit: async () => true,
    open: async (grant) =>
      grant === first
        ? ({ schemes: structuredClone({ 'brand-seed': OTHER }) } as unknown as OpenedGrant)
        : grant === second
          ? ({ schemes: structuredClone({ 'brand-seed': STORED }) } as unknown as OpenedGrant)
          : null,
    channel: () => assert.fail('no channel opens'),
    asset: () => assert.fail('no rendition is read'),
    previewable: () => assert.fail('nothing is offered'),
  };
  deploy(t, () => revision('r1', undefined), { profile: 'owner', previews: port });
  const own = nameOf(OTHER.tokens).name;
  const start = compileCount.value;
  // The frame's page links it, then the frame loads it, again and again.
  previewStylesheets(first, (await port.open(first))!.schemes);
  for (let index = 0; index < 5; index++) {
    assert.equal((await fetchPreview(first, own)).status, 200);
  }
  assert.equal(compileCount.value - start, 1, 'the grant compiled its scheme once');
  // Another grant compiles its own, and never answers the first's name.
  await assertStatusDocument(await fetchPreview(second, own), "the other grant's name");
  assert.equal((await fetchPreview(second, nameOf(STORED.tokens).name)).status, 200);
  assert.equal(compileCount.value - start, 2);
});

test('the preview route is absent under demo and read-only, and the status document under owner with no grants port (#20)', async (t) => {
  const name = nameOf(STORED.tokens).name;
  for (const profile of ['demo', 'read-only']) {
    deploy(t, () => revision('r1', { 'brand-seed': STORED }), { profile });
    await assertNotFound(await fetchPreview(GRANT, name), profile);
  }
  deploy(t, () => revision('r1', { 'brand-seed': STORED }), { profile: 'owner' });
  await assertStatusDocument(await fetchPreview(GRANT, name), 'no port');
});

test("a frame renders its grant's generated scheme with the grant's own stylesheet, and a grant with none, as a draft's is today, falls back and links none (#20)", async (t) => {
  deploy(t, () => revision('r1', { 'brand-seed': STORED }), {
    profile: 'owner',
    previews: grants(new Map()),
  });
  const site = { ...PAIR.site, appearance: { ...PAIR.site.appearance, colorScheme: 'brand-seed' } };
  const environment = {
    displayMode: 'system',
    contrast: 'system',
    motion: 'system',
    enhancement: 'on',
  } as const;
  const variant = PAIR.site.appearance.variant;
  const framed = frameAppearance(
    GRANT,
    { environment, schemes: { 'brand-seed': OTHER } },
    site,
    variant,
  );
  assert.equal(framed.appearance.selection.colorScheme, 'brand-seed');
  assert.ok(!framed.appearance.fallbackAxes.includes('colorScheme'));
  const hrefs = stylesheetHrefs(framed.appearance.selection, framed.stylesheets);
  assert.ok(
    hrefs.includes(`/preview-assets/${GRANT}/_appearance/${nameOf(OTHER.tokens).name}`),
    JSON.stringify(hrefs),
  );
  // Never the live revision's, even though it stores the same scheme.
  assert.ok(!hrefs.some((href) => href.startsWith(SCHEME_URL)), JSON.stringify(hrefs));
  const draft = frameAppearance(GRANT, { environment }, site, variant);
  assert.notEqual(draft.appearance.selection.colorScheme, 'brand-seed');
  const fallback = stylesheetHrefs(draft.appearance.selection, draft.stylesheets);
  assert.ok(!fallback.some((href) => href.includes('_appearance') || href.startsWith(SCHEME_URL)));
});

test("a page's stylesheets link the live revision's generated scheme under /_portfolio/scheme/, and a frame's its grant's under the grant, which the preview policy's style-src 'self' already admits (#20)", async (t) => {
  deploy(t, () => revision('r1', { 'brand-seed': STORED }));
  const selection = {
    designLanguage: 'platform-neutral',
    colorScheme: 'brand-seed',
    typography: 'neutral-ui',
  };
  const live = stylesheetHrefs(selection, liveStylesheets(await liveSchemeSheets()));
  assert.ok(live.includes(`${SCHEME_URL}${nameOf(STORED.tokens).name}`), JSON.stringify(live));
  const frame = stylesheetHrefs(selection, previewStylesheets(GRANT, { 'brand-seed': OTHER }));
  const own = `/preview-assets/${GRANT}/_appearance/${nameOf(OTHER.tokens).name}`;
  assert.ok(frame.includes(own), JSON.stringify(frame));
  assert.ok(!frame.some((href) => href.startsWith(SCHEME_URL)), 'no live scheme in a frame');
  // Same-origin paths, which the preview's own style-src covers: it names
  // 'self' and the request's nonce, and nothing else.
  for (const href of [...live, ...frame]) assert.match(href, /^\/(?!\/)/);
  const styleSrc = previewCsp('n0nce', { mode: 'production' })
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith('style-src '));
  assert.equal(styleSrc, "style-src 'self' 'nonce-n0nce'");
  // A scheme with no stored sets links nothing, so its fallback renders.
  const none = stylesheetHrefs(selection, previewStylesheets(GRANT, undefined));
  assert.ok(!none.some((href) => href.includes('brand-seed')), JSON.stringify(none));
});
