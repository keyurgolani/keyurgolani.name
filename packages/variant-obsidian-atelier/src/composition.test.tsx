import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PresentationBoundary } from '@portfolio/appearance/react';
import { PLATFORM_DEFAULTS } from '@portfolio/appearance';
import { worksByIds } from '@portfolio/kit/sections';
import {
  composeSchemas,
  resolvePortfolioView,
  type ParsedPair,
  type ViewMediaValue,
} from '@portfolio/schema';
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
import ObsidianAtelier from '.';
import { homeModel, treatmentOf } from './model';

// Obsidian Atelier (#15): its manifest holds the catalog's pins, and it
// renders every contract fixture as one main, one h1, one visitor control
// slot, its chrome, the chapter index, one room a chapter with Unfold the
// case, and the rest of the reading order, with nothing hidden reaching it,
// every fragment link landing, and every id under the boundary's prefix.

// tsx compiles JSX to React.createElement calls, so the test supplies React.
Object.assign(globalThis, { React });

const PACKAGE = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const RAW = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
const CSS = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
const { PortfolioSchema } = composeSchemas();

test("its manifest validates with nothing to report, and holds the catalog's pins", () => {
  const result = validateManifest(RAW, { packageName: PACKAGE.name, exports: PACKAGE.exports });
  assert.ok(result.ok, JSON.stringify(result.diagnostics));
  assert.deepEqual(result.diagnostics, []);
  const { manifest } = result;
  assert.equal(manifest.id, 'obsidian-atelier');
  assert.deepEqual(
    [manifest.compositionFamily, manifest.motionIntent, manifest.performanceTier],
    ['gallery', 'subtle', 'light'],
  );
  assert.deepEqual(manifest.renderedKinds, []);
  assert.deepEqual(manifest.unsupportedKinds, []);
  // Home is the composition's own; a work's page is the host's shared one (#101's rule).
  assert.deepEqual(manifest.routes, { home: 'bespoke', work: 'shared', views: [] });
  assert.deepEqual(manifest.textDirection, ['ltr', 'rtl']);
  assert.deepEqual(PACKAGE.portfolio, { kind: 'variant', manifest: './manifest.json' });
  // Its tests run under the root's pnpm test.
  assert.match(PACKAGE.scripts.test, /tsx --test/);
});

const MANIFEST = (() => {
  const result = validateManifest(RAW, { packageName: PACKAGE.name });
  assert.ok(result.ok);
  return result.manifest as VariantManifest;
})();

const SITE = (() => {
  const read = readPair(contractFixture('complete').files);
  assert.ok(read.ok);
  return read.pair.site;
})();

interface InputOptions {
  readonly idPrefix?: string;
  readonly basePath?: string;
  readonly query?: Readonly<Record<string, string>>;
}

function inputOf(pair: ParsedPair, options: InputOptions = {}): VariantRenderInput {
  return buildRenderInput({
    view: resolvePortfolioView(pair, {}, { mediaBase: '/media' }),
    manifest: MANIFEST,
    route: { route: 'home' },
    basePath: options.basePath ?? '',
    query: options.query,
    origin: 'https://rowan.test',
    requestTime: '2026-10-23T12:00:00Z',
    idPrefix: options.idPrefix ?? '',
  });
}

/** The render input of a contract fixture, as the host builds it. */
function fixtureInput(name: string, options: InputOptions = {}): VariantRenderInput {
  const read = readPair(contractFixture(name).files);
  assert.ok(read.ok, JSON.stringify(read));
  return inputOf(read.pair, options);
}

/** A portfolio of the test's own, beside the complete fixture's site document. */
function portfolioInput(portfolio: unknown): VariantRenderInput {
  return inputOf({ portfolio: PortfolioSchema.parse(portfolio), site: SITE } as ParsedPair);
}

const html = (input: VariantRenderInput) => renderToStaticMarkup(<ObsidianAtelier input={input} />);
const count = (markup: string, pattern: RegExp) => markup.match(pattern)?.length ?? 0;
const ids = (markup: string) => [...markup.matchAll(/\sid="([^"]+)"/g)].map(([, id]) => id!);

/** Each room's markup, in page order, by its work's id. */
function rooms(markup: string): { id: string; markup: string }[] {
  return [...markup.matchAll(/<article id="([^"]+)" class="oa-room"[\s\S]*?<\/article>/g)].map(
    ([room, id]) => ({ id: id!, markup: room }),
  );
}

/** `markup` as the text it reads as: no tags, and the entities React writes decoded. */
const text = (markup: string) =>
  markup
    .replace(/<[^>]+>/g, '')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

