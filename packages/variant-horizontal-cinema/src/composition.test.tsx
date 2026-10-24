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
import HorizontalCinema from '.';
import { anchorOf, CHAPTERS, INDEX_ANCHOR } from './chapters';
import { homeModel, JOURNEY_DEFAULT_LIMIT } from './model';
import { Runtime } from './runtime';

// Horizontal Cinema (#17): its manifest holds the catalog's pins, and it
// renders every contract fixture as one main, one h1, one visitor control
// slot, its chrome with the exit to the index, the filmstrip, exactly five
// chapters in their authored order, each with its direct anchor and plain
// previous and next links, and the index after them, with nothing hidden
// reaching it, every fragment link landing, and every id under the
// boundary's prefix.

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
  assert.equal(manifest.id, 'horizontal-cinema');
  assert.deepEqual(
    [manifest.compositionFamily, manifest.motionIntent, manifest.performanceTier],
    ['sequence', 'directed', 'medium'],
  );
  assert.deepEqual(manifest.renderedKinds, []);
  assert.deepEqual(manifest.unsupportedKinds, []);
  // Home is the composition's own; a work's page is the host's shared one (#101's rule).
  assert.deepEqual(manifest.routes, { home: 'bespoke', work: 'shared', views: [] });
  assert.deepEqual(manifest.textDirection, ['ltr', 'rtl']);
  // Nothing moves on its own: no frame loop, timer, or endless animation.
  assert.equal(manifest.budgets?.animation, 0);
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

const html = (input: VariantRenderInput) =>
  renderToStaticMarkup(<HorizontalCinema input={input} />);
const count = (markup: string, pattern: RegExp) => markup.match(pattern)?.length ?? 0;
const ids = (markup: string) => [...markup.matchAll(/\sid="([^"]+)"/g)].map(([, id]) => id!);

/** Each chapter's markup, in page order, by its anchor. */
function chapters(markup: string): { id: string; markup: string }[] {
  const starts = [...markup.matchAll(/<section id="([^"]+)" class="hc-chapter"/g)];
  return starts.map((match, index) => {
    const end =
      index + 1 < starts.length ? starts[index + 1]!.index : markup.indexOf('class="hc-index"');
    return { id: match[1]!, markup: markup.slice(match.index, end) };
  });
}

/** The ids of the sections a chapter's markup shows. */
const sectionsIn = (markup: string) =>
  [...markup.matchAll(/data-section-id="([^"]+)"/g)].map(([, id]) => id!);

/** The works a chapter frames. */
const framesIn = (markup: string) =>
  [...markup.matchAll(/<article[^>]*class="hc-frame" data-work-id="([^"]+)"/g)].map(
    ([, id]) => id!,
  );

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

const ANCHORS = CHAPTERS.map((_, position) => anchorOf(position));

test('the complete fixture: one main, one h1, one control slot, the chrome, the filmstrip, five chapters, and the index', () => {
  const markup = html(fixtureInput('complete'));
  assert.equal(count(markup, /<main\b/g), 1);
  assert.equal(count(markup, /<h1\b/g), 1);
  assert.equal(count(markup, /data-visitor-control-slot/g), 1);
  assert.ok(markup.indexOf('<header class="hc-chrome"') < markup.indexOf('<main'));
  // The exit is in the chrome, before anything else the page holds.
  assert.match(markup, /<a class="hc-chrome__index" href="#chapter-index"/);
  // Exactly five chapters, in their authored order, then the index.
  assert.deepEqual(
    chapters(markup).map(({ id }) => id),
    ANCHORS,
  );
  assert.ok(markup.indexOf('id="chapter-epilogue"') < markup.indexOf(`id="${INDEX_ANCHOR}"`));
  // The h1 is Prologue's, after its 01 Prologue line.
  const [prologue] = chapters(markup);
  assert.match(text(prologue!.markup), /^01 Prologue/);
  assert.equal(count(prologue!.markup, /<h1\b/g), 1);
  // The filmstrip: one link a chapter, in order, before the stage, and nothing marked current yet.
  const filmstrip = markup.slice(markup.indexOf('class="hc-filmstrip"'), markup.indexOf('</nav>'));
  assert.deepEqual(
    [...filmstrip.matchAll(/href="#([^"]+)"/g)].map(([, id]) => id),
    ANCHORS,
  );
  assert.deepEqual(
    [...filmstrip.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/g)].map(([, link]) => text(link!)),
    ['01 Prologue', '02 Origins', '03 Journey', '04 Craft', '05 Epilogue'],
  );
  assert.ok(markup.indexOf('class="hc-filmstrip"') < markup.indexOf('class="hc-stage"'));
  assert.doesNotMatch(markup, /aria-current="step"/);
  // The stage is a named, focusable scroll region the arrow keys work in.
  assert.match(
    markup,
    /<div class="hc-stage" role="region" aria-labelledby="hc--chapters-label" tabindex="0">/,
  );
  // The transport waits for the controller: hidden in the server's markup, so no script means no dead buttons.
  assert.match(markup, /<div class="hc-transport" hidden="">/);
  // One polite live region, empty until a step.
  assert.equal(count(markup, /aria-live="polite"/g), 1);
  assert.match(markup, /<div class="hc-visually-hidden" aria-live="polite"><\/div>/);
});

