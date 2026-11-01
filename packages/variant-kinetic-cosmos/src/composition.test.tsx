import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PresentationBoundary } from '@portfolio/appearance/react';
import { contrast, mix, PLATFORM_DEFAULTS } from '@portfolio/appearance';
import { caseStudyOutline, pageOutline, renderContext } from '@portfolio/kit/sections';
import { resolvePortfolioView, type ParsedPair } from '@portfolio/schema';
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
import KineticCosmos, { sections } from '.';
import { FACT_PARTS, STOP_WORDS } from './flight-rail';
import { hashId, namesFold } from './fold';
import { orbitGeometry, starField } from './geometry';
import { cosmosModel, countLabel, ringIntro, ringLegend } from './model';
import { FAR_STARS, NEAR_STARS } from './orrery';
import { atPlayhead } from './renderers/chronology';
import { splitThesis } from './renderers/practice';
import { Runtime } from './runtime';
import { currentStop } from './tracking';

// Kinetic Cosmos as an orrery (redesign, stream E): its manifest renders
// every core kind, and its home page is the opening stage, the rings, and
// the closing stage, each section in exactly one of them, in frames of its
// own, with a navigation of at most five destinations, an index of every
// section, nothing hidden reaching it, every id under the boundary's
// prefix, and its motion only on the runtime, inside the no-preference
// query.

// tsx compiles JSX to React.createElement calls, so the test supplies React.
Object.assign(globalThis, { React });

const PACKAGE = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const RAW = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
const REPO = fileURLToPath(new URL('../../../', import.meta.url));

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

test("its manifest validates with nothing to report, holds the catalog's pins, and renders every core kind", () => {
  const result = validateManifest(RAW, { packageName: PACKAGE.name, exports: PACKAGE.exports });
  assert.ok(result.ok, JSON.stringify(result.diagnostics));
  assert.deepEqual(result.diagnostics, []);
  const { manifest } = result;
  assert.equal(manifest.id, 'kinetic-cosmos');
  assert.deepEqual(
    [manifest.compositionFamily, manifest.motionIntent, manifest.performanceTier],
    ['kinetic', 'kinetic', 'medium'],
  );
  assert.deepEqual([...manifest.renderedKinds].sort(), [...CORE_KINDS].sort());
  assert.deepEqual(Object.keys(sections.renderers).sort(), [...CORE_KINDS].sort());
  assert.deepEqual(manifest.unsupportedKinds, []);
  assert.deepEqual(manifest.textDirection, ['ltr', 'rtl']);
  // The medium tier's ceilings: three animations, 15 KB of CSS, 90 KB of JS.
  assert.ok((manifest.budgets?.animation ?? 0) <= 3);
  assert.ok((manifest.budgets?.css ?? 0) <= 15360);
  assert.deepEqual(PACKAGE.portfolio, { kind: 'variant', manifest: './manifest.json' });
  assert.match(PACKAGE.scripts.test, /tsx --test/);
});

const MANIFEST = (() => {
  const result = validateManifest(RAW, { packageName: PACKAGE.name });
  assert.ok(result.ok);
  return result.manifest as VariantManifest;
})();

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

/** The render input of a contract fixture, as the host builds it. */
function fixtureInput(name: string, idPrefix = ''): VariantRenderInput {
  const read = readPair(contractFixture(name).files);
  assert.ok(read.ok, JSON.stringify(read));
  return inputOf(read.pair, idPrefix);
}

/** The bundled sample's render input. */
function sampleInput(idPrefix = ''): VariantRenderInput {
  const read = readPair({
    portfolio: `${REPO}portfolio.example.yml`,
    site: `${REPO}site.example.yml`,
  });
  assert.ok(read.ok, JSON.stringify(read));
  return inputOf(read.pair, idPrefix);
}

const html = (input: VariantRenderInput) => renderToStaticMarkup(<KineticCosmos input={input} />);
const count = (markup: string, pattern: RegExp) => markup.match(pattern)?.length ?? 0;
const ids = (markup: string) => [...markup.matchAll(/\sid="([^"]+)"/g)].map(([, id]) => id!);