test('the complete fixture renders one main, one h1, one visitor control slot, and the chrome before the main', () => {
  const markup = html(fixtureInput('complete'));
  assert.equal(count(markup, /<main\b/g), 1);
  assert.equal(count(markup, /<h1\b/g), 1);
  assert.equal(count(markup, /data-visitor-control-slot/g), 1);
  assert.ok(markup.indexOf('<header class="oa-chrome"') < markup.indexOf('<main'));
  // One navigation landmark, the chapter index, in flow under the opening.
  assert.equal(count(markup, /<nav\b/g), 1);
  assert.ok(markup.indexOf('class="oa-opening"') < markup.indexOf('<nav'));
  // Nothing is hidden in the server's markup, and nothing waits on motion.
  assert.doesNotMatch(markup, /\shidden=""|visibility:\s*hidden|opacity:\s*0/);
});

test('every contract fixture renders with one h1, unique ids, and every fragment link landing on the page', () => {
  for (const { name } of CONTRACT_FIXTURES) {
    const markup = html(fixtureInput(name));
    assert.equal(count(markup, /<h1\b/g), 1, name);
    assert.equal(count(markup, /<main\b/g), 1, name);
    const all = ids(markup);
    assert.equal(new Set(all).size, all.length, `${name}: ids repeat`);
    const present = new Set(all);
    for (const [, href] of markup.matchAll(/\shref="#([^"]+)"/g)) {
      assert.ok(present.has(href!), `${name}: #${href} lands nowhere`);
    }
    // No work is shown twice: once in a room, or once in the reading order.
    const works = [...markup.matchAll(/data-work-id="([^"]+)"/g)].map(([, id]) => id!);
    const roomed = rooms(markup).map(({ id }) => id);
    for (const id of roomed)
      assert.ok(!works.includes(id), `${name}: ${id} is a room and a list item`);
  }
});

test('the chapters are the signature and then the featured works, numbered, each a room with a direct URL', () => {
  const input = fixtureInput('design');
  const expected = worksByIds([input.portfolio.signature!, ...input.portfolio.featured], input).map(
    ({ id }) => id,
  );
  assert.ok(expected.length > 2, 'the design fixture curates a signature and featured works');
  const markup = html(input);
  const found = rooms(markup);
  assert.deepEqual(
    found.map(({ id }) => id),
    expected,
  );
  found.forEach((room, index) => {
    assert.match(
      text(room.markup),
      new RegExp(`^Chapter ${index + 1} of ${expected.length}\\b`),
      room.id,
    );
  });
  // The index lists the chapters first, in that order, each by its number and its room's URL.
  const nav = markup.slice(markup.indexOf('<nav'), markup.indexOf('</nav>'));
  const hrefs = [...nav.matchAll(/href="#([^"]+)"/g)].map(([, id]) => id);
  assert.deepEqual(hrefs.slice(0, expected.length), expected);
  // The chrome's index link reaches it in one step.
  assert.match(markup, /<a class="oa-chrome__index" href="#oa--index"/);
  assert.match(markup, /<div id="oa--index" class="oa-index">/);
});

test('each room ends with plain previous, index, and next links to its neighbours', () => {
  const markup = html(fixtureInput('design'));
  const found = rooms(markup);
  found.forEach((room, index) => {
    const pager = /<ul class="oa-pager" role="list">([\s\S]*?)<\/ul>/.exec(room.markup);
    assert.ok(pager, room.id);
    const hrefs = [...pager[1]!.matchAll(/href="#([^"]+)"/g)].map(([, id]) => id);
    assert.deepEqual(hrefs, [
      ...(index > 0 ? [found[index - 1]!.id] : []),
      'oa--index',
      ...(index < found.length - 1 ? [found[index + 1]!.id] : []),
    ]);
    // Links alone: no button, no script, no handler.
    assert.doesNotMatch(pager[1]!, /<button|onclick/i);
  });
});

