import test from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { themeInitScript } from '@portfolio/kit';
import { PROFILES } from '~/server/capabilities';
import { setDeploymentState } from '~/server/config-store';
import { capabilityPolicy } from '~/server/policy';
import ErrorPage from './(site)/error';
import NotFound from './(site)/not-found';
import { NotFoundDocument } from './_chrome/not-found-document';

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

test('not-found.tsx links only home', async () => {
  const html = renderToStaticMarkup(await NotFound());
  assert.match(html, /<h1>Page not found<\/h1>/);
  assertGeneric(html);
});

test("the global 404's document is in the portfolio's language and direction, with the site's theme script, the request's nonce, and none of the site's JSON-LD", async (t) => {
  t.after(() => setDeploymentState(undefined));
  // Before startup: the neutral language, direction, and theme.
  setDeploymentState(undefined);
  const neutral = renderToStaticMarkup(await NotFoundDocument({}));
  assert.ok(
    neutral.startsWith(
      `<html lang="en" dir="ltr"><head><script>${themeInitScript('system')}</script></head><body><main class="host-chrome"><h1>Page not found</h1>`,
    ),
    neutral,
  );
  assertGeneric(neutral);
  // A live pair's locale, direction, and display mode, and the nonce of a Studio path's CSP.
  setDeploymentState({
    config: {
      profile: 'read-only',
      mode: 'production',
      origin: 'https://rowan.test',
      trustedProxyHops: 0,
      secrets: {},
    },
    catalog: {
      getLive: async () =>
        ({
          revisionId: 'r1',
          unit: {
            portfolio: { locale: 'ar', direction: 'rtl' },
            site: { appearance: { variant: 'fallback', displayMode: 'dark' }, sections: {} },
          },
        }) as never,
    },
    dispatch: () => assert.fail('the 404 page runs no operation'),
    degraded: [],
  });
  const html = renderToStaticMarkup(await NotFoundDocument({ nonce: 'MVlEoQyHU2PoMq1Imu8oSA==' }));
  assert.ok(
    html.startsWith(
      `<html lang="ar" dir="rtl"><head><script nonce="MVlEoQyHU2PoMq1Imu8oSA==">${themeInitScript('dark')}</script></head><body>`,
    ),
    html,
  );
  assert.ok(!html.includes('application/ld+json'), html);
  assert.match(html, /<h1>Page not found<\/h1>/);
});

test("the global 404's metadata resolves against the site's origin, and names none before startup", async (t) => {
  t.after(() => setDeploymentState(undefined));
  // It imports the site's stylesheets, which Next bundles; Node would read them as JavaScript.
  (Module as unknown as { _extensions: Record<string, () => void> })._extensions['.css'] = () => {};
  const { generateMetadata } = await import('./global-not-found');
  setDeploymentState(undefined);
  assert.deepEqual(await generateMetadata(), { title: 'Page not found' });
  deploy('read-only', {});
  assert.deepEqual(await generateMetadata(), {
    title: 'Page not found',
    metadataBase: new URL('https://rowan.test'),
  });
});

/** A deployment whose catalog serves `site`, or fails, carrying a canary, when there's none. */
function deploy(profile: (typeof PROFILES)[number], site?: object): void {
  setDeploymentState({
    config: {
      profile,
      mode: 'production',
      origin: 'https://rowan.test',
      trustedProxyHops: 0,
      secrets: {},
    },
    catalog: {
      getLive: async () => {
        if (!site) throw failure();
        return { revisionId: 'canary-revision', unit: { site } } as never;
      },
    },
    dispatch: () => assert.fail('the 404 page runs no operation'),
    degraded: [],
  });
}

test("not-found.tsx links the pages the profile's policy lists", async (t) => {
  t.after(() => setDeploymentState(undefined));
  for (const profile of PROFILES) {
    // A catalog that can't serve leaves the page without a boundary, and shows nothing from the error.
    deploy(profile);
    const html = renderToStaticMarkup(await NotFound());
    assert.match(html, /^<main class="host-chrome">/);
    assertGeneric(html);
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

test("not-found.tsx renders inside the live site's presentation boundary, naming nothing else", async (t) => {
  t.after(() => setDeploymentState(undefined));
  deploy('read-only', {
    appearance: { variant: 'canary-variant' },
    motionPolicy: 'reduce',
    sections: { 'canary-section': { hidden: true } },
  });
  const html = renderToStaticMarkup(await NotFound());
  // The fallback composition stands in for the unregistered variant, which
  // only the boundary's data attribute names, for the owner and the tests.
  const marker = 'data-requested-variant="canary-variant"';
  assert.match(
    html,
    /^<div data-variant="fallback" data-requested-variant="canary-variant" data-motion-policy="reduce"><main class="host-chrome">/,
  );
  assertGeneric(html.replace(marker, ''));
});