test('every contract fixture renders five chapters, one h1, unique ids, and every fragment link landing', () => {
  for (const { name } of CONTRACT_FIXTURES) {
    const markup = html(fixtureInput(name));
    assert.equal(count(markup, /<h1\b/g), 1, name);
    assert.equal(count(markup, /<main\b/g), 1, name);
    assert.deepEqual(
      chapters(markup).map(({ id }) => id),
      ANCHORS,
      name,
    );
    const all = ids(markup);
    assert.equal(new Set(all).size, all.length, `${name}: ids repeat`);
    const present = new Set(all);
    for (const [, href] of markup.matchAll(/\shref="#([^"]+)"/g)) {
      assert.ok(present.has(href!), `${name}: #${href} lands nowhere`);
    }
    // No work is framed twice, and none is a frame and a list item both.
    const framed = framesIn(markup);
    assert.equal(new Set(framed).size, framed.length, `${name}: a work framed twice`);
    const listed = [...markup.matchAll(/data-work-id="([^"]+)"/g)].map(([, id]) => id!);
    for (const id of framed) {
      assert.equal(listed.filter((each) => each === id).length, 1, `${name}: ${id} shows twice`);
    }
    // Nothing the view leaves out reaches the page.
    assert.doesNotMatch(markup, new RegExp(HIDDEN_CANARY), name);
  }
});

test('each chapter holds its kinds, in the reading order: the complete fixture, chapter by chapter', () => {
  const input = fixtureInput('complete');
  const markup = html(input);
  const found = Object.fromEntries(
    chapters(markup).map(({ id, markup: chapter }) => [
      id,
      { sections: sectionsIn(chapter), frames: framesIn(chapter) },
    ]),
  );
  const kinds = (ids: readonly string[]) =>
    ids.map((id) => input.portfolio.sections.find((section) => section.id === id)!.kind);
  // Prologue: the hero, the lede, the quote, and the thesis, then the signature work as its lead frame.
  assert.deepEqual(
    new Set(kinds(found['chapter-prologue']!.sections)),
    new Set(['hero', 'practice', 'lede', 'quote']),
  );
  assert.deepEqual(found['chapter-prologue']!.frames, [input.portfolio.signature]);
  // Origins: the chronology and the fun facts.
  assert.deepEqual(
    new Set(kinds(found['chapter-origins']!.sections)),
    new Set(['chronology', 'fun-facts']),
  );
  // Journey: the featured works, as frames, in the owner's order.
  assert.deepEqual(found['chapter-journey']!.sections, []);
  assert.deepEqual(found['chapter-journey']!.frames, input.portfolio.featured);
  // Craft: the evidence and the rest of the practice.
  assert.ok(kinds(found['chapter-craft']!.sections).includes('evidence'));
  assert.ok(
    kinds(found['chapter-craft']!.sections).every((kind) =>
      ['evidence', 'practice', 'github', 'custom'].includes(kind),
    ),
  );
  // Epilogue: now, focus, the call to action, and contact.
  assert.deepEqual(
    new Set(kinds(found['chapter-epilogue']!.sections)),
    new Set(['now', 'focus', 'cta', 'contact']),
  );
  // Each chapter keeps the sections' authored order.
  const order = input.portfolio.sections.map((section) => section.id);
  for (const { sections } of Object.values(found)) {
    const positions = sections.map((id) => order.indexOf(id));
    assert.deepEqual(
      positions,
      [...positions].sort((a, b) => a - b),
    );
  }
  // What no chapter holds reads in the index, every section shown once somewhere.
  const index = markup.slice(markup.indexOf(`id="${INDEX_ANCHOR}"`));
  const everywhere = [
    ...Object.values(found).flatMap(({ sections }) => sections),
    ...sectionsIn(index),
  ];
  assert.equal(new Set(everywhere).size, everywhere.length, 'a section shows twice');
});

