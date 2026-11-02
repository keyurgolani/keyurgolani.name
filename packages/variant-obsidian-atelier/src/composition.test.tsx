import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PresentationBoundary } from '@portfolio/appearance/react';
import { PLATFORM_DEFAULTS } from '@portfolio/appearance';
import { checkDestinationOverrides, pageOutline, worksByIds } from '@portfolio/kit/sections';
import { composeSchemas, resolvePortfolioView, type ParsedPair } from '@portfolio/schema';
import { readPair, readUnitFiles } from '@portfolio/schema/node';
import {
  buildRenderInput,
  validateManifest,
  type VariantManifest,
  type VariantRenderInput,
} from '@portfolio/variant-contract';
import {
  checkOutline,
  CONTRACT_FIXTURES,
  contractFixture,
  HIDDEN_CANARY,
} from '@portfolio/variant-contract/node';
import ObsidianAtelier from '.';
import { HOME_WORKS, ON_WALL, onWall } from './collection';
import { atelierModel, MAX_ROOMS, mountOf, roman } from './model';
import { glanceSentence } from './galleries/evidence';
import { entranceAnchor } from './plan';
import { thesisParts } from './entrance';
import { ATELIER_OVERRIDES } from './navigation';

// Obsidian Atelier (redesign, stream C): its manifest's pins; the rooms,
// the catalogue numbers, and the collection's bays; private works kept out
// of every number, room, and pager; the plan reaching every titled section;
// the outline check on every contract fixture; and a page that's whole
// with no script, no motion, and in a plate.

// tsx compiles JSX to React.createElement calls, so the test supplies React.
Object.assign(globalThis, { React });

const PACKAGE = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const RAW = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
const CSS = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
const REPO = new URL('../../../', import.meta.url).pathname;
const { PortfolioSchema } = composeSchemas();

const CORE_KINDS = [
  'hero',
  'lede',
  'now',
  'works',
  'evidence',
  'chronology',
  'practice',
  'contact',
  'custom',
  'quote',
  'focus',
  'fun-facts',
  'cta',
  'github',
];

