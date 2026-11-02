import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pageOutline } from '@portfolio/kit/sections';
import { checkOutline } from '@portfolio/variant-contract/node';
import { homeModel } from '../model';
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
  render,
  renderInput,
  sampleInput,
} from './harness.test';

// Raw Grid's home page, rendered as the server sends it, so what these hold
// is also what a page with no JavaScript shows: one h1 (the thesis, the
// owner's name its hidden prefix; the name on the poster is display type),
// the opening's thesis and pinned work, the sheets in the fixed
// order with every section in its own band, the ticker hidden from
// assistive technology over facts the page shows as text, stickers that
// link to records on the page, and one closing block.

const sample = () => renderInput(sampleInput());

test('every core kind renders bespoke, and the manifest says so', () => {
  assert.equal(MANIFEST.renderedKinds.length, 14);
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
    // Every id once, and every fragment link lands.
    const ids = idsIn(html);
    assert.equal(new Set(ids).size, ids.length, `${name}: an id repeats`);
    const known = new Set([...ids, input.ids.main]);
    for (const fragment of fragmentLinks(html))
      assert.ok(known.has(fragment), `${name}: #${fragment} lands nowhere`);
    // The ticker's facts and the stickers' records are on the page as DOM text.
    const model = homeModel(input);
    for (const { id } of [...model.ticker, ...model.stickers])
      assert.ok(known.has(id), `${name}: ${id} isn't on the page`);
    // Every region's name points at an element, and every titled section shows
    // its title, the hero's included (as the poster's tape).
    for (const [, labels] of html.matchAll(/\saria-labelledby="([^"]+)"/g))
      for (const label of labels!.split(' '))
        assert.ok(known.has(label), `${name}: aria-labelledby ${label} names nothing`);
    for (const section of input.portfolio.sections)
      if ('title' in section && typeof section.title === 'string' && section.title.trim() !== '')
        assert.ok(
          html.includes(escaped(section.title)),
          `${name}: ${section.id}'s title "${section.title}" is missing`,
        );
  }
});

