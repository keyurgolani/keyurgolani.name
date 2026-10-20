import test from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { PROFILES } from '~/server/capabilities';
import { setDeploymentState } from '~/server/config-store';
import { capabilityPolicy } from '~/server/policy';
import ErrorPage from './error';
import NotFound from './not-found';

// What a visitor sees when a page fails or nothing lives at the address. No
// page shows a path, validation text, or stack from the error, and each
// links only home: no profile serves /admin any more.

const HERE = path.basename(fileURLToPath(import.meta.url));

/** An error carrying everything the pages must not show. */
function failure(digest?: string): Error & { digest?: string } {
  const error = new Error('canary: /srv/canary/config/portfolio.yml: /identity/name is required');
  return digest === undefined ? error : Object.assign(error, { digest });
}

function assertGeneric(html: string): void {
  for (const leak of ['canary', '/srv/', 'portfolio.yml', '/identity', 'required', HERE, 'admin']) {
    assert.ok(!html.includes(leak), `the page shows "${leak}": ${html}`);
  }
  const links = [...html.matchAll(/href="([^"]*)"/g)].map((match) => match[1]);
  assert.deepEqual(links, ['/']);
}

test('error.tsx shows the digest and nothing else from the error', () => {
  const html = renderToStaticMarkup(<ErrorPage error={failure('4021974117')} />);
  assert.match(html, /<h1>Something went wrong<\/h1>/);
  assert.match(html, /Reference: <code>4021974117<\/code>/);
  assertGeneric(html);
});

test('error.tsx without a digest shows no reference', () => {
  const html = renderToStaticMarkup(<ErrorPage error={failure()} />);
  assert.ok(!html.includes('Reference'), html);
  assertGeneric(html);
});

test('global-error.tsx brings its own document and shows only the digest', async () => {
  // It imports its stylesheet, which Next bundles; Node would read it as JavaScript.
  (Module as unknown as { _extensions: Record<string, () => void> })._extensions['.css'] = () => {};
  const { default: GlobalError } = await import('./global-error');
  const html = renderToStaticMarkup(<GlobalError error={failure('4021974117')} />);
  // React hoists the <title> into a <head> of its own.
  assert.match(html, /^<html lang="en"><head><title>Something went wrong<\/title><\/head><body>/);
  assert.match(html, /Reference: <code>4021974117<\/code>/);
  assertGeneric(html);
});

test('not-found.tsx links only home', () => {
  const html = renderToStaticMarkup(<NotFound />);
  assert.match(html, /<h1>Page not found<\/h1>/);
  assertGeneric(html);
});

test("not-found.tsx links the pages the profile's policy lists", (t) => {
  t.after(() => setDeploymentState(undefined));
  for (const profile of PROFILES) {
    setDeploymentState({
      config: {
        profile,
        mode: 'production',
        origin: 'https://rowan.test',
        trustedProxyHops: 0,
        secrets: {},
      },
      catalog: { getLive: () => assert.fail('the 404 page reads no catalog') },
      dispatch: () => assert.fail('the 404 page runs no operation'),
      degraded: [],
    });
    const html = renderToStaticMarkup(<NotFound />);
    const links = [...html.matchAll(/href="([^"]*)"/g)].map((match) => match[1]);
    assert.deepEqual(
      links,
      capabilityPolicy(profile)
        .navigation(null)
        .map((link) => link.href),
      profile,
    );
  }
});
