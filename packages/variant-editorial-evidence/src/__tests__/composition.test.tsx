import test from 'node:test';
import assert from 'node:assert/strict';
import { checkDestinationOverrides, pageOutline } from '@portfolio/kit/sections';
import { checkOutline } from '@portfolio/variant-contract/node';
import { CURATED, HOSTILE, LONG_TEXT, ONE_ARTIFACT, TEXT_ONLY } from '../__fixtures__/shapes';
import { renderToStaticMarkup } from 'react-dom/server';
import { closesOnFollow, Disclosure } from '@portfolio/appearance/primitives';
import { DISPLAY_SENTENCE, homeModel, splitThesis } from '../model';
import { pinsAt } from '../opening';
import { chaptersOf, ISSUE_OVERRIDES } from '../navigation';
import { at, count, fragmentLinks, idsIn, inputFor, pairOf, render } from './harness';

// Editorial Evidence's pages (#13, redesign stream C), rendered as the
// server sends them, so what these hold is also what a page with no
// JavaScript shows: the thesis as the one h1 over the issue's contents and
// Pl. 1; chapters whose every section renders in its own framed band, with
// the composition's own renderers; the curated run with the archive behind
// a closed disclosure; the masthead's two destinations and the Contents
// sheet; the colophon; and a case study page with its way back.

const curated = () => render(pairOf(CURATED));

/** A portfolio with a thesis and the sections around it, for the opening's rules. */
const withThesis = (thesis: string) =>
  pairOf({
    schemaVersion: 3,
    locale: 'en',
    direction: 'ltr',
    identity: { name: 'Kai Bell', tagline: 'Keeps records.' },
    practice: { thesis },
    sections: [
      { kind: 'practice', id: 'thesis', part: 'thesis' },
      { kind: 'lede', id: 'about', title: 'About', body: 'More.' },
    ],
  });

test('the h1 is the first sentence when the thesis has two and the first is at most 60 characters', () => {
  assert.deepEqual(splitThesis('I make failure legible. The rest follows.'), {
    headline: 'I make failure legible.',
    standfirst: 'The rest follows.',
    whole: false,
  });
  const html = render(withThesis('I make failure legible. The rest follows.'));
  assert.equal(count(html, /<h1\b/g), 1);
  assert.match(
    html,
    /<h1 class="ee-thesis__title"><span[^>]*>I make failure legible\.<\/span><\/h1>/,
  );
  assert.match(
    html,
    /class="ee-thesis__stand" data-type-role="quote"><span[^>]*>The rest follows\./,
  );
  // The thesis keeps its own frame, so a link to it lands.
  assert.match(
    html,
    /<section id="thesis" data-section-id="thesis" data-kind="practice" data-renderer="bespoke"/,
  );
});

test('the split reads the parsed text: never after an abbreviation, nor inside a link, an emphasis or code', () => {
  const cases: readonly (readonly [string, string, string])[] = [
    [
      'Dr. Lee keeps the record. The rest follows.',
      'Dr. Lee keeps the record.',
      'The rest follows.',
    ],
    [
      'Write it down, e.g. in a log. Then read it back.',
      'Write it down, e.g. in a log.',
      'Then read it back.',
    ],
    [
      'I wrote for the [U.S. Digital Service](https://example.com/usds). Then I left.',
      'I wrote for the [U.S. Digital Service](https://example.com/usds).',
      'Then I left.',
    ],
    ['*Make failure legible.* Then fix it.', '*Make failure legible.*', 'Then fix it.'],
    ['Run `make test. all` first. Then ship.', 'Run `make test. all` first.', 'Then ship.'],
  ];
  for (const [thesis, headline, standfirst] of cases) {
    assert.deepEqual(splitThesis(thesis), { headline, standfirst, whole: false }, thesis);
  }
  // The link's text stays whole in the h1, with no Markdown left over.
  const html = render(withThesis(cases[2]![0]));
  const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(html)?.[1] ?? '';
  assert.match(h1, /<a href="https:\/\/example\.com\/usds">U\.S\. Digital Service<\/a>\./);
  assert.doesNotMatch(h1, /[[\]()]/);
  // Titles are matched in their own case, and a lone capital is an initial only in a name.
  for (const [thesis, headline] of [
    ['They said no. So I built it anyway.', 'They said no.'],
    ['Always keep a plan B. Then rehearse it.', 'Always keep a plan B.'],
    ['Ask J. Lee about the outage. She was there.', 'Ask J. Lee about the outage.'],
  ] as const) {
    assert.equal(splitThesis(thesis).headline, headline, thesis);
  }
  // A thesis that is one abbreviated sentence doesn't split at all.
  assert.equal(splitThesis('Ask Dr. Lee.').whole, true);
});