test('Unfold the case: the premise and the artifact show, and the rest of the case is a closed native details', () => {
  const input = fixtureInput('complete');
  const markup = html(input);
  const signature = rooms(markup).find(({ id }) => id === input.portfolio.signature);
  assert.ok(signature, 'the signature room');
  const room = signature.markup;
  const details = room.indexOf('<details');
  assert.ok(details > 0, 'the case is a details element');
  // Closed on the server, named by its summary, with no heading or button in the summary.
  assert.match(
    room,
    /<details class="oa-room__case" data-ui-slot="disclosure"><summary data-ui-slot="disclosure.summary">Unfold the case<\/summary>/,
  );
  // The premise and the artifact come before it, outside it.
  assert.ok(room.indexOf('class="oa-room__title"') < details);
  assert.ok(room.indexOf('class="oa-room__artifact"') < details);
  assert.ok(room.indexOf('Project summary.') < details);
  // Inside: the rest of the case, the case study's fields under their labels one level down.
  const inside = text(room.slice(details, room.indexOf('</details>')));
  for (const words of [
    'Project description.',
    'Challenge',
    'Decisions',
    'Outcomes',
    'Reflection',
  ]) {
    assert.ok(inside.includes(words), `the case holds ${words}`);
  }
  assert.match(room.slice(details), /<h3 class="oa-case__heading"/);
  assert.doesNotMatch(room.slice(details), /<h2\b/);
});

test('a room with nothing more to unfold has no empty disclosure', () => {
  const markup = html(
    portfolioInput({
      schemaVersion: 3,
      locale: 'en',
      direction: 'ltr',
      identity: { name: 'Rowan Atelier' },
      signature: 'bare',
      works: [{ id: 'bare', title: 'Bare work', medium: 'object', summary: 'Only a summary.' }],
      sections: [{ kind: 'works', id: 'work', items: ['bare'] }],
    }),
  );
  const [room] = rooms(markup);
  assert.ok(room);
  assert.doesNotMatch(room.markup, /<details/);
  assert.equal(room.markup.match(/data-artifact="none"/)?.length, 1);
  // A text room reserves no frame for an artifact it doesn't have.
  assert.doesNotMatch(room.markup, /oa-room__artifact|<figure/);
});

test('a private work, or one only a hidden section reaches, is no chapter, no number, and no neighbour', () => {
  const input = fixtureInput('hidden-canary');
  const markup = html(input);
  assert.doesNotMatch(markup, new RegExp(HIDDEN_CANARY));
  const found = rooms(markup);
  // The curation names private works; the chapters are what's left, numbered from 1 with no gap.
  assert.ok(found.length > 0);
  assert.deepEqual(
    found.map(({ id }) => id),
    homeModel(input).chapters.map(({ work }) => work.id),
  );
  found.forEach((room, index) => {
    assert.match(text(room.markup), new RegExp(`^Chapter ${index + 1} of ${found.length}\\b`));
  });
});

test("each room's treatment follows the work's authored medium, not its media", () => {
  assert.deepEqual(
    (
      [
        'photography',
        'image-series',
        'interface',
        'system',
        'software',
        'research',
        'writing',
        'music',
        'object',
        'audio-video',
        'acme/zine',
      ] as const
    ).map((medium) => treatmentOf({ medium })),
    [
      'plate',
      'plate',
      'screen',
      'diagram',
      'diagram',
      'diagram',
      'text',
      'object',
      'object',
      'object',
      'object',
    ],
  );
  const seen = new Set<string>();
  for (const { name } of CONTRACT_FIXTURES) {
    const input = fixtureInput(name);
    for (const room of rooms(html(input))) {
      const work = input.portfolio.works.find(({ id }) => id === room.id)!;
      assert.match(
        room.markup,
        new RegExp(`data-treatment="${treatmentOf(work)}" data-medium="${work.medium}"`),
      );
      seen.add(treatmentOf(work));
    }
  }
  // The fixtures between them put every treatment in a room.
  assert.deepEqual([...seen].sort(), ['diagram', 'object', 'plate', 'screen', 'text']);
});

test("writing's room leads with its own excerpt, and the excerpt isn't repeated in the case", () => {
  const input = fixtureInput('writing');
  const markup = html(input);
  const writing = rooms(markup).filter((room) => /data-treatment="text"/.test(room.markup));
  assert.ok(writing.length > 0);
  let led = 0;
  for (const room of writing) {
    if (!/data-artifact="excerpt"/.test(room.markup)) continue;
    led += 1;
    assert.equal(count(room.markup, /<blockquote/g), 1, room.id);
    assert.ok(room.markup.indexOf('oa-room__excerpt') < room.markup.indexOf('<details') >>> 0);
  }
  assert.ok(led > 0, 'a writing room led by its excerpt');
});

