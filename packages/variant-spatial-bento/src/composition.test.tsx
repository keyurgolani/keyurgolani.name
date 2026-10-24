import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PresentationBoundary } from '@portfolio/appearance/react';
import { PLATFORM_DEFAULTS } from '@portfolio/appearance';
import { renderSection, SHARED_RENDERERS } from '@portfolio/kit/sections';
import { composeSchemas, resolvePortfolioView, type ParsedPair } from '@portfolio/schema';
import { readPair } from '@portfolio/schema/node';
import {
  buildRenderInput,
  validateManifest,
  type VariantManifest,
  type VariantRenderInput,
} from '@portfolio/variant-contract';
import {
  CONTRACT_FIXTURES,
  contractFixture,
  HIDDEN_CANARY,
} from '@portfolio/variant-contract/node';
import SpatialBento from '.';

// Spatial Bento (#16), the static document: its manifest holds the
// catalog's pins and declares budgets inside the medium ceilings, and it
// renders every contract fixture as one main, one h1, one visitor control
// slot, its section links, and a tile a section in content order, each
// section with every word, link, and action the shared renderers write,
// beside a still of the stage that holds none of them. No stage code ships,
// nothing hidden reaches it, and in a plate every id is under the prefix.

// tsx compiles JSX to React.createElement calls, so the test supplies React.
Object.assign(globalThis, { React });

const PACKAGE = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const RAW = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
const CEILINGS = JSON.parse(
  readFileSync(new URL('../../../runtime-budgets.json', import.meta.url), 'utf8'),
).budgets.tiers;
const { PortfolioSchema } = composeSchemas();

test("its manifest validates with nothing to report, holds the catalog's pins, and declares medium budgets", () => {
  const result = validateManifest(RAW, { packageName: PACKAGE.name, exports: PACKAGE.exports });
  assert.ok(result.ok, JSON.stringify(result.diagnostics));
  assert.deepEqual(result.diagnostics, []);
  const { manifest } = result;
  assert.equal(manifest.id, 'spatial-bento');
  assert.deepEqual(
    [manifest.compositionFamily, manifest.motionIntent, manifest.performanceTier],
    ['bento', 'adaptive', 'heavy'],
  );
  assert.deepEqual(manifest.renderedKinds, ['hero']);
  assert.deepEqual(manifest.unsupportedKinds, []);
  assert.deepEqual(manifest.textDirection, ['ltr', 'rtl']);
  // The heavy tier is the catalog's, for the stage that follows; this build declares the medium one's.
  const budgets: Record<string, number> = { ...manifest.budgets };
  assert.equal(Object.keys(budgets).length, 6);
  for (const [kind, declared] of Object.entries(budgets)) {
    assert.ok(
      declared <= CEILINGS.medium[kind],
      `${kind}: ${declared} over medium's ${CEILINGS.medium[kind]}`,
    );
  }
  assert.equal(budgets.animation, 0);
  assert.equal(budgets.enhancement, 0);
  assert.deepEqual(PACKAGE.portfolio, { kind: 'variant', manifest: './manifest.json' });
  // Its tests run under the root's pnpm test.
  assert.match(PACKAGE.scripts.test, /tsx --test/);
});

const MANIFEST = (() => {
  const result = validateManifest(RAW, { packageName: PACKAGE.name });
  assert.ok(result.ok);
  return result.manifest as VariantManifest;
})();

/** The render input of a contract fixture, as the host builds it. */
function fixtureInput(name: string, idPrefix = ''): VariantRenderInput {
  const fixture = contractFixture(name);
  const read = readPair(fixture.files);
  assert.ok(read.ok, JSON.stringify(read));
  return inputOf(read.pair, idPrefix);
}

function inputOf(pair: ParsedPair, idPrefix = ''): VariantRenderInput {
  return buildRenderInput({
    view: resolvePortfolioView(pair, {}, { mediaBase: '/media' }),
    manifest: MANIFEST,
    route: { route: 'home' },
    basePath: '',
    origin: 'https://rowan.test',
    requestTime: '2026-10-23T12:00:00Z',
    idPrefix,
  });
}

/** The shared renderer for the one kind the manifest renders itself, so a section renders as the kit alone writes it. */
const SHARED_HERO = { hero: SHARED_RENDERERS.hero };

