import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PresentationBoundary } from '@portfolio/appearance/react';
import { PLATFORM_DEFAULTS } from '@portfolio/appearance';
import { threadLanes } from '@portfolio/kit/timeline';
import { chronologyOf, evidenceOf, present } from '@portfolio/kit/sections';
import { renderInlineMarkdown } from '@portfolio/kit/markdown';
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
import KineticCosmos from '.';
import { Runtime } from './runtime';
import { GLYPHS_PER_LAYER } from './stage';

// Kinetic Cosmos (#14), the still composition: its manifest holds the
// catalog's pins, and it renders the contract fixtures as one main, one h1,
// one visitor control slot, its chrome, the orbital opening, evidence as
// disclosures, and the chronology in its authored lanes, in reading order,
// with nothing hidden reaching it and every id under the boundary's prefix.

// tsx compiles JSX to React.createElement calls, so the test supplies React.
Object.assign(globalThis, { React });

const PACKAGE = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const RAW = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
const { PortfolioSchema } = composeSchemas();

test("its manifest validates with nothing to report, and holds the catalog's pins", () => {
  const result = validateManifest(RAW, { packageName: PACKAGE.name, exports: PACKAGE.exports });
  assert.ok(result.ok, JSON.stringify(result.diagnostics));
  assert.deepEqual(result.diagnostics, []);
  const { manifest } = result;
  assert.equal(manifest.id, 'kinetic-cosmos');
  assert.deepEqual(
    [manifest.compositionFamily, manifest.motionIntent, manifest.performanceTier],
    ['kinetic', 'kinetic', 'medium'],
  );
  assert.deepEqual(manifest.renderedKinds, ['hero', 'evidence', 'chronology']);
  assert.deepEqual(manifest.unsupportedKinds, []);
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

const html = (input: VariantRenderInput) => renderToStaticMarkup(<KineticCosmos input={input} />);
const count = (markup: string, pattern: RegExp) => markup.match(pattern)?.length ?? 0;
const ids = (markup: string) => [...markup.matchAll(/\sid="([^"]+)"/g)].map(([, id]) => id!);

test('the complete fixture renders one main, one h1, one visitor control slot, and the chrome before the main', () => {
  const markup = html(fixtureInput('complete'));
  assert.equal(count(markup, /<main\b/g), 1);
  assert.equal(count(markup, /<h1\b/g), 1);
  assert.equal(count(markup, /data-visitor-control-slot/g), 1);
  assert.ok(markup.indexOf('<header class="kc-chrome"') < markup.indexOf('<main'));
  // The opening's orbit is decoration, and the one signature sits on its core.
  assert.match(markup, /<div class="kc-orbit" aria-hidden="true">/);
  assert.equal(count(markup, /kc-orbit__core/g), 1);
  // Nothing is hidden in the server's markup but the navigation's name, which names it.
  assert.deepEqual(
    [...markup.matchAll(/<[^>]*\shidden=""[^>]*>[^<]*/g)].map(([tag]) => tag),
    ['<span id="kc--sections" hidden="">Sections'],
  );
  // One navigation landmark, which always shows: its links or its menu button.
  assert.equal(count(markup, /<nav\b/g), 1);
  assert.doesNotMatch(markup, /visibility:\s*hidden|opacity:\s*0/);
});

test('every titled section is linked, with no cap, in the bar and again in the menu dialog', () => {
  const input = fixtureInput('complete');
  const titled = input.portfolio.sections.filter(
    (section) => section.kind !== 'hero' && section.kind !== 'cta' && section.title?.trim(),
  );
  assert.ok(titled.length > 8, `the complete fixture names ${titled.length} sections`);
  const markup = html(input);
  const bar = markup.slice(
    markup.indexOf('class="kc-chrome__links"'),
    markup.indexOf('class="kc-menu"'),
  );
  const menu = markup.slice(markup.indexOf('<dialog'), markup.indexOf('</dialog>'));
  for (const part of [bar, menu]) {
    const hrefs = [...part.matchAll(/data-ui-slot="navigation.link" href="([^"]+)"/g)].map(
      ([, href]) => href,
    );
    assert.deepEqual(
      hrefs,
      titled.map((section) => `#${section.id}`),
    );
  }
  // The menu is #19's Dialog: a native modal, named by its title, opened by a button.
  assert.match(markup, /<button[^>]*aria-haspopup="dialog"[^>]*aria-controls="kc-menu"/);
  assert.match(menu, /<dialog[^>]*id="kc-menu"[^>]*aria-labelledby="kc-menu--title"/);
  // And it locks nothing on body: the stylesheet and the script never name it.
  const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
  assert.doesNotMatch(css, /\bbody\b|position:\s*fixed/);
});

test('each piece of evidence is a disclosure whose summary names it, with no heading inside the summary', () => {
  const markup = html(fixtureInput('complete'));
  const objects = [
    ...markup.matchAll(/<li[^>]*class="kc-evidence__object"[\s\S]*?<\/details><\/li>/g),
  ];
  assert.ok(objects.length > 3, `${objects.length} evidence objects`);
  for (const [object] of objects) {
    const summary = /<summary data-ui-slot="disclosure.summary">([\s\S]*?)<\/summary>/.exec(
      object!,
    );
    assert.ok(summary, object);
    assert.doesNotMatch(summary[1]!, /<h[1-6]\b|<button\b/, summary[1]);
    // Its accessible name: text the owner wrote.
    assert.ok(summary[1]!.replace(/<[^>]+>/g, '').trim().length > 0, object);
    // Closed on the server, with the record whole inside it.
    assert.doesNotMatch(object!, /<details[^>]*\sopen/);
    assert.match(object!, /data-ui-slot="disclosure.content"><ul class="kc-evidence__record"/);
  }
});

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

test("every evidence summary, its accessible name, holds its record's title or statement, in every contract fixture", () => {
  let checked = 0;
  let testimonials = 0;
  for (const { name } of CONTRACT_FIXTURES) {
    const input = fixtureInput(name);
    const markup = html(input);
    const sections = [
      ...markup.matchAll(
        /<section id="([^"]+)"[^>]*data-kind="evidence"[\s\S]*?<ul class="kc-evidence" role="list">([\s\S]*?)<\/ul><\/section>/g,
      ),
    ];
    for (const [, id, objects] of sections) {
      const section = input.portfolio.sections.find((each) => each.id === id)!;
      const entries = evidenceOf(section as never, input);
      const summaries = [
        ...objects!.matchAll(/<summary data-ui-slot="disclosure.summary">([\s\S]*?)<\/summary>/g),
      ].map(([, summary]) => text(summary!));
      assert.equal(summaries.length, entries.length, `${name} ${id}`);
      entries.forEach((entry, index) => {
        const author = [entry.source?.name, entry.publication, entry.venue].find(present);
        const quote = present(entry.statement) ? text(renderInlineMarkdown(entry.statement)) : '';
        // An untitled testimonial is its author's: the quote is read once, inside.
        const quoted = !present(entry.title) && entry.type === 'testimonial' && author;
        const subject = present(entry.title) ? entry.title : quoted ? author : quote || undefined;
        if (subject === undefined) return;
        checked += 1;
        assert.ok(
          summaries[index]!.includes(subject),
          `${name} ${entry.id}: "${summaries[index]}" says nothing of "${subject}"`,
        );
        if (quoted && quote) {
          testimonials += 1;
          assert.ok(
            !summaries[index]!.includes(quote),
            `${name} ${entry.id} reads its quote twice`,
          );
        }
      });
    }
  }
  assert.ok(checked > 5, `${checked} summaries checked`);
  assert.ok(testimonials > 2, `${testimonials} untitled testimonials checked`);
});

