import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PLATFORM_DEFAULTS } from '@portfolio/appearance';
import { compileGeneratedScheme } from '@portfolio/appearance/node';
import { FALLBACK_ID, validateManifest, type VariantRegistry } from '@portfolio/variant-contract';
import { fallbackBoundary } from '~/lib/fallback-boundary';
import { REGISTRY, variantStylesheet } from '~/lib/variants';
import { PROFILES } from '~/server/capabilities';
import { setDeploymentState } from '~/server/config-store';
import { capabilityPolicy } from '~/server/policy';
import { FALLBACK_ATTRIBUTES, fallbackStylesheets } from '~/server/unavailable-page';
import { preferenceCookie } from '~/server/visitor-appearance';
import ErrorPage from './(site)/error';
import { FallbackBoundaryProvider } from './_chrome/fallback-boundary';
import { NotFoundBody } from './_chrome/not-found-body';
import { NotFoundDocument } from './_chrome/not-found-document';

// tsx compiles the appearance package's JSX to React.createElement calls, so the test supplies React.
Object.assign(globalThis, { React });

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
  assert.deepEqual(pageLinks(html), ['/']);
}

/** Where the page's links go: every anchor's but the boundary's skip link to the page's main. */
function pageLinks(html: string): string[] {
  return [...html.matchAll(/<a [^>]*href="([^"]*)"/g)]
    .map((match) => match[1]!)
    .filter((href) => href !== '#main');
}

/** A stylesheet link as React renders it, in `precedence`, with the request's nonce when there's one. */
function stylesheetLink(href: string, precedence: string, nonce?: string): string {
  return `<link rel="stylesheet" href="${href}"${nonce ? ` nonce="${nonce}"` : ''} data-precedence="${precedence}"/>`;
}

/** The platform's and the fallback packs' stylesheets, as every boundary of a page with no site links them. */
function fallbackLinks(nonce?: string): string {
  return fallbackStylesheets()
    .map((href) => stylesheetLink(href, 'appearance', nonce))
    .join('');
}

/** The fallback packs' document boundary and its skip link, as the 503 writes it out. */
const FALLBACK_BOUNDARY = `<div${FALLBACK_ATTRIBUTES.map(([name, value]) => ` ${name}="${value}"`).join('')}><a data-ui-slot="skip-link" href="#main">Skip to content</a>`;

test('error.tsx shows the digest and nothing else from the error', () => {
  const html = renderToStaticMarkup(<ErrorPage error={failure('4021974117')} />);
  assert.match(html, /<h1>Something went wrong<\/h1>/);
  assert.match(html, /Reference: <code>4021974117<\/code>/);
  assertGeneric(html);
});

test("error.tsx renders in the fallback packs' document boundary the site's layout hands down, whatever the site selected (#19, Slice 4)", () => {
  const html = renderToStaticMarkup(
    <FallbackBoundaryProvider value={fallbackBoundary()}>
      <ErrorPage error={failure('4021974117')} />
    </FallbackBoundaryProvider>,
  );
  assert.ok(
    html.startsWith(
      `${fallbackLinks()}${FALLBACK_BOUNDARY}<main id="main" tabindex="-1" class="host-chrome"><h1>Something went wrong</h1>`,
    ),
    html,
  );
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

test("the global 404's document is in the portfolio's language and direction, inside the live site's document boundary with the visitor's own display mode, the request's nonce on every stylesheet, and no script or JSON-LD (#19, Slice 4)", async (t) => {
  t.after(() => setDeploymentState(undefined));
  // Before startup: the neutral language and direction, in the fallback packs.
  setDeploymentState(undefined);
  const neutral = renderToStaticMarkup(await NotFoundDocument({}));
  assert.ok(
    neutral.startsWith(
      `<html lang="en" dir="ltr"><head>${stylesheetLink(variantStylesheet(FALLBACK_ID)!, 'variant')}${fallbackLinks()}</head><body>${FALLBACK_BOUNDARY}<main id="main" tabindex="-1" class="host-chrome"><h1>Page not found</h1>`,
    ),
    neutral,
  );
  assertGeneric(neutral);
  // A live pair's locale, direction, and display mode, the visitor's cookie
  // choosing another, and the nonce of a Studio or preview path's CSP.
  t.mock.method(preferenceCookie, 'read', async () => 'mode=light');
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
            site: {
              appearance: { ...PLATFORM_DEFAULTS, variant: 'canary-variant', displayMode: 'dark' },
              sections: {},
            },
          },
        }) as never,
    },
    dispatch: () => assert.fail('the 404 page runs no operation'),
    degraded: [],
  });
  const nonce = 'MVlEoQyHU2PoMq1Imu8oSA==';
  const html = renderToStaticMarkup(await NotFoundDocument({ nonce }));
  // <html> carries the language and direction alone: the boundary is the appearance.
  assert.ok(
    html.startsWith(
      `<html lang="ar" dir="rtl"><head>${stylesheetLink(variantStylesheet(FALLBACK_ID)!, 'variant', nonce)}${fallbackLinks(nonce)}</head><body><div data-appearance-boundary="document" data-variant="fallback" `,
    ),
    html,
  );
  assert.match(html, / data-display-mode="light" /);
  assert.ok(!html.includes('<script'), html);
  assert.ok(!html.includes('data-theme'), html);
  assert.ok(!html.includes('application/ld+json'), html);
  assert.match(html, /<h1>Page not found<\/h1>/);
});