const html = (input: VariantRenderInput) => renderToStaticMarkup(<SpatialBento input={input} />);
const count = (markup: string, pattern: RegExp) => markup.match(pattern)?.length ?? 0;
const ids = (markup: string) => [...markup.matchAll(/\sid="([^"]+)"/g)].map(([, id]) => id!);
const hrefs = (markup: string) =>
  [...markup.matchAll(/\shref="([^"]+)"/g)].map(([, href]) => href!);
/** `markup` as the text it reads as: no tags, entities decoded, spaces folded. */
const text = (markup: string) =>
  markup
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

/** One rendered section's markup, by its id: its own <section> element, whole. */
function sectionMarkup(markup: string, id: string): string {
  const start = markup.indexOf(`<section id="${id}"`);
  assert.ok(start >= 0, `section ${id}`);
  let depth = 0;
  for (const match of markup.slice(start).matchAll(/<(\/?)section\b[^>]*>/g)) {
    depth += match[1] ? -1 : 1;
    if (depth === 0) return markup.slice(start, start + match.index + match[0].length);
  }
  throw new Error(`section ${id} never closes`);
}

test('the complete fixture renders one main, one h1, one visitor control slot, and its section links before the main', () => {
  const input = fixtureInput('complete');
  const markup = html(input);
  assert.equal(count(markup, /<main\b/g), 1);
  assert.equal(count(markup, /<h1\b/g), 1);
  assert.equal(count(markup, /data-visitor-control-slot/g), 1);
  assert.equal(count(markup, /<nav\b/g), 1);
  assert.ok(markup.indexOf('<header class="sb-header"') < markup.indexOf('<main'));
  const titled = input.portfolio.sections.filter(
    (section) => section.kind !== 'hero' && section.kind !== 'cta' && section.title?.trim(),
  );
  assert.ok(titled.length > 8);
  const nav = markup.slice(markup.indexOf('<nav'), markup.indexOf('</nav>'));
  assert.deepEqual(
    hrefs(nav),
    titled.map((section) => `#${section.id}`),
  );
  // Nothing is hidden in the server's markup but the navigation's name, which names it.
  assert.deepEqual(
    [...markup.matchAll(/<[^>]*\shidden=""[^>]*>[^<]*/g)].map(([tag]) => tag),
    ['<span id="sb--sections" hidden="">Sections'],
  );
});

