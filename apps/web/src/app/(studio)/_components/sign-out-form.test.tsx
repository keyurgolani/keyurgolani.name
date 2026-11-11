import test from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StudioLoadAlert } from './load/late-alert';
import { StudioLoadBoundary } from './load/load-boundary';
import { pageProfileOf, signedIn } from './sign-out-form';
import { StudioErrorView } from './studio-error-view';

// tsx compiles JSX to React.createElement calls, so the test supplies React.
Object.assign(globalThis, { React });

// Sign out where Studio itself didn't load (row 88c-RC2, as the owner ruled): error.tsx and the
// load alert ("Studio couldn't load.") offer the owner a Sign out form, a plain post to
// auth.logout that needs no script of Owner Studio's, beside Reload Studio. Its choice to discard
// this browser's unsaved changes is a second submit, as no dialog can ask without the shell.
// Under demo, which has no session and no auth.logout, neither shows. The (studio) layout renders
// markup only (routes.test.ts), so the profile comes from the page: StudioLoadBoundary takes it as a
// prop and names it on its .studio-load wrapper, which the late alert reads. error.tsx, which Next
// renders in place of a page, asks auth.session once, and offers Sign out on a 200 alone.

const form = (html: string) =>
  /<form[^>]*action="\/api\/studio\/auth\.logout"[^>]*>[\s\S]*?<\/form>/.exec(html)?.[0] ?? '';

function ownersForm(html: string, where: string) {
  const found = form(html);
  assert.notEqual(found, '', `${where}: the owner gets the Sign out form`);
  assert.match(/^<form[^>]*>/.exec(found)![0], /\smethod="post"/, where);
  assert.match(found, /<button[^>]*type="submit"[^>]*>Sign out<\/button>/, where);
  const discard =
    /<button[^>]*>Discard unsaved changes and sign out<\/button>/.exec(found)?.[0] ?? '';
  for (const attribute of ['type="submit"', 'name="choice"', 'value="discard"']) {
    assert.ok(
      discard.includes(attribute),
      `${where}: the discard submit: ${attribute} in ${discard}`,
    );
  }
  assert.ok(!found.includes('<noscript>'), `${where}: both submits show`);
}

test("error.tsx's view offers the owner Sign out, keep or discard, beside Reload Studio, and offers demo none (row 88c-RC2)", () => {
  const error = Object.assign(new Error('thrown'), { digest: 'digest-1' });
  const owner = renderToStaticMarkup(<StudioErrorView error={error} profile="owner" />);
  ownersForm(owner, 'error.tsx under owner');
  assert.match(owner, />Reload Studio<\/button>/);
  for (const profile of ['demo', null] as const) {
    const html = renderToStaticMarkup(<StudioErrorView error={error} profile={profile} />);
    assert.equal(form(html), '', `error.tsx under ${String(profile)}`);
    assert.ok(!html.includes('Sign out'), `error.tsx under ${String(profile)}`);
    assert.match(html, />Reload Studio<\/button>/);
  }
});

test('the load alert offers the owner Sign out, keep or discard, beside Reload Studio, and offers demo none (row 88c-RC2)', () => {
  const owner = renderToStaticMarkup(<StudioLoadAlert main profile="owner" onReload={() => {}} />);
  ownersForm(owner, 'the load alert under owner');
  assert.match(owner, />Reload Studio<\/button>/);
  for (const profile of ['demo', null] as const) {
    const html = renderToStaticMarkup(
      <StudioLoadAlert main={false} profile={profile} onReload={() => {}} />,
    );
    assert.equal(form(html), '', `the load alert under ${String(profile)}`);
    assert.ok(!html.includes('Sign out'), `the load alert under ${String(profile)}`);
  }
});

test("the load boundary names the page's profile on its .studio-load wrapper, which the late alert reads; none without one (row 88c-RC2 (b))", () => {
  for (const profile of ['owner', 'demo'] as const) {
    const html = renderToStaticMarkup(
      <StudioLoadBoundary profile={profile}>
        <p>shell</p>
      </StudioLoadBoundary>,
    );
    assert.equal(
      html,
      `<div class="studio-load" data-studio-profile="${profile}"><p>shell</p></div>`,
    );
  }
  const page = (profile: string | null) => ({
    querySelector: (selectors: string) =>
      selectors === '.studio-load'
        ? { getAttribute: (name: string) => (name === 'data-studio-profile' ? profile : null) }
        : null,
  });
  assert.equal(pageProfileOf(page('owner')), 'owner');
  assert.equal(pageProfileOf(page('demo')), 'demo');
  assert.equal(pageProfileOf(page(null)), null);
  assert.equal(pageProfileOf({ querySelector: () => null }), null);
});

test('error.tsx asks auth.session once, same-origin and uncached, and offers Sign out on a 200 alone: signed in, so owner (row 88c-RC2 (b))', async () => {
  const asked: [string, RequestInit | undefined][] = [];
  const answering = (status: number) => async (url: string, init?: RequestInit) => {
    asked.push([url, init]);
    return new Response('{}', { status });
  };
  assert.equal(await signedIn(answering(200)), true);
  assert.deepEqual(asked, [
    ['/api/studio/auth.session', { method: 'GET', credentials: 'same-origin', cache: 'no-store' }],
  ]);
  // Signed out, demo's not_available_in_profile, refused, or failing: no Sign out.
  for (const status of [401, 403, 404, 429, 500, 503]) {
    assert.equal(await signedIn(answering(status)), false, String(status));
  }
  assert.equal(
    await signedIn(async () => {
      throw new TypeError('offline');
    }),
    false,
    'a query that never answers',
  );
});