test("its manifest validates with nothing to report, renders every core kind, and holds the catalog's pins", () => {
  const result = validateManifest(RAW, { packageName: PACKAGE.name, exports: PACKAGE.exports });
  assert.ok(result.ok, JSON.stringify(result.diagnostics));
  assert.deepEqual(result.diagnostics, []);
  const { manifest } = result;
  assert.equal(manifest.id, 'obsidian-atelier');
  assert.deepEqual(
    [manifest.compositionFamily, manifest.motionIntent, manifest.performanceTier],
    ['gallery', 'subtle', 'light'],
  );
  assert.deepEqual([...manifest.renderedKinds].sort(), [...CORE_KINDS].sort());
  assert.deepEqual(manifest.unsupportedKinds, []);
  // Both pages are the composition's own: home, and a work's own page.
  assert.deepEqual(manifest.routes, { home: 'bespoke', work: 'bespoke', views: [] });
  assert.deepEqual(manifest.textDirection, ['ltr', 'rtl']);
  // The light tier: nothing continuous runs, and the island fits its budget.
  assert.equal(manifest.budgets?.animation, 0);
  assert.equal(manifest.budgets?.js, 2048);
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

function inputOf(pair: ParsedPair, options: InputOptions = {}, dir?: string): VariantRenderInput {
  const unit = dir ? readUnitFiles(dir) : { snapshots: {} };
  return buildRenderInput({
    view: resolvePortfolioView(
      pair,
      {
        snapshots: unit.snapshots,
        ...('media' in unit && unit.media ? { media: unit.media } : {}),
      },
      { mediaBase: '/media' },
    ),
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
  const fixture = contractFixture(name);
  const read = readPair(fixture.files);
  assert.ok(read.ok, JSON.stringify(read));
  return inputOf(read.pair, options, fixture.files.portfolio.replace(/\/portfolio\.yml$/, ''));
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
  return [
    ...markup.matchAll(/<article class="oa-room oa-room--\w+" id="([^"]+)"[\s\S]*?<\/article>/g),
  ].map(([room, id]) => ({ id: id!, markup: room }));
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

/** The footer's plan of the exhibition, and the whole one the Index dialog shows. */
const plan = (markup: string) =>
  markup.slice(markup.indexOf('<footer'), markup.indexOf('</footer>'));
const index = (markup: string) =>
  markup.slice(markup.indexOf('<dialog'), markup.indexOf('</dialog>'));

/** A small portfolio of the test's own: a signature, a featured work, and three works sections. */
const GALLERY = {
  schemaVersion: 3,
  locale: 'en',
  direction: 'ltr',
  identity: { name: 'Rowan Vale', tagline: 'Maker of small tools' },
  signature: 'first',
  featured: ['second', 'hidden-one'],
  works: [
    { id: 'first', title: 'First work', medium: 'software', summary: 'The first.' },
    { id: 'second', title: 'Second work', medium: 'writing', summary: 'The second.' },
    { id: 'hidden-one', title: 'Hidden work', medium: 'object', visibility: 'private' },
    { id: 'third', title: 'Third work', medium: 'writing', readingTimeMinutes: 4 },
    { id: 'fourth', title: 'Fourth work', medium: 'audio-video', series: 'Show', number: 7 },
    {
      id: 'series',
      title: 'A series',
      medium: 'image-series',
      media: [
        { asset: 'one', caption: 'Plate one' },
        { asset: 'two', caption: 'Plate two' },
      ],
    },
  ],
  media: [
    { id: 'one', kind: 'image', source: 'media/one.png', alt: 'One.' },
    { id: 'two', kind: 'image', source: 'media/two.png', alt: 'Two.' },
  ],
  sections: [
    { kind: 'hero', id: 'top', tagline: 'Small tools, carefully made.' },
    { kind: 'works', id: 'projects', title: 'Projects', items: ['first', 'third', 'hidden-one'] },
    { kind: 'works', id: 'writing', title: 'Writing', items: ['second', 'fourth'] },
    { kind: 'works', id: 'pictures', title: 'Pictures', items: ['series'] },
    { kind: 'lede', id: 'about', title: 'About', body: 'Some words.' },
    { kind: 'focus', id: 'focus', title: 'Focus', items: ['One thing'] },
  ],
};

test('every contract fixture holds the outline: one h1, the main, heading order, a frame for each section, named navigation, and real links', () => {
  for (const { name } of CONTRACT_FIXTURES) {
    for (const idPrefix of ['', 'pv-']) {
      const input = fixtureInput(name, { idPrefix });
      const markup = html(input);
      const sections = pageOutline(input).sections.map(({ id, anchor }) =>
        anchor === undefined ? { id } : { id, anchor },
      );
      assert.deepEqual(
        checkOutline(markup, input.ids, { sections }).map(
          ({ code, section, at }) => `${code} ${section ?? at}`,
        ),
        [],
        `${name} ${idPrefix}`,
      );
      // Every section through the composition's own renderer and frame.
      assert.doesNotMatch(markup, /data-renderer="shared"/, name);
      const all = ids(markup);
      assert.equal(new Set(all).size, all.length, `${name}: ids repeat`);
    }
  }
});

test('the page reads whole with no script and no motion: nothing hidden, nothing waiting at zero opacity', () => {
  const markup = html(fixtureInput('complete'));
  assert.equal(count(markup, /<main\b/g), 1);
  assert.equal(count(markup, /<h1\b/g), 1);
  assert.equal(count(markup, /data-visitor-control-slot/g), 1);
  assert.ok(markup.indexOf('class="oa-chrome"') < markup.indexOf('<main'));
  assert.ok(markup.indexOf('<footer') > markup.indexOf('</main>'));
  assert.doesNotMatch(markup, /\shidden=""|visibility:\s*hidden|opacity:\s*0/);
  // Unfold the case and the rest of a bay are closed on the server, native details, and print open.
  assert.match(markup, /<details class="oa-unfold"><summary class="oa-summary">/);
  // Print opens every fold the page has, whatever its class: no rule names some and misses one.
  const print = CSS.slice(CSS.indexOf('@media print'));
  assert.match(
    print,
    /\[data-variant='obsidian-atelier'\] details::details-content \{\s*block-size: auto;\s*content-visibility: visible;/,
  );
  assert.ok(count(markup, /<details class="oa-whole">/g) > 0, 'the page has a closed hall');
});

test('with no script the chrome reads whole: the mark is never hidden, and Index is a link until the script swaps in its dialog', () => {
  // The stylesheet's own rules for the mark: none hides it, at any width.
  const rules = [...CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
  for (const [, selector, body] of rules) {
    if (!selector!.includes('oa-chrome__mark')) continue;
    assert.doesNotMatch(body!, /visibility:\s*hidden|display:\s*none/, selector!.trim());
  }
  // Index: the link shows unless the script's attribute is there; the dialog only when it is.
  const hides = (body: string) => /display:\s*none/.test(body);
  const linkHidden = rules.filter(
    ([, selector, body]) => selector!.includes('.oa-chrome__index-link') && hides(body!),
  );
  assert.ok(linkHidden.length > 0);
  for (const [, selector] of linkHidden) assert.match(selector!, /\[data-oa-script\]/);
  const dialogHidden = rules.filter(
    ([, selector, body]) => /\.oa-chrome__index\b(?!-)/.test(selector!) && hides(body!),
  );
  assert.ok(dialogHidden.some(([, selector]) => /:not\(\[data-oa-script\]\)/.test(selector!)));
  // The markup has both, the link to the footer's plan first.
  const input = fixtureInput('complete');
  const markup = html(input);
  const chrome = markup.slice(markup.indexOf('class="oa-chrome"'), markup.indexOf('<main'));
  assert.match(
    chrome,
    new RegExp(`<a class="oa-chrome__index-link" href="#${input.ids.prefix}oa--plan"`),
  );
  assert.ok(markup.includes(`id="${input.ids.prefix}oa--plan"`));
});

test("the stylesheet styles its own elements, never a primitive's slots, and keys nothing on a display mode", () => {
  assert.doesNotMatch(CSS, /\[data-ui-slot/);
  assert.doesNotMatch(CSS, /aria-haspopup/);
  assert.doesNotMatch(CSS, /data-display-mode|data-color-scheme|data-contrast/);
  // A subgrid with size containment is no subgrid: no rule makes one a container.
  for (const [, body] of CSS.matchAll(/\{([^{}]*grid-template-columns: subgrid[^{}]*)\}/g)) {
    assert.doesNotMatch(body!, /container(-type)?:/);
  }
  // A part that takes its parent's lines is a subgrid of them, never a box dropped from the tree.
  assert.doesNotMatch(CSS.replace(/\/\*[\s\S]*?\*\//g, ''), /display:\s*contents/);
});

test('every animation and transition is inside no-preference, ends where the page already is, and none runs forever', () => {
  const motion = CSS.split('@media (prefers-reduced-motion: no-preference)');
  assert.equal(motion.length, 2, 'one motion block');
  const outside = motion[0]!;
  assert.doesNotMatch(outside, /\banimation:|\btransition:/);
  // And only under full motion: the site's policy, on the boundary, neither reduced nor static.
  const gate =
    "[data-variant='obsidian-atelier']:not([data-motion='reduced'], [data-motion='static'])";
  const block = motion[1]!
    .slice(0, motion[1]!.indexOf('@keyframes'))
    .replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [...block.matchAll(/([^{}]+)\{[^{}]*\}/g)].map(([, selector]) => selector!.trim());
  assert.ok(rules.length > 5, 'the motion block has its rules');
  for (const selector of rules.flatMap((list) => list.split(/,\n\s*/))) {
    assert.ok(selector.startsWith(gate), selector);
  }
  assert.doesNotMatch(CSS, /\binfinite\b|animation-fill-mode:\s*forwards|\sforwards;/);
  // Each keyframe sets its start alone, so its end is the element's own style.
  for (const [, body] of CSS.matchAll(/@keyframes obsidian-atelier-[\w-]+ \{([\s\S]*?)\n\}/g)) {
    assert.doesNotMatch(body!, /\bto\s*\{|^\s*100%\s*\{/m);
  }
  // Durations and the curve are the platform's, worked out from the slots.
  for (const [, value] of CSS.matchAll(/(?:transition|animation):([^;]+);/g)) {
    assert.doesNotMatch(value!, /\d(?:ms|s)\b/, value);
  }
});

test('the rooms are the signature and then the featured works, at most five, each with its catalogue number and room', () => {
  const input = fixtureInput('design');
  const expected = worksByIds([input.portfolio.signature!, ...input.portfolio.featured], input)
    .map(({ id }) => id)
    .slice(0, MAX_ROOMS);
  assert.ok(expected.length > 2, 'the design fixture curates a signature and featured works');
  const markup = html(input);
  const found = rooms(markup);
  assert.deepEqual(
    found.map(({ id }) => id),
    expected,
  );
  const numerals = ['I', 'II', 'III', 'IV', 'V'];
  // One room counter in each room's head, of every room on the page, the halls' too (C7).
  const of = roman(atelierModel(input).roomCount);
  found.forEach((room, index) => {
    assert.match(
      text(room.markup),
      new RegExp(`Room ${numerals[index]} of ${of}(?![IVX])`),
      room.id,
    );
    assert.doesNotMatch(text(room.markup), /No\. \d+, Room/, room.id);
    // Plain previous and next by catalogue number: links alone.
    assert.doesNotMatch(room.markup, /<button|onclick/i);
  });
  // The signature hangs on the entrance wall as No. 1, with its label's way to Room I.
  const entrance = markup.slice(
    markup.indexOf('class="oa-entrance'),
    markup.indexOf('class="oa-room'),
  );
  assert.match(text(entrance), /No\. 1 of \d+/);
  assert.ok(entrance.includes(`href="#${expected[0]}"`));
});

test('a routed work links its whole case from its room: its title and Read the whole case', () => {
  const input = fixtureInput('complete');
  const markup = html(input);
  const signature = rooms(markup).find(({ id }) => id === input.portfolio.signature);
  assert.ok(signature);
  assert.match(signature.markup, /<a href="\/work\/project-name">Read the whole case<\/a>/);
  assert.match(signature.markup, /class="oa-roomtitle"[^>]*><a href="\/work\/project-name">/);
});

test('catalogue numbers run on from the rooms in hanging order, a series is one number with a plate each, and nothing hangs twice', () => {
  const input = portfolioInput(GALLERY);
  const model = atelierModel(input);
  assert.deepEqual(
    model.rooms.map(({ work, number }) => [work.id, number]),
    [
      ['first', 1],
      ['second', 2],
    ],
  );
  const hung = [...model.bays.values()].flatMap(({ hung: items }) =>
    items.map(({ work, number, plates }) => [work.id, number, plates.length]),
  );
  assert.deepEqual(hung, [
    ['third', 3, 0],
    ['fourth', 4, 0],
    ['series', 5, 2],
  ]);
  assert.deepEqual(model.hangs, { first: 3, last: 5 });
  const markup = html(input);
  assert.match(text(markup), /Plate one\s*5\.1/);
  assert.match(text(markup), /Plate two\s*5\.2/);
  // A bay says which rooms hold its works, and links them.
  assert.match(text(markup), /No\. 1 is in Room I\./);
  assert.match(markup, /<a href="#first">I<\/a>/);
  // Each work's anchor is on the page once: its room, or its place on the wall.
  for (const id of ['first', 'second', 'third', 'fourth', 'series']) {
    assert.equal(count(markup, new RegExp(` id="${id}"`, 'g')), 1, id);
  }
  assert.equal(model.total, 5);
});

test('a bay hangs three pieces at most, and the rest of it is its folded checklist, each row keeping its anchor', () => {
  const input = fixtureInput('large');
  const markup = html(input);
  const model = atelierModel(input);
  let folded = 0;
  for (const [id, bay] of model.bays) {
    const start = markup.indexOf(`id="${input.ids.prefix}${id}"`);
    const section = markup.slice(start, markup.indexOf('</section>', start));
    assert.ok(count(section, /<li[^>]*class="oa-work /g) <= ON_WALL, id);
    for (const hung of bay.hung.slice(ON_WALL)) {
      folded += 1;
      assert.match(section, new RegExp(`<tr id="[^"]*${hung.work.id}"`), hung.work.id);
    }
  }
  assert.ok(folded > 0, 'the large fixture folds some of its works');
});

test('each work hangs as its medium: a screen, a sheet, a sleeve, a print, or a ledge', () => {
  const placement = [{ asset: 'a' }];
  const work = (medium: string, extra: object = {}) => ({ id: 'w', title: 'W', medium, ...extra });
  assert.equal(mountOf(work('software') as never, placement as never), 'screen');
  assert.equal(mountOf(work('software') as never, []), 'sheet');
  assert.equal(mountOf(work('writing') as never, placement as never), 'sheet');
  assert.equal(mountOf(work('audio-video', { number: 3 }) as never, placement as never), 'sleeve');
  assert.equal(mountOf(work('image-series') as never, placement as never), 'print');
  assert.equal(mountOf(work('music') as never, placement as never), 'ledge');
  assert.equal(mountOf(work('music') as never, []), 'sleeve');
});

test('a private work, or one only a hidden section reaches, is no room, no number, no plate, and no neighbor', () => {
  const canary = fixtureInput('hidden-canary');
  assert.doesNotMatch(html(canary), new RegExp(HIDDEN_CANARY));
  const input = portfolioInput(GALLERY);
  const markup = html(input);
  assert.doesNotMatch(markup, /Hidden work|hidden-one/);
  // The curation names the private work; the rooms are what's left, numbered with no gap.
  assert.deepEqual(
    rooms(markup).map(({ id }) => id),
    ['first', 'second'],
  );
  assert.match(text(markup), new RegExp(`Room II of ${roman(atelierModel(input).roomCount)}`));
  // Every room the page hangs, Practice among them, as "Room II of III" counts them.
  assert.match(text(markup), /A catalogue of 5 works in 3 rooms/);
});

test('with nothing curated, the rooms are the first three works the reading order shows, the archive left out', () => {
  const input = portfolioInput({
    ...GALLERY,
    signature: undefined,
    featured: undefined,
    archive: ['first'],
  });
  assert.deepEqual(
    atelierModel(input).rooms.map(({ work }) => work.id),
    ['third', 'second', 'fourth'],
  );
});

test('the plan of the exhibition reaches every room, the collection, every gallery, and every section the owner titled', () => {
  for (const name of ['complete', 'design', 'writing']) {
    const input = fixtureInput(name);
    const markup = html(input);
    const footer = plan(markup);
    const dialog = index(markup);
    const model = atelierModel(input);
    assert.match(dialog, /^<dialog[^>]*data-ui-slot="dialog"/);
    for (const room of model.rooms) {
      for (const drawn of [footer, dialog]) {
        assert.ok(drawn.includes(`href="#${room.anchor}"`), `${name}: room ${room.work.id}`);
      }
    }
    // Each gallery's door is its namesake section, as the shared navigation model picks it.
    for (const gallery of model.galleries) {
      const door = model.navigation.primary.find((each) => each.id === gallery.key)?.href;
      for (const drawn of [footer, dialog]) {
        assert.ok(
          drawn.includes(`href="${door ?? `#${input.ids.prefix}oa--${gallery.key}`}"`),
          `${name}: ${gallery.key}`,
        );
      }
    }
    // The Index has a door to every section the owner titled; the entrance's own are its room.
    for (const section of pageOutline(input).sections) {
      if (section.title === undefined || section.href === undefined) continue;
      if (model.hero?.id === section.id || model.thesis?.id === section.id) continue;
      assert.ok(dialog.includes(`href="${section.href}"`), `${name}: ${section.id}`);
    }
    // The footer draws the rooms alone, with no list of every section again.
    assert.doesNotMatch(footer, /oa-plan__doors/);
  }
});

test("the destinations are the shared model's five, named content first, and Writing is its own room in the Index", () => {
  const input = fixtureInput('complete');
  const model = atelierModel(input);
  assert.deepEqual(
    model.navigation.primary.map(({ id, label }) => `${id} ${label}`),
    ['work Work', 'writing Writing', 'record Record', 'about Practice', 'contact Contact'].filter(
      (line) => model.navigation.primary.some(({ id }) => line.startsWith(`${id} `)),
    ),
  );
  const writing = model.navigation.primary.find(({ id }) => id === 'writing');
  assert.ok(writing?.href, 'complete has a section of writing');
  const markup = html(input);
  // Writing is a room of the Index's plan, with its bays; the footer's plan, which lists no doors, leaves
  // its bays to the collection's cell rather than drawing an empty one (P1-6).
  assert.match(index(markup), new RegExp(`href="${writing.href}"[^>]*>(<[^>]+>)*Writing`));
  assert.doesNotMatch(plan(markup), new RegExp(`class="oa-plan__name" href="${writing.href}"`));
});

/** The bundled sample, as the demo renders it, with its frozen GitHub snapshot. */
function sampleInput(): VariantRenderInput {
  const read = readPair({
    portfolio: `${REPO}portfolio.example.yml`,
    site: `${REPO}site.example.yml`,
  });
  assert.ok(read.ok, JSON.stringify(read));
  return inputOf(read.pair, { basePath: '/sample' }, REPO);
}

test("Atelier's one departure from the canonical map is sound, and its galleries hang each section where the model places it", () => {
  const inputs = [sampleInput(), ...CONTRACT_FIXTURES.map(({ name }) => fixtureInput(name))];
  const outlines = inputs.map((input) => pageOutline(input));
  assert.deepEqual(checkDestinationOverrides(ATELIER_OVERRIDES, outlines), []);
  for (const input of inputs) {
    const model = atelierModel(input);
    // No destination lands on the entrance's own sections.
    for (const own of [model.hero?.id, model.thesis?.id]) {
      if (own === undefined) continue;
      assert.ok(
        !model.navigation.primary.some(({ sections }) => sections.some(({ id }) => id === own)),
        own,
      );
    }
    // A gallery holds only sections of its destination, or ones the map leaves to the index.
    for (const gallery of model.galleries) {
      for (const section of gallery.sections) {
        const place = model.navigation.placed.get(section.id);
        assert.ok(
          place === undefined || place === null || place === gallery.key,
          `${section.id} in ${gallery.key}`,
        );
      }
    }
  }
});

test('the map places metrics, quotes, and evidence that shows nothing; the exit wall is the first quote, its destination unmoved', () => {
  const input = portfolioInput({
    ...GALLERY,
    evidence: [
      { id: 'years', type: 'metric', statement: 'Years at it', metric: { key: 'years', value: 9 } },
      {
        id: 'unseen',
        type: 'metric',
        statement: 'Kept back',
        metric: { key: 'unseen', value: 1 },
        visibility: 'private',
      },
    ],
    sections: [
      ...GALLERY.sections,
      { kind: 'evidence', id: 'glance', title: 'At a glance', items: ['years'] },
      { kind: 'evidence', id: 'nothing', title: 'Nothing to show', items: ['unseen'] },
      { kind: 'quote', id: 'words', text: 'Make it plain.', attribution: 'Rowan Vale' },
    ],
  });
  const model = atelierModel(input);
  const hangs = (id: string) =>
    model.galleries.find(({ sections }) => sections.some((section) => section.id === id))?.key;
  // Metrics are Record's, as everywhere: Atelier no longer moves them to Practice.
  assert.equal(hangs('glance'), 'record');
  assert.equal(model.navigation.placed.get('glance'), 'record');
  // Evidence that shows nothing renders nothing, so it hangs nowhere, Practice least of all.
  assert.equal(hangs('nothing'), undefined);
  assert.ok(!model.outline.sections.some(({ id }) => id === 'nothing'));
  // The quote stays Practice's in the navigation, and hangs as the exit wall, with its floor's counter.
  assert.equal(model.navigation.placed.get('words'), 'about');
  assert.equal(model.exit?.id, 'words');
  const markup = html(input);
  assert.match(
    markup,
    /class="oa-exit oa-wall"[\s\S]*?oa-wallfloor__count[^>]*>Nos\. 1 to \d+ hung</,
  );
  // On the way out: after the last gallery, since this page has no Contact.
  assert.ok(markup.lastIndexOf('oa-exit') > markup.lastIndexOf('oa-gallery--record'));
});

test('headings: the h1 on the entrance, h2 for rooms and galleries, h3 for the sections in them', () => {
  const markup = html(portfolioInput(GALLERY));
  const levels = [...markup.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/g)]
    .filter(([whole]) => !/data-ui-slot="dialog.title"/.test(whole))
    .map(([, level, inner]) => `${level} ${text(inner!)}`);
  assert.deepEqual(levels, [
    '1 Rowan Vale Maker of small tools',
    '2 First work',
    '2 Second work',
    '2 Collection',
    '3 Projects',
    '3 Writing',
    '3 Pictures',
    '2 Practice',
    '3 About',
    '3 Focus',
    '2 Plan of the exhibition',
  ]);
});

test('in every fixture the headings run h1 on the entrance, h2 for each room, wall, and gallery, and h3 inside them', () => {
  for (const { name } of CONTRACT_FIXTURES) {
    const input = fixtureInput(name);
    const markup = html(input);
    const levels = [...markup.matchAll(/<h([1-6])\b([^>]*)>/g)]
      .filter(([, , attributes]) => !/data-ui-slot="dialog.title"/.test(attributes!))
      .map(([, level]) => Number(level));
    assert.equal(levels.filter((level) => level === 1).length, 1, `${name}: one h1`);
    assert.equal(levels[0], 1, `${name}: the h1 first`);
    for (let index = 1; index < levels.length; index++) {
      assert.ok(
        levels[index]! <= levels[index - 1]! + 1,
        `${name}: h${levels[index - 1]} to h${levels[index]}`,
      );
      assert.ok(levels[index]! >= 2 && levels[index]! <= 3, `${name}: h${levels[index]}`);
    }
    const model = atelierModel(input);
    for (const room of model.rooms) {
      assert.match(
        markup,
        new RegExp(`<h2 id="${input.ids.prefix}oa--room-${room.work.id}"`),
        name,
      );
    }
    for (const gallery of model.galleries) {
      if (!markup.includes(`id="${input.ids.prefix}oa--${gallery.key}-title"`)) continue;
      assert.match(
        markup,
        new RegExp(`<h2 id="${input.ids.prefix}oa--${gallery.key}-title"`),
        name,
      );
    }
  }
});

test('the top row is the mark, the room switch, the running head, the visitor control, and Index last, with no bar of destinations', () => {
  const input = fixtureInput('complete');
  const markup = html(input);
  const model = atelierModel(input);
  const chrome = markup.slice(markup.indexOf('class="oa-chrome"'), markup.indexOf('<main'));
  const outside = chrome.replace(/<dialog[\s\S]*<\/dialog>/, '');
  // The name back to the entrance, one numeral a room, at most five, then Index to the footer's plan.
  const links = [...outside.matchAll(/<a\b[^>]*href="([^"]*)"/g)].map(([, href]) => href);
  assert.equal(links[0], `#${entranceAnchor(model, input)}`);
  assert.deepEqual(
    links.slice(1, -1),
    model.rooms.map((room) => `#${room.anchor}`),
  );
  assert.ok(model.rooms.length <= 5);
  assert.equal(links.at(-1), `#${input.ids.prefix}oa--plan`);
  assert.equal(count(outside, /<nav\b/g), 1);
  assert.match(outside, /<nav[^>]*aria-label="Rooms"/);
  assert.match(chrome, /class="oa-chrome__here"/);
  assert.match(chrome, /aria-haspopup="dialog"/);
  assert.equal(count(chrome, /data-visitor-control-slot/g), 1);
  // Each room is named by its numeral and its work's own title, so no two read alike.
  const names = [...outside.matchAll(/class="oa-chrome__name"[^>]*>([^<]*)</g)].map(([, name]) =>
    name!.trim(),
  );
  // Each room is named by its title cut at a word in the model, never with an ellipsis; its whole title is its name.
  assert.deepEqual(
    names,
    model.rooms.map((room) => room.name),
  );
  for (const room of model.rooms) {
    assert.ok(room.work.title.startsWith(room.name), room.name);
    assert.ok(!room.name.includes('…'));
    assert.match(
      outside,
      new RegExp(
        `aria-label="Room ${room.numeral}, ${room.work.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`,
      ),
    );
  }
  assert.equal(new Set(names).size, names.length);
  // Index is the one fixed control, its plate holding the footer plan's link and the dialog alike;
  // the corner borrows no ground from what's under it.
  assert.doesNotMatch(outside, /data-oa-ground/);
  const pin = outside.slice(outside.indexOf('class="oa-chrome__pin"'));
  assert.ok(pin.indexOf('oa-chrome__index-link') > 0 && pin.indexOf('oa-chrome__index"') > 0);
  // Past five windows down the running head joins it as the position marker on its strip, and nothing else is fixed.
  assert.match(CSS, /\.oa-chrome__pin \{[^}]*position: fixed/);
  assert.match(CSS, /\.oa-chrome\[data-oa-deep\] \.oa-chrome__here \{[^}]*position: fixed/);
  assert.match(CSS, /\.oa-chrome\[data-oa-deep\] \.oa-chrome__strip \{[^}]*position: fixed/);
  assert.doesNotMatch(
    CSS.replace(/\.oa-chrome__pin \{[^}]*\}/, '')
      .replace(/\.oa-chrome\[data-oa-deep\] \.oa-chrome__here \{[^}]*\}/, '')
      .replace(/\.oa-chrome\[data-oa-deep\] \.oa-chrome__strip \{[^}]*\}/, '')
      .replace(/\/\*[\s\S]*?\*\//g, ''),
    /position: fixed/,
  );
});

test('the plan glues no count to a name, a hall shows its room, and the last word stands before Contact (C7)', () => {
  const input = sampleInput();
  const model = atelierModel(input);
  assert.ok(model.exit, 'the sample has a quote');
  const footer = plan(html(input));
  assert.doesNotMatch(
    footer,
    /(Practice|Record|Contact|Writing)<\/span>?\s*<span class="oa-plan__count">\d/,
  );
  assert.match(
    footer,
    new RegExp(
      `>Practice</a><span class="oa-plan__count">Room\u00a0${model.halls.get('about')!.numeral}<`,
    ),
  );
  assert.doesNotMatch(footer, />Exit</);
  const last = footer.indexOf('>Last word<');
  assert.ok(last > 0, 'the exit wall has its entry');
  assert.ok(last < footer.indexOf('>Contact<'), 'before Contact');
});

test("Contact's halves pair up in reading order: one with no half beside it reads across", () => {
  for (const name of ['complete', 'design', 'writing']) {
    const markup = html(fixtureInput(name));
    for (const key of ['contact']) {
      const start = markup.indexOf(`class="oa-gallery oa-gallery--${key}`);
      if (start < 0) continue;
      // The gallery runs to the next gallery, the exit wall, or the end of the main.
      const after = markup.slice(start + 1);
      const ends = [
        after.search(/<section[^>]*class="oa-(gallery|exit)\b/),
        after.indexOf('</main>'),
      ];
      const gallery = after.slice(0, Math.min(...ends.filter((end) => end >= 0)));
      const spans = [...gallery.matchAll(/data-oa-span="(wide|half)"/g)].map(([, span]) => span!);
      assert.equal(
        spans.length,
        count(gallery, /class="oa-block\b/g),
        `${name} ${key}: every block`,
      );
      // Between wides, halves come two at a time.
      for (const run of spans.join(' ').split('wide')) {
        assert.equal(
          run.trim().split(/\s+/).filter(Boolean).length % 2,
          0,
          `${name} ${key}: ${spans}`,
        );
      }
    }
  }
});

test('the first sentence of a thesis ends at its full stop, not at an abbreviation or an initial', () => {
  assert.deepEqual(thesisParts('Dr. Rowan builds tools. Small ones.'), {
    title: 'Dr. Rowan builds tools.',
    rest: 'Small ones.',
    long: false,
  });
  assert.deepEqual(thesisParts('J. R. Vale makes maps! They are slow.'), {
    title: 'J. R. Vale makes maps!',
    rest: 'They are slow.',
    long: false,
  });
  assert.deepEqual(thesisParts('Tools, e.g. Rust, and patience.'), {
    title: 'Tools, e.g. Rust, and patience.',
    long: false,
  });
  assert.deepEqual(thesisParts('I make failure legible. The rest follows.'), {
    title: 'I make failure legible.',
    rest: 'The rest follows.',
    long: false,
  });
});

test("the practice's thesis is the entrance's room title and the page's h1, the name and role its plaque", () => {
  const input = fixtureInput('complete');
  const markup = html(input);
  const h1 = /<h1\b[^>]*>[\s\S]*?<\/h1>/.exec(markup);
  assert.ok(h1);
  assert.match(h1[0], /class="oa-entrance__title"/);
  assert.equal(atelierModel(input).thesis?.part, 'thesis');
  assert.match(markup, /<p class="oa-plaque__name" data-type-role="label">/);
  // The thesis hangs on the entrance, not in the practice gallery again.
  const practice = markup.slice(markup.indexOf('id="oa--about"'));
  assert.doesNotMatch(practice.slice(0, practice.indexOf('</section>')), /oa-entrance__title/);
});

test('internal links keep the mount: below /sample, with its variant query', () => {
  const input = fixtureInput('complete', {
    basePath: '/sample',
    query: { variant: 'obsidian-atelier' },
  });
  const markup = html(input);
  assert.match(markup, /href="\/sample\/work\/project-name\?variant=obsidian-atelier"/);
  for (const [, href] of markup.matchAll(/\shref="(\/[^"]*)"/g)) {
    assert.ok(href!.startsWith('/sample'), href);
  }
});

test('in a plate it renders the same, every id under the plate prefix, none repeated, and no landmark of its own', () => {
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
  // Its chrome, its navigation, and its colophon are plain divs in a plate.
  assert.doesNotMatch(plate, /<nav\b|<header\b|<footer\b/);
});

test('a portfolio with nothing to hang has no rooms and no Index, and still its h1 and control', () => {
  const markup = html(fixtureInput('identity-only'));
  assert.doesNotMatch(markup, /oa-room|aria-haspopup="dialog"/);
  assert.equal(count(markup, /<h1\b/g), 1);
  assert.equal(count(markup, /data-visitor-control-slot/g), 1);
});

test('the words it adds are marked English in a portfolio in another language', () => {
  const markup = html(fixtureInput('academic'));
  assert.match(markup, /<span class="oa-chrome__index-word" lang="en">Index<\/span>/);
  assert.match(markup, /lang="en">Room I of [IVX]+<\/span>/);
});

test("the stylesheet reads the platform's scales: no length of its own in a padding, margin, or gap", () => {
  for (const [, property, value] of CSS.matchAll(
    /\b((?:padding|margin)(?:-[a-z-]+)?|(?:row-|column-)?gap):\s*([^;]+);/g,
  )) {
    assert.doesNotMatch(value!, /\d(?:px|rem|vw)\b/, `${property}: ${value}`);
  }
  // A custom property of its own is --layout-* alone.
  for (const [, name] of CSS.matchAll(/(--[\w-]+):/g)) {
    assert.match(name!, /^--layout-/, name);
  }
});

/** A gallery's markup, from its section to the next gallery, the exit wall, or the main's end. */
function galleryMarkup(markup: string, key: string): string {
  const start = markup.indexOf(`class="oa-gallery oa-gallery--${key}`);
  if (start < 0) return '';
  const after = markup.slice(start + 1);
  const ends = [
    after.search(/<section[^>]*class="oa-(gallery|exit)\b/),
    after.indexOf('</main>'),
  ].filter((end) => end >= 0);
  return after.slice(0, Math.min(...ends));
}

test('Practice and Record hang as rooms: a wall, a running head, the record summarized and the whole record folded (C1)', () => {
  const input = fixtureInput('complete');
  const model = atelierModel(input);
  const markup = html(input);
  for (const key of ['about', 'record'] as const) {
    const hall = model.halls.get(key);
    assert.ok(hall, key);
    const gallery = galleryMarkup(markup, key);
    assert.match(gallery, /oa-gallery--\w+ oa-hall oa-wall"/);
    assert.match(text(gallery), new RegExp(`Room ${hall.numeral} of ${roman(model.roomCount)}`));
    // Editorial's forms are its own: no dotted leaders and no ruled tables in either room.
    assert.doesNotMatch(gallery, /class="oa-leaders?"|class="oa-table"/);
  }
  const record = galleryMarkup(markup, 'record');
  // One summary on the page, the rest folded behind one disclosure, closed on the server.
  assert.equal(count(record, /<details class="oa-whole">/g), 1);
  assert.doesNotMatch(record, /<details class="oa-whole" open/);
  assert.ok(model.halls.get('record')!.whole.length > 0);
  // In the whole record, the checklist stands in a vitrine and the quotes are framed inscriptions.
  const whole = record.slice(record.indexOf('<details class="oa-whole">'));
  assert.match(whole, /class="oa-vitrine-mat"><table class="oa-checktable">/);
  assert.match(whole, /<figure[^>]*class="oa-frame"[^>]*><div class="oa-frame__mat"><blockquote/);
  // The summary is one section, At a glance where the record has one (this fixture's stats aren't all figures).
  const lead = record.slice(
    record.indexOf('class="oa-hall__lead"'),
    record.indexOf('<details class="oa-whole">'),
  );
  assert.equal(count(lead, /data-section-id=/g), 1);
  assert.doesNotMatch(lead, /oa-frame/);
  // The sample's record has its figures: At a glance is the summary, in sentences.
  const sample = galleryMarkup(html(sampleInput()), 'record');
  const glance = sample.slice(
    sample.indexOf('class="oa-hall__lead"'),
    sample.indexOf('<details class="oa-whole">'),
  );
  assert.match(glance, /<p class="oa-glance">/);
  // Practice's wall holds its words and, beside them, Now as the room's one object (OBS-4).
  const practice = galleryMarkup(html(sampleInput()), 'about');
  const words = practice.slice(
    practice.indexOf('class="oa-hall__lead"'),
    practice.indexOf('<details class="oa-whole">'),
  );
  assert.equal(count(words, /data-section-id=/g), 2);
  assert.match(words, /class="oa-block oa-block--lede"[\s\S]*class="oa-block oa-block--now"/);
  assert.doesNotMatch(
    practice.slice(practice.indexOf('<details class="oa-whole">')),
    /oa-block--now/,
  );
});

test('the home outline (item 8): six works hung at most, one record summary, the rest of each hall closed', () => {
  for (const name of ['complete', 'large']) {
    const input = fixtureInput(name);
    const model = atelierModel(input);
    const markup = html(input);
    // The rooms' works and the wall's together, outside every disclosure.
    const open = markup.replace(/<details[\s\S]*?<\/details>/g, '');
    const hung = count(open, /<li[^>]*class="oa-work /g) + model.rooms.length;
    assert.ok(hung <= HOME_WORKS, `${name}: ${hung} works hung`);
    for (const [key, hall] of model.halls) {
      assert.ok(hall.lead.length <= (key === 'record' ? 1 : 2), `${name} ${key}`);
      const gallery = galleryMarkup(markup, key);
      if (hall.whole.length > 0) {
        assert.equal(count(gallery, /<details class="oa-whole">/g), 1, `${name} ${key}`);
      }
    }
    // Every work the wall doesn't hang is still in its bay, in the closed checklist.
    for (const [id, bay] of model.bays) {
      for (const each of bay.hung.slice(onWall(model).get(id))) {
        assert.match(markup, new RegExp(`<tr id="[^"]*${each.work.id}"`), each.work.id);
      }
    }
  }
});

test('At a glance is one wall label in sentences, the figure leading each', () => {
  const entry = {
    id: 'services',
    type: 'metric' as const,
    statement: 'Services owned',
    description: 'Across three platform teams',
    metric: { key: 'services', value: 38 },
  };
  assert.equal(glanceSentence(entry, '38'), '38 services owned, across three platform teams.');
  assert.equal(
    glanceSentence(
      {
        id: 'tenure',
        type: 'metric',
        statement: 'Years engineering',
        metric: { value: 12, unit: 'years' },
      },
      '12',
    ),
    '12 years engineering.',
  );
  assert.equal(
    glanceSentence(
      {
        id: 'mttd',
        type: 'metric',
        statement: 'Mean time to detect',
        metric: { value: 3, unit: 'minutes' },
      },
      '3',
    ),
    '3 minutes mean time to detect.',
  );
  // The unit is the owner's free text: a pattern's characters are only text, never a crash.
  for (const unit of ['+', '?', '*', '[', '(', '\\']) {
    const sentence = glanceSentence(
      { id: 'u', type: 'metric', statement: 'Contributors', metric: { value: 40, unit } },
      '40',
    );
    assert.equal(sentence, `40 ${unit} contributors.`);
  }
  // A claim that starts with its unit as a word doesn't say it twice; one that only starts with its letters does.
  const claim = (statement: string, unit: string) =>
    glanceSentence({ id: 'c', type: 'metric', statement, metric: { value: 2, unit } }, '2');
  assert.equal(claim('Years at the company', 'years'), '2 years at the company.');
  assert.equal(claim('Yearslong projects', 'years'), '2 years yearslong projects.');
  // And the home page renders a unit of "+" on its server.
  const input = portfolioInput({
    ...GALLERY,
    evidence: [
      {
        id: 'plus',
        type: 'metric',
        statement: 'Contributors',
        metric: { key: 'plus', value: 40, unit: '+' },
      },
    ],
    sections: [
      ...GALLERY.sections,
      { kind: 'evidence', id: 'glance', title: 'At a glance', items: ['plus'] },
    ],
  });
  assert.match(text(html(input)), /40 \+ contributors\./);
});

test("the exit wall's label is Contact's call to work together, and Contact doesn't hang it again (OA-S10)", () => {
  const input = portfolioInput({
    ...GALLERY,
    identity: { ...GALLERY.identity, email: 'rowan@example.test' },
    sections: [
      ...GALLERY.sections,
      { kind: 'quote', id: 'words', text: 'Make the thing, then the case for it.' },
      {
        kind: 'cta',
        id: 'together',
        title: 'Want to work together?',
        description: 'Two engagements a quarter.',
        primaryAction: { label: 'Email me', url: 'mailto:rowan@example.test' },
      },
      { kind: 'contact', id: 'contact', title: 'Get in touch' },
    ],
  });
  const label = atelierModel(input).exitLabel;
  assert.equal(label?.id, 'together');
  const markup = html(input);
  const exit = markup.slice(markup.indexOf('class="oa-exit oa-wall"'));
  const wall = exit.slice(0, exit.indexOf('class="oa-wallfloor"'));
  const frame = new RegExp(`data-section-id="${label.id}"`, 'g');
  assert.equal(count(wall, frame), 1);
  assert.equal(count(markup, frame), 1);
});

test('the plan is drawn in wings, a row each: the entrance and the rooms, the collection and writing, Practice and Record, Contact (C6)', () => {
  const footer = plan(html(fixtureInput('complete')));
  const wings = count(footer, /<li class="oa-plan__wing"><ol class="oa-plan__rooms" role="list">/g);
  assert.ok(wings >= 3 && wings <= 4, `${wings} wings`);
  // No room sits outside a wing.
  assert.doesNotMatch(footer, /data-oa-plan=""><li class="oa-plan__room/);
  assert.ok(count(footer, /class="oa-plan__room[ "]/g) > 0);
});

test('a series titled as its bay names itself once on the wall: the caption shows its kind, a reader hears the title', () => {
  const captionOf = (markup: string) => {
    const bay = markup.slice(markup.indexOf('data-section-id="pictures"'));
    const start = bay.indexOf('<p class="oa-caption"');
    return bay.slice(start, bay.indexOf('</p>', start));
  };
  const sections = GALLERY.sections.map((section) =>
    section.id === 'pictures' ? { ...section, title: 'A series' } : section,
  );
  assert.match(
    captionOf(html(portfolioInput({ ...GALLERY, sections }))),
    /<span class="oa-visually-hidden">A series, <\/span>Photographs/,
  );
  // Titled otherwise, the caption says the title.
  const plain = captionOf(html(portfolioInput(GALLERY)));
  assert.doesNotMatch(plain, /oa-visually-hidden/);
  assert.match(text(plain), /^A series/);
});

test('the copy says each thing once (P1-6): one Then Contact, one name for the CV, the rooms counted as the heads count them', () => {
  const input = sampleInput();
  const model = atelierModel(input);
  const markup = html(input);
  const words = text(markup);
  // The record's floor leads to the last word, whose own floor says Then Contact, once.
  assert.equal(words.match(/Then Contact/g)?.length, 1);
  assert.match(galleryMarkup(markup, 'record'), /Then the last word/);
  // The CV goes by the exit wall's name alone.
  assert.match(words, /Download CV/);
  assert.doesNotMatch(galleryMarkup(markup, 'contact'), />Resume</);
  // The colophon counts every room the heads count.
  assert.match(words, new RegExp(`in ${model.roomCount} rooms`));
  assert.match(words, new RegExp(`Room I of ${roman(model.roomCount)}`));
  // A sheet says what the owner did when "Writing" would only repeat its bay; a series its bay names says Episode.
  assert.doesNotMatch(markup, /class="oa-sheet__kind"[^>]*>Writing</);
  assert.match(markup, /class="oa-sheet__kind"[^>]*>Curriculum author</);
  assert.doesNotMatch(markup, /class="oa-sleeve__series"[^>]*>Incident History</);
  assert.match(markup, /class="oa-sleeve__series"[^>]*>(<[^>]+>)*Episode</);
});

test("a title-size link's box reaches under its hanging rule, so the focus ring's foot passes under it (the contact address, 1440 focus perimeter on 85b2807c8)", () => {
  for (const selector of ['.oa-roomtitle a', '.oa-address a']) {
    const at = CSS.indexOf(`[data-variant='obsidian-atelier'] ${selector} {`);
    assert.ok(at >= 0, selector);
    const body = CSS.slice(at, CSS.indexOf('}', at));
    assert.match(body, /padding-block-end: var\(--layout-underline\);/, selector);
  }
  // The rule hangs that far: the links' underline offset is the same length.
  assert.match(
    CSS,
    /\] a \{\s*color: inherit;[^}]*text-underline-offset: var\(--layout-underline\);/,
  );
});

test('with no script the entrance is there at once: nothing in it waits at opacity 0 or unveiled, and no scripting query', () => {
  // The no-JavaScript rows audit with script on for axe, which a scripting query would flip.
  assert.doesNotMatch(CSS, /@media[^{]*\bscripting\b/);
  // The page says it was read with no script by an element only the parser makes, in <noscript>.
  assert.match(
    html(sampleInput()),
    /<main [^>]*class="oa-main"[^>]*><noscript><i data-oa-nojs=""><\/i><\/noscript>/,
  );
  // The mark is never a box, nor a cell of the main's layout.
  assert.match(CSS, /\.oa-main > :has\(> \[data-oa-nojs\]\) \{\s*display: none;/);
  // Each rule that plays the entrance's keyframes plays them only where the mark isn't.
  const entrance = ['obsidian-atelier-light', 'obsidian-atelier-unveil', 'obsidian-atelier-settle'];
  let uses = 0;
  for (const name of entrance)
    for (const use of CSS.matchAll(new RegExp(`animation(?:-name)?:[^;]*\\b${name}\\b`, 'g'))) {
      uses++;
      const prelude = CSS.slice(CSS.lastIndexOf('}', use.index!) + 1, use.index!);
      assert.match(
        prelude,
        /\.oa-main:not\(:has\(> \* > \[data-oa-nojs\]\)\)/,
        `${name}: ${prelude}`,
      );
    }
  assert.ok(uses >= 3, `${uses}`);
});

test('print opens every fold and keeps the chrome once: Index static, the marker and its strip not printed', () => {
  const print = CSS.slice(CSS.indexOf('@media print'));
  assert.match(print, /\.oa-chrome, \.oa-chrome__pin\) \{\s*position: static;/);
  // As specific as the screen's marker and strip, and after them, so print wins.
  assert.match(
    print,
    /\[data-variant='obsidian-atelier'\]\s+\.oa-chrome\[data-oa-deep\]\s+:is\(\.oa-chrome__here, \.oa-chrome__strip\) \{\s*display: none;/,
  );
  assert.ok(
    CSS.indexOf('@media print') > CSS.indexOf('.oa-chrome[data-oa-deep] .oa-chrome__strip {'),
  );
  // Every fold opens on paper, by element, so each of the page's fold classes is covered.
  assert.match(
    print,
    /\[data-variant='obsidian-atelier'\] details::details-content \{\s*block-size: auto;/,
  );
  const markup = html(sampleInput());
  for (const fold of new Set(
    [...markup.matchAll(/<details class="([\w-]+)"/g)].map(([, name]) => name),
  )) {
    assert.ok(
      ['oa-unfold', 'oa-checklist', 'oa-whole'].includes(fold!),
      `${fold} is a fold print opens`,
    );
  }
  assert.ok(
    count(markup, /<details class="oa-whole">/g) >= 2,
    'the whole practice and the whole record',
  );
  // But the visitor's Appearance control isn't a fold of the page: its panel stays closed on
  // paper, past the rule above, or its form widens the top row's corner over the room switch.
  assert.match(
    print,
    /\[data-variant='obsidian-atelier'\] \.oa-chrome__appearance details::details-content \{\s*content-visibility: hidden;/,
  );
});

test("the floor's words are all the primary ink, which the floor holds at 4.5:1 (N1), and a vitrine draws no column no row fills (N2)", () => {
  assert.match(
    CSS,
    /:is\(\.oa-entrance__statement, \.oa-installation__title\)\s+:is\(\.oa-no, p\) \{\s*color: var\(--color-text-primary\);/,
  );
  // Nothing on the case's title band asks for the secondary ink.
  for (const rule of CSS.matchAll(/([^{}]*\.oa-installation__(?:title|lede)[^{}]*)\{([^}]*)\}/g)) {
    assert.doesNotMatch(rule[2]!, /--color-text-secondary/, rule[1]!.trim());
  }
  const markup = html(sampleInput());
  assert.doesNotMatch(markup, /<td><\/td><td class="oa-checktable__when"><\/td>/);
  assert.doesNotMatch(markup, /<td class="oa-checktable__when"><\/td><\/tr>/);
});
