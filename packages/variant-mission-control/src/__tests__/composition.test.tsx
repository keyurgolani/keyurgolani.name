import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { checkGrouping, pageOutline } from '@portfolio/kit/sections';
import { checkOutline } from '@portfolio/variant-contract/node';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import { boardGrouping, dateText, homeModel, KIND_WORDS, signalsOf } from '../model';
import { RENDERED_KINDS } from '../renderers';
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

// Mission Control's home page as the server sends it, so what these hold is
// also what a page with no JavaScript shows: one h1 (the name, in the anchor
// panel's bar), the rail and the status line, the Overview's square
// readouts and Latest, the boards in the fixed order, every section in a
// panel, and the colophon's index.

const sample = () => renderInput(sampleInput());
const STYLES = readFileSync(path.join(PACKAGE_DIR, 'src', 'styles.css'), 'utf8');

/** The sample and every contract fixture, by name. */
const ALL = (): readonly (readonly [string, VariantRenderInput])[] => [
  ['sample', sampleInput()],
  ...FIXTURE_NAMES.map((name) => [name, fixtureInput(name)] as const),
];

/** Markup's text, as a reader gets it: tags gone, entities read, spaces collapsed. */
const textOf = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/[\s\u2060]+/g, ' ');

/** Authored Markdown as it reads on the page: a link's words, no emphasis marks. */
const readAs = (source: string) =>
  source
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/** The markup from an element's opening to the next match of `end`. */
const between = (html: string, start: string, end: string) => {
  const at = html.indexOf(start);
  assert.ok(at >= 0, start);
  const stop = html.indexOf(end, at + start.length);
  return html.slice(at, stop < 0 ? undefined : stop);
};

/** Every element opening with `open` (a tag's start, such as '<span class="mc-lamp"'), whole. */
const elements = (html: string, open: string): string[] => {
  const tag = /^<([a-z0-9]+)/.exec(open)![1]!;
  const out: string[] = [];
  for (let at = html.indexOf(open); at >= 0; at = html.indexOf(open, at + 1)) {
    const pattern = new RegExp(`<${tag}\\b|</${tag}>`, 'g');
    pattern.lastIndex = at + 1;
    let depth = 1;
    let match: RegExpExecArray | null;
    while (depth > 0 && (match = pattern.exec(html))) depth += match[0].startsWith('</') ? -1 : 1;
    out.push(html.slice(at, pattern.lastIndex));
  }
  return out;
};

/** The Overview board's markup. */
const overviewOf = (html: string) =>
  between(html, 'class="mc-board mc-board--overview"', 'class="mc-board" id=');

/** Each wall's panel spans, in DOM order. */
const wallSpans = (html: string) =>
  html
    .split('<div class="mc-wall">')
    .slice(1)
    .map((wall) =>
      // A stack of short panels is one unit of the wall; its panels take its span, not their own.
      [...wall.matchAll(/class="mc-(?:panel|stack)[^"]*" data-span="(\d+)"/g)].map(([, n]) =>
        Number(n),
      ),
    );

/** The spans the stylesheet gives a rule, and the 16 a panel takes with none. */
const KNOWN_SPANS = new Set([
  16,
  ...[...STYLES.matchAll(/\.mc-panel\[data-span='(\d+)'\] \{/g)].map(([, n]) => Number(n)),
]);

test('the manifest renders every core kind itself, and nothing on any page is the kit’s (P2)', () => {
  assert.deepEqual([...MANIFEST.renderedKinds].sort(), [...RENDERED_KINDS].sort());
  assert.equal(RENDERED_KINDS.length, 14);
  assert.equal(MANIFEST.routes.home, 'bespoke');
  assert.equal(count(sample(), /data-renderer="shared"/g), 0, 'sample');
  for (const name of FIXTURE_NAMES)
    assert.equal(count(renderInput(fixtureInput(name)), /data-renderer="shared"/g), 0, name);
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
    assert.doesNotMatch(html, /<(ul|ol|dl)[^>]*><\/\1>/, `${name}: an empty list`);
  }
});

test('the boards never move a section: the grouping hook refuses nothing on the sample or any fixture', () => {
  const outlines = [sampleInput(), ...FIXTURE_NAMES.map((name) => fixtureInput(name))].map(
    (input) => pageOutline(input),
  );
  assert.deepEqual(checkGrouping({ grouping: boardGrouping(undefined) }, outlines), []);
  // overviewTail brings now and focus back to the Overview, still without moving a section.
  assert.deepEqual(
    checkGrouping({ grouping: boardGrouping(['now', 'currently-focused-on']) }, outlines),
    [],
  );
});