test('every section is a tile of the bento, in content order, the opening first with the still beside it', () => {
  const input = fixtureInput('complete');
  const markup = html(input);
  const main = markup.slice(markup.indexOf('<main'));
  const tiles = [...main.matchAll(/<section id="([^"]+)"[^>]*data-section-id/g)].map(
    ([, id]) => id,
  );
  const rendered = input.portfolio.sections
    .filter((section) => renderSection(section, input, SHARED_HERO, { level: 2 }) !== null)
    .map((section) => section.id);
  assert.deepEqual(tiles, rendered);
  // The still is decoration: hidden from assistive technology, with no word, link, or control.
  const still = /<div class="sb-still" aria-hidden="true">([\s\S]*?)<\/div>/.exec(markup);
  assert.ok(still);
  assert.equal(text(still[1]!), '');
  assert.doesNotMatch(still[1]!, /<(?:a|button|input|img|svg|canvas)\b/);
  assert.equal(count(still[1]!, /class="sb-still__plane /g), 4);
  assert.equal(count(markup, /sb-still__plane--signature/g), 1);
});

test('every section holds every word, link, and action the shared renderers write for it, in every contract fixture', () => {
  let compared = 0;
  for (const { name } of CONTRACT_FIXTURES) {
    const input = fixtureInput(name);
    const markup = html(input);
    let leads = true;
    for (const section of input.portfolio.sections) {
      const level = leads && section.kind === 'hero' ? 1 : 2;
      const shared = renderSection(section, input, SHARED_HERO, { level });
      if (shared === null) continue;
      leads = false;
      const expected = renderToStaticMarkup(shared);
      const actual = sectionMarkup(markup, `${input.ids.prefix}${section.id}`);
      assert.equal(text(actual), text(expected), `${name} ${section.id}: its words`);
      assert.deepEqual(hrefs(actual), hrefs(expected), `${name} ${section.id}: its links`);
      assert.equal(
        count(actual, /<(?:a|button|img|details)\b/g),
        count(expected, /<(?:a|button|img|details)\b/g),
        `${name} ${section.id}: its links, actions, images, and disclosures`,
      );
      compared += 1;
    }
  }
  assert.ok(compared > 100, `${compared} sections compared`);
});

test('a hidden section never reaches the page: none of its words, ids, or links', () => {
  const markup = html(fixtureInput('hidden-canary'));
  assert.doesNotMatch(markup, new RegExp(HIDDEN_CANARY));
});

test('in a plate it renders the same, every id under the plate prefix and none repeated', () => {
  const input = fixtureInput('complete', 'pl-');
  // What resolveAppearance() gives a plate in the platform's own packs.
  const { displayMode, ...packs } = PLATFORM_DEFAULTS;
  const selection = { ...packs, variant: 'spatial-bento', displayMode };
  const appearance = {
    selection,
    requested: selection,
    resolvedMode: 'light',
    modeLocked: false,
    contrast: 'system',
    motion: 'static',
    enhancement: 'off',
    fallbackAxes: [],
    diagnostics: [],
  } as never;
  const plate = renderToStaticMarkup(
    <PresentationBoundary
      kind="plate"
      appearance={appearance}
      ids={{ prefix: 'pl-', main: input.ids.main }}
    >
      <SpatialBento input={input} />
    </PresentationBoundary>,
  );
  const all = ids(plate);
  assert.ok(all.length > 10);
  assert.deepEqual(
    all.filter((id) => !id.startsWith('pl-')),
    [],
  );
  assert.equal(new Set(all).size, all.length, 'no id repeats');
});

test('a portfolio with no titled section has no section links, and still its h1 and visitor control', () => {
  const portfolio = PortfolioSchema.parse({
    schemaVersion: 3,
    locale: 'en',
    direction: 'ltr',
    identity: { name: 'Rowan Bento', tagline: 'Builds calm software.' },
    contact: { message: 'Write any time.' },
    sections: [{ kind: 'contact', id: 'contact' }],
  });
  const site = readPair(contractFixture('complete').files);
  assert.ok(site.ok);
  const markup = html(inputOf({ portfolio, site: site.pair.site } as ParsedPair));
  assert.doesNotMatch(markup, /<nav\b/);
  assert.equal(count(markup, /<h1 class="sb-name">Rowan Bento<\/h1>/g), 1);
  assert.equal(count(markup, /data-visitor-control-slot/g), 1);
});

const SOURCES = readdirSync(new URL('.', import.meta.url))
  .filter((file) => /\.tsx?$/.test(file) && !file.includes('.test.'))
  .map((file) => [file, readFileSync(new URL(`./${file}`, import.meta.url), 'utf8')] as const);

test('no stage code ships: no client module, no 3D library, and no spatial kit', () => {
  assert.ok(SOURCES.length >= 2);
  for (const [file, source] of SOURCES) {
    assert.doesNotMatch(source, /^\s*['"]use client['"]/m, file);
    assert.doesNotMatch(
      source,
      /from\s+['"](?:three|@react-three\/[\w-]+|postprocessing|@portfolio\/kit\/(?:spatial|spatial-r3f|enhancements))['"]/,
      file,
    );
    assert.doesNotMatch(source, /SpatialCanvas|requestAnimationFrame|addEventListener/, file);
  }
  const dependencies = { ...PACKAGE.dependencies, ...PACKAGE.peerDependencies };
  for (const name of Object.keys(dependencies)) {
    assert.doesNotMatch(name, /^(?:three|@react-three\/|postprocessing)/, name);
  }
});

/** The stylesheet, comments gone. */
const CSS = readFileSync(new URL('./styles.css', import.meta.url), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
);

test('each border token is used whole, as the border it is, never as a width', () => {
  // The design language's --ui-border-* is a whole border, or none: `1px solid var(--color-border-default)`.
  const uses = [...CSS.matchAll(/([a-z-]+)\s*:([^;{}]*var\(--ui-border-[^;{}]*)/g)];
  assert.ok(uses.length >= 3, `${uses.length} uses`);
  for (const [declaration, property, value] of uses) {
    assert.match(property!, /^border(?:-(?:block|inline)(?:-(?:start|end))?)?$/, declaration);
    assert.match(value!.trim(), /^var\(--ui-border-[a-z]+\)$/, declaration);
  }
});

test('the bento keeps content order: no dense packing, no reordering, and nothing that moves', () => {
  assert.doesNotMatch(CSS, /\bdense\b/);
  assert.doesNotMatch(CSS, /(?<![\w-])order\s*:/);
  assert.doesNotMatch(CSS, /\b(?:animation|transition)\b|@keyframes/);
});
