import test from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import StudioError from './(studio)/error';

// tsx compiles JSX to React.createElement calls, so the test supplies React.
Object.assign(globalThis, { React });

// Studio's error page, app/(studio)/error.tsx (row 88c), tested here beside
// error-pages.test.tsx, since every file in the Studio group is a route or
// segment file or sits in a private folder (routes.test.ts). An alert that
// Studio couldn't load, with Reload Studio, and like every error page only
// the digest from the error (threat-model baseline-4). It offers no Sign
// out: it renders under every profile, and Demo Studio has no session to end.

/** An error carrying everything the page must not show. */
function failure(digest?: string): Error & { digest?: string } {
  const error = new Error('canary: /srv/canary/config/portfolio.yml: /identity/name is required');
  return digest === undefined ? error : Object.assign(error, { digest });
}

test("Studio's error page says Studio couldn't load, with Reload Studio, and shows the digest and nothing else from the error (row 88c, R7)", () => {
  const html = renderToStaticMarkup(<StudioError error={failure('4021974117')} />);
  assert.match(
    html,
    /<div class="studio-alert" role="alert"><p>Studio couldn(?:&#x27;|')t load\.<\/p><button type="button" class="studio-button">Reload Studio<\/button><\/div>/,
  );
  assert.match(html, /Reference: <code>4021974117<\/code>/);
  assert.ok(!html.includes('canary'), html);
  assert.ok(!html.includes('Sign out'), html);
  const bare = renderToStaticMarkup(<StudioError error={failure()} />);
  assert.ok(!bare.includes('Reference'), bare);
});