test("the opening's titled sections name their regions with their titles, and set no heading for them", () => {
  const html = render(
    pairOf({
      schemaVersion: 3,
      locale: 'en',
      direction: 'ltr',
      identity: { name: 'Kai Bell', tagline: 'Keeps records.' },
      practice: { thesis: 'I make failure legible. The rest follows.' },
      sections: [
        { kind: 'hero', id: 'hello', title: 'Hero label' },
        { kind: 'practice', id: 'thesis', part: 'thesis', title: 'Thesis title' },
        { kind: 'lede', id: 'about', title: 'About', body: 'More.' },
      ],
    }),
  );
  for (const [id, title] of [
    ['hello', 'Hero label'],
    ['thesis', 'Thesis title'],
  ] as const) {
    assert.match(
      html,
      new RegExp(
        `<section id="${id}"[^>]*aria-labelledby="${id}--head"[^>]*><span id="${id}--head" hidden="">${title}</span>`,
      ),
      id,
    );
  }
  assert.equal(count(html, /<h1\b/g), 1);
});

test('otherwise the whole thesis is the headline, a step down: one sentence, or a first one over 60', () => {
  const long = `${'A sentence that runs on and on '.repeat(3).trim()}. Then more.`;
  assert.ok(long.indexOf('.') > DISPLAY_SENTENCE);
  for (const thesis of ['Make the record the product.', long]) {
    const split = splitThesis(thesis);
    assert.equal(split.whole, true, thesis);
    assert.equal(split.standfirst, undefined, thesis);
    const html = render(withThesis(thesis));
    assert.match(html, /<h1 class="ee-thesis__title ee-thesis__title--whole">/, thesis);
    assert.doesNotMatch(html, /ee-thesis__stand/, thesis);
  }
});

test('every section the page renders has its own bespoke frame, and the outline check finds nothing', () => {
  for (const idPrefix of ['', 'pv-']) {
    const input = inputFor(pairOf(CURATED), { idPrefix });
    const html = render(pairOf(CURATED), { idPrefix });
    const sections = pageOutline(input).sections.map(({ id, anchor }) => ({ id, anchor }));
    assert.deepEqual(checkOutline(html, input.ids, { sections }), [], idPrefix);
    assert.doesNotMatch(html, /data-renderer="shared"/);
    for (const { id } of sections) {
      assert.match(
        html,
        new RegExp(`data-section-id="${id}" data-kind="[^"]+" data-renderer="bespoke"`),
        id,
      );
    }
  }
});

test('the opening: the h1, then the contents, then Pl. 1, then the byline, before any chapter', () => {
  const html = curated();
  const h1 = at(html, '<h1');
  const contents = at(html, 'class="ee-contents"');
  const plate = at(html, 'class="ee-lead"');
  const chapter = at(html, 'class="ee-chapter"');
  assert.ok(h1 < contents && contents < plate && plate < chapter);
  // Pl. 1 is the signature, its cover eager, its caption the one caption system's.
  assert.match(html, /<figure id="ee--plate-ledger" class="ee-lead"/);
  assert.match(
    html,
    /class="ee-caption__index"><span>Pl\. 1<\/span>|class="ee-caption__index">Pl\. 1</,
  );
  assert.doesNotMatch(html.slice(plate, chapter), /loading="lazy"/);
  // It links to the work's case study.
  // The way into the case is the language's own action (owner's similarity complaint).
  assert.match(
    html.slice(plate, chapter),
    /<a data-ui-slot="action" data-emphasis="secondary" href="\/work\/ledger"><span data-ui-slot="action.label">Read the case study</,
  );
  // Pl. 1's mat is the Surface primitive, so the language's material and texture draw on it.
  assert.match(
    html.slice(plate, chapter),
    /<div class="ee-lead__frame" data-ui-slot="surface" data-emphasis="default">/,
  );
});

/** The data-ui-slot values in a piece of markup, in document order: its slot structure. */
const slotsIn = (html: string) => [...html.matchAll(/data-ui-slot="([^"]+)"/g)].map((m) => m[1]);