test('with nothing curated, Journey frames the works the works sections show, the archive left out, six at most', () => {
  const works = Array.from({ length: 9 }, (_, index) => ({
    id: `work-${index + 1}`,
    title: `Work ${index + 1}`,
    medium: 'software',
  }));
  const input = portfolioInput({
    schemaVersion: 3,
    locale: 'en',
    direction: 'ltr',
    identity: { name: 'Rowan Vale' },
    archive: ['work-2'],
    works,
    sections: [
      { kind: 'works', id: 'projects', title: 'Projects', items: works.map(({ id }) => id) },
    ],
  });
  const markup = html(input);
  const journey = chapters(markup).find(({ id }) => id === 'chapter-journey')!;
  assert.deepEqual(framesIn(journey.markup), [
    'work-1',
    'work-3',
    'work-4',
    'work-5',
    'work-6',
    'work-7',
  ]);
  assert.equal(JOURNEY_DEFAULT_LIMIT, 6);
  // The rest of the section reads in the index, by the section's own id.
  const index = markup.slice(markup.indexOf(`id="${INDEX_ANCHOR}"`));
  assert.match(index, /<section id="projects" data-section-id="projects"/);
  assert.deepEqual(
    [...index.matchAll(/data-work-id="([^"]+)"/g)].map(([, id]) => id),
    ['work-2', 'work-8', 'work-9'],
  );
});

test('a works section the frames show whole keeps its id, on Journey', () => {
  const input = fixtureInput('design');
  const model = homeModel(input);
  assert.ok(model.folded.length > 0, 'the design fixture folds a works section');
  const markup = html(input);
  const journey = chapters(markup).find(({ id }) => id === 'chapter-journey')!;
  for (const id of model.folded) {
    assert.match(journey.markup, new RegExp(`<span id="${id}" class="hc-anchor">`));
  }
});

test('each chapter ends with plain previous and next links, and Epilogue’s next is the index', () => {
  const markup = html(fixtureInput('complete'));
  chapters(markup).forEach(({ id, markup: chapter }, position) => {
    const pager = /<ul class="hc-pager" role="list">([\s\S]*?)<\/ul>/.exec(chapter);
    assert.ok(pager, id);
    const hrefs = [...pager[1]!.matchAll(/href="#([^"]+)"/g)].map(([, href]) => href);
    assert.deepEqual(hrefs, [
      ...(position > 0 ? [ANCHORS[position - 1]] : []),
      position < ANCHORS.length - 1 ? ANCHORS[position + 1] : INDEX_ANCHOR,
    ]);
  });
  // The index lists every chapter, then every titled section, each by its direct link.
  const index = markup.slice(markup.indexOf(`id="${INDEX_ANCHOR}"`));
  const nav = index.slice(index.indexOf('<nav'), index.indexOf('</nav>'));
  const hrefs = [...nav.matchAll(/href="#([^"]+)"/g)].map(([, href]) => href);
  assert.deepEqual(hrefs.slice(0, 5), ANCHORS);
  assert.ok(hrefs.includes('contact'), 'the index reaches contact');
});

test('a section or a record whose id is a chapter’s anchor reads in place with no anchor, and the chapter keeps it', () => {
  const input = portfolioInput({
    schemaVersion: 3,
    locale: 'en',
    direction: 'ltr',
    identity: { name: 'Rowan Vale' },
    works: [{ id: 'chapter-craft', title: 'A work named for a chapter', medium: 'software' }],
    evidence: [{ id: 'chapter-index', type: 'metric', title: 'An index of its own' }],
    sections: [
      { kind: 'lede', id: 'chapter-journey', title: 'Chapter Journey', body: 'Its words.' },
      { kind: 'evidence', id: 'proof', title: 'Proof', items: ['chapter-index'] },
      { kind: 'works', id: 'projects', title: 'Projects', items: ['chapter-craft'] },
    ],
  });
  const markup = html(input);
  const all = ids(markup);
  assert.equal(new Set(all).size, all.length, 'ids repeat');
  // The chapters and the index keep their anchors, each once.
  for (const anchor of [...ANCHORS, INDEX_ANCHOR]) {
    assert.equal(all.filter((id) => id === anchor).length, 1, anchor);
  }
  assert.equal(
    chapters(markup)
      .find(({ id }) => id === 'chapter-journey')!
      .markup.includes('Chapter Journey'),
    false,
    'the lede reads in Prologue, not as Journey',
  );
  // Each still renders, in its chapter, with no id of its own.
  assert.match(markup, /<section data-section-id="chapter-journey" data-kind="lede"/);
  assert.match(markup, /class="hc-frame" data-work-id="chapter-craft"/);
  assert.doesNotMatch(markup, /<article id="chapter-craft"/);
  assert.match(text(markup), /An index of its own/);
  // And the index doesn't link the lede by an anchor it doesn't have.
  assert.doesNotMatch(markup, /href="#chapter-journey"[^>]*><span class="hc-index__section"/);
});