test("a metric with no title says what it counts, its source after it, as complete's tenure does", () => {
  const input = fixtureInput('complete');
  const tenure = input.portfolio.evidence.find(
    (entry) =>
      entry.metric?.value !== undefined && !present(entry.title) && present(entry.statement),
  );
  assert.ok(tenure, 'a metric with a statement and no title');
  const markup = html(input);
  const object = new RegExp(`<li id="${tenure.id}"[\\s\\S]*?</summary>`).exec(markup);
  assert.ok(object, tenure.id);
  assert.match(object[0], /class="kc-evidence__figure"/);
  assert.ok(text(object[0]).includes(text(renderInlineMarkdown(tenure.statement!))), object[0]);
});

test('a section the owner calls kc-menu takes that id, and the menu dialog takes another, so none repeats', () => {
  const portfolio = PortfolioSchema.parse({
    schemaVersion: 3,
    locale: 'en',
    direction: 'ltr',
    identity: { name: 'Rowan Kinetic', tagline: 'Builds calm software.' },
    contact: { message: 'Write any time.' },
    sections: [
      { kind: 'hero', id: 'top' },
      { kind: 'contact', id: 'kc-menu', title: 'Contact' },
    ],
  });
  const site = readPair(contractFixture('complete').files);
  assert.ok(site.ok);
  const markup = html(inputOf({ portfolio, site: site.pair.site } as ParsedPair));
  const all = ids(markup);
  assert.equal(new Set(all).size, all.length, `ids repeat: ${all.join(' ')}`);
  assert.match(markup, /<section id="kc-menu"/);
  assert.match(markup, /<dialog[^>]*id="kc-menu-2"/);
});