test('the anchor panel: the name is the h1 at title size, then the role, then the thesis’s first sentence, its rest the standfirst (MC-M1)', () => {
  const html = sample();
  assert.match(html, /<h1 class="mc-name" id="mc--name">Anamika Devi<\/h1>/);
  const anchor = html.slice(
    html.indexOf('class="mc-panel mc-anchor"'),
    html.indexOf('mc-readouts'),
  );
  assert.match(
    anchor,
    /<p class="mc-role"><span>Principal Engineer, Reliability<\/span> at <span class="mc-role__org">Solstice Payments<\/span><\/p>/,
  );
  assert.match(anchor, /<p class="mc-lede">.*I make failure legible\..*<\/p>/);
  // One statement, continued: the thesis's rest right under its first sentence, a step smaller.
  assert.match(
    anchor,
    /<p class="mc-lede">.*I make failure legible\..*<\/p><p class="mc-lede__rest"><span class="pf-rich-text">The systems I build, [^<]*so they can change what happens next\.<\/span><\/p>/,
  );
  // The hero's tagline opens About's lede panel instead (the sample has one).
  assert.doesNotMatch(anchor, /I build calm software/);
  // The thesis comes before the hero's actions, first by position.
  assert.ok(anchor.indexOf('I make failure legible.') < anchor.indexOf('Get in touch'));
});

test('the readouts are square modules of the first all-metric section, each linking to its record (MC-M3)', () => {
  const html = sample();
  const readouts = html.slice(html.indexOf('mc-readouts'), html.indexOf('mc-latest'));
  assert.equal(count(readouts, /class="mc-readout"/g), 4);
  assert.match(readouts, /href="#tenure-years"/);
  assert.match(readouts, /<span class="mc-readout__label">Years engineering<\/span>/);
  assert.match(STYLES, /\.mc-readout \{[^}]*aspect-ratio: 1;/);
  // Each record they name is on the page.
  for (const id of ['tenure-years', 'services-owned', 'essays-published', 'books-in-progress'])
    assert.match(html, new RegExp(`id="${id}"`));
});

test('Latest lists the newest three dated records of all of them, with a route to the rest (MC-S8)', () => {
  const html = sample();
  const latest = html.slice(html.indexOf('mc-latest'), html.indexOf('id="now"'));
  assert.equal(count(latest, /class="mc-latest__item"/g), 3);
  assert.match(
    latest,
    /<span class="mc-num">3<\/span> of <span class="mc-num">\d+<\/span> dated records/,
  );
  // The rest are on whichever boards hold them, each its own link, never one board for all.
  const foot = latest.slice(latest.indexOf('mc-panel__foot'));
  assert.match(foot, /The rest on /);
  for (const [href, label] of [
    ['#work-showcase', 'Work'],
    ['#essays', 'Writing'],
    ['#at-a-glance', 'Record'],
  ])
    assert.ok(foot.includes(`<a class="mc-link" href="${href}">${label}</a>`), label);
  assert.doesNotMatch(foot, /the Record board/);
});

/** A panel's markup, from its frame's opening tag to its first closing one. */
const panelOf = (html: string, id: string) => {
  const at = html.indexOf(`<section id="${id}"`);
  assert.ok(at >= 0, `panel ${id}`);
  return html.slice(at, html.indexOf('</section>', at));
};

