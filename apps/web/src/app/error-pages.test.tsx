import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { themeInitScript } from '@portfolio/kit/theme-init';
import { FALLBACK_ID, validateManifest, type VariantRegistry } from '@portfolio/variant-contract';
import { REGISTRY, variantStylesheet } from '~/lib/variants';
import { PROFILES } from '~/server/capabilities';
import { setDeploymentState } from '~/server/config-store';
import { capabilityPolicy } from '~/server/policy';
import ErrorPage from './(site)/error';
import { NotFoundBody } from './_chrome/not-found-body';
import { NotFoundDocument } from './_chrome/not-found-document';

// What a visitor sees when a page fails or nothing lives at the address. No
// page shows a path, validation text, or stack from the error, and each
// links only home: no profile serves /admin any more. not-found.tsx reads
// the request's experience segment and renders NotFoundBody with it, as
// global-not-found.tsx reads its nonce and renders NotFoundDocument, so
// these render the bodies.

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
  const html = renderToStaticMarkup(await NotFoundBody());
  assert.match(html, /<h1>Page not found<\/h1>/);
  assertGeneric(html);
});

test("the global 404's document is in the portfolio's language and direction, with the site's theme script but on a preview's 404, the request's nonce, and none of the site's JSON-LD", async (t) => {
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
  // Inside the site's presentation boundary, with the stylesheet of the
  // variant that renders (#6), which carries the request's nonce, as a
  // preview's policy wants (#6, Slice 2).
  const stylesheet = `<link rel="stylesheet" href="${variantStylesheet('fallback')}" nonce="MVlEoQyHU2PoMq1Imu8oSA==" data-precedence="variant"/>`;
  assert.ok(
    html.startsWith(
      `<html lang="ar" dir="rtl"><head>${stylesheet}<script nonce="MVlEoQyHU2PoMq1Imu8oSA==">${themeInitScript('dark')}</script></head><body>`,
    ),
    html,
  );
  assert.ok(!html.includes('application/ld+json'), html);
  assert.match(html, /<h1>Page not found<\/h1>/);
  // A preview's 404 leaves the theme script out, as a preview document does (#7).
  const preview = renderToStaticMarkup(
    await NotFoundDocument({ nonce: 'MVlEoQyHU2PoMq1Imu8oSA==', theme: false }),
  );
  assert.ok(
    preview.startsWith(`<html lang="ar" dir="rtl"><head>${stylesheet}</head><body>`),
    preview,
  );
  assert.ok(!preview.includes('<script'), preview);
  assert.match(preview, /<h1>Page not found<\/h1>/);
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
    const html = renderToStaticMarkup(await NotFoundBody());
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
  const html = renderToStaticMarkup(await NotFoundBody());
  // The fallback composition stands in for the unregistered variant, which
  // only the boundary's data attribute names, for the owner and the tests,
  // and the boundary links the fallback's stylesheet and no other (#6).
  const marker = 'data-requested-variant="canary-variant"';
  const stylesheet = `<link rel="stylesheet" href="${variantStylesheet('fallback')}" data-precedence="variant"/>`;
  assert.ok(
    html.startsWith(
      `${stylesheet}<div data-variant="fallback" data-requested-variant="canary-variant" data-motion-policy="reduce"><main class="host-chrome">`,
    ),
    html,
  );
  assert.equal(html.split('rel="stylesheet"').length, 2, 'one stylesheet');
  assertGeneric(html.replace(marker, '').replace(stylesheet, ''));
});

/** A registry of the fallback composition and the route tests' `chapters` fixture variant. */
function withChapters(): VariantRegistry {
  const read = (file: string) =>
    JSON.parse(
      readFileSync(
        new URL(`../../../../tests/fixtures/variants/chapters/${file}`, import.meta.url),
        'utf8',
      ),
    );
  const { name: packageName, version } = read('package.json');
  const result = validateManifest(read('manifest.json'), { packageName });
  assert.ok(result.ok, JSON.stringify(result.diagnostics));
  return [
    REGISTRY.find(({ manifest }) => manifest.id === FALLBACK_ID)!,
    { packageName, version, manifest: result.manifest },
  ];
}

test("not-found.tsx renders in the composition of the request's experience segment where it isn't the live site's, naming no other stylesheet (#6, Slice 2)", async (t) => {
  t.after(() => setDeploymentState(undefined));
  deploy('demo', { appearance: { variant: 'canary-variant' }, motionPolicy: 'reduce' });
  const registry = withChapters();
  // Under demo, /sample?variant=fixture-chapters renders in its own segment, and
  // its payload carries the site's 404 in that variant, not the live site's.
  const html = renderToStaticMarkup(await NotFoundBody({ segment: 'fixture-chapters', registry }));
  assert.ok(
    html.startsWith(
      '<div data-variant="fixture-chapters" data-motion-policy="reduce"><main class="host-chrome">',
    ),
    html,
  );
  // The fixture has no stylesheet in this build, and the fallback's goes unnamed.
  assert.ok(!html.includes('rel="stylesheet"'), html);
  // The segment of the live site, the fallback composition standing in, is the live site's boundary.
  const live = renderToStaticMarkup(await NotFoundBody({ segment: 'fallback', registry }));
  const stylesheet = `<link rel="stylesheet" href="${variantStylesheet('fallback')}" data-precedence="variant"/>`;
  assert.ok(
    live.startsWith(
      `${stylesheet}<div data-variant="fallback" data-requested-variant="canary-variant" data-motion-policy="reduce">`,
    ),
    live,
  );
});