test("each chronology is one list, in the section's order, each entry in its authored thread's lane", () => {
  const input = fixtureInput('complete');
  const markup = html(input);
  const lists = [
    ...markup.matchAll(
      /<section id="([^"]+)"[^>]*data-kind="chronology"[\s\S]*?<ol class="kc-chronology" role="list" data-lanes="(\d)">([\s\S]*?)<\/ol>/g,
    ),
  ];
  assert.ok(lists.length > 1, `${lists.length} chronology sections`);
  for (const [, id, lanes, items] of lists) {
    const section = input.portfolio.sections.find((each) => each.id === id)!;
    const expected = threadLanes(chronologyOf(section as never, input));
    // An entry anchored on an earlier section carries no id here, so its title says which it is.
    const rendered = [
      ...items!.matchAll(
        /<li\b[^>]*data-lane="(\d)"[^>]*>[\s\S]*?class="pf-item__title"[^>]*>([^<]+)/g,
      ),
    ].map(([, lane, title]) => [title, Number(lane)]);
    assert.deepEqual(
      rendered,
      expected.map(({ entry, lane }) => [entry.title, lane]),
      id,
    );
    assert.equal(Number(lanes), new Set(expected.map(({ lane }) => lane)).size, id);
  }
  // The complete fixture's threads branch: one list has lanes, and a fork drawn toward another.
  const branching = lists.filter(([, , lanes]) => Number(lanes) > 1);
  assert.ok(branching.length > 0, 'a chronology with more than one lane');
  assert.ok(
    branching.some(([, , , items]) => /data-branches-from-lane="\d"/.test(items!)),
    'a fork toward another lane',
  );
  // No pixel-positioned SVG card, and no foreignObject.
  assert.doesNotMatch(markup, /foreignObject|<svg[^>]*class="[^"]*timeline/i);
});

test('a hidden section never reaches the page: none of its words, ids, or links', () => {
  const markup = html(fixtureInput('hidden-canary'));
  assert.doesNotMatch(markup, new RegExp(HIDDEN_CANARY));
});

