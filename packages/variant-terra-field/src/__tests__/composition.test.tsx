import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { isRoutedWork, pageOutline } from '@portfolio/kit/sections';
import { newestFirst } from '@portfolio/schema';
import { homeModel } from '../model';
import { checkOutline } from '@portfolio/variant-contract/node';
import {
  count,
  escaped,
  FIXTURE_NAMES,
  fixtureInput,
  fragmentLinks,
  idsIn,
  MANIFEST,
  PACKAGE_DIR,
  pairOf,
  render,
  renderInput,
  sampleInput,
} from './harness.test';

// Terra Field's home page, rendered as the server sends it, so what these
// hold is also what a page with no JavaScript shows: one h1 (the thesis,
// the owner's name its hidden prefix), the kicker in place of a greeting,
// one action, the seal on the arc, the anchor band of one photograph and
// two plates, the five fields in the fixed order each with its own index,
// the signature work once, the close, and Field notes as a closed modal
// dialog its invokers open with no script.

const sample = () => renderInput(sampleInput());
const STYLES = readFileSync(path.join(PACKAGE_DIR, 'src', 'styles.css'), 'utf8');

/** The selectors of the rule a declaration at `at` in the stylesheet sits in, split at the top-level commas. */
function selectorsAt(at: number): string[] {
  const prelude = STYLES.slice(
    Math.max(STYLES.lastIndexOf('}', at), STYLES.lastIndexOf(';', at)) + 1,
    STYLES.lastIndexOf('{', at),
  );
  const list = prelude.slice(prelude.lastIndexOf('{') + 1);
  const out: string[] = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i < list.length; i++) {
    if (list[i] === '(') depth++;
    else if (list[i] === ')') depth--;
    else if (list[i] === ',' && depth === 0) {
      out.push(list.slice(from, i).trim());
      from = i + 1;
    }
  }
  out.push(list.slice(from).trim());
  return out.filter((selector) => selector !== '' && !selector.startsWith('@'));
}

test('every core kind renders bespoke, and the manifest says so', () => {
  assert.equal(MANIFEST.renderedKinds.length, 14);
  const html = sample();
  assert.equal(count(html, /data-renderer="shared"/g), 0);
  assert.ok(count(html, /data-renderer="bespoke"/g) > 20);
});

test('the sample and every contract fixture pass the outline check, every id once, every fragment landing', () => {
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
          html.includes(escaped(section.title)),
          `${name}: ${section.id}'s title is missing`,
        );
    assert.equal(count(html, /<h1\b/g), 1, `${name}: one h1`);
    assert.equal(count(html, /<main\b/g), 1, `${name}: one main`);
    // No empty frame: no figure, plate, or list with nothing in it (F7).
    assert.doesNotMatch(html, /<(ul|ol|dl)[^>]*><\/\1>/, `${name}: an empty list`);
    assert.doesNotMatch(html, /<figure[^>]*><\/figure>/, `${name}: an empty figure`);
  }
});