test('a frame shows its media beside its evidence, decoration never, and a failed image keeps the words', () => {
  const input = fixtureInput('complete');
  const markup = html(input);
  const prologue = chapters(markup)[0]!.markup;
  const signature = worksByIds([input.portfolio.signature!], input)[0]!;
  const frame = prologue.slice(prologue.indexOf(`data-work-id="${signature.id}"`));
  // Media on a matte, #19's Surface, then the words: the title, the summary, and the evidence it cites.
  assert.match(
    frame,
    /data-ui-slot="surface"[^>]*class="hc-frame__matte"|class="hc-frame__matte"[^>]*data-ui-slot="surface"/,
  );
  assert.ok(frame.indexOf('hc-frame__matte') < frame.indexOf('hc-frame__words'));
  assert.match(frame, /class="pf-evidence hc-frame__evidence"/);
  // No rendition yet: the box and its label stand in, and the title and the evidence stay.
  assert.match(frame, /data-media-state="unavailable"/);
  assert.match(text(frame), /Image unavailable/);
  assert.match(text(frame), new RegExp(signature.title));
  // A case study is the host's shared page, at its slug.
  assert.match(frame, new RegExp(`href="/work/${signature.slug}"`));

  // Behind a decorative cover, the first meaningful image leads; with none, no matte at all.
  const decorative = portfolioInput({
    schemaVersion: 3,
    locale: 'en',
    direction: 'ltr',
    identity: { name: 'Rowan Vale' },
    media: [
      { id: 'texture', kind: 'image', source: 'texture.jpg', decorative: true },
      { id: 'shot', kind: 'image', source: 'shot.jpg', alt: 'The shot' },
    ],
    works: [
      { id: 'ambient', title: 'Ambient', medium: 'software', cover: { asset: 'texture' } },
      {
        id: 'shown',
        title: 'Shown',
        medium: 'software',
        cover: { asset: 'texture' },
        media: [{ asset: 'shot' }],
      },
    ],
    featured: ['ambient', 'shown'],
    sections: [{ kind: 'works', id: 'projects', title: 'Projects', items: ['ambient', 'shown'] }],
  });
  const frames = html(decorative);
  assert.match(frames, /class="hc-frame" data-work-id="ambient" data-media="none"/);
  assert.match(frames, /class="hc-frame" data-work-id="shown" data-media="image"/);
  assert.doesNotMatch(frames, /data-media-asset="texture"/);
  assert.match(frames, /data-media-asset="shot"/);
});

/** A ready image of the asset, in one JPEG rendition. */
function ready(asset: string, width: number, height: number): ViewMediaValue {
  return {
    width,
    height,
    renditions: [{ url: `/media/${asset}-${width}.jpg`, width, height, mime: 'image/jpeg' }],
  } as unknown as ViewMediaValue;
}

test('only Prologue’s lead frame loads eagerly; every other image is lazy, and nothing plays', () => {
  const input = fixtureInput('complete');
  const media = Object.fromEntries(
    Object.entries(input.media).map(([id, value]) => [
      id,
      value.kind === 'image'
        ? { ...value, derived: { state: 'ready', value: ready(id, 1200, 800) } }
        : value,
    ]),
  );
  const markup = html({ ...input, media } as VariantRenderInput);
  const images = [...markup.matchAll(/<img\b[^>]*>/g)].map(([tag]) => tag);
  assert.ok(images.length > 1, `${images.length} images`);
  const eager = images.filter((tag) => !/loading="lazy"/.test(tag));
  assert.equal(eager.length, 1, eager.join('\n'));
  assert.ok(markup.indexOf(eager[0]!) < markup.indexOf('id="chapter-origins"'));
  // No third-party frame, no player, no autoplay, and nothing that pretends to record.
  assert.doesNotMatch(markup, /<iframe|<video|<audio|autoplay|<canvas/);
});