test('every panel has a title bar, and every panel with items counts them on it (MC-M2)', () => {
  const html = sample();
  // Every kind is the composition's own form under its bar: no kit header, no kit renderer.
  assert.doesNotMatch(html, /pf-section__header/);
  assert.doesNotMatch(html, /data-renderer="shared"/);
  for (const [id, words] of [
    ['experience', /<span class="mc-num">4<\/span> entries/],
    ['education', /<span class="mc-num">2<\/span> entries/],
    ['on-github', /<span class="mc-num">3<\/span> repositories/],
    ['off-the-page', /<span class="mc-num">4<\/span> items/],
  ] as const) {
    const panel = panelOf(html, id);
    assert.match(panel, /^<section[^>]*data-renderer="bespoke"/, `${id} is MC's own`);
    // Its bar, or the full record's bar as its closed disclosure's summary.
    assert.match(
      panel,
      /<(?:header class="mc-bar"|summary class="mc-bar mc-fold__bar")><h3 class="mc-bar__title">/,
      `${id} has MC's bar`,
    );
    assert.match(panel, words, `${id} counts its items`);
  }
  // The items keep their level, one under the bar's heading.
  assert.match(panelOf(html, 'experience'), /<h4 class="mc-log__title">/);
  // An untitled panel's bar names its kind, as a label, not a heading the owner didn't write.
  const quote = panelOf(html, 'quote');
  assert.match(quote, /<header class="mc-bar"><p class="mc-bar__title">Quote<\/p><\/header>/);
  // Prose kinds have no items, so their bars carry no count.
  for (const id of ['about', 'contact']) assert.doesNotMatch(panelOf(html, id), /mc-count/, id);
  for (const panel of html.matchAll(
    /<section id="[^"]*"[^>]*class="mc-panel[^"]*"[^>]*>(.{0,80})/g,
  ))
    assert.match(
      panel[1]!,
      /^(?:<header class="mc-bar">|<details class="mc-fold" data-mc-fold=""><summary class="mc-bar mc-fold__bar">)/,
      'every wall panel opens on its bar',
    );
});

test('the full record’s closed panels span the row, a log with no dates has no date track, and the owner’s metric title shows once (G2)', () => {
  const html = sample();
  // On a board's end, each of the full record's panels is a closed bar the row's width.
  for (const id of ['on-github', 'elsewhere', 'skills'])
    assert.match(
      panelOf(html, id),
      /^<section[^>]*data-span="16" data-fold=""/,
      `${id} is a closed bar across the row`,
    );
  // No kit stack is left to flow: every kind is the composition's own.
  assert.doesNotMatch(STYLES, /\.pf-(?:list|short-list|groups)\b/);
  assert.doesNotMatch(STYLES, /mc-panel--kit/);
  const elsewhere = panelOf(html, 'elsewhere');
  assert.match(elsewhere, /<ol class="mc-log" data-dated="none">/);
  assert.doesNotMatch(elsewhere, /mc-log__date/);
  // The readouts' bar is theirs, and routes to the ledger the owner titled.
  assert.equal(count(html, /class="mc-bar__title"><span[^>]*>At a glance</g), 1);
  assert.match(html, /<a class="mc-link" href="#at-a-glance">Ledger on <span>Record<\/span><\/a>/);
});

test('the status line carries only real readings, and nothing invented (MC-M6, N4)', () => {
  const input = sampleInput();
  const html = renderInput(input);
  const status = between(html, '<header id="mc--status"', '<main');
  // An allowlist, not a denylist: the line's words are the owner's name and the readings the
  // fields give, exactly, and nothing else.
  const readings = signalsOf(input).map(({ label, text }) => `${label} ${text}`);
  assert.deepEqual(readings, ['Now, updated Apr 15, 2026', 'Last push Oct 15, 2026']);
  assert.equal(textOf(status).trim(), ['Anamika Devi', ...readings].join(' '));
  assert.deepEqual(
    elements(status, '<span class="mc-lamp"').map((lamp) => textOf(lamp).trim()),
    readings,
  );
  for (const invented of [/ALL SYSTEMS NOMINAL/i, /Uptime/i, /Email open/i, /Open to talk/i])
    assert.doesNotMatch(html, invented);
});

test('every lamp on the sample and every fixture says a state its record’s fields give (MC-M6)', () => {
  for (const [name, input] of ALL()) {
    const html = renderInput(input);
    const awards = input.portfolio.evidence.flatMap((record) =>
      record.type === 'award' && record.title ? [readAs(record.title)] : [],
    );
    const now = signalsOf(input).find(({ key }) => key === 'now');
    const state =
      /^(?:Archived|Active since .+|Shipped \d{4}|Published .+|Released .+|Current|Ended|Granted(?: \d{4})?|Filed(?: \d{4})?|Now, updated .+|Last push .+)$/;
    // A github section's repositories the owner featured (featuredRepos) say so.
    const featured = new Set(
      input.portfolio.sections.flatMap((section) =>
        section.kind === 'github' ? (section.featuredRepos ?? []) : [],
      ),
    );
    for (const lamp of elements(html, '<span class="mc-lamp"')) {
      const words = textOf(lamp).trim();
      assert.ok(
        state.test(words) ||
          awards.includes(words) ||
          words === now?.text ||
          (words === 'Featured' && featured.size > 0),
        `${name}: an invented lamp, "${words}"`,
      );
    }
  }
});