test("every slot EE renders is a primitive's own markup: the contents fold is the Disclosure, and no part is hand-written (EE-LANG round 2, M1)", () => {
  const html = curated();
  const fold = /<details class="ee-contents__details"[\s\S]*?<\/details>/.exec(html)?.[0] ?? '';
  const primitive = renderToStaticMarkup(
    <Disclosure className="ee-contents__details" summary="x">
      <ol />
    </Disclosure>,
  );
  // The same elements carrying the same slots, the summary's and the content's, in order.
  const shape = (markup: string) =>
    [...markup.matchAll(/<(\w+)[^>]*?data-ui-slot="([^"]+)"/g)].map((m) => `${m[1]}:${m[2]}`);
  assert.deepEqual(shape(fold).slice(0, 3), shape(primitive));
  assert.match(fold, /<div data-ui-slot="disclosure.content"><ol id="ee--contents"/);
  // The masthead, the sheet and the way back are EE's own, with no slot written out by hand.
  const header = /<header class="ee-masthead">[\s\S]*?<\/header>/.exec(html)?.[0] ?? '';
  assert.deepEqual(slotsIn(header), []);
  // A featured plate's picture sits on the Surface primitive's mat, as Pl. 1's does.
  const covered = structuredClone(CURATED) as typeof CURATED & {
    works: { id: string; cover?: { asset: string } }[];
  };
  covered.works.find((work) => work.id === 'atlas')!.cover = { asset: 'ledger-entry' };
  assert.match(
    render(pairOf(covered)),
    /<article id="ee--plate-atlas"[^>]*>(?:(?!<\/article>)[\s\S])*?<div class="ee-plate__mat" data-ui-slot="surface" data-emphasis="default">/,
  );
  const page = render(pairOf(CURATED), { route: { route: 'work', slug: 'ledger' } });
  assert.match(page, /<div class="ee-case__plate" data-ui-slot="surface" data-emphasis="default">/);
  assert.match(
    page,
    /<div class="ee-case__facts" data-ui-slot="surface" data-emphasis="subtle"><dl class="ee-facts"/,
  );
  const way = /<nav class="ee-case__way"[\s\S]*?<\/nav>/.exec(page)?.[0] ?? '';
  assert.deepEqual(slotsIn(way), []);
});

test("chapters are the kit navigation model's destinations, in its fixed order, the owner's order kept inside", () => {
  const input = inputFor(pairOf(CURATED));
  const chapters = chaptersOf(input, pageOutline(input));
  assert.deepEqual(
    chapters.map(({ id, number, label, sections }) => [
      id,
      number,
      label,
      sections.map(({ id }) => id),
    ]),
    [
      ['work', 1, 'Work', ['work']],
      ['record', 2, 'Record', ['evidence']],
      ['about', 3, 'Practice', ['thesis']],
      ['contact', 4, 'Contact', ['contact']],
    ],
  );
  // The model drops a chapter the opening empties, and numbers the rest from 1.
  assert.deepEqual(
    homeModel(input).chapters.map(({ number, label }) => [number, label]),
    [
      [1, 'Work'],
      [2, 'Record'],
      [3, 'Contact'],
    ],
  );
  // So the page does too: the running head, the rail, the openers and the sheet.
  const html = curated();
  assert.match(html, /data-ee-folio-n="">1<\/span> <b data-ee-folio-chapter="">Work</);
  assert.deepEqual(
    [...html.matchAll(/data-ee-chapter="(\d+)"/g)].map(([, n]) => n),
    ['1', '2', '3'],
  );
  assert.deepEqual(
    [...html.matchAll(/data-ee-rail="(\d+)"/g)].map(([, n]) => n),
    ['1', '2', '3'],
  );
  assert.deepEqual(
    [...html.matchAll(/class="ee-sheet__no">([\d.]+)</g)].map(([, n]) => n),
    ['1.1', '2.1', '3.1'],
  );
});

test('its one override puts what the canonical map leaves to the index in Practice, and is sound', () => {
  assert.deepEqual({ ...ISSUE_OVERRIDES }, { lede: 'about', custom: 'about', extension: 'about' });
  const pair = pairOf({
    ...CURATED,
    sections: [
      { kind: 'lede', id: 'intro', body: 'An untitled word first.' },
      ...CURATED.sections,
      { kind: 'custom', id: 'aside', title: 'An aside', items: [{ title: 'One' }] },
    ],
  });
  const input = inputFor(pair);
  const real = pageOutline(input);
  // No host registers a content extension yet, so an extension's section joins the outline by
  // hand, as pageOutline() lists one: its kind namespaced, its family 'extension'.
  const outline = {
    ...real,
    sections: [
      ...real.sections,
      {
        id: 'ext',
        anchor: 'ext',
        href: '#ext',
        kind: 'acme/note',
        family: 'extension',
        title: 'A note',
        count: 0,
      },
    ],
  } as typeof real;
  assert.deepEqual(checkDestinationOverrides(ISSUE_OVERRIDES, [outline]), []);
  const practice = chaptersOf(input, outline).find(({ id }) => id === 'about');
  assert.deepEqual(
    practice?.sections.map(({ id }) => id),
    ['intro', 'thesis', 'aside', 'ext'],
  );
  // Every section with an anchor but the hero lands in a chapter.
  const placed = new Set(
    chaptersOf(input, outline).flatMap(({ sections }) => sections.map(({ id }) => id)),
  );
  for (const section of outline.sections) {
    if (section.href === undefined || section.kind === 'hero') continue;
    assert.ok(placed.has(section.id), section.id);
  }
});

