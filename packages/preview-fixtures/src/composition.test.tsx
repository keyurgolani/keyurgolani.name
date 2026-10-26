import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { composeSchemas, resolvePortfolioView, type ParsedPair } from '@portfolio/schema';
import {
  buildRenderInput,
  validateManifest,
  type VariantManifest,
} from '@portfolio/variant-contract';
import EnvironmentFixture from '.';

// The environment fixture (#7, Slice 4, item 10): a fixture package whose
// manifest validates, which renders every section through the shared
// renderers and styles only against the environment attributes.

// tsx compiles JSX to React.createElement calls, so the test supplies React.
Object.assign(globalThis, { React });

const PACKAGE = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const RAW = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
const { PortfolioSchema, SiteSchema } = composeSchemas();

test('a fixture package whose manifest validates with nothing to report, and one enhancement', () => {
  const result = validateManifest(RAW, { packageName: PACKAGE.name, exports: PACKAGE.exports });
  assert.ok(result.ok, JSON.stringify(result.diagnostics));
  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.manifest.id, 'fixture-environment');
  assert.deepEqual(
    result.manifest.enhancements?.map(({ id }) => id),
    ['mark'],
  );
  assert.deepEqual(PACKAGE.portfolio, {
    kind: 'variant',
    manifest: './manifest.json',
    fixture: true,
  });
});

const MANIFEST = (() => {
  const result = validateManifest(RAW, { packageName: PACKAGE.name, exports: PACKAGE.exports });
  assert.ok(result.ok);
  return result.manifest as VariantManifest;
})();

const SITE = SiteSchema.parse({
  schemaVersion: 2,
  appearance: {
    variant: 'fixture-environment',
    designLanguage: 'platform-neutral',
    colorScheme: 'warm',
    typography: 'classic',
    displayMode: 'system',
  },
  visitorControls: {
    variant: 'locked',
    designLanguage: 'locked',
    colorScheme: 'locked',
    typography: 'locked',
    displayMode: 'locked',
  },
  motionPolicy: 'respect-os',
  features: { feed: true },
});

function render(portfolio: unknown) {
  const pair = { portfolio: PortfolioSchema.parse(portfolio), site: SITE } as unknown as ParsedPair;
  const input = buildRenderInput({
    view: resolvePortfolioView(pair, {}, { mediaBase: '/media' }),
    manifest: MANIFEST,
    route: { route: 'home' },
    basePath: '',
    origin: 'https://rowan.test',
    requestTime: '2026-01-01T00:00:00Z',
  });
  return renderToStaticMarkup(<EnvironmentFixture input={input} />);
}

test('one main, one h1, the mark that moves, and every section shared, with the enhancement left to the browser', () => {
  const html = render({
    schemaVersion: 3,
    locale: 'en',
    direction: 'ltr',
    identity: { name: 'Rowan Fixture', tagline: 'Builds calm software.' },
    sections: [
      { kind: 'lede', id: 'about', title: 'About', body: 'Hi.' },
      { kind: 'lede', id: 'more', title: 'More', body: 'Again.' },
    ],
  });
  assert.equal(html.match(/<main\b/g)?.length, 1);
  assert.match(html, /<h1 class="fe-name">Rowan Fixture<\/h1>/);
  assert.match(html, /<span class="fe-motion" aria-hidden="true"><\/span>/);
  // The server renders no enhancement: the kit mounts it after hydration.
  assert.doesNotMatch(html, /data-fixture-environment-enhanced/);
  assert.deepEqual(
    [...html.matchAll(/<section id="([^"]+)"/g)].map(([, id]) => id),
    ['about', 'more'],
  );
});

test('its stylesheet keys everything on the environment attributes or the preferences they stand in for, with no font face', () => {
  const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8').replace(
    /\/\*[\s\S]*?\*\//g,
    '',
  );
  assert.doesNotMatch(css, /@font-face|@import|url\(/);
  for (const attribute of ['data-display-mode', 'data-contrast', 'data-motion']) {
    assert.match(css, new RegExp(`\\[${attribute}=`), attribute);
  }
  for (const preference of ['prefers-contrast: more', 'prefers-reduced-motion: reduce']) {
    assert.match(css, new RegExp(`@media \\(${preference}\\)`), preference);
  }
  for (const [, selectors] of css.matchAll(/([^{}@]+)\{[^{}]*\}/g)) {
    for (const selector of selectors!.split(',')) {
      const trimmed = selector.trim();
      if (/^(?:from|to|\d+%)$/.test(trimmed)) continue;
      assert.match(trimmed, /^\[data-variant='fixture-environment'\]/, trimmed);
    }
  }
});