test('in a plate it renders the same, every id under the plate prefix and none repeated', () => {
  const input = fixtureInput('complete', 'pl-');
  // What resolveAppearance() gives a plate in the platform's own packs.
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
        <KineticCosmos input={input} />
      </PresentationBoundary>,
    );
    // A plate renders the still before any runtime hook: none is called.
    assert.deepEqual(calls, [], 'runtime hooks called in a plate');
    // The control: the same composition outside a plate calls it, for the stage and the chrome.
    html(fixtureInput('complete'));
    documentCalls = calls.length;
  } finally {
    Runtime.useEnhancementRuntime = hook;
  }
  assert.equal(documentCalls, 2, 'runtime hooks outside a plate');
  const all = ids(plate);
  assert.ok(all.length > 10);
  assert.deepEqual(
    all.filter((id) => !id.startsWith('pl-')),
    [],
  );
  assert.equal(new Set(all).size, all.length, 'no id repeats');
  // The menu links are the plain links the server wrote, with no handler of their own.
  assert.match(plate, /<dialog[^>]*id="pl-kc-menu"/);
  // The still composition: nothing that moves, and no pause for it.
  assert.doesNotMatch(plate, /data-runtime|data-recede|data-motion-control/);
});

/** Every rule of the stylesheet, as its selector and its declarations, comments gone. */
const CSS = readFileSync(new URL('./styles.css', import.meta.url), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
);

test('the server draws the still opening: a fixed, small glyph field and the orbit, none of it moving or read', () => {
  let openings = 0;
  for (const { name } of CONTRACT_FIXTURES) {
    const markup = html(fixtureInput(name));
    // No runtime has run, so nothing is set to move.
    assert.doesNotMatch(markup, /data-runtime|data-recede|data-activity/, name);
    if (!markup.includes('<div class="kc-opening">')) continue;
    openings += 1;
    const field =
      /<div class="kc-glyphs" aria-hidden="true" data-type-role="code">([\s\S]*?)<\/div><div class="kc-orbit"/.exec(
        markup,
      );
    assert.ok(field, name);
    // The same count whatever the content: two layers of one tile twice.
    const glyphs = [
      ...field[1]!.matchAll(
        /<span class="kc-glyph kc-glyph--[sml]" data-glyph="([^"]+)"[^>]*><\/span>/g,
      ),
    ];
    assert.equal(glyphs.length, 2 * 2 * GLYPHS_PER_LAYER, name);
    // Each glyph is a mark in a pseudo-element, never text, and never a word.
    assert.equal(text(field[1]!), '', name);
    for (const [, glyph] of glyphs) assert.match(text(glyph!), /^[^\p{L}\p{N}]$/u, glyph);
  }
  assert.ok(openings > 5, `${openings} openings`);
  assert.ok(GLYPHS_PER_LAYER <= 16);
});

test('the chrome has the pause for motion, beside the visitor control, unless the site reduces motion', () => {
  const input = fixtureInput('complete');
  const markup = html(input);
  const chrome = markup.slice(
    markup.indexOf('<header class="kc-chrome"'),
    markup.indexOf('</header>'),
  );
  assert.match(chrome, /data-visitor-control-slot[\s\S]*data-motion-control/);
  assert.match(
    chrome,
    /<button[^>]*aria-pressed="false"[^>]*><span[^>]*>Pause motion<\/span><\/button>/,
  );
  const reduced = {
    ...input,
    presentation: { ...input.presentation, motionPolicy: 'reduce' as const },
  };
  assert.doesNotMatch(html(reduced), /data-motion-control/);
});

