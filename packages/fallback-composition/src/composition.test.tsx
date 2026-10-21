import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { composeSchemas, toPublicView, type ParsedPair } from '@portfolio/schema';
import { readPair } from '@portfolio/schema/node';
import {
  buildRenderInput,
  validateManifest,
  type VariantManifest,
} from '@portfolio/variant-contract';
import FallbackComposition from '.';

// The fallback composition (#5, Slice 3): its manifest is what the contract
// pins for it, and it renders any portfolio as one main, one h1, one visitor
// control slot, and every visible section through the shared renderers.

// tsx compiles JSX to React.createElement calls, so the test supplies React.
Object.assign(globalThis, { React });

const PACKAGE = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const RAW = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
const { PortfolioSchema, SiteSchema } = composeSchemas();

test('its manifest validates with nothing to report, and pins the fallback values', () => {
  const result = validateManifest(RAW, { packageName: PACKAGE.name, exports: PACKAGE.exports });
  assert.ok(result.ok, JSON.stringify(result.diagnostics));
  assert.deepEqual(result.diagnostics, []);
  const { manifest } = result;
  assert.equal(manifest.id, 'fallback');
  assert.deepEqual(
    [manifest.compositionFamily, manifest.motionIntent, manifest.performanceTier],
    ['document', 'still', 'light'],
  );
  assert.deepEqual([manifest.renderedKinds, manifest.unsupportedKinds], [[], []]);
  assert.ok(manifest.contentSlots.every(({ level }) => level === 'optional'));
  assert.deepEqual(PACKAGE.portfolio, { kind: 'variant', manifest: './manifest.json' });
});

const MANIFEST = (() => {
  const result = validateManifest(RAW, { packageName: PACKAGE.name });
  assert.ok(result.ok);
  return result.manifest as VariantManifest;
})();

const SITE = SiteSchema.parse({
  schemaVersion: 2,
  appearance: {
    variant: 'missing-variant',
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

function render(portfolio: unknown, idPrefix = '') {
  const pair = { portfolio: PortfolioSchema.parse(portfolio), site: SITE } as unknown as ParsedPair;
  return markup(pair, idPrefix);
}

function markup(pair: ParsedPair, idPrefix = '') {
  const input = buildRenderInput({
    view: toPublicView(pair),
    manifest: MANIFEST,
    route: { route: 'home' },
    basePath: '',
    origin: 'https://rowan.test',
    requestTime: '2026-01-01T00:00:00Z',
    idPrefix,
  });
  return renderToStaticMarkup(<FallbackComposition input={input} />);
}

const count = (html: string, pattern: RegExp) => html.match(pattern)?.length ?? 0;

const PORTFOLIO = {
  schemaVersion: 2,
  locale: 'en',
  direction: 'ltr',
  identity: { name: 'Rowan Fallback', tagline: 'Builds calm software.' },
  links: [{ url: 'https://rowan.test', label: 'Site' }],
  sections: [
    { kind: 'hero', id: 'top' },
    { kind: 'lede', id: 'about', title: 'About', body: 'Hi.' },
    {
      kind: 'cta',
      id: 'hire',
      title: 'Hire me',
      primaryAction: { url: '#contact', label: 'Write' },
    },
    { kind: 'contact', id: 'contact', title: 'Contact' },
  ],
};

test('one main, one h1 from the hero, one visitor control slot, and every section shared, in order', () => {
  const html = render(PORTFOLIO);
  assert.equal(count(html, /<main\b/g), 1);
  assert.match(html, /<main id="main" class="fc-main" tabindex="-1">/);
  assert.equal(count(html, /<h1\b/g), 1);
  assert.match(html, /<h1 class="pf-hero__name">Rowan Fallback<\/h1>/);
  assert.equal(count(html, /data-visitor-control-slot/g), 1);
  const sections = [...html.matchAll(/<section id="([^"]+)"[^>]* data-renderer="([^"]+)"/g)];
  assert.deepEqual(
    sections.map(([, id, renderer]) => [id, renderer]),
    [
      ['top', 'shared'],
      ['about', 'shared'],
      ['hire', 'shared'],
      ['contact', 'shared'],
    ],
  );
});

test('the navigation links each titled section but the hero and calls to action', () => {
  const html = render(PORTFOLIO);
  const nav = /<nav class="fc-nav" aria-label="Sections">([\s\S]*?)<\/nav>/.exec(html)?.[1] ?? '';
  assert.deepEqual(
    [...nav.matchAll(/<a href="([^"]+)"[^>]*>([^<]+)<\/a>/g)].map(([, href, text]) => [href, text]),
    [
      ['#about', 'About'],
      ['#contact', 'Contact'],
    ],
  );
  // The render's id prefix reaches the main, the sections, and every link.
  const prefixed = render(PORTFOLIO, 'pv-');
  assert.match(prefixed, /<main id="pv-main"/);
  assert.match(prefixed, /<a href="#pv-contact"[^>]*>Contact<\/a>/);
  assert.match(prefixed, /<section id="pv-contact"/);
});

test("without a hero, the identity's name is the page's one h1", () => {
  const html = render({ ...PORTFOLIO, sections: PORTFOLIO.sections.slice(1) });
  assert.equal(count(html, /<h1\b/g), 1);
  assert.match(
    html,
    /<main id="main" class="fc-main" tabindex="-1"><h1 class="fc-name">Rowan Fallback<\/h1>/,
  );
  // A second hero takes h2, so there's still one h1.
  const twice = render({
    ...PORTFOLIO,
    sections: [...PORTFOLIO.sections, { kind: 'hero', id: 'again', name: 'Again' }],
  });
  assert.equal(count(twice, /<h1\b/g), 1);
  assert.match(twice, /<h2 class="pf-hero__name">Again<\/h2>/);
});

test('every profession pair renders, both directions included, with the same structure', () => {
  const pairs = new URL('../../schema/src/__fixtures__/pairs/', import.meta.url);
  const practices = readdirSync(pairs).sort();
  assert.ok(practices.length >= 8);
  for (const practice of practices) {
    const dir = new URL(`${practice}/yaml/`, pairs);
    const result = readPair({
      portfolio: fileURLToPath(new URL('portfolio.yml', dir)),
      site: fileURLToPath(new URL('site.yml', dir)),
    });
    assert.ok(result.ok, practice);
    const html = markup(result.pair);
    assert.equal(count(html, /<main\b/g), 1, practice);
    assert.equal(count(html, /<h1\b/g), 1, practice);
    assert.equal(count(html, /data-visitor-control-slot/g), 1, practice);
    assert.doesNotMatch(html, /data-renderer="bespoke"/, practice);
  }
});

test('its stylesheet stays under [data-variant="fallback"] with logical properties and no appearance', () => {
  const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8').replace(
    /\/\*[\s\S]*?\*\//g,
    '',
  );
  for (const [, selectors, body] of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    for (const selector of selectors!.split(',')) {
      assert.match(selector.trim(), /^\[data-variant='fallback'\]/, selector);
    }
    assert.doesNotMatch(body!, /\b(?:color|background|font|opacity|animation|transition)\b/, body);
    assert.doesNotMatch(body!, /-(?:left|right)\b|text-align/, body);
  }
});