test('the boards follow the destinations in the fixed order, Writing among them when there is writing', () => {
  const html = sample();
  const order = [...html.matchAll(/class="mc-board" id="mc--board-([a-z]+)"/g)].map(([, id]) => id);
  assert.deepEqual(order, ['work', 'writing', 'record', 'about', 'contact']);
  const rail = html.slice(html.indexOf('class="mc-rail"'), html.indexOf('class="mc-status"'));
  assert.equal(count(rail, /class="mc-rail__link"/g), 5);
});

test('every panel on the sample and every fixture takes a span the wall knows, and each row of a board sums to 16', () => {
  assert.deepEqual(
    [...KNOWN_SPANS].sort((a, b) => a - b),
    [4, 6, 8, 10, 12, 14, 16],
  );
  for (const [name, input] of ALL()) {
    for (const [index, spans] of wallSpans(renderInput(input)).entries()) {
      let row = 0;
      for (const span of spans) {
        assert.ok(KNOWN_SPANS.has(span), `${name} wall ${index}: span ${span} has no rule`);
        row += span;
        assert.ok(row <= 16, `${name} wall ${index}: a row overflows 16 (${spans})`);
        if (row === 16) row = 0;
      }
      assert.equal(row, 0, `${name} wall ${index}: the last row closes short of 16 (${spans})`);
    }
  }
});

test('a single metric: its readouts take 4 columns, one square, and the Overview’s row still sums to 16', () => {
  // complete lists one metric with a value.
  const html = renderInput(fixtureInput('complete'));
  assert.match(html, /class="mc-panel mc-readouts" data-span="4"/);
  assert.equal(count(overviewOf(html), /class="mc-readout"/g), 1);
  assert.deepEqual(wallSpans(html)[0], [6, 4, 6]);
});

test('every thesis, hero tagline and identity tagline the owner wrote is on the page, the sample and every fixture (N3)', () => {
  for (const [name, input] of ALL()) {
    const page = textOf(renderInput(input));
    const authored = [
      ['the thesis', input.portfolio.practice?.thesis],
      ['the identity tagline', input.portfolio.identity.tagline],
      ...input.portfolio.sections.flatMap((section) =>
        section.kind === 'hero' ? [[`${section.id}'s tagline`, section.tagline] as const] : [],
      ),
    ] as const;
    for (const [what, source] of authored)
      if (source && source.trim() !== '')
        assert.ok(page.includes(readAs(source)), `${name}: ${what} is missing`);
  }
});

test('the thesis and the hero’s tagline each show once: the thesis in the anchor, the tagline opening About’s lede panel (N3, N6)', () => {
  for (const [name, input] of ALL()) {
    const html = renderInput(input);
    const page = textOf(html);
    const model = homeModel(input);
    // The lede's first sentence is on the page exactly once, its rest with it.
    if (model.lede) {
      const lede = readAs(model.lede);
      assert.equal(page.split(lede).length - 1, 1, `${name}: the lede shows more than once`);
    }
    // No panel off the Overview is titled as the thesis section is.
    const title = model.thesis && 'title' in model.thesis ? model.thesis.title : undefined;
    if (title)
      for (const [, bar] of html.matchAll(/<h3 class="mc-bar__title"><span[^>]*>([^<]*)</g))
        assert.notEqual(bar, escaped(title), `${name}: a second "${title}" panel`);
    assert.doesNotMatch(html, /mc--statement|mc-statement/, `${name}: a Statement panel`);
  }
  const html = sample();
  const about = panelOf(html, 'about');
  assert.match(
    about,
    /<div class="mc-panel__body"><p class="mc-panel__standfirst"><span class="pf-rich-text">I build calm software at scale, [^<]*<\/span><\/p>/,
  );
  // With the thesis as the lede and no About text, the tagline sits in the anchor, above the
  // subtagline.
  const bare = renderInput(
    inputFor(
      pairOf({
        schemaVersion: 3,
        locale: 'en',
        direction: 'ltr',
        identity: { name: 'Sam Q' },
        practice: { thesis: 'Pots should pour. The rest is glaze.' },
        sections: [
          {
            kind: 'hero',
            id: 'top',
            tagline: 'I throw pots for kitchens.',
            subtagline: 'Studio in Leith.',
          },
          { kind: 'practice', id: 'thesis', part: 'thesis' },
        ],
      }),
    ),
  );
  const anchor = between(bare, 'class="mc-panel mc-anchor"', '</main>');
  assert.match(
    anchor,
    /<p class="mc-lede"><span class="pf-rich-text">Pots should pour\.<\/span><\/p><p class="mc-lede__rest"><span class="pf-rich-text">The rest is glaze\.<\/span><\/p>/,
  );
  assert.ok(anchor.indexOf('class="mc-anchor__tagline"') > 0, 'the tagline is in the anchor');
  assert.ok(anchor.indexOf('I throw pots') < anchor.indexOf('Studio in Leith.'));
});

