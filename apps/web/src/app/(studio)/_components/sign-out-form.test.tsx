import test from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StudioLoadAlert } from './load/late-alert';
import { studioProfileOf } from './sign-out-form';
import { StudioErrorView } from './studio-error-view';

// tsx compiles JSX to React.createElement calls, so the test supplies React.
Object.assign(globalThis, { React });

// Sign out where Studio itself didn't load (row 88c-RC2, as the owner ruled): error.tsx and the
// load alert ("Studio couldn't load.") offer the owner a Sign out form, a plain post to
// auth.logout that needs no script of Owner Studio's, beside Reload Studio. Its choice to discard
// this browser's unsaved changes is a second submit, as no dialog can ask without the shell.
// Under demo, which has no session and no auth.logout, neither shows. The profile is the one the
// (studio) layout puts on <body>.

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

test("the profile is the one <body> names, and none when there's no body or no name (row 88c-RC2)", () => {
  assert.equal(studioProfileOf({ dataset: { studioProfile: 'owner' } }), 'owner');
  assert.equal(studioProfileOf({ dataset: { studioProfile: 'demo' } }), 'demo');
  assert.equal(studioProfileOf({ dataset: {} }), null);
  assert.equal(studioProfileOf(null), null);
});