test('the curated run: the featured works on plates in the owner order, then a row back to Pl. 1 with the rest, then the archive', () => {
  const html = curated();
  const run = /<div class="ee-run">[\s\S]*?<\/details><\/div>/.exec(html)?.[0] ?? '';
  assert.ok(run, 'the run');
  // Pl. 1 heads the page, so the run refers back to it in one ruled row.
  assert.match(
    run,
    /data-work-id="ledger"[\s\S]*?href="#ee--plate-ledger"><span>Pl\. 1<\/span>|data-work-id="ledger"[\s\S]*?href="#ee--plate-ledger">Pl\. 1</,
  );
  assert.doesNotMatch(run, /class="ee-feature"/);
  // The row back to Pl. 1 follows the plates, so it never sits over another work's figure (C11).
  assert.ok(at(run, 'ee--plate-atlas') < at(run, 'ee--plate-harbor'));
  assert.ok(at(run, 'ee--plate-harbor') < at(run, 'ee--plate-kiln'));
  assert.ok(at(run, 'ee--plate-kiln') < at(run, 'data-work-id="ledger"'));
  assert.ok(at(run, 'data-work-id="ledger"') < at(run, 'data-work-id="notes"'));
  for (const n of [2, 3, 4]) assert.match(run, new RegExp(`Pl\\. ${n}`));
  // Nothing on a plate repeats as a row in its own run.
  assert.equal(count(run, /class="ee-row"[^>]*data-work-id="atlas"/g), 0);
  // The archive: a closed native disclosure, its count and titles in the summary.
  assert.match(run, /<details id="ee--archive" class="ee-archive" data-ui-slot="disclosure">/);
  assert.match(run, /The archive, 2 older works/);
  assert.match(run, /The old site and A zine/);
  assert.equal(count(html, /\sid="atlas"/g), 1);
});

test('a figure run is a numbered figure table with leaders, never metric tiles', () => {
  const html = curated();
  assert.doesNotMatch(html, /ee-figtable/);
  const metrics = pairOf({
    ...CURATED,
    evidence: [
      ...CURATED.evidence,
      {
        id: 'mttr',
        type: 'metric',
        statement: 'Time to recover',
        metric: { value: 4, unit: 'min' },
      },
    ],
    sections: [
      ...CURATED.sections,
      { kind: 'evidence', id: 'numbers', title: 'Numbers', items: ['uptime', 'mttr'] },
    ],
  });
  const page = render(metrics);
  assert.match(page, /<figure class="ee-figtable">/);
  assert.match(page, /class="ee-figrow__leader" aria-hidden="true"/);
  assert.match(
    page,
    /<data value="99.95" class="ee-figrow__value" data-type-role="headline">99\.95<\/data>/,
  );
  assert.match(page, /Fig\. 1/);
});

