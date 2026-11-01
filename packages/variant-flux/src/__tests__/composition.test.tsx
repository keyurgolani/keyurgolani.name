import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pageOutline } from '@portfolio/kit/sections';
import { checkOutline } from '@portfolio/variant-contract/node';
import { headlineText, openingOf, plateOf, sheetsOf } from '../model';
import {
  count,
  escaped,
  FIXTURE_NAMES,
  fixtureInput,
  fragmentLinks,
  idsIn,
  inputFor,
  MANIFEST,
  PACKAGE_DIR,
  pairOf,
  renderInput,
  sampleInput,
} from './harness.test';
import { everywhere, onPhones, rulesOf, valueOf, type Rule } from './css-rules';

// Flux's home page, rendered as the server sends it, so what these hold is
// also what a page with no JavaScript shows: one h1 that reads as one
// string, the greeting line then the key phrase (FX-M6, FX-S6); the plate
// once, its work linked back from its sheet (N6); the tab bar's name and
// five destinations at most (FX-M3); no runaway dodge (R10-8); a field
// that's the same still for every owner (FX-M19, N4); and loops that read
// the ambient slot under the runtime's gate (K-4 b, c).

const sample = () => renderInput(sampleInput());
const CSS = readFileSync(path.join(PACKAGE_DIR, 'src', 'styles.css'), 'utf8');
const RULES = rulesOf(CSS);

test("in print the Index is the contents list near the top, live or not, with no dialog chrome; the bar's plain Index link prints", () => {
  const print = RULES.filter((rule) => rule.at.some((each) => /^@media print/.test(each)));
  const has = (selector: string) =>
    print.find((rule) => rule.selector.split(/\s*,\s*/).includes(selector));
  const index = has("[data-variant='flux'] .fx[data-fx-index] .fx-index:not(:popover-open)");
  assert.ok(index, 'the live, closed Index prints');
  assert.ok(index.selector.includes("[data-variant='flux'] .fx-index"), 'and the no-script one');
  assert.equal(valueOf(index.body, 'display'), 'grid');
  assert.equal(valueOf(index.body, 'order'), '-1');
  // In the flow, not the browser's popover box, which holds even shut once the page is live.
  assert.equal(valueOf(index.body, 'position'), 'static');
  assert.equal(valueOf(index.body, 'margin'), '0');
  assert.equal(valueOf(index.body, 'inset'), 'auto');
  // What any print rule for `selector` gives `property`.
  const said = (selector: string, property: string) =>
    print
      .filter((rule) => rule.selector.split(/\s*,\s*/).includes(selector))
      .map((rule) => valueOf(rule.body, property))
      .find((value) => value !== undefined);
  assert.equal(said("[data-variant='flux'] .fx-bar", 'order'), '-2');
  assert.equal(said("[data-variant='flux'] .fx", 'flex-direction'), 'column');
  assert.equal(said("[data-variant='flux'] .fx-index__close", 'display'), 'none');
  assert.equal(said("[data-variant='flux'] .fx-index::backdrop", 'display'), 'none');
  // Of the bar's tools only the Index's plain link prints, live or not: its live button, Pause and
  // Appearance stay off the paper.
  assert.equal(
    said("[data-variant='flux'] .fx-bar__tools > :not(.fx-tool--plain)", 'display'),
    'none',
  );
  assert.equal(
    said("[data-variant='flux'] .fx[data-fx-index] .fx-tool--plain", 'display'),
    'inline-flex',
  );
});