test('internal links keep the mount: below /sample, with its variant query', () => {
  const input = fixtureInput('complete', {
    basePath: '/sample',
    query: { variant: 'horizontal-cinema' },
  });
  const markup = html(input);
  assert.match(markup, /<a class="hc-chrome__name" href="\/sample\?variant=horizontal-cinema"/);
  assert.match(markup, /href="\/sample\/work\/project-name\?variant=horizontal-cinema"/);
  for (const [, href] of markup.matchAll(/\shref="(\/[^"]*)"/g)) {
    assert.ok(href!.startsWith('/sample'), href);
  }
});

test('in a plate it renders the same chapters, with no runtime hook, no listener, and no landmark of its own', () => {
  const input = fixtureInput('complete', { idPrefix: 'pl-' });
  // What resolveAppearance() gives a plate in the platform's own packs.
  const { displayMode, ...packs } = PLATFORM_DEFAULTS;
  const selection = { ...packs, variant: 'horizontal-cinema', displayMode };
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
  // Every call of the runtime's hook, which subscribes to the document,
  // observes the root, and writes data-activity once mounted.
  const calls: string[] = [];
  const hook = Runtime.useEnhancementRuntime;
  Runtime.useEnhancementRuntime = (options) => {
    calls.push('runtime');
    return hook(options);
  };
  let plate: string;
  let documentCalls: number;
  try {
    plate = renderToStaticMarkup(
      <PresentationBoundary
        kind="plate"
        appearance={appearance}
        ids={{ prefix: 'pl-', main: input.ids.main }}
      >
        <HorizontalCinema input={input} />
      </PresentationBoundary>,
    );
    assert.deepEqual(calls, [], 'runtime hooks called in a plate');
    // The control: the same composition outside a plate calls it once, for the controller.
    html(fixtureInput('complete'));
    documentCalls = calls.length;
  } finally {
    Runtime.useEnhancementRuntime = hook;
  }
  assert.equal(documentCalls, 1, 'runtime hooks outside a plate');
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
  assert.deepEqual(
    chapters(plate).map(({ id }) => id),
    ANCHORS.map((anchor) => `pl-${anchor}`),
  );
  // No landmark, no control, no live region, and nothing of the runtime's.
  assert.doesNotMatch(plate, /<nav\b|role="region"|aria-live|hc-transport|data-runtime|<button/);
});

test('the words it adds are marked English in a portfolio in another language', () => {
  const markup = html(fixtureInput('academic'));
  assert.match(markup, /<span lang="en">Index<\/span>/);
  assert.match(markup, /<span lang="en">Prologue<\/span>/);
  assert.match(markup, /<span lang="en">Next chapter<\/span>/);
  assert.match(markup, /aria-live="polite" lang="en"/);
});

test('an identity alone still gets its h1, its control, the five chapters, and the exit', () => {
  const markup = html(fixtureInput('identity-only'));
  assert.equal(count(markup, /<h1\b/g), 1);
  assert.equal(count(markup, /data-visitor-control-slot/g), 1);
  assert.deepEqual(
    chapters(markup).map(({ id }) => id),
    ANCHORS,
  );
  // An empty chapter is its title and its links: no frame, no placeholder, no filler.
  const craft = chapters(markup).find(({ id }) => id === 'chapter-craft')!;
  assert.equal(text(craft.markup).replace(/\s+/g, ''), '04CraftPrevious03JourneyNext05Epilogue');
});