test('the masthead: the name, the running head, Contents and Contact, and the visitor control', () => {
  const html = curated();
  const header = /<header class="ee-masthead">[\s\S]*?<\/header>/.exec(html)?.[0] ?? '';
  assert.match(
    header,
    /<a class="ee-masthead__name" href="\/" aria-current="page">Rowan Vale<\/a>/,
  );
  assert.match(header, /data-ee-folio=""/);
  // Contents is a link to the sheet: the scroll-spy opens it as a popover, and with no
  // JavaScript, or no popover, it's the page's target until a link in it is followed.
  assert.match(
    header,
    /<a href="#ee--sheet" class="ee-masthead__contents" aria-haspopup="dialog" aria-controls="ee--sheet" data-ee-contents="">/,
  );
  assert.match(header, /href="#contact"><span>Contact<\/span>|href="#contact">Contact</);
  // The masthead is EE's own typesetting: no hand-written slot (EE-LANG round 2, M1).
  assert.doesNotMatch(header, /data-ui-slot="navigation/);
  assert.equal(count(html, /data-visitor-control-slot/g), 1);
  // Two destinations, never a bar of every section.
  const tools = /<nav class="ee-masthead__tools"[\s\S]*?<\/nav>/.exec(header)?.[0] ?? '';
  assert.equal(count(tools, /<li\b/g), 2);
  // The sheet lists every titled section by chapter, and every fragment on the page lands.
  const sheet = /<div id="ee--sheet"[\s\S]*?<\/div>/.exec(header)?.[0] ?? '';
  assert.match(sheet, /popover="auto"/);
  for (const id of ['work', 'evidence', 'contact'])
    assert.match(sheet, new RegExp(`href="#${id}"`));
  const ids = idsIn(html);
  assert.equal(new Set(ids).size, ids.length, 'no id repeats');
  for (const fragment of fragmentLinks(html)) assert.ok(ids.includes(fragment), fragment);
});

test('links resolve under every mount: the site root, /sample with its variant, and a preview prefix', () => {
  const sample = render(pairOf(CURATED), {
    basePath: '/sample',
    query: { variant: 'editorial-evidence' },
  });
  assert.match(sample, /class="ee-masthead__name" href="\/sample\?variant=editorial-evidence"/);
  assert.match(sample, /href="\/sample\/work\/ledger\?variant=editorial-evidence"/);
  const preview = render(pairOf(CURATED), { idPrefix: 'pv-' });
  assert.match(preview, /<main id="pv-main"/);
  const ids = idsIn(preview);
  assert.ok(
    ids.every((id) => id.startsWith('pv-')),
    ids.join(' '),
  );
  for (const fragment of fragmentLinks(preview)) assert.ok(ids.includes(fragment), fragment);
});

test('every routed work has a link to its page on home', () => {
  const html = curated();
  const routed = (pairOf(CURATED).portfolio.works ?? [])
    .filter((work) => work.caseStudy !== undefined && work.slug !== undefined)
    .map(({ slug }) => slug!)
    .sort();
  assert.deepEqual(routed, ['ledger', 'notes', 'zine']);
  const linked = [...html.matchAll(/href="\/work\/([^"?#]+)"/g)].map(([, slug]) => slug);
  assert.deepEqual([...new Set(linked)].sort(), routed);
  // A slug alone is no page (#10b routes a case study at a slug).
  assert.doesNotMatch(html, /href="\/work\/atlas"/);
});

test("a case study's page is a feature article: its title the one h1, the issue's own stops, back matter, and the next plate (C5)", () => {
  const html = render(pairOf(CURATED), { route: { route: 'work', slug: 'ledger' } });
  assert.equal(count(html, /<h1\b/g), 1);
  assert.match(html, /<h1 class="ee-case__title">Ledger<\/h1>/);
  // The page names its work, as the host's checks look for it.
  assert.match(html, /<main [^>]*data-work-id="ledger"/);
  // The running head carries the case's ancestry: its chapter, the section it shows in, its title.
  assert.equal(/data-ee-folio-chapter=""[^>]*>([^<]*)</.exec(html)?.[1], 'Work');
  const folio = /data-ee-folio-section="">([\s\S]*?)<\/span><\/p>/.exec(html)?.[1] ?? '';
  assert.equal(folio.replace(/<[^>]+>/g, ''), 'Work Ledger');
  // The head column leads back to the selected run and numbers the case among its plates.
  const way = /<nav class="ee-case__way"[\s\S]*?<\/nav>/.exec(html)?.[0] ?? '';
  assert.match(way, /<a href="\/#work">Back to selected work<\/a>/);
  assert.match(way, /Case study, Pl\. 1 of 4/);
  // The issue's own stops, in its order; never the outline's labels.
  const stops = [...html.matchAll(/<h2 class="ee-head-title"[^>]*>([^<]*)</g)].map(([, t]) => t);
  assert.deepEqual(stops, ['The work', 'Background', 'Decisions', 'Results', 'Back matter']);
  for (const label of ['Challenge', 'The problem', 'What changed', 'Outcomes', 'Reflection']) {
    assert.doesNotMatch(html, new RegExp(`<h[23][^>]*>${label}<`), label);
  }
  // Every part the outline lists keeps its anchor on what holds it.
  const ids = idsIn(html);
  for (const key of ['challenge', 'decisions', 'evidence', 'outcomes']) {
    assert.ok(ids.includes(`ledger--${key}`), key);
  }
  // The work's other plates break out as Pl. 1a and 1b, the cover not repeated (EE-S9).
  const plates =
    /<figure class="ee-case__plates">[\s\S]*?<\/figure><\/div><\/section>/.exec(html)?.[0] ?? '';
  assert.deepEqual(
    [...plates.matchAll(/class="ee-caption__index">([^<]*)</g)].map(([, index]) => index),
    ['Pl. 1a', 'Pl. 1b'],
  );
  assert.equal(count(plates, /data-media-asset="ledger-cover"/g), 0);
  // The cited quotation at headline size, and the back matter with how to cite the work.
  assert.match(
    html,
    /<figure class="ee-case__quote"[\s\S]*?data-type-role="headline"[\s\S]*?The first audit/,
  );
  assert.match(
    html,
    /Cite this work[\s\S]*?Rowan Vale \(2021–\)\. <i>Ledger<\/i> \[System\]\. <span class="ee-url__part">ledger\.rowan\.test<\/span>/,
  );
  // An address in a link: each part the link's own child, so it takes the link's underline.
  assert.match(html, /<a href="[^"]*"><span class="ee-url__part">ledger\.rowan\.test<\/span><\/a>/);
  // The next plate at headline size, a page of its own when it has one.
  assert.match(
    html,
    /Next in selected work, Pl\. 2[\s\S]*?data-type-role="headline"[^>]*><a href="\/#ee--plate-atlas">Atlas<\/a>/,
  );
  // The work's figures sit in the margin beside its results, never in what cites it.
  assert.match(html, /<dt><span>Uptime<\/span><\/dt><dd><data value="99.95">/);
  assert.doesNotMatch(/Cited in[\s\S]*?<\/ul>/.exec(html)?.[0] ?? '', /Uptime/);
  assert.doesNotMatch(html, /pf-case-study|data-renderer="shared"/);
});

test("a work's page leads back to where home shows it: its plate, the archive, or its section", () => {
  const zine = render(pairOf(CURATED), { route: { route: 'work', slug: 'zine' } });
  assert.match(zine, /<a href="\/#ee--archive">[\s\S]*?Back to the archive/);
  const notes = render(pairOf(CURATED), { route: { route: 'work', slug: 'notes' } });
  assert.match(notes, /<a href="\/#notes">Back to work<\/a>/);
  const home = idsIn(curated());
  for (const id of ['ee--archive', 'notes', 'ee--plate-ledger']) assert.ok(home.includes(id), id);
});

test('one artifact: the name as the h1 and Pl. 1, text-led, with no chapters, contents, or empty frame', () => {
  const html = render(pairOf(ONE_ARTIFACT));
  assert.match(html, /<h1 class="ee-thesis__title">Sol Ito<\/h1>/);
  assert.match(html, /class="ee-lead ee-lead--text"/);
  assert.doesNotMatch(html, /ee-chapter|ee-contents|ee-sheet|<img/);
});

test('text only: the thesis, Pl. 1 set in words, and the reading order, with no media at all', () => {
  const html = render(pairOf(TEXT_ONLY));
  assert.doesNotMatch(html, /<img|<picture/);
  assert.match(html, /Cities are arguments people live inside\./);
  assert.match(html, /class="ee-lead ee-lead--text"/);
  assert.ok(at(html, 'class="ee-lead') < at(html, 'data-section-id="about"'));
  // Without a cover there is nothing to mark: no marks, keys, or leaders.
  assert.doesNotMatch(html, /ee-lead__(?:pin|key|leader)/);
});

test("the review's fixes hold: Pl. 1's callouts on its notes, one-sentence lists, an email that wraps at its @, one intro", () => {
  const html = render(
    pairOf({
      ...CURATED,
      identity: { ...CURATED.identity, email: 'rowan@example.com' },
      practice: {
        ...CURATED.practice,
        tools: [
          {
            name: 'Stack',
            items: [{ name: 'Go', version: '1.23' }, { name: 'TypeScript' }, { name: 'Bun' }],
          },
        ],
      },
      evidence: [
        ...CURATED.evidence,
        {
          id: 'gallery',
          type: 'external-work',
          title: 'A photo journal',
          url: 'https://example.com/photos',
          highlights: [
            { label: '120+', sub: 'Published frames' },
            { label: '8', sub: 'Cities documented' },
          ],
        },
      ],
      sections: [
        {
          kind: 'hero',
          id: 'hello',
          tagline: 'A second intro.',
          subtagline: 'And a third.',
        },
        ...CURATED.sections,
        { kind: 'practice', id: 'stack', part: 'tools', title: 'Stack' },
        { kind: 'evidence', id: 'elsewhere', title: 'Elsewhere', items: ['gallery'] },
      ],
    }),
  );
  // Pl. 1's marks sit on its artwork, one per note, each placed on the picture and keyed to its note
  // by numeral, and each note has its leader (EDI-1). None of them is read: the notes are the list.
  const notes = /class="ee-ruled ee-lead__lines"[\s\S]*?<\/ol>/.exec(html)?.[0] ?? '';
  const n = count(notes, /<li /g);
  assert.ok(n >= 2);
  const pins = /<ol class="ee-lead__pins" aria-hidden="true">[\s\S]*?<\/ol>/.exec(html)?.[0] ?? '';
  assert.equal(
    count(
      pins,
      /<li class="ee-lead__pin" style="--layout-ee-pin-x:[\d.]+%;--layout-ee-pin-mx:[\d.]+%;--layout-ee-pin-y:[\d.]+%;/g,
    ),
    n,
  );
  assert.equal(count(notes, /<span class="ee-n ee-lead__key" aria-hidden="true"/g), n);
  assert.match(
    notes,
    /<li id="ee--plate-ledger--note-1"><span class="ee-n ee-lead__key"[^>]*>1<\/span> /,
  );
  assert.equal(count(html, /class="ee-lead__leader"/g), n);
  assert.match(html, /<\/figcaption><span class="ee-lead__leaders" aria-hidden="true">/);
  // With no focal point the marks run through the picture's centre, note 1 highest and rightmost.
  assert.match(
    pins,
    /^<ol[^>]*><li class="ee-lead__pin" style="--layout-ee-pin-x:(?:55|60)%;--layout-ee-pin-mx:(?:45|40)%;--layout-ee-pin-y:(?:44\.5|39)%;/,
  );
  assert.doesNotMatch(html, /ee-mark|ee-lead__marks/);
  // The tools read as one sentence in one run of text.
  assert.match(html, /<dd><span>Go 1\.23, TypeScript, and Bun<\/span><\/dd>/);
  // Highlights fold into one sentence, never a stack of figures.
  assert.match(html, /<p>120\+ published frames and 8 cities documented\.<\/p>/);
  // The email wraps after its @, never mid-word.
  assert.match(html, /rowan@<wbr\/>example\.com/);
  // With a thesis, the standfirst is the opening's one paragraph: no second intro.
  assert.doesNotMatch(html, /A second intro\.|And a third\.|ee-byline__lede/);
});

test('a record entry with nothing else for its margin puts its description there (G2: Education)', () => {
  const html = render(
    pairOf({
      ...CURATED,
      chronology: [
        {
          id: 'ms',
          kind: 'study',
          title: 'M.S.',
          organization: 'A university',
          period: { start: '2014', end: '2016' },
          description: 'Thesis on model checking.',
          achievements: ['Gold medal'],
        },
      ],
      sections: [
        ...CURATED.sections,
        { kind: 'chronology', id: 'education', title: 'Education', items: ['ms'] },
      ],
    }),
  );
  const row =
    /<li id="[^"]*ms"[^>]*class="ee-row"[\s\S]*?<\/li><\/ol>|<li[^>]*class="ee-row"[^>]*data-chronology-kind="study"[\s\S]*?<\/ol>/.exec(
      html,
    )?.[0] ?? '';
  assert.match(row, /class="ee-row__note"[^>]*>[\s\S]*?Thesis on model checking\./);
  assert.doesNotMatch(row, /class="pf-rich-text ee-prose"[^>]*>[\s\S]*?Thesis on model checking/);
  assert.match(row, /Gold medal/);
});

test("a plate's margin has a job (G2): its fact sheet, its evidence lines, and its links", () => {
  const html = render(
    pairOf({
      ...CURATED,
      works: CURATED.works.map((work) =>
        work.id === 'atlas'
          ? {
              ...work,
              role: 'Designer',
              organization: 'Northwind',
              period: { start: '2023-01' },
              tools: ['Figma', 'TypeScript'],
              evidence: ['paper', 'talk'],
              url: 'https://example.com/atlas',
            }
          : work,
      ),
    }),
  );
  const plate = /<article id="ee--plate-atlas"[\s\S]*?<\/article>/.exec(html)?.[0] ?? '';
  const side = /class="ee-caption ee-plate__side"[\s\S]*$/.exec(plate)?.[0] ?? '';
  assert.match(side, /<dl class="ee-facts ee-plate__facts"/);
  for (const term of ['Role', 'When', 'With', 'Made with']) {
    assert.match(side, new RegExp(`<dt>(?:<span[^>]*>)?${term}<`), term);
  }
  assert.match(side, /Figma and TypeScript/);
  assert.match(
    side,
    /<ul class="ee-ruled ee-plate__lines" role="list"><li>Append-only operations<\/li><li>Ledgers all the way down<\/li><\/ul>/,
  );
  // A plate with fewer than two facts keeps its one-line caption.
  assert.doesNotMatch(
    /<article id="ee--plate-harbor"[\s\S]*?<\/article>/.exec(html)?.[0] ?? '',
    /ee-plate__facts/,
  );
});

test('a link followed in the sheet closes it when it goes to a place on this page, and only then', () => {
  const click = {
    button: 0,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    defaultPrevented: false,
  };
  const link = (href: string, extra = {}) => ({
    href,
    target: '',
    download: false,
    inDialog: true,
    ...extra,
  });
  const here = 'https://rowan.test/sample?variant=editorial-evidence#top';
  assert.equal(
    closesOnFollow(click, link('https://rowan.test/sample?variant=editorial-evidence#work'), here),
    'work',
  );
  assert.equal(closesOnFollow(click, link('https://rowan.test/work/ledger'), here), null);
  assert.equal(closesOnFollow({ ...click, metaKey: true }, link('#work'), here), null);
  assert.equal(closesOnFollow(click, link('#work', { target: '_blank' }), here), null);
  assert.equal(closesOnFollow(click, link('#work', { inDialog: false }), here), null);
  assert.equal(closesOnFollow(click, null, here), null);
  assert.equal(closesOnFollow(click, link('#ee--chapter-work'), here), 'ee--chapter-work');
});

test('a long title and long evidence render whole, for the stylesheet to wrap', () => {
  const home = render(pairOf(LONG_TEXT));
  assert.match(home, new RegExp(LONG_TEXT.works[0]!.title));
  const page = render(pairOf(LONG_TEXT), { route: { route: 'work', slug: 'long' } });
  assert.match(page, new RegExp(LONG_TEXT.evidence[0]!.statement));
});

test('hostile Markdown renders as text: no script, no javascript: or data: link, no injected markup', () => {
  for (const route of [{ route: 'home' as const }, { route: 'work' as const, slug: 'trap' }]) {
    const html = render(pairOf(HOSTILE), { route });
    assert.doesNotMatch(html, /<script|<iframe|<img\b|<[^>]*\son\w+=/i, route.route);
    assert.doesNotMatch(html, /href="\s*(?:javascript|data):/i, route.route);
  }
});

test("Pl. 1's marks: a diagonal through the focal point, held inside the picture, mirrored for notes over them (EDI-1)", () => {
  const near = (actual: number, expected: number) =>
    assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} ≈ ${expected}`);
  // No focal point: the picture's centre, note 1 highest, rightmost (x) or leftmost (mx).
  const centre = pinsAt(undefined, 3);
  [0.6, 0.5, 0.4].forEach((x, i) => near(centre[i]!.x, x));
  [0.4, 0.5, 0.6].forEach((x, i) => near(centre[i]!.mx, x));
  [0.39, 0.5, 0.61].forEach((y, i) => near(centre[i]!.y, y));
  // The sample's front sheet.
  const sheet = pinsAt({ x: 0.65, y: 0.66 }, 3);
  [0.75, 0.65, 0.55].forEach((x, i) => near(sheet[i]!.x, x));
  [0.55, 0.66, 0.77].forEach((y, i) => near(sheet[i]!.y, y));
  // A point at an edge moves in so the whole diagonal fits: no two marks share an x or a y.
  for (const focal of [
    { x: 0.95, y: 0.95 },
    { x: 0, y: 0 },
    { x: 1, y: 0.05 },
  ]) {
    const pins = pinsAt(focal, 3);
    for (const pin of pins) {
      for (const v of [pin.x, pin.mx, pin.y])
        assert.ok(v >= 0.1 - 1e-9 && v <= 0.9 + 1e-9, String(v));
    }
    assert.equal(new Set(pins.map((pin) => pin.x.toFixed(6))).size, 3);
    assert.equal(new Set(pins.map((pin) => pin.y.toFixed(6))).size, 3);
  }
  near(pinsAt({ x: 0.95, y: 0.95 }, 3)[0]!.x, 0.9);
  near(pinsAt({ x: 0.95, y: 0.95 }, 3)[2]!.y, 0.9);
  // One note: its mark on the point itself; none: none.
  assert.deepEqual(pinsAt({ x: 0.3, y: 0.7 }, 1), [{ x: 0.3, mx: 0.3, y: 0.7 }]);
  assert.deepEqual(pinsAt(undefined, 0), []);
});