test("a tampered or unregistered preference cookie renders the site's own appearance on that axis, never an error page, and never shows in the page (#19, Slice 4)", async (t) => {
  t.after(() => setDeploymentState(undefined));
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
            portfolio: { locale: 'en', direction: 'ltr' },
            site: {
              appearance: { ...PLATFORM_DEFAULTS, variant: 'canary-variant', displayMode: 'dark' },
              visitorControls: {
                variant: 'locked',
                designLanguage: 'locked',
                colorScheme: 'selectable',
                typography: 'locked',
                displayMode: 'selectable',
              },
              sections: {},
            },
          },
        }) as never,
    },
    dispatch: () => assert.fail('the 404 page runs no operation'),
    degraded: [],
  });
  let cookie = '';
  t.mock.method(preferenceCookie, 'read', async () => cookie);
  for (const value of [
    'scheme=nebula-canary',
    'mode=dim-canary',
    'mode=light&mode=dark&scheme=Nebula-Canary',
    '<script>canary()</script>',
    '%E0%A4%A&scheme=%ZZ',
    `scheme=${'canary'.repeat(400)}`,
  ]) {
    cookie = value;
    const html = renderToStaticMarkup(await NotFoundDocument({}));
    assert.ok(html.startsWith('<html lang="en" dir="ltr">'), value);
    assert.match(html, /<h1>Page not found<\/h1>/, value);
    assert.match(html, / data-color-scheme="warm-parchment" /, value);
    assert.doesNotMatch(html, /canary\(|nebula|dim-canary|canarycanary/i, value);
    assert.ok(!html.includes('<script'), value);
  }
  // A well-formed mode beside a malformed scheme still sets the mode.
  cookie = 'mode=light&scheme=Nebula-Canary';
  assert.match(renderToStaticMarkup(await NotFoundDocument({})), / data-display-mode="light" /);
  // And an unregistered id alone leaves the published mode.
  cookie = 'scheme=nebula-canary';
  assert.match(renderToStaticMarkup(await NotFoundDocument({})), / data-display-mode="dark" /);
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
function deploy(profile: (typeof PROFILES)[number], site?: object, snapshots?: object): void {
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
        return { revisionId: 'canary-revision', unit: { site, snapshots } } as never;
      },
    },
    dispatch: () => assert.fail('the 404 page runs no operation'),
    degraded: [],
  });
}

test("not-found.tsx links the pages the profile's policy lists", async (t) => {
  t.after(() => setDeploymentState(undefined));
  for (const profile of PROFILES) {
    // A catalog that can't serve leaves the page in the fallback packs, and shows nothing from the error.
    deploy(profile);
    const html = renderToStaticMarkup(await NotFoundBody());
    assert.ok(html.includes(`${FALLBACK_BOUNDARY}<main id="main"`), html);
    assertGeneric(html);
    assert.deepEqual(
      pageLinks(html),
      capabilityPolicy(profile)
        .navigation(null)
        .map((link) => link.href),
      profile,
    );
  }
});

test("not-found.tsx renders inside the live site's document boundary, naming nothing else", async (t) => {
  t.after(() => setDeploymentState(undefined));
  t.mock.method(preferenceCookie, 'read', async () => null);
  deploy('read-only', {
    appearance: { ...PLATFORM_DEFAULTS, variant: 'canary-variant' },
    motionPolicy: 'reduce',
    sections: { 'canary-section': { hidden: true } },
  });
  const html = renderToStaticMarkup(await NotFoundBody());
  // The fallback composition stands in for the unregistered variant, which
  // only the boundary's data attributes name, for the owner and the tests,
  // and the boundary links the fallback's stylesheet and the selected
  // packs', and no other (#6; #19, Slice 4).
  const marker = 'data-requested-variant="canary-variant"';
  const variant = stylesheetLink(variantStylesheet(FALLBACK_ID)!, 'variant');
  assert.ok(html.startsWith(`${variant}${fallbackLinks()}<div `), html);
  const boundary = /^<div ([^>]*)>/.exec(html.slice(`${variant}${fallbackLinks()}`.length))![1]!;
  for (const attribute of [
    'data-appearance-boundary="document"',
    'data-variant="fallback"',
    'data-motion="reduced"',
    'data-appearance-fallback="variant"',
    marker,
  ]) {
    assert.ok(boundary.includes(attribute), `${attribute}: ${boundary}`);
  }
  assert.equal(html.split('data-precedence="variant"').length, 2, 'one variant stylesheet');
  assert.ok(
    html.includes('<a data-ui-slot="skip-link" href="#main">Skip to content</a><main id="main"'),
    html,
  );
  assertGeneric(html.replace(marker, ''));
});