/** The stylesheet without its comments. */
const STYLES = CSS.replace(/\/\*[\s\S]*?\*\//g, '');

test("the stylesheet uses #19's border tokens whole, and declares no custom property but --layout-*", () => {
  // Each is a whole border, such as `1px solid var(--color-border-default)`: never a width, a
  // style, or a color longhand, and never with anything beside it.
  const declarations = [...CSS.matchAll(/([a-z-]+)\s*:\s*([^;{}]+);/g)].filter(([, , value]) =>
    value!.includes('var(--ui-border-'),
  );
  assert.ok(declarations.length > 4, `${declarations.length} border token uses`);
  for (const [declaration, property, value] of declarations) {
    assert.match(
      property!,
      /^border(?:-(?:block|inline|top|right|bottom|left)(?:-(?:start|end))?)?$/,
      declaration,
    );
    assert.match(value!.trim(), /^var\(--ui-border-[a-z-]+\)$/, declaration);
  }
  for (const [, name] of CSS.matchAll(/(--[a-z][a-z0-9-]*):/g)) {
    assert.match(name!, /^--layout-/, name);
  }
});

test('the horizontal layout tests reduced motion itself, holds the five chapters, and never scrolls on its own', () => {
  const queries = [...STYLES.matchAll(/@media\s*([^{]+)\{/g)].map(([, query]) => query!.trim());
  const horizontal = queries.filter((query) => query.includes('pointer: fine'));
  assert.equal(horizontal.length, 1, 'one query picks the horizontal layout');
  for (const feature of [
    'min-width: 64rem',
    'hover: hover',
    'pointer: fine',
    'prefers-reduced-motion: no-preference',
  ]) {
    assert.ok(horizontal[0]!.includes(`(${feature})`), feature);
  }
  // Never data-motion, which stays full under the OS's reduce.
  assert.doesNotMatch(STYLES, /data-motion/);
  // The scroller: the chapters side by side, one window wide each.
  const block = STYLES.slice(STYLES.indexOf(horizontal[0]!));
  assert.match(block, /grid-auto-flow: column/);
  assert.match(block, /grid-auto-columns: 100%/);
  assert.match(block, /overflow-x: auto/);
  // No snapping and no smooth scrolling in CSS: find, Tab, and a fragment land
  // where they reach, and only the controller eases, on its runtime.
  assert.doesNotMatch(STYLES, /scroll-snap|scroll-behavior/);
  // Nothing hidden, inert, pinned, or unselectable.
  assert.doesNotMatch(
    STYLES,
    /overscroll-behavior|user-select|visibility:\s*hidden|position:\s*(?:fixed|sticky)/,
  );
  // No grain, glow, or motion of its own: those are the appearance packs'.
  assert.doesNotMatch(STYLES, /@keyframes|animation|transition|filter|url\(|gradient/);
});

test('the controller never cancels a wheel, touch, or scroll, writes no history entry of its own, and never runs in a frame’s history', () => {
  const source = readFileSync(new URL('./controller.tsx', import.meta.url), 'utf8');
  assert.match(source, /^'use client';/);
  // The gestures it notes, passively, only to know a scroll was the visitor's own.
  assert.match(source, /const GESTURES = \['wheel', 'touchstart'\] as const;/);
  assert.match(
    source,
    /for \(const type of GESTURES\) stageElement\.addEventListener\(type, onGesture, \{ passive: true \}\);/,
  );
  assert.match(
    source,
    /const onGesture = \(event: Event\) => \{\n\s*gestureAt = event\.timeStamp;\n\s*\};/,
  );
  assert.doesNotMatch(source, /['"](?:mousewheel|touchmove|touchend|pointermove)['"]/);
  // Scrolls it listens to are passive, and it calls preventDefault for a step and a framed link alone.
  for (const [line] of source.matchAll(/addEventListener\('scroll(?:end)?'[^\n]*/g)) {
    assert.match(line, /passive: true/, line);
  }
  assert.equal(count(source, /preventDefault\(\)/g), 2);
  // replaceState alone, once a change settles, and never in a frame.
  assert.doesNotMatch(source, /pushState|location\.(?:assign|replace)\(|location\.hash\s*=/);
  assert.equal(count(source, /history\.replaceState/g), 1);
  assert.match(source, /if \(changed && effects\.replace && !framed\)/);
  assert.match(source, /const framed = window\.self !== window\.top;/);
  // No clock or randomness: what it shows depends on the URL and the layout alone.
  assert.doesNotMatch(source, /Date\.|performance\.|Math\.random|requestAnimationFrame/);
});

test('the composition draws nothing of its own: no canvas, shader, recording mark, or timecode, and nothing from legacy/', () => {
  const dir = new URL('./', import.meta.url);
  for (const file of readdirSync(dir).filter(
    (name) => /\.tsx?$/.test(name) && !/\.test\./.test(name),
  )) {
    const source = readFileSync(new URL(file, dir), 'utf8');
    assert.doesNotMatch(source, /<canvas|getContext|webgl|three|REC\b|timecode|legacy\//i, file);
    assert.doesNotMatch(source, /from '@portfolio\/kit'/, file);
  }
});