test('in print every word in the bar is ink with no fill: the drop and its inverse words, and the no-script fills, never reach paper', () => {
  const print = RULES.filter((rule) => rule.at.some((each) => /^@media print/.test(each)));
  const tabs = print.find((rule) => rule.selector.includes('.fx-tab[data-fx-under]'));
  assert.ok(tabs, "a print rule for the bar's words");
  // Each screen state that turns a word to the inverse ink is in it, at its own specificity.
  for (const state of [
    "[data-variant='flux'] .fx-tabs .fx-tab",
    "[data-variant='flux'] .fx[data-fx-live] .fx-tabs .fx-tab[data-fx-under]",
    "[data-variant='flux'] .fx:not([data-fx-live]) .fx-tabs .fx-tab--name",
    "[data-variant='flux'] .fx:not([data-fx-live]) .fx-tabs__dest[data-current] .fx-tab",
  ])
    assert.ok(tabs.selector.split(/\s*,\s*/).includes(state), state);
  assert.equal(valueOf(tabs.body, 'color'), 'var(--color-text-primary)');
  assert.equal(valueOf(tabs.body, 'background-color'), 'transparent');
  // And the drop itself doesn't print.
  assert.ok(
    print.some(
      (rule) => rule.selector.includes('.fx-bar__drop') && valueOf(rule.body, 'display') === 'none',
    ),
  );
});
/** The rules whose selector is exactly `selector` after the scope, where `where` holds. */
const rulesFor = (selector: string, where: (rule: Rule) => boolean = () => true) =>
  RULES.filter((rule) => rule.selector === `[data-variant='flux'] ${selector}` && where(rule));
const REACH = 'calc(var(--ui-focus-offset) + var(--ui-focus-width))';