test('the motion layer starts only under the runtime, moves only transforms, and takes its timing from the motion pack', () => {
  const rules = [...CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, body]) => ({
    selector: selector!.replace(/\s+/g, ' ').trim(),
    body: body!,
  }));
  const animated = rules.filter(({ body }) => /\banimation\s*:/.test(body));
  assert.ok(animated.length >= 5, `${animated.length} animated rules`);
  for (const { selector, body } of animated) {
    if (/\banimation\s*:\s*none\b/.test(body)) continue;
    // Never on data-motion: on the runtime's state, which a static or reduced page never sets.
    assert.match(selector, /\[data-runtime\]|\[data-recede='[ab]'\]/, selector);
    assert.doesNotMatch(selector, /data-motion/, selector);
    // Every duration a multiple of the motion pack's slow one.
    assert.match(body, /var\(--ui-motion-slow\)/, selector);
    assert.doesNotMatch(body.replace(/var\([^()]*\)/g, ''), /\d(?:m?s)\b/, selector);
  }
  // Three run forever, the glyph layers and the orbit, the medium tier's ceiling.
  assert.equal(animated.filter(({ body }) => /\binfinite\b/.test(body)).length, 3);
  // What they move: transforms, and the chrome's color as it recedes.
  const keyframes = [...CSS.matchAll(/@keyframes ([\w-]+)\s*\{([\s\S]*?\})\s*\}/g)];
  assert.equal(keyframes.length, 4);
  for (const [, name, frames] of keyframes) {
    const properties = [...frames!.matchAll(/([a-z-]+)\s*:/g)].map(([, property]) => property);
    assert.deepEqual(
      [...new Set(properties)],
      name!.includes('recede') ? ['color'] : ['transform'],
      name,
    );
  }
});

test('each border token is used whole, as the border it is, never as a width', () => {
  // The design language's --ui-border-* is a whole border, or none: `1px solid var(--color-border-default)`.
  const uses = [...CSS.matchAll(/([a-z-]+)\s*:([^;{}]*var\(--ui-border-[^;{}]*)/g)];
  assert.ok(uses.length >= 4, `${uses.length} uses`);
  for (const [declaration, property, value] of uses) {
    assert.match(property!, /^border(?:-(?:block|inline)(?:-(?:start|end))?)?$/, declaration);
    assert.match(value!.trim(), /^var\(--ui-border-[a-z]+\)$/, declaration);
  }
});

test('a fork or a join reaches the lane it names, however far and on whichever side', () => {
  const reach = (kind: 'fork' | 'join', distance: number) =>
    rulesSetting(`--layout-${kind}-reach: ${distance}`);
  const rulesSetting = (declaration: string) =>
    [...CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter(([, , body]) => body!.includes(declaration))
      .map(([selector]) => selector!.replace(/\s+/g, ''))
      .join(' ');
  const toward = (pseudo: 'before' | 'after') =>
    [...CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter(
        ([, selector, body]) =>
          selector!.includes(`::${pseudo}`) && /inset-inline:\s*100%/.test(body!),
      )
      .map(([selector]) => selector!.replace(/\s+/g, ''))
      .join(' ');
  for (const [kind, attribute, pseudo] of [
    ['fork', 'data-branches-from-lane', 'before'],
    ['join', 'data-merges-into-lane', 'after'],
  ] as const) {
    for (let lane = 0; lane < 4; lane++) {
      for (let other = 0; other < 4; other++) {
        if (other === lane) continue;
        const pair = `[data-lane='${lane}'][${attribute}='${other}']`;
        assert.ok(reach(kind, Math.abs(lane - other)).includes(pair), `${kind} ${pair}`);
        // Toward the end, it starts past the entry's own column.
        assert.equal(
          toward(pseudo).includes(pair),
          other > lane,
          `${kind} ${pair} toward the ${other > lane ? 'end' : 'start'}`,
        );
      }
    }
  }
});

test('a portfolio with no titled section has no section links and no menu, and still its visitor control', () => {
  const portfolio = PortfolioSchema.parse({
    schemaVersion: 3,
    locale: 'en',
    direction: 'ltr',
    identity: { name: 'Rowan Kinetic', tagline: 'Builds calm software.' },
    contact: { message: 'Write any time.' },
    sections: [
      { kind: 'hero', id: 'top' },
      { kind: 'contact', id: 'contact' },
    ],
  });
  const site = readPair(contractFixture('complete').files);
  assert.ok(site.ok);
  const markup = html(inputOf({ portfolio, site: site.pair.site } as ParsedPair));
  assert.doesNotMatch(markup, /data-ui-slot="navigation"|<dialog/);
  assert.equal(count(markup, /data-visitor-control-slot/g), 1);
  assert.equal(count(markup, /<h1\b/g), 1);
});