test('the sample opens on one stage: the masthead, the orrery, the thesis as the one h1, and the band', () => {
  const markup = html(sampleInput());
  assert.equal(count(markup, /<main\b/g), 1);
  assert.equal(count(markup, /<h1\b/g), 1);
  assert.equal(count(markup, /data-visitor-control-slot/g), 1);
  assert.ok(markup.indexOf('<header class="kc-masthead"') < markup.indexOf('<main'));
  // The thesis's first sentence is the h1, its last word stepped, and the rest the standfirst.
  const h1 = /<h1 class="kc-thesis">([\s\S]*?)<\/h1>/.exec(markup)?.[1] ?? '';
  assert.match(
    h1,
    /^<span class="kc-thesis__line">(?:<span[^>]*>)?I make failure(?:<\/span>)?<\/span> /,
  );
  assert.match(
    h1,
    /<span class="kc-thesis__line kc-thesis__line--stepped">(?:<span[^>]*>)?legible\.(?:<\/span>)?<\/span>$/,
  );
  assert.match(markup, /kc-standfirst"[^>]*>[\s\S]*?The systems I build/);
  // The orrery is decoration, and the one signature sits on its core.
  assert.match(markup, /<div class="kc-map__frame" dir="ltr" aria-hidden="true">/);
  assert.equal(count(markup, /class="kc-core"/g), 1);
  // Nothing is hidden or faded in the server's markup.
  assert.doesNotMatch(markup, /\shidden=""|visibility:\s*hidden|opacity:\s*0/);
});

test("the sample's sections sit on the mockup's rings, in the mockup's order", () => {
  const input = sampleInput();
  const model = cosmosModel(pageOutline(input), input);
  assert.deepEqual(
    model.opening.map(({ id }) => id),
    ['top', 'thesis'],
  );
  assert.deepEqual(
    model.rings.map(({ key, sections: list }) => [key, list.map(({ id }) => id)]),
    [
      ['work', ['work-showcase', 'on-github', 'engagements']],
      ['writing', ['essays', 'incident-history', 'talks', 'publications', 'press']],
      [
        'record',
        [
          'about',
          'at-a-glance',
          'experience',
          'education',
          'words-from-collaborators',
          'awards',
          'patents',
          'skills',
          'stack-i-currently-reach-for',
        ],
      ],
      [
        'personal',
        [
          'now',
          'currently-focused-on',
          'looking',
          'listening-a-small-experiment',
          'off-the-page',
          'quote',
          'elsewhere',
        ],
      ],
    ],
  );
  assert.deepEqual(
    model.closing.map(({ id }) => id),
    ['contact', 'want-to-work-together'],
  );
  const ctx = renderContext(input, { id: 'kc' }, 2);
  // The legend says what a visitor recognises, derived by meaning (review round 2, must-fix 4).
  assert.deepEqual(
    model.rings.map((ring) => ringLegend(ring, input, ctx)),
    [
      '3 projects',
      '3 essays, a podcast, and 3 talks',
      '12 years, 3 roles, and 2 degrees',
      'Now, photographs, and an EP',
    ],
  );
  assert.deepEqual(
    model.rings.map((ring) => ringIntro(ring, input, ctx)),
    [
      'Postmortem Template Kit, small-traces, and chaos-curriculum, with two ways to work together.',
      'Three essays, the Incident History podcast, three talks, two papers, and what the press wrote.',
      'Twelve years in figures, three roles, two degrees, words from three collaborators, two awards, a patent, and the skills and tools behind it.',
      "What's happening now, the current focus, photographs, an EP, a few facts off the page, and two homes elsewhere.",
    ],
  );
  for (const ring of model.rings) {
    assert.doesNotMatch(
      ringLegend(ring, input, ctx) ?? '',
      /\b(?:items?|entries|entry|figures?|groups?|pieces?|offers?)\b/,
      ring.key,
    );
  }
  const byId = new Map(input.portfolio.sections.map((section) => [section.id, section]));
  assert.equal(countLabel(byId.get('listening-a-small-experiment')!, input, ctx), '6 tracks');
  assert.equal(countLabel(byId.get('words-from-collaborators')!, input, ctx), '3 people');
});

test('on every contract fixture, every section the outline lists renders once, in a frame of its own, bespoke', () => {
  for (const { name } of CONTRACT_FIXTURES) {
    const input = fixtureInput(name);
    const markup = html(input);
    const outline = pageOutline(input, sections);
    for (const section of outline.sections) {
      const frames = count(markup, new RegExp(`data-section-id="${section.id}"`, 'g'));
      assert.equal(frames, 1, `${name}: ${section.id} has ${frames} frames`);
    }
    assert.doesNotMatch(markup, /data-renderer="shared"/, name);
    assert.equal(count(markup, /<h1\b/g), 1, name);
    // Every fragment link lands.
    const all = new Set(ids(markup));
    for (const [, href] of markup.matchAll(/href="#([^"]+)"/g)) {
      assert.ok(all.has(href!), `${name}: #${href} has no target`);
    }
  }
});