test("Flux's CSS has no (scripting) query: its no-script rules are scoped to an enhancement's mark", () => {
  // No-JavaScript rows audit with script on for axe, which a scripting query would flip; and a
  // failed enhancement leaves the page as it would be with none.
  assert.doesNotMatch(CSS, /@media[^{]*\(\s*scripting/);
  // Both of them, each on its own: the content shown, and the closed fold's content box opened.
  const landed = RULES.filter((rule) =>
    rule.selector.includes(':is(:target > details.fx-fold, details.fx-fold:has(:target))'),
  );
  assert.deepEqual(
    landed.map((rule) => rule.selector.replace(/^.*\)\)/, '')),
    [' > :not(summary)', '::details-content'],
  );
  for (const rule of landed) {
    assert.match(rule.selector, /^\[data-variant='flux'\] \.fx:not\(\[data-fx-folds\]\) :is\(/);
    assert.ok(everywhere(rule), rule.selector);
  }
});

const SMALL = {
  schemaVersion: 3,
  locale: 'en',
  direction: 'ltr',
  identity: { name: 'Rowan Vale', tagline: 'Letterpress and small tools.' },
  sections: [{ kind: 'hero', id: 'top', greeting: 'Hi, I am', tagline: 'I print things.' }],
};

test('every core kind renders bespoke, and the manifest says so', () => {
  assert.equal(MANIFEST.renderedKinds.length, 14);
  assert.equal(MANIFEST.performanceTier, 'medium');
  assert.equal(MANIFEST.budgets?.animation, 2);
  const html = sample();
  assert.equal(count(html, /data-renderer="shared"/g), 0);
  assert.ok(count(html, /data-renderer="bespoke"/g) > 20);
});

test('the sample and every contract fixture pass the outline check', () => {
  const inputs = [
    ['sample', sampleInput()] as const,
    ...FIXTURE_NAMES.map((name) => [name, fixtureInput(name)] as const),
  ];
  for (const [name, input] of inputs) {
    const html = renderInput(input);
    const findings = checkOutline(html, input.ids, { sections: pageOutline(input).sections });
    assert.deepEqual(findings, [], `${name}: ${JSON.stringify(findings, null, 1)}`);
    const ids = idsIn(html);
    assert.equal(new Set(ids).size, ids.length, `${name}: an id repeats`);
    const known = new Set([...ids, input.ids.main]);
    for (const fragment of fragmentLinks(html))
      assert.ok(known.has(fragment), `${name}: #${fragment} lands nowhere`);
    for (const [, labels] of html.matchAll(/\saria-labelledby="([^"]+)"/g))
      for (const label of labels!.split(' '))
        assert.ok(known.has(label), `${name}: aria-labelledby ${label} names nothing`);
    for (const section of input.portfolio.sections)
      if ('title' in section && typeof section.title === 'string' && section.title.trim() !== '')
        assert.ok(
          html.includes(escaped(section.title.trim())),
          `${name}: ${section.id}'s title "${section.title}" is missing`,
        );
    assert.equal(count(html, /<h1\b/g), 1, `${name}: one h1`);
    assert.equal(count(html, /data-visitor-control-slot/g), 1, `${name}: one visitor slot`);
    assert.equal(count(html, /<filter\b/g), 1, `${name}: the goo filter, once`);
  }
});

test('the h1: the greeting with the name, a space, then the key phrase, as one string (FX-M6, FX-S6, N5)', () => {
  const input = sampleInput();
  const html = renderInput(input);
  const h1 = /<h1 class="fx-h1"[^>]*>([\s\S]*?)<\/h1>/.exec(html)?.[1] ?? '';
  assert.match(h1, /<bdi>Anamika Devi<\/bdi>\.<\/span> <span class="fx-h1__key"/);
  const text = h1.replace(/<[^>]+>/g, '').replace(/&#x27;/g, "'");
  assert.equal(text, headlineText(openingOf(input)));
  assert.equal(text, "Hello, I'm Anamika Devi. I make failure legible.");
  // One positioning line, one call to action, one proof line.
  assert.equal(count(html, /class="fx-lede"/g), 1);
  assert.equal(count(html, /class="fx-btn" href/g) >= 1, true);
  assert.equal(count(html, /class="fx-proof"/g), 1);
  assert.ok(count(html, /<ul class="fx-proof"[\s\S]*?<\/ul>/g) === 1);
  const proof = /<ul class="fx-proof"[^>]*>([\s\S]*?)<\/ul>/.exec(html)?.[1] ?? '';
  assert.ok(count(proof, /<li>/g) <= 3);
});

test('without a thesis the key phrase is the tagline, and a missing greeting leaves the name alone', () => {
  const html = renderInput(inputFor(pairOf(SMALL)));
  assert.match(html, /Hi, I am <bdi>Rowan Vale<\/bdi>\./);
  const plain = renderInput(
    inputFor(pairOf({ ...SMALL, sections: [{ kind: 'hero', id: 'top', tagline: 'I print.' }] })),
  );
  assert.match(
    plain,
    /<span class="fx-h1__hello" data-type-role="display"><bdi>Rowan Vale<\/bdi>\./,
  );
});

test('the plate shows the signature work once, and the page says nothing of its own about it (FX-M2, N6)', () => {
  const html = sample();
  assert.equal(count(html, /id="fx--plate"/g), 1);
  // No made-up line about it (the lead's SF14 ruling): the plate is on this page.
  assert.doesNotMatch(html, /The signature work, /);
  assert.doesNotMatch(html, /opens this page/);
  // Never a rectangle beside the headline: the plate sits in the drop on its pool.
  assert.match(html, /class="fx-drop"/);
  assert.match(html, /class="fx-pool"/);
});

test('the signature title shows once, as the plate; any other appearance is one link to it (N6)', () => {
  const inputs = [
    ['sample', sampleInput()] as const,
    ...FIXTURE_NAMES.map((name) => [name, fixtureInput(name)] as const),
  ];
  let plates = 0;
  for (const [name, input] of inputs) {
    const html = renderInput(input);
    const signature = plateOf(input, () => '')?.work;
    if (!signature || !html.includes('class="fx-plate"')) continue;
    plates += 1;
    const title = escaped(signature.title);
    // What a reader meets: the drop's own type for a work with no picture is for the eye alone.
    const read = html.replace(/<p class="fx-drop__type"[^>]*aria-hidden="true">[^<]*<\/p>/g, '');
    const plate = /<h2 class="fx-plate__title"[^>]*>([\s\S]*?)<\/h2>/.exec(read)?.[1] ?? '';
    assert.ok(plate.includes(title), `${name}: the plate is titled ${signature.title}`);
    const elsewhere = read
      .replace(/<h2 class="fx-plate__title"[^>]*>[\s\S]*?<\/h2>/, '')
      .replace(
        /<h[2-6] id="[^"]*--h" class="(?:fx-sec__title|fx-hidden)"[^>]*>[\s\S]*?<\/h[2-6]>/g,
        '',
      );
    const ids = new Set(idsIn(html));
    // An appearance of the work is its title as a heading or a row's title, whole: another
    // record that shares its name, prose that mentions it, or a section named as it (a series)
    // is that record's or section's own words.
    const safe = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const headed = new RegExp(
      `<(h[2-6]|p)[^>]*class="[^"]*title[^"]*"[^>]*>(<a href="([^"]*)"[^>]*>)?(<span[^>]*>)?${safe}<`,
      'g',
    );
    for (const at of [...elsewhere.matchAll(headed)]) {
      const href = at[3];
      assert.ok(
        href?.startsWith('#'),
        `${name}: "${signature.title}" is titled again, and not as a link to the plate`,
      );
      assert.ok(ids.has(href!.slice(1)), `${name}: its link ${href} lands nowhere`);
    }
  }
  assert.ok(plates >= 3, `${plates} pages with a plate`);
});

test("a run's rest folds on a phone: closed from the server, its summary More and how many it holds", () => {
  const html = sample();
  const mores = [
    ...html.matchAll(/<details class="fx-fold fx-more"([^>]*)>([\s\S]*?)<\/summary>/g),
  ];
  // The voices, the essays, the episodes, the lede's rest, Experience's account, the facts, the
  // figures' gloss and the engagements.
  assert.ok(mores.length >= 7, `${mores.length} folds`);
  for (const [, attrs, summary] of mores) {
    assert.doesNotMatch(attrs!, /\sopen/);
    assert.match(attrs!, /data-fx-fold="" data-fx-more=""/);
    assert.match(summary!, /More<\/span><span class="fx-fold__count fx-num"[^>]*>\d+</);
  }
});

test("a run's rest reads whole from 64rem alone, so a tablet keeps its folds, and a tablet's odd gallery leads with one frame across (SF-P2-4)", () => {
  const tabs = readFileSync(path.join(PACKAGE_DIR, 'src', 'enhancements', 'tabs.ts'), 'utf8');
  assert.match(tabs, /const wide = window\.matchMedia\('\(min-width: 64rem\)'\);/);
  const hides = RULES.filter(
    (rule) => rule.selector === "[data-variant='flux'] .fx-more[open] > .fx-fold__summary",
  );
  assert.deepEqual(
    hides.map((rule) => [rule.at, valueOf(rule.body, 'display')]),
    [[['@media (min-width: 64rem)'], 'none']],
  );
  const tablet = (rule: Rule) => rule.at.includes('@media (max-width: 63.99rem)');
  assert.equal(
    valueOf(rulesFor('.fx-gallery__frames', tablet)[0]?.body ?? '', 'grid-template-columns'),
    'repeat(2, minmax(0, 1fr))',
  );
  const lead = RULES.find(
    (rule) =>
      tablet(rule) &&
      rule.selector.includes(":is([data-count='1'], [data-count='3'], [data-count='5'])"),
  );
  assert.equal(valueOf(lead?.body ?? '', 'grid-column'), '1 / -1');
});

test('the tab bar: the name and at most five destinations, each landing on its sheet (FX-M3, K-1)', () => {
  const input = sampleInput();
  const html = renderInput(input);
  const tabs = /<ul class="fx-tabs" role="list">([\s\S]*?)<\/ul>/.exec(html)?.[1] ?? '';
  assert.ok(count(tabs, /<a\b/g) <= 6);
  const sheets = sheetsOf(input, pageOutline(input)).filter((sheet) => sheet.id !== 'more');
  for (const sheet of sheets) assert.match(tabs, new RegExp(`href="#fx--sheet-${sheet.id}"`));
  // Index without script is a link to the contents list; its button waits for the enhancement.
  assert.match(html, /class="fx-tool fx-tool--index fx-tool--plain" href="#fx--index"/);
  assert.match(
    html,
    /<button type="button" class="fx-tool fx-tool--index fx-tool--live"[^>]*hidden/,
  );
});

test('the tabs step across the page in reading order', () => {
  const input = sampleInput();
  const steps = sheetsOf(input, pageOutline(input))
    .filter((sheet) => sheet.word)
    .map((sheet) => sheet.step);
  assert.equal(steps[0], 0);
  assert.equal(steps.at(-1), 1);
  for (let i = 1; i < steps.length; i++) assert.ok(steps[i]! > steps[i - 1]!);
});

test('Copy email is an ordinary button beside the mailto link, hidden with no script (R10-8, FX-S53)', () => {
  const html = sample();
  assert.match(html, /<a href="mailto:[^"]+">/);
  assert.match(
    html,
    /<button type="button" class="fx-btn fx-btn--quiet" data-fx-copy="[^"]+"[^>]*hidden/,
  );
  assert.doesNotMatch(html, /runaway|data-fx-dodge/);
  assert.doesNotMatch(JSON.stringify([MANIFEST.controls, MANIFEST.enhancements]), /runaway/);
});