test('media that never arrives keeps its box, its label, and its words, and the reading order holds', () => {
  const input = fixtureInput('missing-media');
  const markup = html(input);
  const found = rooms(markup);
  // With no curation, the chapters are the works the reading order's works sections show.
  assert.ok(found.length > 1);
  let unavailable = 0;
  for (const room of found) {
    const artifact = /<div class="oa-room__artifact"[\s\S]*?<\/figure><\/div>/.exec(room.markup);
    if (!artifact) {
      assert.match(room.markup, /data-artifact="(?:none|excerpt)"/, room.id);
      continue;
    }
    unavailable += 1;
    assert.match(artifact[0], /data-media-state="unavailable"/, room.id);
    assert.match(artifact[0], /Image unavailable/, room.id);
  }
  assert.ok(unavailable > 0, 'a room whose image never arrives');
  // The works sections the chapters show whole keep their ids, on the chapters.
  for (const id of homeModel(input).folded)
    assert.match(markup, new RegExp(`<span id="${id}" class="oa-anchor">`));
});

/** A ready image of `width` by `height`, as #10's derivation writes it. */
function ready(asset: string, width: number, height: number, mime = 'image/jpeg'): ViewMediaValue {
  return {
    sha256: 'a'.repeat(64),
    mime,
    bytes: 1000,
    width,
    height,
    renditions: [
      { url: `/media/${asset}/a/${width}.jpg`, name: `${width}`, mime, bytes: 1000, width, height },
    ],
  };
}

test('portrait, panorama, transparent, text-heavy, and low-resolution artifacts all show whole, with their words below', () => {
  const shapes = {
    portrait: [600, 4000, 'image/jpeg'],
    panorama: [9000, 400, 'image/jpeg'],
    transparent: [800, 800, 'image/png'],
    pages: [1200, 1700, 'image/png'],
    tiny: [64, 48, 'image/jpeg'],
  } as const;
  const base = portfolioInput({
    schemaVersion: 3,
    locale: 'en',
    direction: 'ltr',
    identity: { name: 'Rowan Atelier' },
    featured: Object.keys(shapes),
    media: Object.keys(shapes).map((id) => ({
      id,
      kind: 'image',
      source: `images/${id}.jpg`,
      alt: `Alt ${id}`,
      credit: `Credit ${id}`,
      rights: { holder: `Holder ${id}`, license: 'CC BY 4.0' },
    })),
    works: Object.keys(shapes).map((id, index) => ({
      id,
      title: `Work ${id}`,
      medium: ['photography', 'photography', 'interface', 'research', 'object'][index],
      cover: { asset: id, caption: `A long caption for ${id}, `.repeat(12) },
    })),
    sections: [{ kind: 'works', id: 'work', items: Object.keys(shapes) }],
  });
  const media = Object.fromEntries(
    Object.entries(base.media).map(([id, asset]) => {
      const [width, height, mime] = shapes[id as keyof typeof shapes];
      return [
        id,
        {
          ...asset,
          derived: {
            state: 'ready',
            value: ready(id, width, height, mime),
            derivedAt: '2026-10-23T00:00:00Z',
          },
        },
      ];
    }),
  );
  const markup = html({ ...base, media } as VariantRenderInput);
  const found = rooms(markup);
  assert.equal(found.length, 5);
  for (const room of found) {
    const [width, height] = shapes[room.id as keyof typeof shapes];
    const figure = /<figure[\s\S]*?<\/figure>/.exec(room.markup)?.[0];
    assert.ok(figure, room.id);
    // Its intrinsic size reserves its box; the owner's alt names it; its words follow it.
    assert.match(
      figure,
      new RegExp(
        `<img class="oa-room__image"[^>]*width="${width}" height="${height}" alt="Alt ${room.id}"`,
      ),
    );
    const img = figure.indexOf('<img');
    for (const words of [
      `A long caption for ${room.id}`,
      `Credit ${room.id}`,
      `Holder ${room.id}`,
    ]) {
      assert.ok(figure.indexOf(words) > img, `${room.id}: ${words} after the image`);
    }
  }
  // The first chapter's artifact loads at once, the rest lazily.
  assert.doesNotMatch(found[0]!.markup, /loading="lazy"/);
  for (const room of found.slice(1)) assert.match(room.markup, /loading="lazy"/);
  // The stylesheet never crops an artifact, never upscales one past its pixels, and caps its height.
  const rule = /:is\(\.oa-room__artifact, \.oa-case__media\) img \{([^}]*)\}/.exec(CSS)?.[1];
  assert.ok(rule, 'the artifact image rule');
  for (const declaration of [
    'inline-size: auto',
    'max-inline-size: 100%',
    'block-size: auto',
    'max-block-size: 80vh',
    'object-fit: contain',
  ]) {
    assert.ok(rule.includes(declaration), declaration);
  }
  assert.doesNotMatch(CSS, /object-fit:\s*cover/);
});