test('the home outline: the Record ring shows its summary, and the rest of the record sits in closed disclosures', () => {
  const markup = html(sampleInput());
  const section = (id: string) => {
    const at = markup.indexOf(`id="${id}"`);
    assert.ok(at > 0, id);
    return markup.slice(at, markup.indexOf('</section>', at));
  };
  // The summary: open, no disclosure.
  // (About folds its tail on a phone, inside itself: the section stays open.)
  for (const id of ['about', 'at-a-glance']) {
    assert.doesNotMatch(section(id), /<details class="kc-fold"><summary/, id);
  }
  // The rest, the roles and the words of others too (KIN-4): each a closed disclosure, its
  // title in the summary, and what it holds inside, whole.
  for (const id of [
    'experience',
    'education',
    'words-from-collaborators',
    'awards',
    'patents',
    'skills',
  ]) {
    assert.match(section(id), /<details class="kc-fold"><summary/, id);
  }
  // Inside its fold, Experience still shows the playhead and the latest role, its earlier ones folded (P2).
  const roles = section('experience');
  assert.match(roles, /class="kc-playhead"/);
  const earlier = roles.indexOf(
    '<details class="kc-fold kc-fold--inline kc-fold--earlier"><summary',
  );
  assert.ok(earlier > 0 && roles.indexOf('class="kc-entry"') < earlier, 'the latest role shows');
  // Inside its fold, the words of others lead with one quotation, the rest in a wrapper, so a link
  // to the section doesn't open them: only a link inside does (L1).
  const words = section('words-from-collaborators');
  assert.match(
    words,
    /<div class="kc-evidence__more"><details class="kc-fold kc-fold--inline kc-fold--earlier">/,
  );
  assert.equal(count(words, /class="kc-quote/g) > 0, true);
  // Personal opens on its Now; everything after it, the focus list that repeats it first, is folded.
  assert.doesNotMatch(section('now'), /<details class="kc-fold"><summary/);
  for (const id of [
    'currently-focused-on',
    'looking',
    'listening-a-small-experiment',
    'elsewhere',
  ]) {
    assert.match(section(id), /<details class="kc-fold"><summary/, id);
  }
  // Every other ring closes its record-like tail: the repositories, the talks and papers, and the work elsewhere.
  for (const each of sampleInput().portfolio.sections.filter((entry) => entry.kind === 'github')) {
    assert.match(section(each.id), /<details class="kc-fold"><summary/, each.id);
  }
});

test('persistent navigation holds at most five destinations; the index holds every titled section', () => {
  const input = sampleInput();
  const markup = html(input);
  const plates = markup.slice(
    markup.indexOf('<nav class="kc-plates"'),
    markup.indexOf('</nav>', markup.indexOf('<nav class="kc-plates"')),
  );
  // The four rings, and the closing's Contact on the dock's own href.
  assert.equal(count(plates, /<a\b/g), 5);
  assert.match(
    plates,
    /<li class="kc-plate kc-plate--closing"[^>]*><a class="kc-plate__link" href="#contact">/,
  );
  const dock = markup.slice(markup.indexOf('<nav class="kc-dock"'));
  assert.equal(count(dock.slice(0, dock.indexOf('</nav>')), /class="kc-dock__stop"/g), 5);
  // The index's dialog, not a talk's.
  const at = markup.search(/<dialog[^>]*class="kc-index"/);
  assert.ok(at >= 0);
  const index = markup.slice(at, markup.indexOf('</dialog>', at));
  const model = cosmosModel(pageOutline(input), input);
  const titled = [...model.rings.flatMap((ring) => ring.sections), ...model.closing].filter(
    (section) => section.title?.trim(),
  );
  for (const section of titled)
    assert.match(index, new RegExp(`href="${section.href}"`), section.id);
  // No bar of section links in the masthead.
  const masthead = markup.slice(0, markup.indexOf('</header>'));
  assert.equal(count(masthead, /<a\b/g), 1);
});

test("on the motion contract's own fixture the first nav link to #contact shows on arrival: the plates', not the hidden dock's", () => {
  const motion = readPair({
    portfolio: `${REPO}tests/fixtures/motion/portfolio.yml`,
    site: `${REPO}tests/fixtures/motion/site.yml`,
  });
  assert.ok(motion.ok, JSON.stringify(motion));
  const home = html(inputOf(motion.pair));
  assert.match(home, /\sid="contact"/);
  const navs = [...home.matchAll(/<nav\b[^>]*>[\s\S]*?<\/nav>/g)].map((each) => each[0]);
  const first = navs.find((nav) => /href="#contact"/.test(nav));
  assert.ok(first, 'a nav link to #contact');
  const open = /^<nav[^>]*>/.exec(first)![0];
  assert.doesNotMatch(open, /class="kc-dock/);
  assert.match(open, /^<nav class="kc-plates"/);
  assert.doesNotMatch(open, /\bhidden\b|inert/);
});

test('a hidden section never reaches the page: none of its words, ids, or links', () => {
  const markup = html(fixtureInput('hidden-canary'));
  assert.doesNotMatch(markup, new RegExp(HIDDEN_CANARY));
});

test('in a plate it renders the same, every id under the plate prefix and none repeated, and no runtime', () => {
  const input = fixtureInput('complete', 'pl-');
  const { displayMode, ...packs } = PLATFORM_DEFAULTS;
  const selection = { ...packs, variant: 'kinetic-cosmos', displayMode };
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
        <KineticCosmos input={input} />
      </PresentationBoundary>,
    );
    assert.deepEqual(calls, [], 'runtime hooks called in a plate');
    html(fixtureInput('complete'));
    documentCalls = calls.length;
  } finally {
    Runtime.useEnhancementRuntime = hook;
  }
  // Outside a plate, the stage is the one thing on the runtime.
  assert.equal(documentCalls, 1, 'runtime hooks outside a plate');
  const all = ids(plate);
  assert.ok(all.length > 10);
  assert.deepEqual(
    all.filter((id) => !id.startsWith('pl-')),
    [],
  );
  assert.equal(new Set(all).size, all.length, 'no id repeats');
  assert.doesNotMatch(plate, /data-(?:kit-)?runtime|data-motion-control/);
});

test('the pause sits on the stage band, unless the site reduces motion', () => {
  const input = sampleInput();
  assert.match(html(input), /class="kc-pause"[\s\S]*?data-motion-control[\s\S]*?Pause motion/);
  const reduced = {
    ...input,
    presentation: { ...input.presentation, motionPolicy: 'reduce' as const },
  };
  assert.doesNotMatch(html(reduced), /data-motion-control/);
});

test('the orrery is bounded: a fixed star field, at most four orbits, the same for the same seed', () => {
  assert.deepEqual(starField(7, NEAR_STARS, 100, 100), starField(7, NEAR_STARS, 100, 100));
  assert.ok(NEAR_STARS + FAR_STARS * 2 <= 150);
  assert.equal(orbitGeometry([3, 5, 9, 7, 2]).length, 4);
  for (const orbit of orbitGeometry([3, 5, 9, 7])) {
    assert.ok(orbit.anchor.x > orbit.start.x, 'each leader runs from its plate to its body');
  }
});

test('the thesis splits at its first sentence', () => {
  assert.deepEqual(splitThesis('I make failure legible. The rest follows.'), {
    head: 'I make failure legible.',
    rest: 'The rest follows.',
  });
  assert.deepEqual(splitThesis('One sentence only'), { head: 'One sentence only' });
});

/** Every rule of the stylesheet, comments gone. */
const CSS = readFileSync(new URL('./styles.css', import.meta.url), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
);

test('the motion runs only inside no-preference, on the runtime, three infinite transforms on the ambient cycle', () => {
  const start = CSS.indexOf('@media (prefers-reduced-motion: no-preference)');
  assert.ok(start > 0);
  // Every rule that animates, by the shorthand or the longhands, and the ones that never stop (code review L2).
  const animated = [...CSS.matchAll(/([^{}]+)\{([^{}]*\banimation(?:-[a-z-]+)?\s*:[^{}]*)\}/g)];
  const infinite = animated.filter(([, , body]) =>
    /\banimation(?:-iteration-count)?\s*:[^;]*\binfinite\b/.test(body!),
  );
  assert.equal(infinite.length, 3);
  for (const match of infinite) {
    assert.ok(match.index! > start, 'inside the no-preference query');
    // Under the kit runtime's own gate, which only the kit sets (motion-gate, K-4).
    assert.match(match[1]!, /\.kc-opening\[data-kit-runtime\]\s/);
    assert.match(match[1]!, /:not\(\[data-motion='reduced'\], \[data-motion='static'\]\)/);
    // Each loop's cycle is the ambient slot, never a multiplied token, and it reads the ambient state (K-4 b, R4-L2).
    assert.match(match[2]!, /var\(--motion-ambient\)/);
    assert.doesNotMatch(match[2]!, /\*/);
    assert.match(match[2]!, /animation-play-state:\s*var\(--motion-ambient-state\)/);
  }
  const keyframes = [...CSS.matchAll(/@keyframes ([\w-]+)\s*\{([\s\S]*?\})\s*\}/g)];
  for (const [, name, frames] of keyframes) {
    assert.match(name!, /^kinetic-cosmos-/);
    const properties = [...frames!.matchAll(/([a-z-]+)\s*:/g)].map(([, property]) => property);
    // transform alone, on a plain box, so the compositor runs it (code review M1).
    for (const property of properties) assert.match(property!, /^transform$/, name);
  }
});