test('the field is the same still for every owner: geometry alone, no text in it (FX-M19, N4)', () => {
  const field = (html: string) =>
    /<div id="fx--field" class="fx-field" aria-hidden="true">([\s\S]*?)<\/div>/.exec(html)?.[1];
  const a = field(sample());
  const b = field(renderInput(inputFor(pairOf(SMALL))));
  assert.ok(a && a.length > 1000);
  assert.equal(a, b);
  assert.doesNotMatch(a!, />[^<\s]/);
});

test("the key phrase's words each take a solid colour along the pour, and no glyph is a clipped gradient (quality-pr: contrast large-text)", () => {
  const html = renderInput(sampleInput());
  const key = /<span class="fx-h1__key"[^>]*>([\s\S]*?)<\/span><\/h1>/.exec(html)?.[1] ?? '';
  const words = [
    ...key.matchAll(/<span class="fx-h1__word" style="--layout-fx-at:([\d.]+)">([^<]+)<\/span>/g),
  ];
  assert.deepEqual(
    words.map((word) => word[2]),
    ['I', 'make', 'failure', 'legible.'],
  );
  assert.deepEqual(
    words.map((word) => Number(word[1])),
    [0, 0.333, 0.667, 1],
  );
  // A sampler reads a text's colour against its ground: a glyph whose paint is its background,
  // a gradient clipped to the text, has no colour of its own to read.
  assert.doesNotMatch(CSS, /background-clip:\s*text/);
  assert.doesNotMatch(CSS, /text-fill-color/);
  assert.match(CSS, /\.fx-h1__word \{\s*color: color-mix\(/);
});

test('the drop lies under the tab row and holds no words of its own, so no tab is covered (quality-pr: occlusion, an unresolved word)', () => {
  for (const html of [renderInput(sampleInput()), renderInput(fixtureInput('complete'))]) {
    const nav = /<nav class="fx-bar__nav"[^>]*>([\s\S]*?)<\/nav>/.exec(html)?.[1] ?? '';
    // The empty drop first, then the row: a later sibling paints over it.
    assert.match(nav, /^<span class="fx-bar__drop" aria-hidden="true"><\/span><ul class="fx-tabs"/);
    assert.equal(count(nav, /fx-tab__word/g), count(nav, /<a /g));
  }
  assert.match(CSS, /\.fx-tabs \{\s*position: relative;/);
  assert.match(
    CSS,
    /\.fx\[data-fx-live\] \.fx-tabs \.fx-tab\[data-fx-under\] \{\s*color: var\(--color-text-inverse\);/,
  );
  // The word turns at once: a colour that ran behind the drop's would be the drop's own over it
  // for a moment (quality-pr, 390: the name word read 1.12:1). No rule on a tab, its word or the
  // name transitions anything; the enhancement times each turn to the drop's edge (SF-P2-2).
  const tabRules = RULES.filter((rule) =>
    /\.fx-tab(?:__word|--name)?(?![\w-])/.test(rule.selector),
  );
  assert.ok(tabRules.length > 5);
  for (const rule of tabRules)
    assert.equal(valueOf(rule.body, 'transition'), undefined, rule.selector);
});

test("every gap the bar's rows and the dock's tools take, row and column, holds a focus ring's reach", () => {
  const atReach = (gap: string) => gap === REACH || (gap.startsWith('max(') && gap.includes(REACH));
  for (const selector of ['.fx-bar__tools', '.fx-tabs']) {
    const rules = rulesFor(selector);
    assert.ok(rules.length > 0, selector);
    for (const rule of rules)
      for (const property of ['gap', 'column-gap', 'row-gap']) {
        const gap = valueOf(rule.body, property);
        if (gap !== undefined) assert.ok(atReach(gap), `${selector} ${property}: ${gap}`);
      }
  }
  // Where the bar wraps (tablets), its rows; and on a phone, between the tabs and the tools.
  const bar = rulesFor('.fx-bar__in', everywhere).map((rule) => valueOf(rule.body, 'row-gap'));
  assert.ok(
    bar.some((gap) => gap !== undefined && atReach(gap)),
    String(bar),
  );
  const dock = rulesFor('.fx-bar__in', onPhones).map((rule) => valueOf(rule.body, 'column-gap'));
  assert.ok(
    dock.some((gap) => gap !== undefined && atReach(gap)),
    String(dock),
  );
});

test("the bar's controls sit at least a focus ring's reach apart, so none lies over its neighbour's ring (quality-pr, 390: Pause over Index)", () => {
  const reach = REACH;
  const gaps = (selector: string) =>
    [
      ...CSS.matchAll(
        new RegExp(`\\${selector} \\{[^}]*?(?<![\\w-])(?:column-)?gap: ([^;]+);`, 'g'),
      ),
    ].map((match) => match[1]!);
  // The tools and the tabs, everywhere they're set: a ring's reach, or more.
  for (const selector of ['.fx-bar__tools', '.fx-tabs']) {
    const set = gaps(selector);
    assert.ok(set.length > 0, selector);
    for (const gap of set)
      assert.ok(
        gap === reach || (gap.startsWith('max(') && gap.includes(reach)),
        `${selector}: ${gap}`,
      );
  }
  // The phone dock's row, between the tabs and the tools.
  assert.ok(gaps('.fx-bar__in').includes(`max(var(--space-2xs), ${reach})`));
});

test("the visitor's Appearance floats over the page, in Flux's ink: under its own tool from 40rem, over the dock on a phone, a lip and a drip, no card (SF-P2-5, SF-P2-6)", () => {
  const PANEL = ".fx-bar__appearance [data-ui-slot='disclosure.content']";
  const [panel, ...others] = rulesFor(PANEL, everywhere);
  assert.equal(others.length, 0);
  const body = panel!.body;
  assert.equal(valueOf(body, 'position'), 'absolute');
  assert.equal(valueOf(body, 'inset-block-start'), 'calc(100% + var(--space-xs))');
  // Over what follows the bar in its own stacking context, and scrolling within the window.
  assert.ok(Number(valueOf(body, 'z-index')) >= 1);
  assert.equal(valueOf(body, 'overflow-y'), 'auto');
  assert.equal(
    valueOf(body, 'max-block-size'),
    'calc(100dvh - 100% - var(--space-xs) - var(--space-m))',
  );
  // The page's own ground, the bar's ink as its lip, a hairline; no floating card's shadow.
  assert.equal(valueOf(body, 'background-color'), 'var(--color-surface-default)');
  assert.equal(valueOf(body, 'border-block-start'), 'var(--layout-line-lip-drop)');
  assert.equal(valueOf(body, 'box-shadow'), undefined);
  assert.equal(valueOf(body, 'white-space'), 'normal');
  assert.match(CSS, /--layout-line-lip-drop: 6px solid var\(--color-text-primary\);/);
  // The drip pours off the open tool's foot, its ::before (on a phone, from its top, upward).
  const OPEN = ".fx-bar__appearance [open] > [data-ui-slot='disclosure.summary']";
  const drip = rulesFor(`${OPEN}::before`, everywhere)[0]?.body ?? '';
  assert.equal(valueOf(drip, 'background-color'), 'var(--color-text-primary)');
  assert.equal(valueOf(drip, 'inset-block-start'), '100%');
  assert.equal(valueOf(drip, 'pointer-events'), 'none');
  const rise = rulesFor(`${OPEN}::before`, onPhones)[0]?.body ?? '';
  assert.equal(valueOf(rise, 'inset-block'), 'auto 100%');
  // Open, its tool takes the bar's drop.
  const open = rulesFor(".fx-bar__appearance [open] > [data-ui-slot='disclosure.summary']")[0]
    ?.body;
  assert.equal(valueOf(open ?? '', 'background-color'), 'var(--color-text-primary)');
  // From 40rem, where the browser anchors, under its own tool, flipped where it would run past.
  const anchored =
    rulesFor(
      PANEL,
      (rule) =>
        rule.at.some((each) => each.startsWith('@supports (anchor-name')) &&
        rule.at.some((each) => each.includes('(min-width: 40rem)')),
    )[0]?.body ?? '';
  assert.equal(valueOf(anchored, 'position'), 'fixed');
  assert.equal(valueOf(anchored, 'position-anchor'), '--fx-appearance');
  assert.equal(valueOf(anchored, 'inset-inline'), 'auto anchor(end)');
  assert.equal(
    valueOf(anchored, 'inset-block'),
    'calc(anchor(end) + var(--space-xs)) var(--space-m)',
  );
  assert.equal(valueOf(anchored, 'block-size'), 'fit-content');
  // A block fit-content is the form's own height, so a short window needs the cap: the room
  // between the insets, or the foot runs past the window, out of reach (640x360).
  assert.match(anchored, /max-block-size: stretch;/);
  assert.doesNotMatch(anchored, /max-block-size: none;/);
  assert.equal(valueOf(anchored, 'position-try-fallbacks'), 'flip-inline');
  // On a phone it rises over the dock: its foot above the bar, never off the bottom of the window.
  const phone = rulesFor(PANEL, onPhones)[0]?.body ?? '';
  assert.equal(valueOf(phone, 'inset-block'), 'auto calc(100% + var(--space-xs))');
  assert.equal(valueOf(phone, 'border-block-end'), 'var(--layout-line-lip-drop)');
  assert.match(CSS, /\.fx-bar__in \{\s*position: relative;\s*\}/);
});

test('the phone dock: the tools keep their size, the destination being read keeps its own, and the name gives way whole before fewer than five of its letters would show (B1, M1)', () => {
  const phone = (selector: string) => rulesFor(selector, onPhones)[0]?.body ?? '';
  assert.equal(valueOf(phone('.fx-bar__nav'), 'flex'), '1 1 0');
  assert.equal(valueOf(phone('.fx-bar__nav'), 'min-inline-size'), 'min-content');
  const name = phone('.fx-tabs__name');
  assert.equal(valueOf(name, 'flex'), '1 1 0');
  assert.equal(valueOf(name, 'min-inline-size'), '0');
  assert.equal(valueOf(name, 'container'), 'fx-name / inline-size');
  assert.equal(valueOf(phone('.fx-tabs__dest'), 'flex'), 'none');
  assert.equal(valueOf(phone('.fx-tab--name'), 'min-inline-size'), '0');
  assert.equal(valueOf(phone('.fx-tab--name .fx-tab__word'), 'min-inline-size'), '0');
  const gone = RULES.filter(
    (rule) => rule.at.includes('@container fx-name (inline-size < 5rem)') && onPhones(rule),
  );
  assert.deepEqual(
    gone.map((rule) => [rule.selector, valueOf(rule.body, 'display')]),
    [["[data-variant='flux'] .fx-tab--name", 'none']],
  );
  // Index is its mark beside a destination, keyed to a destination shown, not to the name's place
  // (SF-P2-3: a fresh load and a return to the top give the same dock).
  assert.equal(
    rulesFor('.fx-bar__in:has(.fx-tabs__dest[data-current]) .fx-bar__word', onPhones).length,
    1,
  );
  assert.doesNotMatch(CSS, /:has\(\.fx-tabs \[data-current\]\)|\.fx-tabs:has\(\[data-current\]\)/);
  // The dock's Appearance is its mark alone: its word its name, at no size, and no chevron.
  const summary = phone(".fx-bar__appearance [data-ui-slot='disclosure.summary']");
  assert.equal(valueOf(summary, 'font-size'), '0');
  // Its mark where its chevron was: a round, half inked, never turned as the chevron is.
  const mark = phone(".fx-bar__appearance [data-ui-slot='disclosure.summary']::after");
  assert.equal(valueOf(mark, 'inline-size'), 'var(--space-s)');
  assert.equal(valueOf(mark, 'border-radius'), 'var(--layout-round)');
  assert.equal(valueOf(mark, 'rotate'), 'none');
  assert.equal(valueOf(mark, 'translate'), 'none');
});

test('blobs: off draws no inks and keeps the drop; 2 drops the pool', () => {
  const off = renderInput(inputFor(pairOf(SMALL, { blobs: 'off' })));
  assert.equal(count(off, /class="fx-ink /g), 0);
  const sampleOff = renderInput(sampleInput());
  assert.ok(count(sampleOff, /class="fx-ink /g) === 8);
  const two = renderInput(inputFor(pairOf(SMALL, { blobs: '2' })));
  assert.equal(count(two, /class="fx-pool/g), 0);
});

test('two loops, each on the ambient slot, gated by the runtime, reduced motion and a still page (K-4 b, c)', () => {
  const infinite = [...CSS.matchAll(/animation:\s*([a-z-]+)[^;]*infinite[^;]*;/g)];
  assert.equal(infinite.length, 2);
  for (const [rule] of infinite) assert.match(rule, /var\(--motion-ambient\)/);
  assert.equal(count(CSS, /animation-play-state: var\(--motion-ambient-state\)/g), 2);
  const block = CSS.slice(CSS.indexOf('/* The drift'), CSS.indexOf('@keyframes flux-drift-a'));
  assert.match(block, /prefers-reduced-motion: no-preference/);
  // The two drifts, and their stepped ease under the same gates.
  assert.equal(count(block, /\.fx-field\[data-kit-runtime\]/g), 3);
  assert.equal(count(block, /:not\(\[data-motion='reduced'\], \[data-motion='static'\]\)/g), 3);
  // The ease in 64 steps a keyframe: the goo repaints a few times a second, not every frame.
  const steps = /animation-timing-function: linear\(([^)]*)\)/.exec(block)?.[1] ?? '';
  assert.equal(steps.split(',').length, 128);
  // Transform alone moves the liquid.
  for (const [, frames] of CSS.matchAll(/@keyframes flux-drift-[ab] \{([\s\S]*?)\n\}/g))
    assert.doesNotMatch(frames!, /(?:^|\s)(?:top|left|width|height|margin|inset)[a-z-]*:/);
});
