import test from 'node:test';
import assert from 'node:assert/strict';
import {
  appearancePreference,
  MAX_BODY_BYTES,
  PREFERENCE_MAX_AGE,
  preferenceCookie,
  sitePath,
} from './appearance-preference';

// POST /api/appearance (#19, Slice 4): what it takes, from where, and the
// one cookie it sets.

const ORIGIN = 'https://rowan.test';
const URL_ = `${ORIGIN}/api/appearance`;

function post(
  body: string,
  {
    type = 'application/x-www-form-urlencoded',
    origin = ORIGIN,
    site,
    length,
  }: { type?: string | null; origin?: string | null; site?: string; length?: string } = {},
): Request {
  const headers = new Headers();
  if (type !== null) headers.set('content-type', type);
  if (origin !== null) headers.set('origin', origin);
  if (site !== undefined) headers.set('sec-fetch-site', site);
  if (length !== undefined) headers.set('content-length', length);
  return new Request(URL_, { method: 'POST', headers, body });
}

const answer = (request: Request, origin = ORIGIN) => appearancePreference(request, { origin });

const COOKIE_ATTRIBUTES = `Path=/; Max-Age=${PREFERENCE_MAX_AGE}; HttpOnly; SameSite=Lax; Secure`;

test('a form post sets the ids it names, and goes back to its page with a 303, no-store', async () => {
  const response = await answer(
    post('scheme=warm-parchment&mode=dark&return=%2Fwork%2Ftide%3Fview%3Dall%23notes'),
  );
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('location'), '/work/tide?view=all#notes');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(
    response.headers.get('set-cookie'),
    `portfolio_appearance=scheme=warm-parchment&mode=dark; ${COOKIE_ATTRIBUTES}`,
  );
  // No Domain, so no sibling origin shares it.
  assert.doesNotMatch(response.headers.get('set-cookie')!, /domain=/i);
  // Without a return path, home.
  const home = await answer(post('mode=light'));
  assert.equal(home.headers.get('location'), '/');
});

test('the JSON save sets the same cookie and answers 204, since it follows no redirect', async () => {
  const response = await answer(
    post(JSON.stringify({ scheme: 'warm-parchment', mode: 'dark' }), { type: 'application/json' }),
  );
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('location'), null);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(
    response.headers.get('set-cookie'),
    `portfolio_appearance=scheme=warm-parchment&mode=dark; ${COOKIE_ATTRIBUTES}`,
  );
});

test('a reset clears the cookie, whatever else the form sent', async () => {
  const cleared = `portfolio_appearance=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax; Secure`;
  const form = await answer(post('scheme=warm-parchment&mode=dark&reset=1&return=%2F'));
  assert.equal(form.status, 303);
  assert.equal(form.headers.get('set-cookie'), cleared);
  const json = await answer(post('{"reset":true}', { type: 'application/json' }));
  assert.equal(json.status, 204);
  assert.equal(json.headers.get('set-cookie'), cleared);
});

test('the cookie keeps ids alone, in axis order, and never the variant, which the host renders as the page names it', async () => {
  const response = await answer(
    post('mode=dark&type=humanist-ui&variant=editorial-evidence&language=platform-neutral'),
  );
  assert.equal(
    response.headers.get('set-cookie')?.split(';')[0],
    'portfolio_appearance=language=platform-neutral&type=humanist-ui&mode=dark',
  );
  // An id this build doesn't register is well formed, so it's kept: the
  // resolver falls back on its axis when a page renders, and says so.
  const unknown = await answer(post('scheme=nebula'));
  assert.equal(unknown.status, 303);
  assert.equal(
    unknown.headers.get('set-cookie')?.split(';')[0],
    'portfolio_appearance=scheme=nebula',
  );
});

test('an http origin, the loopback test mode, gets the cookie without Secure', async () => {
  const origin = 'http://127.0.0.1:3000';
  const response = await answer(post('mode=dark', { origin }), origin);
  assert.equal(response.status, 303);
  assert.equal(
    response.headers.get('set-cookie'),
    `portfolio_appearance=mode=dark; Path=/; Max-Age=${PREFERENCE_MAX_AGE}; HttpOnly; SameSite=Lax`,
  );
  assert.equal(preferenceCookie('', origin, 0).includes('Secure'), false);
});