test('each border token is used whole, as the border it is, never as a width', () => {
  const uses = [...CSS.matchAll(/([a-z-]+)\s*:([^;{}]*var\(--ui-border-[^;{}]*)/g)];
  assert.ok(uses.length >= 4, `${uses.length} uses`);
  for (const [declaration, property, value] of uses) {
    assert.match(property!, /^border(?:-(?:block|inline)(?:-(?:start|end))?)?$/, declaration);
    assert.match(value!.trim(), /^var\(--ui-border-[a-z]+\)$/, declaration);
  }
});

test("the stage's quiet ink reads at 4.5:1 on its ground in every shipping scheme and mode", () => {
  // The stage is the inverse pair: the text color as the ground and the
  // canvas as the ink, and its quiet ink is 76% of the way from ground to
  // ink. The sRGB mix here stands in for the stylesheet's oklab one.
  const packs = new URL('../../appearance-schemes/packs/', import.meta.url);
  let checked = 0;
  for (const id of readdirSync(packs)) {
    const manifest = JSON.parse(readFileSync(new URL(`${id}/manifest.json`, packs), 'utf8'));
    const anchors = (manifest.anchors ?? {}) as Record<string, { canvas: string; text: string }>;
    for (const [mode, anchor] of Object.entries(anchors)) {
      const quiet = mix(anchor.text, anchor.canvas, 76);
      const ratio = contrast(quiet, anchor.text);
      assert.ok(ratio >= 4.5, `${id} ${mode}: ${ratio}`);
      checked += 1;
    }
  }
  assert.ok(checked > 20, `${checked} sets checked`);
});

test('a fold opens only when the address names its own section or something inside it, and a bad escape never throws', () => {
  // A toy tree: main > the Record ring > Experience's section > its fold > an entry.
  type Toy = { parentElement: Toy | null; contains(other: unknown): boolean };
  const toy = (parent: Toy | null): Toy => {
    const node: Toy = {
      parentElement: parent,
      contains(other) {
        for (let at = other as Toy | null; at; at = at.parentElement) if (at === node) return true;
        return false;
      },
    };
    return node;
  };
  const main = toy(null);
  const ring = toy(main);
  const section = toy(ring);
  const fold = toy(section);
  const entry = toy(fold);
  const other = toy(ring);
  // #main and the ring's own link name an ancestor further out: nothing opens (N1).
  assert.equal(namesFold(fold, main), false);
  assert.equal(namesFold(fold, ring), false);
  // The section's own id, or something inside the fold, opens just this one.
  assert.equal(namesFold(fold, section), true);
  assert.equal(namesFold(fold, entry), true);
  assert.equal(namesFold(fold, other), false);
  assert.equal(namesFold(fold, null), false);
  // A malformed escape decodes as written (N3).
  assert.equal(hashId('#100%'), '100%');
  assert.equal(hashId('#caf%C3%A9'), 'café');
  assert.equal(hashId(''), '');
});

/** A selector's specificity, as [ids, classes and attributes, elements]; :is and :not take their heaviest argument. */
function specificity(selector: string): [number, number, number] {
  const total: [number, number, number] = [0, 0, 0];
  const add = ([a, b, c]: readonly number[]) => {
    total[0] += a!;
    total[1] += b!;
    total[2] += c!;
  };
  let rest = selector.replace(/:where\((?:[^()]|\([^()]*\))*\)/g, '');
  rest = rest.replace(/:(?:is|not|has)\(((?:[^()]|\([^()]*\))*)\)/g, (_, inner: string) => {
    add(inner.split(',').map(specificity).sort(outranks).at(-1)!);
    return ' ';
  });
  const count = (pattern: RegExp, at: 0 | 1 | 2) => {
    rest = rest.replace(pattern, () => {
      total[at] += 1;
      return ' ';
    });
  };
  count(/\[[^\]]*\]/g, 1);
  count(/::[\w-]+/g, 2);
  count(/#[\w-]+/g, 0);
  count(/[.:][\w-]+/g, 1);
  count(/(?<![\w-])[a-z][\w-]*/gi, 2);
  return total;
}

/** Sorts by specificity, lightest first. */
function outranks(a: readonly number[], b: readonly number[]): number {
  return a[0]! - b[0]! || a[1]! - b[1]! || a[2]! - b[2]!;
}

test('held still, the pause control is hidden: each hide rule outranks the outlined control (KC-S8)', () => {
  assert.deepEqual(specificity("[data-variant='x'] .a :is(button, [b='c'])"), [0, 3, 0]);
  assert.deepEqual(specificity('.a button::before'), [0, 1, 2]);
  const rules = [...CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .map((match) => ({
      selector: match[1]!.trim().replace(/\s+/g, ' '),
      body: match[2]!,
      at: match.index!,
    }))
    .filter(
      ({ selector, body }) =>
        /\.kc-pause__control (?:button|\[data-ui-slot='action'\]|:is\()/.test(selector) &&
        !selector.includes('::') &&
        /(?:^|;)\s*display\s*:/.test(body),
    );
  const hides = rules.filter(({ body }) => /display\s*:\s*none/.test(body));
  const shows = rules.filter(({ body }) => !/display\s*:\s*none/.test(body));
  assert.equal(hides.length, 2);
  assert.ok(shows.length >= 1);
  for (const hide of hides) {
    assert.match(hide.selector, /\[data-ui-slot='action'\]/);
    for (const show of shows) {
      const order = outranks(specificity(hide.selector), specificity(show.selector));
      assert.ok(
        order > 0 || (order === 0 && hide.at > show.at),
        `${hide.selector} over ${show.selector}`,
      );
    }
  }
});

/** The render input of a work's own page, as the host builds it. */
function workInput(pair: ParsedPair, slug: string, idPrefix = ''): VariantRenderInput {
  return buildRenderInput({
    view: resolvePortfolioView(pair, {}, { mediaBase: '/media' }),
    manifest: MANIFEST,
    route: { route: 'work', slug },
    basePath: '',
    origin: 'https://rowan.test',
    requestTime: '2026-10-23T12:00:00Z',
    idPrefix,
  });
}

test("a work's own page is the composition's: its title the one h1, its stops in its own words, every link landing (KC-M2)", () => {
  const pairs: Array<[string, ParsedPair]> = [];
  const sample = readPair({
    portfolio: `${REPO}portfolio.example.yml`,
    site: `${REPO}site.example.yml`,
  });
  assert.ok(sample.ok);
  pairs.push(['sample', sample.pair]);
  for (const { name } of CONTRACT_FIXTURES) {
    const read = readPair(contractFixture(name).files);
    assert.ok(read.ok);
    pairs.push([name, read.pair]);
  }
  let pages = 0;
  for (const [name, pair] of pairs) {
    const view = resolvePortfolioView(pair, {}, { mediaBase: '/media' });
    for (const work of view.portfolio.works) {
      if (work.caseStudy === undefined || work.slug === undefined) continue;
      const input = workInput(pair, work.slug);
      const outline = caseStudyOutline(input);
      assert.ok(outline, `${name}/${work.slug}`);
      const markup = html(input);
      const where = `${name}/${work.slug}`;
      pages += 1;
      // Its own markup: no kit case study, no shared renderer, and the title as the one h1.
      assert.doesNotMatch(markup, /pf-case-study|data-renderer="shared"/, where);
      const h1 = [...markup.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/g)];
      assert.equal(h1.length, 1, where);
      assert.equal(
        h1[0]![1]!
          .replace(/<[^>]+>/g, '')
          .replaceAll('&amp;', '&')
          .replaceAll('&#x27;', "'"),
        work.title,
        where,
      );
      assert.match(markup, new RegExp(`data-work-id="${work.id}"`), where);
      // The case's setting reads as rows of the fact sheet at their anchors, and the rest as
      // bodies of their own, each in the composition's words (KC-M2); its stops ride an arc.
      for (const part of outline.parts) {
        const pattern = FACT_PARTS.has(part.key)
          ? `<div id="${part.anchor}" class="kc-facts__row"><dt[^>]*>${STOP_WORDS[part.key]}</dt>`
          : `<section id="${part.anchor}"[^>]*>\\s*(?:<span[^>]*></span>)?\\s*<h2[^>]*>(?:<span[^>]*></span>)?${STOP_WORDS[part.key]}</h2>`;
        assert.match(markup, new RegExp(pattern), `${where}: ${part.key}`);
      }
      if (outline.parts.length > 0) {
        assert.match(markup, /<div class="kc-arc kc-flight"/, where);
        assert.doesNotMatch(markup, /kc-stop__title|kc-flight__rail/, where);
      }
      if (outline.parts.some((part) => part.key === 'decisions')) {
        assert.match(markup, /<table class="kc-decisions">/, where);
      }
      // Every id once, and every fragment link lands.
      const all = ids(markup);
      assert.equal(new Set(all).size, all.length, `${where}: a repeated id`);
      for (const [, href] of markup.matchAll(/href="#([^"]+)"/g)) {
        assert.ok(all.includes(href!), `${where}: #${href} has no target`);
      }
      // The way back reaches home.
      assert.match(markup, new RegExp(`<a href="${outline.home}"`), where);
    }
  }
  assert.ok(pages >= 2, `${pages} case pages`);
  // No stop is headed in a template's words.
  for (const words of Object.values(STOP_WORDS)) {
    assert.doesNotMatch(
      words,
      /^(?:Challenge|Context|Role|Constraints|Decisions|Evidence|Outcomes|Reflection)$/,
    );
  }
});

test('with no script a section link shows only its own fold, and print and no script read every dialog inline', () => {
  // The child combinator: a link to #main targets an ancestor of every fold and must open none (T1).
  const noScript = CSS.slice(CSS.indexOf('@media (scripting: none) {'));
  assert.match(noScript, /:target > details\.kc-fold > :not\(summary\)\s*\{\s*display: block;/);
  assert.match(noScript, /:target > details\.kc-fold::details-content\s*\{/);
  assert.doesNotMatch(CSS, /:target\s+details\.kc-fold|:target\s+:is\(/);
  // A printed page holds the whole record: a dialog's content too (M1).
  const inline =
    /@media \(scripting: none\), print \{\s*\[data-variant='kinetic-cosmos'\] \.kc-talk-dialog \{([^}]*)\}/.exec(
      CSS,
    );
  assert.ok(inline, 'one rule for no script and print');
  assert.match(inline[1]!, /display: grid;/);
  assert.match(inline[1]!, /position: static;/);
  // In the page's ink, so its text and its focus ring read on the page, not the stage (L2).
  assert.match(inline[1]!, /--layout-ink: var\(--color-text-primary\);/);
});

test('the dock is at the stop under its line, else the last passed; a row of stops is one place, the named one or its first (review M1)', () => {
  const line = 320;
  // Stacked stops: under the line, between two, above the first.
  const stacked = [
    { top: -400, bottom: 100 },
    { top: 200, bottom: 600 },
    { top: 700, bottom: 900 },
  ];
  assert.equal(currentStop(stacked, line), 1);
  assert.equal(
    currentStop(
      stacked.map((box) => ({ top: box.top - 300, bottom: box.bottom - 300 })),
      line,
    ),
    1,
  );
  assert.equal(
    currentStop(
      stacked.map((box) => ({ top: box.top + 800, bottom: box.bottom + 800 })),
      line,
    ),
    -1,
  );
  // A case's last three stops in one row from 64rem, after the decisions above them.
  const row = [
    { top: -300, bottom: -20 },
    { top: 12, bottom: 400 },
    { top: 12, bottom: 400 },
    { top: 12, bottom: 400 },
  ];
  assert.equal(currentStop(row, line), 1, 'the row reads as its first');
  assert.equal(currentStop(row, line, 2), 2, 'the stop the address names');
  assert.equal(currentStop(row, line, 3), 3);
  assert.equal(currentStop(row, line, 0), 1, 'a name outside the row is no help');
  // Past the row, scrolling either way, it's the same place.
  const past = row.map((box) => ({ top: box.top - 500, bottom: box.bottom - 500 }));
  assert.equal(currentStop(past, line), 1);
  assert.equal(currentStop(past, line, 2), 2);
});

/** The declarations of the rule whose selector is exactly `selector`, inside `within` (the whole sheet by default). */
function ruleBody(selector: string, within = CSS): string | undefined {
  for (const [, head, body] of within.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (head!.trim().replace(/\s+/g, ' ') === selector) return body;
  }
  return undefined;
}

test("an offer's What it includes sits at its terms' start, not centred across the column (KIN-8)", () => {
  const body = ruleBody("[data-variant='kinetic-cosmos'] .kc-offer .kc-object__more");
  assert.ok(body, 'a rule for the offer’s button');
  assert.match(body, /justify-self: start;/);
  assert.match(body, /text-align: start;/);
});

test('a work set in type starts at its row’s top, as the plate beside it does, never centred on it (KIN-1)', () => {
  assert.doesNotMatch(CSS, /\.kc-work--type\s*\{[^}]*align-self/);
  assert.doesNotMatch(CSS, /\.kc-works\s*\{[^}]*align-items:\s*center/);
});

test('At a glance’s four bodies sit two by two on a phone, not four across (KIN-3)', () => {
  // The sample's At a glance is a set of four figures.
  const markup = html(sampleInput());
  const at = markup.indexOf('id="at-a-glance"');
  const glance = markup.slice(at, markup.indexOf('</section>', at));
  assert.equal(count(glance, /class="kc-planet"/g), 4);
  // Four sit two by two at every width, by a rule that outranks the phone's one row.
  const four =
    "[data-variant='kinetic-cosmos'] .kc-planets:not(.kc-planets--row):has(> :nth-child(4):last-child)";
  assert.match(ruleBody(four) ?? '', /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
  // And no other rule, the phone's included, sets four of them any other way.
  for (const [, head, body] of CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (/:nth-child\(4\):last-child/.test(head!) && /grid-template-columns/.test(body!)) {
      assert.match(body!, /repeat\(2, minmax\(0, 1fr\)\)/, head!.trim());
    }
  }
});

test('under the playhead, each running thread shows its current entry, and only finished ones fold (KIN-5)', () => {
  type Row = Parameters<typeof atPlayhead>[0][number];
  const row = (id: string, lane: number, start: string, end?: string): Row => ({
    lane,
    entry: {
      id,
      kind: 'role',
      title: id,
      period: end ? { start, end } : { start },
    } as Row['entry'],
  });
  const ids = (rows: readonly Row[]) => rows.map(({ entry }) => entry.id);
  // Newest first by start: a side project began after the current role.
  const podcast = row('podcast', 1, '2023-09');
  const principal = row('principal', 0, '2023-04');
  const senior = row('senior', 0, '2018-08', '2023-03');
  const assistant = row('assistant', 2, '2014-08', '2016-06');
  const split = atPlayhead([podcast, principal, senior, assistant]);
  assert.deepEqual(ids(split.shown), ['podcast', 'principal']);
  assert.deepEqual(ids(split.earlier), ['senior', 'assistant']);
  // A finished entry newer than a running one folds, and the running one still shows.
  const contract = row('contract', 2, '2024-01', '2024-06');
  assert.deepEqual(ids(atPlayhead([contract, principal, senior]).shown), ['principal']);
  // A thread's older running entry folds behind its current one.
  const older = row('older', 0, '2020-01', 'Present');
  assert.deepEqual(ids(atPlayhead([principal, older, senior]).shown), ['principal']);
  // Nothing running: the newest alone. A short history: whole.
  assert.deepEqual(ids(atPlayhead([senior, assistant, contract]).shown), ['senior']);
  assert.deepEqual(ids(atPlayhead([senior, assistant]).shown), ['senior', 'assistant']);
  // The sample's Experience, once its own fold is open (KIN-4): the current role leads, not under the earlier entries' fold.
  const markup = html(sampleInput());
  const at = markup.indexOf('id="experience"');
  const roles = markup.slice(at, markup.indexOf('</section>', at));
  const fold = roles.indexOf('<details class="kc-fold kc-fold--inline kc-fold--earlier"');
  assert.ok(fold > 0, 'the finished roles fold');
  assert.ok(roles.indexOf('Principal Engineer, Reliability') < fold, 'the current role shows');
  assert.ok(roles.indexOf('Incident History, a podcast') < fold, 'the running project shows');
  assert.match(roles.slice(fold), /2 earlier entries/);
});

test("the next body's cover class is on the grid child that holds the figure, not on its picture (KIN-2)", () => {
  const sample = readPair({
    portfolio: `${REPO}portfolio.example.yml`,
    site: `${REPO}site.example.yml`,
  });
  assert.ok(sample.ok);
  const view = resolvePortfolioView(sample.pair, {}, { mediaBase: '/media' });
  let covers = 0;
  for (const work of view.portfolio.works) {
    if (work.caseStudy === undefined || work.slug === undefined) continue;
    const markup = html(workInput(sample.pair, work.slug));
    const at = markup.indexOf('kc-case-next__cover');
    if (at < 0) continue;
    covers += 1;
    assert.match(
      markup.slice(markup.lastIndexOf('<', at)),
      /^<div class="kc-case-next__cover"><figure class="pf-figure/,
      work.slug,
    );
    assert.doesNotMatch(markup, /<img[^>]*kc-case-next__cover/, work.slug);
  }
  assert.ok(covers > 0, 'a case page with a next body and its cover');
});

test('a writing row keeps its title and facts apart from its words, so a wide ring hangs the words beside them (KIN-6)', () => {
  const markup = html(sampleInput());
  const rows = [...markup.matchAll(/<li[^>]*class="kc-row"[\s\S]*?<\/li>/g)].map(([row]) => row);
  assert.ok(rows.length >= 3, 'the sample has its essays');
  for (const row of rows) {
    const words = row.indexOf('class="kc-row__words"');
    assert.ok(words > row.indexOf('class="kc-row__facts"'), 'the title and facts come first');
    // The standfirst, the excerpt, and the links are the words' part.
    assert.ok(row.indexOf('class="kc-actions"') > words);
  }
});