/** brand-seed's reference record (#20 PR 3), as the live revision's snapshots/schemes.json holds it. */
function storedBrandSeed() {
  const record = JSON.parse(
    readFileSync(
      new URL('../../../../packages/appearance-schemes/generated/brand-seed.json', import.meta.url),
      'utf8',
    ),
  ) as { result: { generator: unknown; input: { seedColor: string }; tokens: unknown } };
  return {
    generator: record.result.generator,
    inputsHash: createHash('sha256').update(record.result.input.seedColor).digest('hex'),
    tokens: record.result.tokens,
  };
}

test("not-found.tsx renders the live revision's stored generated scheme in its document boundary, and the fallback without one (#20 PR 3)", async (t) => {
  t.after(() => setDeploymentState(undefined));
  t.mock.method(preferenceCookie, 'read', async () => null);
  const site = {
    appearance: { ...PLATFORM_DEFAULTS, variant: FALLBACK_ID, colorScheme: 'brand-seed' },
    motionPolicy: 'system',
    sections: {},
  };
  const boundary = async (snapshots: object) => {
    deploy('read-only', site, snapshots);
    const html = renderToStaticMarkup(await NotFoundBody());
    return /<div ([^>]*data-appearance-boundary="document"[^>]*)>/.exec(html)![1]!;
  };
  const stored = await boundary({ schemes: { 'brand-seed': storedBrandSeed() } });
  assert.ok(stored.includes('data-color-scheme="brand-seed"'), stored);
  assert.ok(!stored.includes('data-appearance-fallback'), stored);
  // A revision without stored sets, or with a malformed entry, falls back on the scheme.
  for (const snapshots of [{}, { schemes: { 'brand-seed': { generator: 7 } } }]) {
    const without = await boundary(snapshots);
    assert.ok(!without.includes('data-color-scheme="brand-seed"'), without);
    assert.ok(without.includes('data-appearance-fallback="color-scheme"'), without);
  }
});

test("not-found.tsx links the live revision's generated scheme from /_portfolio/scheme/, from the same read its boundary renders, and links none once it falls back (#20)", async (t) => {
  t.after(() => setDeploymentState(undefined));
  t.mock.method(preferenceCookie, 'read', async () => null);
  const site = {
    appearance: { ...PLATFORM_DEFAULTS, variant: FALLBACK_ID, colorScheme: 'brand-seed' },
    motionPolicy: 'system',
    sections: {},
  };
  const stored = storedBrandSeed();
  const render = async (revisionId: string, snapshots: object) => {
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
          ({ revisionId, unitHash: `hash-${revisionId}`, unit: { site, snapshots } }) as never,
      },
      dispatch: () => assert.fail('the 404 page runs no operation'),
      degraded: [],
    });
    return renderToStaticMarkup(await NotFoundBody());
  };
  const css = compileGeneratedScheme(
    'brand-seed',
    stored.tokens as Parameters<typeof compileGeneratedScheme>[1],
  );
  const href = `/_portfolio/scheme/brand-seed.${createHash('sha256').update(css).digest('hex').slice(0, 12)}.css`;
  const html = await render('nf-stored', { schemes: { 'brand-seed': stored } });
  const boundary = /<div ([^>]*data-appearance-boundary="document"[^>]*)>/.exec(html)![1]!;
  assert.ok(boundary.includes('data-color-scheme="brand-seed"'), boundary);
  assert.ok(!boundary.includes('data-appearance-fallback'), boundary);
  assert.ok(html.includes(`href="${href}"`), html);
  // With no stored sets the scheme falls back, and no scheme file is linked.
  const without = await render('nf-plain', {});
  assert.ok(without.includes('data-appearance-fallback="color-scheme"'), without);
  assert.ok(!without.includes('/_portfolio/scheme/'), without);
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
  deploy('demo', {
    appearance: { ...PLATFORM_DEFAULTS, variant: 'canary-variant' },
    motionPolicy: 'reduce',
  });
  // Demo reads the query, never a cookie.
  t.mock.method(preferenceCookie, 'read', async () => assert.fail('demo reads no cookie'));
  const registry = withChapters();
  // Under demo, /sample?variant=fixture-chapters renders in its own segment, and
  // its payload carries the site's 404 in that variant, not the live site's.
  const html = renderToStaticMarkup(await NotFoundBody({ segment: 'fixture-chapters', registry }));
  assert.ok(
    html.startsWith(
      `${fallbackLinks()}<div data-appearance-boundary="document" data-variant="fixture-chapters" `,
    ),
    html,
  );
  assert.match(html, / data-motion="reduced" /);
  // The fixture has no stylesheet in this build, and the fallback's goes unnamed.
  assert.ok(!html.includes('data-precedence="variant"'), html);
  // The segment of the live site, the fallback composition standing in, is the live site's boundary.
  const live = renderToStaticMarkup(await NotFoundBody({ segment: 'fallback', registry }));
  assert.ok(
    live.startsWith(
      `${stylesheetLink(variantStylesheet(FALLBACK_ID)!, 'variant')}${fallbackLinks()}<div data-appearance-boundary="document" data-variant="fallback" `,
    ),
    live,
  );
  assert.match(live, / data-requested-variant="canary-variant" /);
});