test('a request from anywhere but the canonical origin is a 403 that sets nothing', async () => {
  for (const [what, request] of [
    ['no Origin', post('mode=dark', { origin: null })],
    ['another origin', post('mode=dark', { origin: 'https://evil.test' })],
    ['a sibling origin', post('mode=dark', { origin: 'https://www.rowan.test' })],
    ['the origin over http', post('mode=dark', { origin: 'http://rowan.test' })],
    ['null', post('mode=dark', { origin: 'null' })],
    ['a cross-site fetch', post('mode=dark', { site: 'cross-site' })],
    ['a same-site fetch', post('mode=dark', { site: 'same-site' })],
  ] as const) {
    const response = await answer(request);
    assert.equal(response.status, 403, what);
    assert.equal(response.headers.get('set-cookie'), null, what);
    assert.equal(response.headers.get('cache-control'), 'no-store', what);
  }
  const same = await answer(post('mode=dark', { site: 'same-origin' }));
  assert.equal(same.status, 303);
});

test('a body past the cap is a 413, by its length or as it streams, and another body type a 415', async () => {
  const big = `mode=dark&return=/${'a'.repeat(MAX_BODY_BYTES)}`;
  const declared = await answer(post('mode=dark', { length: String(MAX_BODY_BYTES + 1) }));
  assert.equal(declared.status, 413);
  const streamed = await answer(post(big));
  assert.equal(streamed.status, 413);
  assert.equal(streamed.headers.get('set-cookie'), null);
  for (const type of ['text/plain', 'multipart/form-data; boundary=x', null]) {
    const response = await answer(post('mode=dark', { type }));
    assert.equal(response.status, 415, String(type));
    assert.equal(response.headers.get('set-cookie'), null, String(type));
  }
});

test('a body the schema refuses is a 400 that sets nothing', async () => {
  const json = { type: 'application/json' };
  for (const [what, request] of [
    ['an unknown field', post('mode=dark&colour=red')],
    ['a field given twice', post('mode=dark&mode=light')],
    ['a malformed id', post('scheme=Warm Parchment')],
    ['an id too long', post(`scheme=${'a'.repeat(65)}`)],
    ['a display mode that is none', post('mode=dim')],
    ['nothing to set', post('return=%2F')],
    ['an empty body', post('')],
    ['a reset other than 1', post('reset=yes')],
    ['JSON that is not', post('{', json)],
    ['a JSON array', post('[]', json)],
    ['a JSON value not a string', post('{"mode":1}', json)],
    ['a JSON reset with values', post('{"reset":true,"mode":"dark"}', json)],
    ['a JSON reset not true', post('{"reset":false}', json)],
    ['a JSON unknown field', post('{"mode":"dark","x":"y"}', json)],
    ['JSON with nothing to set', post('{}', json)],
    [
      'malformed UTF-8',
      new Request(URL_, {
        method: 'POST',
        headers: { origin: ORIGIN, 'content-type': 'application/json' },
        body: new Uint8Array([0x7b, 0xff, 0x7d]),
      }),
    ],
  ] as const) {
    const response = await answer(request);
    assert.equal(response.status, 400, what);
    assert.equal(response.headers.get('set-cookie'), null, what);
    assert.equal(response.headers.get('cache-control'), 'no-store', what);
  }
});

test('a return path is a path on the canonical origin, or the form is a 400 that sets nothing', async () => {
  for (const returnTo of [
    'https://evil.test/',
    '//evil.test/',
    '/\\evil.test/',
    '\\\\evil.test',
    '/%0d%0aSet-Cookie:x',
    '/a\tb',
    '/a\nb',
    '/a b',
    'javascript:alert(1)',
    'work',
    '',
  ]) {
    const response = await answer(
      post(new URLSearchParams({ mode: 'dark', return: returnTo }).toString()),
    );
    if (returnTo === '/%0d%0aSet-Cookie:x') {
      // Encoded, it's a path whose characters stay encoded: the Location names the same path.
      assert.equal(response.status, 303, returnTo);
      assert.equal(response.headers.get('location'), '/%0d%0aSet-Cookie:x', returnTo);
      continue;
    }
    assert.equal(response.status, 400, JSON.stringify(returnTo));
    assert.equal(response.headers.get('set-cookie'), null, JSON.stringify(returnTo));
  }
  const long = await answer(
    post(new URLSearchParams({ mode: 'dark', return: `/${'a'.repeat(2048)}` }).toString()),
  );
  assert.equal(long.status, 400);
});

test('sitePath() keeps a path, query, and fragment on the origin, normalized, and nothing else', () => {
  assert.equal(sitePath('/work/tide?view=all#notes', ORIGIN), '/work/tide?view=all#notes');
  assert.equal(sitePath('/a/../b', ORIGIN), '/b');
  assert.equal(sitePath('/', ORIGIN), '/');
  for (const value of [
    '//evil.test',
    '/\\evil.test',
    'https://rowan.test/',
    '/a\u0000',
    '/a\u007f',
    'a',
  ]) {
    assert.equal(sitePath(value, ORIGIN), null, JSON.stringify(value));
  }
});