test('the opening: the thesis is the one h1, the name its prefix, the poster name display type, the pinned work under it (N5)', () => {
  const html = sample();
  assert.equal(count(html, /<h1\b/g), 1);
  assert.match(
    html,
    /<h1 class="rg-thesis__lead"><span class="rg-hidden">Anamika Devi: <\/span><span class="rg-name rg-fit" style="--layout-name-chars:8"><span class="pf-rich-text">I make failure legible\.<\/span><\/span><\/h1>/,
  );
  assert.match(
    html,
    /<p class="rg-name" style="--layout-name-chars:7"><span class="rg-name__line">Anamika <\/span><span class="rg-name__line">Devi<\/span><\/p>/,
  );
  // The tapes are labels, so the sheets' h2s follow the h1 with nothing between.
  assert.match(html, /<p class="rg-tab"><span id="thesis--head">Practice<\/span><\/p>/);
  const headings = [...html.matchAll(/<h([1-6])\b/g)].map(([, n]) => Number(n));
  assert.deepEqual(headings.slice(0, 2), [1, 2]);
  assert.match(html, /id="rg--pin"[^>]*>[\s\S]*Signature work[\s\S]*Postmortem Template Kit/);
  // The greeting never leads (N5).
  assert.doesNotMatch(html, /Hello, I&#x27;m/);
});

test('a thesis too long for a headline is a paragraph, and the poster name is the h1', () => {
  const html = render(
    pairOf({
      schemaVersion: 3,
      locale: 'en',
      direction: 'ltr',
      identity: { name: 'Kai Bell' },
      practice: {
        thesis:
          'I keep long careful records of every system I run and every change. Then I read them.',
      },
      sections: [
        { kind: 'hero', id: 'top', tagline: 'Keeps records.' },
        { kind: 'practice', id: 'thesis', title: 'Practice', part: 'thesis' },
      ],
    }),
  );
  assert.equal(count(html, /<h1\b/g), 1);
  assert.match(html, /<h1 class="rg-name"[^>]*><span class="rg-name__line">Kai <\/span>/);
  assert.match(html, /class="pf-rich-text rg-thesis__whole"><p>I keep long careful records/);
});

test('a second titled hero shows its title once, in its band head, under one id', () => {
  const html = render(
    pairOf({
      schemaVersion: 3,
      locale: 'en',
      direction: 'ltr',
      identity: { name: 'Kai Bell' },
      sections: [
        { kind: 'hero', id: 'top', title: 'Opening', tagline: 'Keeps records.' },
        { kind: 'hero', id: 'again', title: 'Second poster', tagline: 'Keeps more.' },
      ],
    }),
  );
  const ids = idsIn(html);
  assert.equal(new Set(ids).size, ids.length, 'an id repeats');
  const main = /<main[\s\S]*<\/main>/.exec(html)![0];
  assert.equal(count(main, />Second poster</g), 1);
  assert.match(html, /<p class="rg-tab rg-poster__tab"><span id="top--head">Opening<\/span><\/p>/);
});

test('the pinned work falls back to the first featured, then the first shown, each named for why', () => {
  const doc = {
    schemaVersion: 3,
    locale: 'en',
    direction: 'ltr',
    identity: { name: 'Kai Bell' },
    works: [
      { id: 'one', title: 'First thing', medium: 'research' },
      { id: 'two', title: 'Second thing', medium: 'research' },
    ],
    sections: [{ kind: 'works', id: 'things', title: 'Things', items: ['one', 'two'] }],
  };
  const featured = render(pairOf({ ...doc, featured: ['two'] }));
  assert.match(featured, /id="rg--pin"[\s\S]*?Featured work[\s\S]*?Second thing/);
  const first = render(pairOf(doc));
  assert.match(first, /id="rg--pin"[\s\S]*?<p class="rg-meta">Work<\/p>[\s\S]*?First thing/);
  assert.doesNotMatch(first, /Featured work|Signature work/);
});

test('the signature work shows once: the pinned cell, and a back-reference where its section lists it (RG-S6)', () => {
  const html = sample();
  assert.equal(count(html, /class="rg-card__title"[^>]*>(?:<a[^>]*>)?Postmortem Template Kit/g), 0);
  assert.match(
    html,
    /<p class="rg-ref" id="postmortem-template-kit">.*Pinned above:.*<a href="#rg--pin">Postmortem Template Kit<\/a>/,
  );
});

test('the stickers: facts from records on the page, each a link to its record, the first on emphasis', () => {
  const input = sampleInput();
  const { stickers } = homeModel(input);
  assert.deepEqual(
    stickers.map(({ id, tone }) => [id, tone]),
    [
      ['srecon-practitioner-award', 'emphasis'],
      ['a-survey-of-anti-entropy-mechanisms-in-production-systems', 'plain'],
      ['principal-engineer-reliability-solstice-payments', 'plain'],
    ],
  );
  // The record's own words, with one kit word at most ("Published in").
  assert.deepEqual(
    stickers.map(({ line, sub, own }) => [line, sub, own]),
    [
      ['SREcon Practitioner Award', '2025', undefined],
      ['Published in', 'ACM Computing Surveys', 'line'],
      ['Principal Engineer, Reliability', 'Solstice Payments', undefined],
    ],
  );
  const html = renderInput(input);
  const ids = new Set(idsIn(html));
  for (const sticker of stickers) {
    assert.ok(ids.has(sticker.id), `${sticker.id} is on the page`);
    assert.match(html, new RegExp(`<li class="rg-sticker"[^>]*><a href="#${sticker.id}">`));
  }
});

test('the stickers control picks them, and with none the poster closes up', () => {
  const doc = {
    schemaVersion: 3,
    locale: 'en',
    direction: 'ltr',
    identity: { name: 'Kai Bell' },
    evidence: [
      { id: 'a', type: 'award', title: 'First prize', receivedAt: '2020' },
      { id: 'b', type: 'award', title: 'Second prize', receivedAt: '2024' },
    ],
    sections: [
      { kind: 'hero', id: 'top', tagline: 'Keeps records.' },
      { kind: 'evidence', id: 'awards', title: 'Awards', items: ['a', 'b'] },
    ],
  };
  assert.deepEqual(
    homeModel(inputFor(pairOf(doc))).stickers.map(({ id }) => id),
    ['b'],
  );
  assert.deepEqual(
    homeModel(inputFor(pairOf(doc, { stickers: ['a'] }))).stickers.map(({ id }) => id),
    ['a'],
  );
  // A stale control, every id gone or off the page, falls back to the default.
  assert.deepEqual(
    homeModel(inputFor(pairOf(doc, { stickers: ['gone'] }))).stickers.map(({ id }) => id),
    ['b'],
  );
  // A publication with no venue is its title alone, with no kit word.
  const paper = inputFor(
    pairOf({
      ...doc,
      evidence: [{ id: 'p', type: 'publication', title: 'On keeping records' }],
      sections: [doc.sections[0], { kind: 'evidence', id: 'pubs', title: 'Papers', items: ['p'] }],
    }),
  );
  assert.deepEqual(
    homeModel(paper).stickers.map(({ line, sub, own }) => [line, sub, own]),
    [['On keeping records', undefined, undefined]],
  );
  const noEvidence = Object.fromEntries(Object.entries(doc).filter(([key]) => key !== 'evidence'));
  const bare = renderInput(inputFor(pairOf({ ...noEvidence, sections: [doc.sections[0]] })));
  assert.doesNotMatch(bare, /rg-stickers|rg-poster--stuck/);
});

test('the ticker: hidden from assistive technology, every fact shown elsewhere as text, off by control', () => {
  const input = sampleInput();
  const html = renderInput(input);
  assert.match(html, /<div class="rg-ticker__track" aria-hidden="true">/);
  // The pause is the kit's MotionControl, in the ticker's end cell; the ticker starts static, which
  // hides the cell until the client module runs it, so no script means no dead control.
  assert.match(html, /<div class="rg-ticker" data-ticker="static">/);
  assert.match(html, /<span class="rg-ticker__control" data-motion-control="">/);
  assert.match(html, /aria-pressed="false"[^>]*>[^]*?Pause motion/);
  // Under the site's reduce policy MotionControl renders nothing.
  const reduce = {
    ...input,
    presentation: { ...input.presentation, motionPolicy: 'reduce' as const },
  };
  assert.doesNotMatch(renderInput(reduce), /data-motion-control/);
  const ids = new Set(idsIn(html));
  for (const fact of homeModel(input).ticker)
    assert.ok(ids.has(fact.id), `${fact.id} shows on the page`);
  const off = inputFor(
    pairOf(
      {
        schemaVersion: 3,
        locale: 'en',
        direction: 'ltr',
        identity: { name: 'Kai Bell' },
        evidence: [
          { id: 'm1', type: 'metric', statement: 'Things made', metric: { value: 3 } },
          { id: 'm2', type: 'metric', statement: 'Things kept', metric: { value: 4 } },
        ],
        sections: [{ kind: 'evidence', id: 'facts', title: 'Facts', items: ['m1', 'm2'] }],
      },
      { ticker: false },
    ),
  );
  assert.doesNotMatch(renderInput(off), /rg-ticker/);
});

test('the header row: the name, five destinations with a counted unit, the where cell hidden, the Index a real link', () => {
  const html = sample();
  const nav = /<nav class="rg-head__row" aria-label="Site">([\s\S]*?)<\/nav>/.exec(html)![1]!;
  assert.equal(count(nav, /class="rg-go rg-head__dest"/g), 5);
  assert.match(
    nav,
    /<span>Work<\/span><span class="rg-num rg-count">4<span class="rg-hidden"> sections<\/span>/,
  );
  assert.match(nav, /<p class="rg-head__where" aria-hidden="true">/);
  assert.match(
    nav,
    /<span class="rg-head__index"><a class="rg-go" href="#rg--index" data-rg-index="">/,
  );
});

test('the index lists every column it draws, a one-section sheet and Contact too', () => {
  const html = sample();
  const index = /<nav class="rg-index"[\s\S]*?<\/nav>/.exec(html)![0];
  const columns = index.split('class="rg-index__col"').slice(1);
  assert.equal(columns.length, 5);
  for (const column of columns) assert.match(column, /^[^]*?<ul role="list"><li><a href="#/);
  assert.match(index, /href="#rg--writing"[^>]*>Writing<\/a><ul role="list"><li><a href="#essays"/);
  assert.match(index, />Contact<\/a><ul role="list"><li><a href="#/);
});

test('the sheets come in the fixed order, each an h2 region with its sections at h3', () => {
  const html = sample();
  const order = [...html.matchAll(/data-sheet="([a-z]+)"/g)].map(([, id]) => id);
  assert.deepEqual(order, ['work', 'writing', 'record', 'about']);
  assert.match(
    html,
    /<h2 class="rg-cell rg-sheet__word" id="rg--work-title"><span class="rg-name rg-fit" style="--layout-name-chars:4">Work<\/span><\/h2>/,
  );
  assert.match(
    html,
    /<h3 class="rg-tab"><span id="work-showcase--head"><span class="rg-name rg-fit" style="--layout-name-chars:8">Work Showcase<\/span><\/span><\/h3>/,
  );
  // A sheet of one section has no table of contents.
  const writing = /data-sheet="writing">([\s\S]*?)<\/section><section class="rg-sheet"/.exec(
    html,
  )![1]!;
  assert.doesNotMatch(writing, /rg-sheet__toc/);
});

test('counts are items: a series of photographs counts its frames (RG-M4)', () => {
  const html = sample();
  assert.match(
    html,
    /<span id="looking--head"><span class="rg-name rg-fit" style="--layout-name-chars:7">Looking<\/span><\/span><\/h3><p class="rg-band__sub">[^<]*<\/p><p class="rg-band__count"><span class="rg-num">3<\/span> photographs<\/p>/,
  );
});

test('one closing block: the contact holds the call to action, framed inside it, under one heading', () => {
  const html = sample();
  assert.equal(count(html, /data-kind="contact"/g), 1);
  assert.equal(count(html, /data-kind="cta"/g), 1);
  const foot = /<footer class="rg-foot">([\s\S]*)<\/footer>/.exec(html)![1]!;
  assert.ok(
    foot.indexOf('rg-index') < foot.indexOf('rg-ink'),
    'the index comes before the closing block',
  );
  assert.match(
    foot,
    /<a class="rg-ink__mail" href="mailto:anamika@example\.com"><span class="rg-name rg-ink__big" style="--layout-name-chars:8">Email me<\/span><span class="rg-ink__addr"><span>anamika@<wbr\/>example<wbr\/>\.com<\/span><\/span><\/a>/,
  );
  assert.match(
    foot,
    /<p class="rg-ink__lead"><span class="rg-name rg-fit" style="--layout-name-chars:9">Want to work together\?<\/span><\/p>/,
  );
  assert.equal(count(foot, /data-visitor-control-slot/g), 1);
});

test('an owner whose one way in is an email still gets the block whole: the address is its big link', () => {
  // The music fixture: a contact record with one email link, no message, no call to action.
  const foot = /<footer class="rg-foot">([\s\S]*)<\/footer>/.exec(
    renderInput(fixtureInput('music')),
  )![1]!;
  assert.match(
    foot,
    /<a class="rg-ink__mail" href="mailto:joana@ribeiro\.test"><span class="rg-name rg-ink__big" style="--layout-name-chars:7" data-case="sentence"><span>joana@<wbr\/>ribeiro<wbr\/>\.test<\/span><\/span><\/a>/,
  );
  // Never the lone small link under the heading, nor the address twice.
  assert.equal(count(foot, /rg-ink__links/g), 0);
  assert.equal(count(foot, /mailto:joana@ribeiro\.test/g), 1);
  // An identity email alone, too.
  const only = /<footer class="rg-foot">([\s\S]*)<\/footer>/.exec(
    render(
      pairOf({
        schemaVersion: 3,
        locale: 'en',
        direction: 'ltr',
        identity: { name: 'Rowan Mail', email: 'rowan@mail.test' },
        sections: [
          { kind: 'lede', id: 'about', title: 'About', body: 'Hi.' },
          { kind: 'contact', id: 'contact', title: 'Contact' },
        ],
      }),
    ),
  )![1]!;
  assert.match(only, /<a class="rg-ink__mail" href="mailto:rowan@mail\.test">/);
  assert.equal(count(only, /rg-ink__links/g), 0);
  // With nothing else to hold, the heading hangs on the link's cell: no cell for a tab alone.
  for (const block of [foot, only]) {
    assert.equal(count(block, /rg-ink__head/g), 0);
    assert.match(block, /<div class="rg-cell rg-ink__go rg-ink__go--head"><h\d class="rg-tab">/);
  }
});

test('the stylesheet: zero radius on every cell, tokens for the rest, and motion gated on the boundary', () => {
  const css = readFileSync(path.join(PACKAGE_DIR, 'src/styles.css'), 'utf8');
  for (const [, value] of css.matchAll(/border(?:-[a-z]+)*-radius:\s*([^;]+);/g)) {
    assert.match(value!, /^(?:0|var\(--ui-radius-badge\))$/, `radius ${value}`);
  }
  for (const [, value] of css.matchAll(/box-shadow:\s*([^;]+);/g)) {
    assert.match(value!, /^(?:none|var\(--ui-shadow-[a-z]+\))$/, `shadow ${value}`);
  }
  assert.doesNotMatch(css, /var\(--[\w-]+,/, 'no var() fallbacks');
  assert.doesNotMatch(css, /drop-shadow\(|display:\s*contents/);
  const motion = css.slice(css.indexOf('@media (prefers-reduced-motion: no-preference)'));
  assert.match(
    motion,
    /^@media \(prefers-reduced-motion: no-preference\) \{\s*\[data-variant='raw-grid'\]:not\(\[data-motion='reduced'\], \[data-motion='static'\]\)/,
  );
  // One belt per direction, only one of which runs on a page.
  assert.equal(count(css, /animation:/g), 2);
  assert.match(css, /@keyframes raw-grid-ticker \{\s*to \{\s*transform: translateX\(-50%\);/);
  assert.match(css, /@keyframes raw-grid-ticker-rtl \{\s*to \{\s*transform: translateX\(50%\);/);
  // Nothing pauses the ticker on focus, so Pause pressed again resumes it (2.2.2).
  assert.doesNotMatch(css, /\.rg-ticker[^{]*:focus-within/);
  assert.equal(count(css, /transition:/g), 1);
});

test('the stylesheet: the fitted links’ cells are containers, and the layout leans on :has only where it degrades whole', () => {
  const css = readFileSync(path.join(PACKAGE_DIR, 'src/styles.css'), 'utf8');
  // Without the container, 100cqi in the name's fit falls back to the viewport.
  assert.match(
    css,
    /\[data-variant='raw-grid'\] :is\(\.rg-ink__go, \.rg-next__go\) \{\s*container-type: inline-size;/,
  );
  // A cover with nothing beside it runs the width; without :has, it keeps its eight columns.
  assert.ok(css.includes('.rg-case__media:not(:has(+ :not(.rg-photo)))'));
  // The ink block's cells place without :has, so no browser gets half a pair of rules.
  assert.doesNotMatch(css, /\.rg-ink[\w-]*[^{}]*:has\(/);
  // Words stay whole: anywhere only on an address.
  assert.deepEqual(
    [...css.matchAll(/([^{}]+)\{[^}]*overflow-wrap: anywhere/g)].map(([, selector]) =>
      selector!.trim(),
    ),
    ["[data-variant='raw-grid'] .rg-ink__addr"],
  );
  assert.doesNotMatch(css, /word-break:\s*break-|line-break:\s*anywhere|hyphens:\s*auto/);
  // The kit's anywhere on its rich text is overridden where that text is display type.
  assert.match(
    css,
    /:is\([^)]*\.rg-thesis__lead[^)]*\.rg-note[^)]*\.rg-t-title[^)]*\)\s*\[class\*=.pf-.\] \{\s*overflow-wrap: break-word;/,
  );
  // The net under 200% text works only in boxes that can't grow past their cell.
  assert.match(
    css,
    /:where\(\.rg-cell, \.rg-card__body, \.rg-ink__mail, \.pf-rich-text[^)]*\) \{\s*grid-template-columns: minmax\(0, 1fr\);/,
  );
});

test('red is spent once: only the first sticker takes the emphasis tone', () => {
  const html = sample();
  assert.equal(count(html, /data-tone="emphasis"/g), 1);
});

test('right to left: the page mirrors through logical properties and keeps its order', () => {
  const html = renderInput(
    inputFor(
      pairOf({
        schemaVersion: 3,
        locale: 'ar',
        direction: 'rtl',
        identity: { name: 'ليلى حداد' },
        practice: { thesis: 'أجعل الفشل مقروءا. والباقي يتبع.' },
        sections: [
          { kind: 'hero', id: 'top', tagline: 'تحفظ السجلات.' },
          { kind: 'practice', id: 'thesis', title: 'الممارسة', part: 'thesis' },
          { kind: 'lede', id: 'about', title: 'نبذة', body: 'نص.' },
        ],
      }),
    ),
  );
  assert.equal(count(html, /<h1\b/g), 1);
  // The composition's own words are marked English in a portfolio that isn't.
  assert.match(html, /<span lang="en">Index<\/span>/);
  // The order is left to right's: header, poster, thesis, sheets, foot.
  const order = [
    /<header class="rg-head"/,
    /class="rg-cell rg-poster/,
    /class="rg-cell rg-thesis"/,
    /data-sheet="about"/,
    /<footer class="rg-foot"/,
  ].map((pattern) => html.search(pattern));
  assert.ok(
    order.every((n) => n >= 0),
    JSON.stringify(order),
  );
  assert.deepEqual(
    order,
    [...order].sort((a, b) => a - b),
  );
  // The mirroring is the stylesheet's: logical properties only, and the
  // tilts and the belt turn round under :dir(rtl).
  const css = readFileSync(path.join(PACKAGE_DIR, 'src/styles.css'), 'utf8').replace(
    /\/\*[\s\S]*?\*\//g,
    '',
  );
  assert.doesNotMatch(
    css,
    /(?:margin|padding|border)-(?:left|right)\b|[\s;{](?:left|right):|text-align:\s*(?:left|right)/,
  );
  for (const sticker of [
    '.rg-sticker:dir(rtl)',
    '.rg-sticker:nth-child(2):dir(rtl)',
    '.rg-sticker:nth-child(3):dir(rtl)',
  ])
    assert.ok(css.includes(sticker), `${sticker} mirrors its tilt`);
  assert.match(css, /:dir\(rtl\)\s*\.rg-ticker__belt \{\s*animation: raw-grid-ticker-rtl/);
});

test('the big link fits by its longest word, an address split where it wraps', async () => {
  const { longestPiece } = await import('../renderers/contact');
  assert.equal(longestPiece('Email me'), 5);
  assert.equal(longestPiece('joana@ribeiro.test'), 7);
  assert.equal(longestPiece('kiri.longfellow-ashbourne-whitcombe@longtext.test'), 32);
  // A word with no wrap point is all one piece, and a path splits before each slash as
  // Breakable wraps it.
  assert.equal(longestPiece('Collaborations'), 14);
  assert.equal(longestPiece('jane.test/writing/notes'), 8);
  // A call to action is a phrase, fitted whole so it keeps one line, up to sixteen characters.
  const { bigChars } = await import('../renderers/contact');
  assert.equal(bigChars('Email me'), 8);
  assert.equal(bigChars('joana@ribeiro.test'), 7);
  assert.equal(bigChars('Start a conversation about your project'), 16);
  assert.equal(bigChars('Internationalization'), 20);
});

test('the home outline: the full record’s minor parts fold at their sheet’s end, each summary its title, first item and count', () => {
  const html = renderInput(sampleInput());
  const folds = [
    ...html.matchAll(
      /<details class="rg-fold" data-rg-fold=""><summary>([\s\S]*?)<\/summary><section id="([^"]+)"/g,
    ),
  ];
  assert.deepEqual(
    folds.map(([, , id]) => id),
    [
      'education',
      'publications',
      'talks',
      'awards',
      'patents',
      'press',
      'elsewhere',
      'on-github',
      'currently-focused-on',
      'off-the-page',
      'stack-i-currently-reach-for',
      'engagements',
    ],
  );
  for (const [, summary, id] of folds) {
    assert.match(
      summary!,
      /^<h3 class="rg-tab"><span class="rg-name rg-fit"[^>]*>[^<]+<\/span><\/h3>/,
      `${id}: its title`,
    );
    assert.match(
      summary!,
      /class="rg-band__sub rg-fold__first" aria-hidden="true">[^<]+</,
      `${id}: its first item`,
    );
    assert.match(
      summary!,
      /class="rg-band__count">[^]*?\d+ (?:entr|repositor|profile)/,
      `${id}: its count`,
    );
  }
  // Experience, Skills and the sheets' leads stay open; closed, none of them.
  for (const id of ['experience', 'skills', 'about', 'at-a-glance', 'words-from-collaborators'])
    assert.doesNotMatch(
      html,
      new RegExp(`data-rg-fold=""><summary>[^]*?</summary><section id="${id}"`),
      id,
    );
  assert.doesNotMatch(html, /<details[^>]* open/);
  // The complete fixture: its other records fold too; its figures, its words from collaborators
  // and its mixed timeline stay open.
  const complete = renderInput(fixtureInput('complete'));
  const folded = (id: string) =>
    new RegExp(`data-rg-fold=""><summary>(?:(?!</summary>)[^])*</summary><section id="${id}"`).test(
      complete,
    );
  for (const id of ['education', 'more-evidence', 'publications']) assert.ok(folded(id), id);
  for (const id of ['experience', 'timeline', 'testimonials', 'stats', 'skills'])
    assert.ok(!folded(id), id);
});