test('nothing sits over an artifact: no positioned layer, and every caption, credit, and rights line in flow below it', () => {
  assert.doesNotMatch(CSS, /position:\s*(?:absolute|fixed|sticky)/);
  assert.doesNotMatch(CSS, /(?:^|[\s;{])inset(?:-[a-z-]+)?:/);
  assert.doesNotMatch(CSS, /margin[a-z-]*:\s*-/);
});

test('the composition needs no motion, hover, pointer, or script: still CSS and server modules alone', () => {
  // No transition, animation, smooth scrolling, transform, or hover-only rule.
  assert.doesNotMatch(CSS, /transition|animation|@keyframes|scroll-behavior|transform|:hover/);
  const sources = readdirSync(new URL('.', import.meta.url)).filter(
    (file) => /\.tsx?$/.test(file) && !file.includes('.test.'),
  );
  assert.ok(sources.length > 4);
  for (const file of sources) {
    const source = readFileSync(new URL(`./${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(
      source,
      /'use client'|useEffect|useState|useRef|addEventListener|onClick/,
      file,
    );
    // None of Page 99's traits, none of v1's chapter navigation, and nothing from legacy/.
    assert.doesNotMatch(
      source,
      /TypingAnimation|useMouseTilt|MagneticCursor|TableOfContents|legacy\//,
      file,
    );
    assert.doesNotMatch(source, /from '@portfolio\/kit'/, file);
    assert.doesNotMatch(source, /scrollIntoView|scrollTo|history\.|location\./, file);
  }
});

test("the stylesheet uses #19's border tokens whole, and declares no custom property but --layout-*", () => {
  for (const [, value] of CSS.matchAll(/border[a-z-]*:\s*([^;]+);/g)) {
    if (value!.includes('var(--ui-border-')) {
      assert.match(value!.trim(), /^var\(--ui-border-[a-z-]+\)$/, value);
    }
  }
  for (const [, name] of CSS.matchAll(/(--[a-z][a-z0-9-]*):/g)) {
    assert.match(name!, /^--layout-/, name);
  }
});

test('internal links keep the mount: below /sample, with its variant query', () => {
  const input = fixtureInput('complete', {
    basePath: '/sample',
    query: { variant: 'obsidian-atelier' },
  });
  const markup = html(input);
  assert.match(markup, /<a class="oa-chrome__name" href="\/sample\?variant=obsidian-atelier"/);
  for (const [, href] of markup.matchAll(/\shref="(\/[^"]*)"/g)) {
    assert.ok(href!.startsWith('/sample'), href);
  }
});

test('in a plate it renders the same, every id under the plate prefix, none repeated, and no landmark of its own index', () => {
  const input = fixtureInput('complete', { idPrefix: 'pl-' });
  // What resolveAppearance() gives a plate in the platform's own packs.
  const { displayMode, ...packs } = PLATFORM_DEFAULTS;
  const selection = { ...packs, variant: 'obsidian-atelier', displayMode };
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
      <ObsidianAtelier input={input} />
    </PresentationBoundary>,
  );
  const all = ids(plate);
  assert.ok(all.length > 10);
  assert.deepEqual(
    all.filter((id) => !id.startsWith('pl-')),
    [],
  );
  assert.equal(new Set(all).size, all.length, 'no id repeats');
  for (const [, href] of plate.matchAll(/\shref="#([^"]+)"/g)) {
    assert.ok(all.includes(href!), `#${href} lands nowhere`);
  }
  // #19's Navigation is a plain div in a plate, so the page around it keeps its landmarks.
  assert.doesNotMatch(plate, /<nav\b/);
});

test('a portfolio with nothing to index has no index link, no index, and no chapters, and still its h1 and control', () => {
  const markup = html(fixtureInput('identity-only'));
  assert.doesNotMatch(markup, /oa-chrome__index|oa--index|oa-room/);
  assert.equal(count(markup, /<h1\b/g), 1);
  assert.equal(count(markup, /data-visitor-control-slot/g), 1);
});

test('the words it adds are marked English in a portfolio in another language', () => {
  const markup = html(fixtureInput('academic'));
  assert.match(markup, /<span lang="en">Index<\/span>/);
  assert.match(markup, /<span lang="en">Chapter 1 of \d+<\/span>/);
  assert.match(
    markup,
    /<summary data-ui-slot="disclosure.summary"><span lang="en">Unfold the case<\/span>/,
  );
});