test('with no hero and no thesis, the anchor says the identity’s tagline itself (N5)', () => {
  const html = renderInput(fixtureInput('writing'));
  const anchor = between(html, 'class="mc-panel mc-anchor"', 'class="mc-panel mc-latest"');
  assert.match(
    anchor,
    /<div class="mc-anchor__body"><p class="mc-lede"><span class="pf-rich-text">Essayist and novelist<\/span><\/p><\/div>/,
  );
  // Every page with a lede shows it in its anchor, whichever part draws it.
  for (const [name, input] of ALL()) {
    const lede = homeModel(input).lede;
    if (!lede) continue;
    const body = between(renderInput(input), 'class="mc-anchor__body"', 'class="mc-panel mc-');
    assert.ok(textOf(body).includes(readAs(lede)), `${name}: the anchor has no lede`);
  }
});

test('the Overview holds the anchor, the readouts and Latest only; the metrics render whole on Record (K-1)', () => {
  for (const [name, input] of ALL()) {
    const html = renderInput(input);
    const overview = overviewOf(html);
    // No section frame but the anchor's parts, and no ledger: the readouts only summarise.
    for (const [, cls] of overview.matchAll(/<section id="[^"]*"[^>]*class="([^"]*)"/g))
      assert.equal(cls, 'mc-anchor__part', `${name}: the Overview holds a ${cls}`);
    assert.doesNotMatch(overview, /mc-ledger/, `${name}: a ledger on the Overview`);
  }
  const html = sample();
  const record = between(html, 'id="mc--board-record"', 'class="mc-board" id=');
  assert.match(panelOf(record, 'at-a-glance'), /<dl class="mc-ledger">/);
});

test('a mixed evidence section keeps a testimonial’s source and a metric’s figure (consulting, and a crafted section)', () => {
  const clients = panelOf(renderInput(fixtureInput('consulting')), 'clients');
  assert.match(
    clients,
    /<blockquote class="mc-quote__text">[\s\S]*Marcus turned a six-month rewrite into a three-week migration\.[\s\S]*<\/blockquote><figcaption class="mc-quote__source"><span class="mc-quote__who"><span class="mc-quote__name">Priya Nair<\/span><span class="mc-quote__role">CEO/,
  );
  assert.doesNotMatch(
    clients,
    /<h4[^>]*>[^<]*(?:<[^/][^>]*>)*Marcus turned/,
    'a quote is not a title',
  );
  const html = renderInput(
    inputFor(
      pairOf({
        schemaVersion: 3,
        locale: 'en',
        direction: 'ltr',
        identity: { name: 'Sam Q' },
        evidence: [
          {
            id: 'uptime-kept',
            type: 'metric',
            statement: 'Quarters without a sev-1',
            description: 'Since the rewrite.',
            metric: { key: 'quarters', value: 12, unit: 'quarters' },
          },
          {
            id: 'prize',
            type: 'award',
            title: 'Reliability prize',
            statement: 'For the rewrite.',
            description: 'Judged by peers.',
            receivedAt: '2025-05-01',
          },
        ],
        sections: [
          { kind: 'evidence', id: 'proof', title: 'Proof', items: ['uptime-kept', 'prize'] },
        ],
      }),
    ),
  );
  const proof = panelOf(html, 'proof');
  assert.match(
    proof,
    /<p class="mc-log__figure"><span class="mc-num">12<\/span><span class="mc-ledger__unit"> quarters<\/span><\/p>/,
  );
  // A record with a title, a statement and a description keeps all three.
  for (const words of [
    'Reliability prize',
    'For the rewrite.',
    'Judged by peers.',
    'Since the rewrite.',
  ])
    assert.ok(textOf(proof).includes(words), words);
});

test('an untitled panel’s bar says its kind in the composition’s words, never the schema’s id', () => {
  const words = new Set(Object.values(KIND_WORDS));
  for (const [name, input] of ALL()) {
    for (const [, label] of renderInput(input).matchAll(
      /<p class="mc-bar__title">(?:<span lang="en">)?([^<]*)/g,
    ))
      assert.ok(words.has(label!), `${name}: an untitled bar says "${label}"`);
  }
  assert.equal(KIND_WORDS.github, 'GitHub');
  assert.equal(KIND_WORDS.lede, 'Introduction');
});

test('the readings on the status line use the page’s locale', () => {
  const input = sampleInput();
  assert.equal(signalsOf(input)[0]!.text, dateText('2026-04-15', input.portfolio.locale));
});

test('the stylesheet: no colour or family literal, motion only inside no-preference', () => {
  assert.doesNotMatch(STYLES, /#[0-9a-f]{3,8}\b/i);
  assert.doesNotMatch(STYLES, /font-family:(?!\s*var\()/);
  assert.doesNotMatch(STYLES, /animation:/);
});

test('the full record waits behind closed native panels at the end of its board, and opens with no script from a link and on paper (Design gate rule 8)', () => {
  const input = sampleInput();
  const html = renderInput(input);
  const folded = [...html.matchAll(/<section[^>]*data-fold=""[^>]*>/g)];
  assert.ok(folded.length > 0, 'some of the sample folds');
  // Closed, never open by default, each with its bar as the summary holding its heading.
  assert.doesNotMatch(html, /<details[^>]*\sopen/);
  assert.equal(count(html, /<details class="mc-fold"/g), folded.length);
  // Within a board, no open panel follows a folded one.
  for (const [, board] of html.matchAll(/<div class="mc-wall">([\s\S]*?)<\/div><\/section>/g)) {
    const kinds = [...board!.matchAll(/<section[^>]*class="mc-panel([^"]*)"/g)].map(([, cls]) =>
      cls!.includes('mc-panel--fold'),
    );
    const first = kinds.indexOf(true);
    if (first >= 0) assert.ok(kinds.slice(first).every(Boolean), 'folds end the board');
  }
  // The figures, the voices, the roles and every work stay open.
  for (const section of input.portfolio.sections) {
    if (section.kind === 'works')
      assert.doesNotMatch(html, new RegExp(`id="${section.id}"[^>]*data-fold`), section.id);
  }
  // No script (the root without the record enhancement's mark): a link to a folded panel shows
  // it; on paper every one is open.
  assert.match(STYLES, /\.mc-root:not\(\[data-mc-folds\]\)\s*:is\(:target > details\.mc-fold/);
  assert.match(STYLES, /@media print[\s\S]*details\.mc-fold::details-content/);
});

test('correlate on the page: every record a record names carries its mark, and each Linked control opens its own list with no script (MC-M4, MC-M5)', () => {
  for (const [name, input] of [
    ['sample', sampleInput()] as const,
    ['complete', fixtureInput('complete')] as const,
  ]) {
    const html = renderInput(input);
    const marked = new Set([...html.matchAll(/\sdata-mc-rec="([^"]+)"/g)].map(([, id]) => id!));
    const naming = [...html.matchAll(/\sdata-mc-names="([^"]+)"/g)];
    assert.ok(naming.length > 0, `${name}: some record names another`);
    for (const [, names] of naming)
      for (const id of names!.split(' ')) assert.ok(marked.has(id), `${name}: ${id} has no mark`);
    const ids = new Set(idsIn(html));
    const targets = [...html.matchAll(/\spopovertarget="([^"]+)"/gi)].map(([, id]) => id!);
    assert.ok(targets.length > 0, `${name}: a Linked control`);
    for (const target of targets) {
      assert.ok(ids.has(target), `${name}: ${target} is on the page`);
      assert.match(html, new RegExp(`popover="auto" id="${target}"`), `${name}: ${target}`);
    }
    // The pin is a native button; the island that lights is the only script, and it's declared.
    assert.equal(count(html, /data-mc-pin=/g), targets.length);
  }
  assert.deepEqual(
    MANIFEST.enhancements?.map(({ id }) => id),
    ['correlate', 'record'],
  );
  // Off, nothing is marked and there's no control.
  const base = sampleInput();
  const off = renderInput({ ...base, controls: { ...base.controls, correlate: false } });
  assert.doesNotMatch(off, /data-mc-(rec|names|pin)=|popover=/);
});