test('the opening: the thesis is the one h1, the name its hidden prefix, the kicker where a greeting stood (N5, TF-M3)', () => {
  const html = sample();
  assert.match(
    html,
    /<h1 class="tf-display tf-hero__line" id="tf--hero-title"><span class="tf-sr">Anamika Devi: <\/span><span class="pf-rich-text">I make failure legible\.<\/span><\/h1>/,
  );
  assert.match(
    html,
    /<p class="tf-kicker tf-label tf-hero__kicker"><span class="tf-strong">Anamika Devi<\/span>, <span>Principal Engineer, Reliability<\/span> at <span>Solstice Payments<\/span><\/p>/,
  );
  // The greeting never shows, and the opening has one action.
  assert.doesNotMatch(html, /Hello, I&#x27;m/);
  const opening = html.slice(
    html.indexOf('class="tf-hero"'),
    html.indexOf('class="tf-page tf-band"'),
  );
  assert.equal(count(opening, /class="tf-act /g), 1);
  assert.doesNotMatch(opening, /Resume/);
});

test('the seal: the first proof record, its words whole, linking to where the page shows it (TF-M2)', () => {
  const html = sample();
  assert.match(
    html,
    /<p class="tf-seal"><a class="tf-seal__link" href="#tenure-years"><span class="tf-seal__value tf-num">12<\/span><span class="tf-seal__label">Years engineering<\/span><\/a><\/p>/,
  );
  // The opening sizes the seal, and the room above it, by the widest word.
  assert.match(
    html,
    /<div class="tf-root" data-tf-field="accent" style="--layout-seal-chars:11;--layout-seal-figure:2">/,
  );
  // The label never breaks a word: the stylesheet holds it to its widest word.
  assert.match(
    STYLES,
    /\.tf-seal__label \{[^}]*min-inline-size: min-content;[^}]*overflow-wrap: normal;[^}]*word-break: keep-all;/,
  );
  const off = render(pairOf(SMALL, { seal: false }));
  assert.doesNotMatch(off, /class="tf-seal"/);
});

test('the anchor band: one photograph, the signature plate, and the next proof record, captioned on paper (TF-M4)', () => {
  const html = sample();
  const band = html.slice(
    html.indexOf('class="tf-page tf-band"'),
    html.indexOf('class="tf-page tf-thesis"'),
  );
  assert.match(band, /<figure class="tf-band__photo">/);
  assert.match(band, /Hampi market, just before close/);
  assert.match(
    band,
    /<article class="tf-plate" id="tf--companion-1"[^>]*><p class="tf-label tf-kicker">Signature work<\/p>/,
  );
  assert.match(
    band,
    /<figure class="tf-plate" id="tf--companion-2"[^>]*>[\s\S]*Services owned[\s\S]*<a href="#services-owned">38<\/a>/,
  );
  // Plates, never cards: no surface fill and no card border on a plate.
  assert.doesNotMatch(STYLES, /\.tf-plate \{[^}]*(background|--ui-border-card|box-shadow)/);
});

test('the signature work shows once: its plate, and a back-reference where its section lists it (TF-M8)', () => {
  const html = sample();
  assert.equal(count(html, /<a [^>]*>Postmortem Template Kit<\/a>/g), 2);
  assert.match(
    html,
    /<p class="tf-backref tf-compact" id="postmortem-template-kit">The signature work, in the opening: <a href="#tf--companion-1">Postmortem Template Kit<\/a><\/p>/,
  );
  assert.doesNotMatch(html, /<article class="tf-entry" id="postmortem-template-kit"/);
});

test('the fields come in the fixed order, each an h2 region with its own form and index, its sections at h3 (TF-M5)', () => {
  const html = sample();
  const fields = [
    ...html.matchAll(
      /<section class="tf-field" aria-labelledby="tf--([a-z]+)-title" data-tf-destination="\1">/g,
    ),
  ].map(([, id]) => id);
  assert.deepEqual(fields, ['work', 'writing', 'record', 'about']);
  const forms = [
    ...html.matchAll(
      /<header class="tf-fieldhead" id="tf--[a-z]+" data-tone="([a-z]+)" data-arc="([a-z]+)" data-depth="([a-z]+)"/g,
    ),
  ].map(([, tone, arc, depth]) => `${tone} ${arc} ${depth}`);
  assert.equal(new Set(forms).size, forms.length, 'no two fields open alike');
  // Record keeps the accent as the hairline on its arc, not as a ground (S-6): the full
  // accent is the two bookends', the opening and the close.
  assert.match(
    html,
    /<header class="tf-fieldhead" id="tf--record" data-tone="subtle" data-arc="sag" data-depth="mid" data-edge="accent">/,
  );
  assert.match(
    html,
    /<nav class="tf-fieldhead__nav" aria-labelledby="tf--work-title"><ul class="tf-fieldhead__index tf-compact" role="list"><li><a href="#work-showcase">Work Showcase<\/a>/,
  );
  const headings = [...html.matchAll(/<h([1-6])\b/g)].map(([, n]) => Number(n));
  for (let i = 1; i < headings.length; i++)
    assert.ok(
      headings[i]! - headings[i - 1]! <= 1,
      `heading ${headings[i - 1]} then ${headings[i]}`,
    );
});

test('every work in a mixed section is the one series template, with one kicker (S1, S5)', () => {
  const html = sample();
  const entries = [...html.matchAll(/<article class="tf-entry"[^>]*>([\s\S]*?)<\/article>/g)];
  assert.ok(entries.length >= 2);
  for (const [, body] of entries) {
    assert.equal(count(body!, /class="tf-kicker /g), 1);
    assert.match(body!, /^<div class="tf-entry__text"><p class="tf-kicker tf-label">/);
  }
  // Writing is three reading columns, recordings an episode log, photographs a gallery, music a sleeve.
  assert.match(html, /data-form="essays"[\s\S]*<div class="tf-essays" data-count="3">/);
  assert.match(html, /data-form="episodes"[\s\S]*<ol class="tf-log" role="list">/);
  assert.match(html, /data-form="gallery"[\s\S]*<div class="tf-gallery" id="looking-photographs"/);
  assert.match(html, /data-form="sleeve"/);
});

test('one close: the contact holds the call to action under one heading, the address its biggest link', () => {
  const html = sample();
  const close = html.slice(html.indexOf('class="tf-close"'), html.indexOf('<footer'));
  assert.equal(count(close, /<h[1-6]\b/g), 1);
  assert.match(
    close,
    /<p class="tf-close__mail"><a class="tf-display-link" href="mailto:anamika@example.com">/,
  );
  assert.match(html, /<section id="contact"[^>]*class="tf-close" data-ui-surface="accent">/);
  // Its one action reads on the field: a paper pill with the primary text (TF-M1).
  assert.match(
    STYLES,
    /\.tf-act--canvas \{\s*background-color: var\(--color-canvas\);\s*color: var\(--color-text-primary\);/,
  );
  assert.match(STYLES, /\.tf-close a:not\(\.tf-act\) \{\s*color: inherit;/);
});

test('the closing address underlines its own words: the line is the text’s, not the link’s round it', () => {
  // A decoration is painted by the box that declares it. Drawn by the link round the address's
  // words, it's what's behind them wherever a face sets its underline into their box (a Linux
  // fallback's from-font line: 2.19:1 on the address at 1440 and 390), so the words' own box
  // draws it, the same line every link has.
  const close = sample().slice(sample().indexOf('class="tf-close"'), sample().indexOf('<footer'));
  assert.match(close, /<a class="tf-display-link" href="mailto:[^"]+"><span>/);
  assert.match(STYLES, /\.tf-display-link:has\(> span\) \{\s*text-decoration-line: none;/);
  const own = /\.tf-display-link > span \{([^}]*)\}/.exec(STYLES)?.[1] ?? '';
  for (const declaration of [
    'text-decoration-line: underline;',
    'text-decoration-thickness: from-font;',
    'text-decoration-color: color-mix(in oklab, currentColor 42%, transparent);',
    'text-underline-offset: 0.22em;',
  ])
    assert.ok(own.includes(declaration), `the words' own line: ${declaration}`);
  assert.match(STYLES, /\.tf-display-link:hover > span \{\s*text-decoration-color: currentColor;/);
});

test('Field notes: a closed modal dialog, invoked with show-modal, Contact in its first lines (S2)', () => {
  const html = sample();
  assert.match(
    html,
    /<dialog class="tf-notes" id="tf--notes" aria-labelledby="tf--notes-title" closedby="any">/,
  );
  assert.equal(count(html, /commandfor="tf--notes" command="show-modal"/g), 3);
  assert.match(html, /commandfor="tf--notes" command="close"/);
  const notes = html.slice(html.indexOf('<dialog'), html.indexOf('</dialog>'));
  assert.ok(
    notes.indexOf('mailto:') < notes.indexOf('tf-notes__cols'),
    'the way to get in touch comes first',
  );
  assert.doesNotMatch(notes, /<dialog[^>]* open/);
});

test('the masthead: the name on the axis, five destinations, Field notes; the marker hidden words only', () => {
  const html = sample();
  const mast = html.slice(0, html.indexOf('<main'));
  assert.match(
    mast,
    /<header class="tf-mast" data-ui-surface="accent"><nav class="tf-page" aria-label="Site">/,
  );
  assert.equal(count(mast, /data-tf-to="/g), 5);
  assert.match(
    html,
    /<span class="tf-marker__where tf-label" id="tf--where" aria-hidden="true"><\/span>/,
  );
});

test('every accent ground claims K-2’s surface, so its focus ring is on-accent (TF-M7)', () => {
  const html = sample();
  for (const ground of [
    /<header class="tf-mast" data-ui-surface="accent">/,
    /<div class="tf-page" data-ui-surface="accent"><div class="tf-hero__inner">/,
    /class="tf-close" data-ui-surface="accent">/,
    /<footer class="tf-foot" data-ui-surface="accent">/,
    /<div class="tf-notes__ground" data-ui-surface="accent">/,
  ])
    assert.match(html, ground);
  // No destination field claims the accent ground: only the bookends hold it (S-6).
  assert.doesNotMatch(html, /<header class="tf-fieldhead"[^>]* data-ui-surface="accent">/);
  // The seal sits on the canvas, outside the hero's accent column.
  const hero = html.slice(html.indexOf('class="tf-hero'), html.indexOf('class="tf-seal'));
  assert.equal(count(hero, /data-ui-surface="accent"/g), 1);
});

test('quiet field: no region claims the accent ground, and the root says quiet', () => {
  const html = render(pairOf(SMALL, { field: 'quiet' }));
  assert.match(html, /<div class="tf-root" data-tf-field="quiet"/);
  assert.doesNotMatch(html, /data-ui-surface="accent"/);
});

test('the stylesheet: tokens only, the field from the scheme, focus never overridden, motion gated', () => {
  assert.doesNotMatch(STYLES, /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
  assert.doesNotMatch(
    STYLES,
    /--color-focus\s*:/,
    'focus inside a field comes from K-2, never a --color-focus override',
  );
  assert.match(
    STYLES,
    /--layout-field-ground: var\(--color-accent\);\s*--layout-field-ink: var\(--color-on-accent\);/,
  );
  // Every animation that travels sits under no-preference; reduce keeps a short fade.
  const reduce = STYLES.slice(STYLES.indexOf('@media (prefers-reduced-motion: reduce)'));
  assert.match(reduce, /terra-field-fade var\(--motion-feedback\)/);
  assert.match(
    STYLES,
    /\[data-variant='terra-field'\]\[data-motion='reduced'\]\s+\.tf-root:not\(:has\(> \* > \[data-tf-nojs\]\)\)\s+\.tf-hero__inner \{\s*animation: terra-field-fade var\(--motion-feedback\)/,
    "the owner's reduce gets the same short fade",
  );
  assert.doesNotMatch(STYLES, /infinite/);
  // Every rule naming keyframes that travel or scale is gated on no-preference and full motion.
  const moving = [...STYLES.matchAll(/@keyframes (terra-field-[\w-]+) \{([^@]*?)\n\}/g)]
    .filter(([, , body]) =>
      /translate|scale|transform|rotate|\binset|\bmargin|\bc[xy]:/.test(body!),
    )
    .map(([, name]) => name!);
  assert.ok(moving.length >= 5, moving.join(' '));
  const GATE = "[data-variant='terra-field']:not([data-motion='reduced'], [data-motion='static'])";
  // Every no-preference block's span, by its braces.
  const gated: [number, number][] = [];
  for (const head of STYLES.matchAll(/@media \(prefers-reduced-motion: no-preference\) \{/g)) {
    let depth = 0;
    let at = head.index! + head[0].length - 1;
    for (; at < STYLES.length; at++) {
      if (STYLES[at] === '{') depth++;
      else if (STYLES[at] === '}' && --depth === 0) break;
    }
    gated.push([head.index!, at]);
  }
  const check = (what: string, at: number) => {
    assert.ok(
      gated.some(([open, close]) => at > open && at < close),
      `${what} outside no-preference`,
    );
    // Each selector of the rule, not only one of a list (code re-review gap).
    for (const selector of selectorsAt(at))
      assert.ok(selector.includes(GATE), `${what} not gated on data-motion: ${selector}`);
  };
  // The shorthand or the animation-name longhand (code review low 3).
  for (const name of moving)
    for (const use of STYLES.matchAll(new RegExp(`animation(?:-name)?:[^;]*\\b${name}\\b`, 'g')))
      check(name, use.index!);
  // A transition that moves (transform, translate, scale, rotate, or all of them) is motion too,
  // through the shorthand or the transition-property longhand.
  const transitions = [
    ...STYLES.matchAll(
      /transition(?:-property)?:[^;]*\b(?:transform|translate|scale|rotate|all)\b[^;]*;/g,
    ),
  ];
  assert.ok(transitions.length >= 1);
  for (const use of transitions) check(use[0], use.index!);
  // No physical property, so right to left mirrors.
  assert.doesNotMatch(
    STYLES,
    /(?:^|[\s;{])(?:margin|padding)-(?:left|right)\s*:|(?:^|[\s;{])(?:left|right)\s*:/m,
  );
});

test('with no script the page shows at once: nothing waits at opacity 0 for an entrance, and no scripting query', () => {
  // The no-JavaScript rows audit with script on for axe, which a scripting query would flip.
  assert.doesNotMatch(STYLES, /@media[^{]*\bscripting\b/);
  // The page says it was read with no script by an element only the parser makes, in <noscript>.
  const work = sampleInput().portfolio.works.find(isRoutedWork)!;
  const pages = {
    home: renderInput(sampleInput()),
    case: renderInput({ ...sampleInput(), route: { route: 'work', slug: work.slug } }),
  };
  for (const [name, html] of Object.entries(pages))
    assert.match(
      html,
      /<div class="tf-root"[^>]*><noscript><i data-tf-nojs="" hidden=""><\/i><\/noscript>/,
      `${name}: the root's first child is the no-script mark`,
    );
  // The mark is never a box, nor a cell of the root's layout.
  assert.match(STYLES, /\.tf-root > :has\(> \[data-tf-nojs\]\) \{\s*display: none;/);
  // Every entrance that starts at opacity 0 plays only where the mark isn't: with no script the
  // opening is there from the first read, not waiting out a delay (WCAG 1.3.1, the inventory).
  const hiding = [...STYLES.matchAll(/@keyframes (terra-field-[\w-]+) \{([^@]*?)\n\}/g)]
    .filter(([, , body]) => /(?:from|0%)\s*\{[^}]*\bopacity:\s*0\b/.test(body!))
    .map(([, name]) => name!);
  assert.ok(hiding.length >= 3, hiding.join(' '));
  const SCRIPTED = '.tf-root:not(:has(> * > [data-tf-nojs]))';
  let uses = 0;
  for (const name of hiding)
    for (const use of STYLES.matchAll(new RegExp(`animation(?:-name)?:[^;]*\\b${name}\\b`, 'g'))) {
      uses++;
      for (const selector of selectorsAt(use.index!))
        assert.ok(selector.includes(SCRIPTED), `${name} plays with no script: ${selector}`);
    }
  assert.ok(uses >= 6, `${uses}`);
});

test('the marker chip is as tall as its words, and they carry its ground, whatever a pack’s raised level draws', () => {
  // The marker takes no room (block-size: 0); a stretched flex item would be its padding alone, its
  // words spilling past its ground onto a pack's inset band or hard offset (row 12: 3.46:1 under
  // international-grid, 1.37:1 under neobrutalist).
  assert.match(STYLES, /\.tf-marker \{[^}]*block-size: 0;[^}]*align-items: flex-start;[^}]*\}/);
  assert.match(
    STYLES,
    /\.tf-marker__chip > :is\(\.tf-marker__where, \[data-tf-notes\]\) \{\s*background-color: var\(--color-surface-overlay\);/,
  );
  assert.match(
    STYLES,
    /\.tf-marker__chip \{[^}]*background-color: var\(--color-surface-overlay\);/,
  );
});

test('right to left: the page keeps its order and its words, the composition’s own marked English', () => {
  const html = renderInput(fixtureInput('rtl'));
  assert.equal(count(html, /<h1\b/g), 1);
  assert.match(html, /lang="en"/);
});

test('with no year total, the calendar hidden from assistive technology still has its facts in words (#9)', () => {
  const input = sampleInput();
  const id = input.portfolio.sections.find((section) => section.kind === 'github')!.id;
  const derived = input.derived[id] as { state: string; value: Record<string, unknown> };
  assert.equal(derived.state, 'ready');
  const html = renderInput({
    ...input,
    derived: {
      ...input.derived,
      [id]: { ...derived, value: { ...derived.value, contributionsLastYear: null } },
    },
  } as typeof input);
  const days = (derived.value.contributionCalendar as { count: number }[]).slice(-364);
  const total = days.reduce((sum, day) => sum + day.count, 0);
  assert.ok(days.length > 0);
  assert.match(html, /<svg class="tf-gh__dots"[^>]*aria-hidden="true"/);
  assert.ok(
    html.includes(`${total.toLocaleString('en')}</span> contributions in the calendar`),
    'the caption counts what the calendar shows',
  );
});

test('Experience shows the current entries open and folds the earlier ones under one disclosure (S-1)', () => {
  const html = sample();
  const at = html.indexOf('<section id="experience"');
  const experience = html.slice(at, html.indexOf('</section>', at));
  const [open, folded] = experience.split(
    '<details class="tf-fold tf-chron__earlier" data-record="">',
  );
  assert.ok(folded, 'the earlier roles fold');
  assert.equal(count(open!, /<li /g), 2, 'the two current entries open (MF-4)');
  assert.match(
    folded!,
    /<summary class="tf-fold__summary"><span class="tf-title"><span class="tf-num">\d+<\/span> earlier (roles|entries)<\/span><\/summary>/,
  );
  assert.ok(count(folded!, /<li /g) >= 2);
});

test('Experience opens every current entry, newest first, and folds only the ended ones in written order (MF2, MF-4)', () => {
  const input = sampleInput();
  const section = input.portfolio.sections.find((s) => s.id === 'experience')!;
  assert.ok('items' in section && section.items);
  const byId = new Map(input.portfolio.chronology.map((entry) => [entry.id, entry]));
  const authored = section.items
    .filter((id): id is string => typeof id === 'string')
    .map((id) => byId.get(id)!);
  const current = authored.filter((entry) => entry.period.end === undefined);
  // The sample holds two concurrent current entries, one of them started later.
  assert.equal(current.length, 2);
  assert.notEqual(current[0]!.period.start, current[1]!.period.start);
  for (const items of [authored, newestFirst(authored).reverse()]) {
    const html = renderInput({
      ...input,
      portfolio: {
        ...input.portfolio,
        sections: input.portfolio.sections.map((s) =>
          s === section ? { ...s, items: items.map((entry) => entry.id) } : s,
        ),
      },
    } as typeof input);
    const at = html.indexOf('<section id="experience"');
    const experience = html.slice(at, html.indexOf('</section>', at));
    const [open, folded] = experience.split(
      '<details class="tf-fold tf-chron__earlier" data-record="">',
    );
    assert.ok(folded, 'the ended entries fold');
    const where = (text: string, entry: (typeof authored)[number]) =>
      text.indexOf(escaped(entry.title));
    // Every current entry open, newest first.
    const opened = newestFirst(current).map((entry) => where(open!, entry));
    assert.ok(
      opened.every((index) => index >= 0),
      'every current entry is open',
    );
    assert.deepEqual(
      opened,
      [...opened].sort((a, b) => a - b),
      'newest first',
    );
    assert.equal(count(open!, /<li /g), current.length);
    // Only the ended ones fold, in the order written, and the label counts them.
    const ended = items.filter((entry) => entry.period.end !== undefined);
    const rest = ended.map((entry) => where(folded!, entry));
    assert.ok(
      rest.every((index) => index >= 0),
      'every ended entry folds',
    );
    assert.deepEqual(
      rest,
      [...rest].sort((a, b) => a - b),
      'in the order written',
    );
    for (const entry of current) assert.equal(where(folded!, entry), -1, `${entry.id} folded`);
    assert.match(
      folded!,
      new RegExp(`<span class="tf-num">${ended.length}</span> earlier (roles|entries)<`),
    );
  }
});

test('a section titled only with its field’s word keeps its heading out of sight, not "About" twice (S-9)', () => {
  const input = sampleInput();
  const html = renderInput(input);
  const labels = homeModel(input).fields.map((field) => field.label.toLocaleLowerCase());
  const visible = [
    ...html.matchAll(
      /<h[2-6] class="tf-title tf-sechead__title"><span id="[^"]+">([^<]+)<\/span>/g,
    ),
  ].map(([, title]) => title!.trim().toLocaleLowerCase());
  for (const label of labels) assert.ok(!visible.includes(label), `${label} twice`);
  assert.match(html, /<h3 class="tf-sr"><span id="[^"]+">About<\/span><\/h3>/);
});

test('the full record folds behind closed disclosures, each keeping its frame, id and heading (Design gate 8)', () => {
  const html = sample();
  const folded = [
    ...html.matchAll(
      /<section id="([a-z-]+)"[^>]*data-fold=""><details class="tf-fold" data-record=""><summary class="tf-fold__summary"><h3/g,
    ),
  ].map(([, id]) => id);
  assert.deepEqual(folded, [
    'education',
    'publications',
    'talks',
    'awards',
    'patents',
    'press',
    'elsewhere',
    'on-github',
    'skills',
    'stack-i-currently-reach-for',
  ]);
  // The summary stays open: the figures, the voices, the roles, the works.
  for (const id of [
    'at-a-glance',
    'words-from-collaborators',
    'experience',
    'work-showcase',
    'essays',
  ])
    assert.match(
      html,
      new RegExp(`<section id="${id}"[^>]*class="tf-page tf-section" data-form="[a-z-]+">`),
      id,
    );
  assert.doesNotMatch(html, /<details class="tf-fold"[^>]* open/);
  // Print and no script show what's folded.
  assert.match(
    STYLES,
    /\[data-variant='terra-field'\]\s+\.tf-root:has\(> \* > \[data-tf-nojs\]\)\s+:is\(:target > details\.tf-fold, details\.tf-fold:has\(:target\)\)\s+> :not\(summary\) \{\s*display: grid;/,
  );
  assert.match(
    STYLES,
    /\[data-variant='terra-field'\]\s+\.tf-root:has\(> \* > \[data-tf-nojs\]\)\s+:is\(:target > details\.tf-fold, details\.tf-fold:has\(:target\)\)::details-content \{\s*content-visibility: visible;/,
  );
  assert.match(
    STYLES,
    /@media print \{[\s\S]*details\.tf-fold::details-content \{\s*content-visibility: visible;/,
  );
});

/** A small document for the control cases. */
const SMALL = {
  schemaVersion: 3,
  locale: 'en',
  direction: 'ltr',
  identity: { name: 'Rowan Hale', email: 'rowan@example.com' },
  practice: { thesis: 'Quiet tools last. Everything else is a draft.' },
  proof: ['years'],
  works: [{ id: 'loom', title: 'Loom', medium: 'software' }],
  evidence: [
    {
      id: 'years',
      type: 'metric',
      statement: 'Years building',
      metric: { value: 9, unit: 'years' },
    },
  ],
  sections: [
    { kind: 'hero', id: 'top', tagline: 'Makes small tools.' },
    { kind: 'practice', id: 'thesis', title: 'Practice', part: 'thesis' },
    { kind: 'works', id: 'work', title: 'Work', items: ['loom'] },
    { kind: 'evidence', id: 'numbers', title: 'Numbers', items: ['years'] },
    { kind: 'contact', id: 'contact', title: 'Get in touch' },
  ],
};

test('the opening never anchors on an image that isn’t ready, and an unavailable image keeps a frame (TF-M6)', () => {
  for (const name of FIXTURE_NAMES) {
    const html = renderInput(fixtureInput(name, 'as-loaded'));
    const at = html.indexOf('class="tf-page tf-band');
    if (at < 0) continue;
    const band = html.slice(at, html.indexOf('</section>', at));
    assert.doesNotMatch(band, /data-media-state="unavailable"/, name);
    assert.doesNotMatch(band, /tf-band__photo/, name);
  }
  assert.match(
    STYLES,
    /\.pf-media-box \{[^}]*background-color: var\(--color-surface-subtle\);[^}]*border: var\(--ui-border-divider\);/,
  );
});

test('the seal’s focus is a circle inset inside it, so the ring lies on its own ground (C2, TF-M7)', () => {
  // The platform's ring is the link's outline at its offset: the inset clears both, and a little more.
  assert.match(
    STYLES,
    /\.tf-seal__link \{\s*position: absolute;\s*inset: calc\(var\(--ui-focus-width\) \+ var\(--ui-focus-offset\) \+ var\(--space-3xs\)\);\s*border-radius: var\(--layout-round\);/,
  );
  // An outline-offset of its own would lose to the platform's later layer, and --ui-* isn't the variant's.
  assert.doesNotMatch(STYLES, /\.tf-seal[\w-]*:focus-visible \{[^}]*outline-offset/);
  assert.doesNotMatch(STYLES, /--ui-[\w-]+\s*:/);
});

test('the opening keeps four sizes at 1440: the lede and the plate figure at step 1 (T1)', () => {
  assert.match(STYLES, /\.tf-hero__lede \{[^}]*font-size: var\(--type-step-1\);/);
  assert.match(STYLES, /\.tf-plate__figure \{[^}]*font-size: var\(--type-step-1\);/);
});

test('every band plate carries its index, and the stylesheet places plates by it, never by element type (MF-4)', () => {
  for (const [name, input] of [
    ['sample', sampleInput()],
    ...FIXTURE_NAMES.map((each) => [each, fixtureInput(each, 'as-loaded')] as const),
    ...FIXTURE_NAMES.map((each) => [each, fixtureInput(each)] as const),
  ] as const) {
    const html = renderInput(input);
    const at = html.indexOf('class="tf-page tf-band');
    if (at < 0) continue;
    const band = html.slice(at, html.indexOf('</section>', at));
    const plates = [...band.matchAll(/class="tf-plate"[^>]*data-plate="(\d)"/g)].map((m) => m[1]);
    assert.deepEqual(
      plates,
      plates.map((_, i) => String(i + 1)),
      name,
    );
  }
  assert.doesNotMatch(STYLES, /\.tf-plate:nth-of-type/);
  // Two plates and no photograph: halves; with the photograph, the two 1fr tracks.
  assert.match(
    STYLES,
    /\.tf-band\[data-photo='none'\] \.tf-plate\[data-plate='1'\][^{]*\{\s*grid-column: 1 \/ 7;/,
  );
  assert.match(
    STYLES,
    /\.tf-band\[data-photo='none'\] \.tf-plate\[data-plate='2'\] \{\s*grid-column: 7 \/ 13;/,
  );
  assert.match(
    STYLES,
    /\.tf-band\[data-photo=''\] \.tf-plate\[data-plate='1'\] \{\s*grid-column: 7 \/ 10;/,
  );
  assert.match(
    STYLES,
    /\.tf-band\[data-photo=''\] \.tf-plate\[data-plate='2'\] \{\s*grid-column: 10 \/ 13;/,
  );
});
