import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  caseStudyOutline,
  checkGrouping,
  pageOutline,
  sectionRenders,
} from '@portfolio/kit/sections';
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
import SwissSignal from '.';
import { figuresBand, heroOf, ownerName, partGrouping, partsOf, posterLine } from './model';
import { Out } from './parts';

// Swiss Signal's manifest, and over every contract fixture and the
// repository's sample, the home page: one h1 that names the owner, one
// main, every section that renders in exactly one Swiss frame (never the
// kit's shared renderer), unique ids under the prefix, every fragment
// landing, and every collection a native table with column headers.

// tsx compiles JSX to React.createElement calls, so the test supplies React.
Object.assign(globalThis, { React });

const PACKAGE = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const RAW = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
const ROOT = new URL('../../../', import.meta.url);

const MANIFEST = (() => {
  const result = validateManifest(RAW, { packageName: PACKAGE.name, exports: PACKAGE.exports });
  assert.ok(result.ok, JSON.stringify(result.ok ? [] : result.diagnostics));
  return result.manifest as VariantManifest;
})();

function inputOf(
  pair: ParsedPair,
  idPrefix = '',
  snapshots: Readonly<Record<string, unknown>> = {},
  route: { route: 'home' } | { route: 'work'; slug: string } = { route: 'home' },
): VariantRenderInput {
  return buildRenderInput({
    view: resolvePortfolioView(pair, { snapshots }, { mediaBase: '/media' }),
    manifest: MANIFEST,
    route,
    basePath: '',
    origin: 'https://rowan.test',
    requestTime: '2026-10-26T12:00:00Z',
    idPrefix,
  });
}

function pairOf(name: string): ParsedPair {
  const read = readPair(contractFixture(name).files);
  assert.ok(read.ok, `${name}: ${JSON.stringify(read)}`);
  return read.pair;
}

function samplePair(): ParsedPair {
  const read = readPair({
    portfolio: new URL('portfolio.example.yml', ROOT).pathname,
    site: new URL('site.example.yml', ROOT).pathname,
  });
  assert.ok(read.ok, JSON.stringify(read));
  return read.pair;
}

const SAMPLE_SNAPSHOTS = {
  github: JSON.parse(readFileSync(new URL('snapshots/github.json', ROOT), 'utf8')) as unknown,
};

const html = (input: VariantRenderInput) => renderToStaticMarkup(<SwissSignal input={input} />);
const ids = (markup: string) => [...markup.matchAll(/\sid="([^"]+)"/g)].map(([, id]) => id!);
const fragments = (markup: string) =>
  [...markup.matchAll(/\shref="[^"#]*#([^"]+)"/g)].map(([, id]) => decodeURIComponent(id!));

test('its manifest renders every core kind itself, owns home, and moves nothing', () => {
  assert.deepEqual([...MANIFEST.renderedKinds].sort(), [
    'chronology',
    'contact',
    'cta',
    'custom',
    'evidence',
    'focus',
    'fun-facts',
    'github',
    'hero',
    'lede',
    'now',
    'practice',
    'quote',
    'works',
  ]);
  assert.equal(MANIFEST.routes.home, 'bespoke');
  assert.equal(MANIFEST.compositionFamily, 'document');
  assert.equal(MANIFEST.performanceTier, 'light');
  assert.equal(MANIFEST.budgets?.animation, 0);
  assert.equal(MANIFEST.visitorControl.placement, 'footer');
  // No enhancement island: the Position controller is in the page (S4, S6 under reduced motion).
  assert.equal(MANIFEST.enhancements, undefined);
});

const cases: { name: string; input: (prefix: string) => VariantRenderInput }[] = [
  ...CONTRACT_FIXTURES.map(({ name }) => ({
    name,
    input: (prefix: string) => inputOf(pairOf(name), prefix),
  })),
  { name: 'sample', input: (prefix: string) => inputOf(samplePair(), prefix, SAMPLE_SNAPSHOTS) },
];

for (const { name, input: build } of cases) {
  test(`${name}: one h1 naming the owner, one main, every section in one Swiss frame`, () => {
    for (const prefix of ['', 'pv-']) {
      const input = build(prefix);
      const markup = html(input);
      assert.equal(markup.match(/<h1[\s>]/g)?.length, 1);
      assert.equal(markup.match(/<main[\s>]/g)?.length, 1);
      // SS-M5: the owner's name is inside the h1, as the hero gives it (else the identity's).
      const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(markup)![1]!;
      const text = h1
        .replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&')
        .replace(/&#x27;/g, "'")
        .replace(/&quot;/g, '"');
      assert.ok(text.includes(ownerName(input)), `${name}: ${text}`);
      assert.doesNotMatch(markup, new RegExp(HIDDEN_CANARY), name);
      assert.doesNotMatch(markup, /data-renderer="shared"/);
      const shown = input.portfolio.sections.filter((section) => sectionRenders(section, input));
      for (const section of shown) {
        const frames =
          markup.match(new RegExp(`data-section-id="${section.id}"`, 'g'))?.length ?? 0;
        assert.equal(frames, 1, `${name}: ${section.id} is framed once`);
      }
      const all = ids(markup);
      assert.equal(
        new Set(all).size,
        all.length,
        `duplicate ids: ${all.filter((id, i) => all.indexOf(id) !== i)}`,
      );
      if (prefix) for (const id of all) assert.ok(id.startsWith(prefix), id);
      const known = new Set(all);
      for (const fragment of fragments(markup))
        assert.ok(known.has(fragment), `${name}: #${fragment} lands`);
      // Native tables: every table has a caption and column headers with scope.
      for (const table of markup.match(/<table[\s\S]*?<\/table>/g) ?? []) {
        assert.match(table, /<caption>/);
        assert.match(table, /<th scope="col"/);
      }
      // No hyphen in a year range (S13).
      assert.doesNotMatch(
        // The words a reader sees: a printed address (paper alone) is a URL, not a range.
        markup.replace(/<span class="ss-addr"[\s\S]*?<\/span>/g, ' ').replace(/<[^>]+>/g, ' '),
        /\b(19|20)\d\d-(?:\s|now|(19|20)\d\d\b)/,
      );
      // The Index's count agrees in number: "1 section", never "1 sections".
      assert.doesNotMatch(markup, /\b1 (sections|parts)\b/);
      // Nothing ships marked live: until Position runs, the Index is its plain link (code review B).
      assert.doesNotMatch(markup, /data-ss-live|data-open|aria-expanded/);
      // The sheet sits after main, out of the sticky masthead, for the no-script path.
      assert.match(markup, /<\/main><div class="ss-index__sheet"/);
    }
  });
}

// Gate item 8: the full record folds into closed native disclosures, each holding its own frame.
for (const { name, input: build } of cases) {
  test(`${name}: every fold is a closed native disclosure holding its section's own frame`, () => {
    const markup = html(build(''));
    const opening = /<details\b([^>]*)>/g;
    for (const [tag, attributes] of markup.matchAll(opening)) {
      if (!/\sdata-ss-fold=/.test(attributes!)) continue;
      // The open attribute, in any position and any form (open, open="", open="open").
      assert.doesNotMatch(attributes!, /\sopen(?=[\s=>]|$)/, `${name}: folds ship closed: ${tag}`);
      const after = markup.slice(markup.indexOf(tag));
      assert.match(after, /^<details[^>]*><summary class="ss-fold__summary">/);
      assert.match(
        after.slice(0, after.indexOf('</summary>') + 400),
        /<\/summary><section[^>]*data-section-id="[^"]+"/,
        `${name}: the frame follows the summary inside the fold`,
      );
    }
  });
}

test('the sample: home folds the full record, keeps a handful of works and one Record summary', () => {
  const input = inputOf(samplePair(), '', SAMPLE_SNAPSHOTS);
  const markup = html(input);
  const folded = [
    ...markup.matchAll(/<details class="ss-fold"[\s\S]*?data-section-id="([^"]+)"/g),
  ].map(([, id]) => id);
  for (const id of [
    'experience',
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
    'engagements',
  ]) {
    assert.ok(folded.includes(id), `${id} folds: ${folded.join(', ')}`);
  }
  for (const id of ['work-showcase', 'essays', 'words-from-collaborators', 'contact']) {
    assert.ok(!folded.includes(id), `${id} stays open`);
  }
  // The Record summary keeps the latest role in view.
  assert.match(markup, /class="ss-fold__first"[^>]*>Principal Engineer, Reliability/);
  // Each closed row reads as a list of things: its first item, and its count in its own noun
  // (lead A's ruling with design review item 10); the "(n)" leaves the fold's title.
  const rows = [...markup.matchAll(/<summary class="ss-fold__summary">([\s\S]*?)<\/summary>/g)].map(
    ([, row]) => row!.replace(/<[^>]+>/g, '|').replace(/\|+/g, '|'),
  );
  for (const [title, count] of [
    ['Looking', '3 photographs'] as const,
    ['Listening', '6 tracks'] as const,
    ['Publications', '2 papers'] as const,
    ['Engagements', '2 offers'] as const,
    ['On GitHub', '3 repositories'] as const,
  ]) {
    const row = rows.find((each) => each.replace(/^\|/, '').trimStart().startsWith(title));
    assert.ok(row, `${title}: ${rows.join(' / ')}`);
    assert.ok(row.includes(`|${count}|`), `${title} counts ${count}: ${row}`);
    assert.ok(row.split('|').filter(Boolean).length >= 3, `${title} names its first item: ${row}`);
  }
  assert.ok(
    rows.every((row) => !/\|\(\d+\)\|/.test(row)),
    rows.join(' / '),
  );
  // At a table row's size an aside is in the quiet paren, never the signal colour (axe at 390).
  for (const [summary] of markup.matchAll(
    /<summary class="ss-fold__summary">[\s\S]*?<\/summary>/g,
  )) {
    assert.doesNotMatch(summary, /ss-paren--signal/, summary);
    // Its name is a heading in the summary, so closed folds stay in heading navigation;
    // the first item is the content's own line, hidden from assistive tech; the count
    // reads as its own phrase: "Publications, 2 papers" (confirmation review 5).
    assert.match(summary, /^<summary class="ss-fold__summary"><h3 class="ss-fold__title"/);
    assert.match(summary, /<span class="ss-fold__first"[^>]*aria-hidden="true"/);
    assert.match(
      summary,
      /<span class="ss-fold__count[^"]*"[^>]*><span class="ss-hidden">, <\/span>/,
    );
  }
  // Every folded section is still an Index entry.
  for (const id of folded) assert.match(markup, new RegExp(`ss-index__list[\\s\\S]*href="#${id}"`));
});

// The case study (component 19), on every fixture with a work of its own and on the sample.
const workCases = [
  ...CONTRACT_FIXTURES.map(({ name }) => ({ name, pair: () => pairOf(name), snapshots: {} })),
  { name: 'sample', pair: samplePair, snapshots: SAMPLE_SNAPSHOTS },
].flatMap(({ name, pair, snapshots }) =>
  // From the view, so a hidden work (the canary's) never counts as a page.
  inputOf(pair(), '', snapshots)
    .portfolio.works.filter((work) => work.slug && work.caseStudy)
    .map((work) => ({ name: `${name} ${work.slug}`, pair, snapshots, slug: work.slug! })),
);

test('the case study renders on every fixture that has one', () => {
  assert.ok(workCases.length >= 2, workCases.map((c) => c.name).join(', '));
});

for (const { name, pair, snapshots, slug } of workCases) {
  test(`${name}: the case page is Swiss's own, one h1, its parts numbered and landing`, () => {
    for (const prefix of ['', 'pv-']) {
      const input = inputOf(pair(), prefix, snapshots, { route: 'work', slug });
      const markup = html(input);
      assert.match(markup, /class="ss ss--case"/, 'Swiss renders the work route itself');
      assert.equal(markup.match(/<h1[\s>]/g)?.length, 1);
      assert.equal(markup.match(/<main[\s>]/g)?.length, 1);
      assert.doesNotMatch(markup, /data-renderer="shared"/);
      // The h1 is the work's own title, exactly (ci:variants' case-study check):
      // the page's derived "(medium, period)" stands outside it.
      const own = input.portfolio.works.find((each) => each.slug === slug)!;
      const heading = /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(markup)![1]!;
      assert.equal(
        heading
          .replace(/<[^>]+>/g, '')
          .replace(/&#x27;/g, "'")
          .replace(/&quot;/g, '"')
          .replace(/&amp;/g, '&')
          .replace(/\s+/g, ' ')
          .trim(),
        own.title.replace(/\s+/g, ' ').trim(),
      );
      assert.doesNotMatch(markup, new RegExp(HIDDEN_CANARY), name);
      // The crumb goes back to home.
      assert.match(markup, /class="ss-crumb"[\s\S]*?<a href="\/(?:#[^"]+)?"/);
      // Each part the owner wrote is a numbered row with its outline anchor.
      const work = input.portfolio.works.find((each) => each.slug === slug)!;
      const study = work.caseStudy!;
      const written = (
        [
          'challenge',
          'context',
          'role',
          'constraints',
          'decisions',
          'evidence',
          'outcomes',
          'reflection',
        ] as const
      ).filter((key) => {
        const value = study[key];
        return Array.isArray(value)
          ? value.length > 0
          : typeof value === 'string' && value.trim() !== '';
      });
      for (const key of written.filter((key) => key !== 'evidence')) {
        assert.match(
          markup,
          new RegExp(`class="ss-spec__row" id="${prefix}${work.id}--${key}"`),
          key,
        );
      }
      // Every part the outline counts (and "(n parts)" says) has a body under its name.
      const outline = caseStudyOutline(input)!;
      const head = markup.slice(markup.indexOf(`id="${prefix}ss--case-parts"`));
      assert.match(
        head.slice(0, head.indexOf('</h2>')).replace(/<[^>]+>/g, ''),
        new RegExp(`The case \\(${outline.parts.length} parts?\\)$`),
      );
      for (const part of outline.parts) {
        const at = markup.indexOf(`id="${part.anchor}"`);
        assert.ok(at > 0, `${part.key} row`);
        const row = markup.slice(markup.indexOf('</h3>', at) + 5);
        const body = row
          .slice(0, row.indexOf('</li>'))
          .replace(/<[^>]+>/g, '')
          .trim();
        assert.notEqual(body, '', `${name}: ${part.key} has a body`);
      }
      // Ids are unique, and every fragment lands on the page or goes home.
      const all = ids(markup);
      assert.equal(new Set(all).size, all.length);
      const known = new Set(all);
      for (const [, href, fragment] of markup.matchAll(/\shref="([^"#]*)#([^"]+)"/g)) {
        if (href === '') assert.ok(known.has(decodeURIComponent(fragment!)), `#${fragment} lands`);
      }
      for (const table of markup.match(/<table[\s\S]*?<\/table>/g) ?? []) {
        assert.match(table, /<caption>/);
        assert.match(table, /<th scope="col"/);
      }
      // Next: the next case, else the way back to the works section.
      assert.match(markup, /class="ss-next__link"/);
      assert.doesNotMatch(
        // The words a reader sees: a printed address (paper alone) is a URL, not a range.
        markup.replace(/<span class="ss-addr"[\s\S]*?<\/span>/g, ' ').replace(/<[^>]+>/g, ' '),
        /\b(19|20)\d\d-(?:\s|now|(19|20)\d\d\b)/,
      );
    }
  });
}

test('an Evidence part with no words lists what the work cites, each a link to its row', () => {
  const input = inputOf(
    pairOf('academic'),
    '',
    {},
    { route: 'work', slug: 'canopy-drought-memory' },
  );
  const markup = html(input);
  const work = input.portfolio.works.find((each) => each.slug === 'canopy-drought-memory')!;
  assert.ok(!work.caseStudy?.evidence?.trim(), 'the fixture writes no evidence words');
  const row = markup.slice(markup.indexOf(`id="${work.id}--evidence"`));
  const list = row.slice(0, row.indexOf('</ul>'));
  assert.match(list, /class="ss-spec__text ss-spec__cited"/);
  for (const id of work.evidence ?? []) {
    assert.match(list, new RegExp(`href="#ss--case-cited-${id}"`), id);
    assert.match(markup, new RegExp(`<li id="ss--case-cited-${id}"`), `${id} lands On the record`);
  }
  assert.match(list, />Drought memory in temperate canopies</);
});

test('a cited record named by its own organization, with no year, sets no empty by-line', () => {
  const pair = pairOf('academic');
  const evidence = (pair.portfolio.evidence ?? []).map((entry) =>
    entry.id === 'erc-starting-grant'
      ? { ...entry, title: undefined, receivedAt: undefined, publishedAt: undefined }
      : entry,
  );
  const markup = html(
    inputOf(
      { ...pair, portfolio: { ...pair.portfolio, evidence } } as ParsedPair,
      '',
      {},
      {
        route: 'work',
        slug: 'canopy-drought-memory',
      },
    ),
  );
  const list = markup.slice(markup.indexOf('class="ss-spec__text ss-spec__cited"'));
  const item = list.slice(list.indexOf('href="#ss--case-cited-erc-starting-grant"'));
  const row = item.slice(0, item.indexOf('</li>'));
  assert.match(row, />European Research Council<\/a>$/);
  assert.doesNotMatch(markup, /<span class="ss-muted" data-type-role="body-compact"><\/span>/);
});

test('the sample case: the poster aside, the fact sheet, the decisions table, On the record', () => {
  const input = inputOf(samplePair(), '', SAMPLE_SNAPSHOTS, {
    route: 'work',
    slug: 'postmortem-template-kit',
  });
  const markup = html(input);
  assert.match(markup, />\(software, <span class="ss-nowrap">2022–now<\/span>\)</);
  // POSTMORTEM is ten letters: the phone rule fits the poster to that word.
  assert.match(
    markup,
    /<div class="ss-poster__line"[^>]*data-word="long"[^>]*style="--layout-ss-word:10"><h1 class="ss-case__title"/,
  );
  assert.match(markup, /class="ss-next__link"[^>]*style="--layout-ss-word:\d+"/);
  assert.match(markup, /<dt>Period<\/dt><dd class="ss-num">Since January 2022<\/dd>/);
  assert.match(markup, /<dt>Made with<\/dt><dd>TypeScript, Bun, Markdown<\/dd>/);
  assert.match(markup, /<caption><span class="ss-hidden">Decisions<\/span><\/caption>/);
  // Below 48rem each decision is one row: Why and Instead of leave as columns
  // (ss-wide) and stand under it as labelled lines (design review item 11).
  const decisions = markup.slice(markup.indexOf('Decisions</span></caption>'));
  const table = decisions.slice(0, decisions.indexOf('</table>'));
  assert.match(table, /<th scope="col" class="ss-wide"[^>]*>Why<\/th>/);
  assert.match(table, /<th scope="col" class="ss-wide"[^>]*>Instead of<\/th>/);
  const narrow = [
    ...table.matchAll(/<div class="ss-narrow"><dl class="ss-decision">([\s\S]*?)<\/dl>/g),
  ];
  assert.equal(narrow.length, 2);
  assert.match(
    narrow[0]![1]!,
    /<dt data-type-role="label">Why<\/dt><dd>(<span[^>]*>)?A field invites/,
  );
  assert.match(
    narrow[1]![1]!,
    /<dt data-type-role="label">Instead of<\/dt><dd><span class="ss-muted">Not recorded/,
  );
  assert.match(
    markup,
    /On the record <span class="ss-paren ss-paren--signal" data-type-role="quote">\(2\)/,
  );
  assert.match(markup, /Back to the index|Next case study/);
});

test('N7: the parts are the navigation model grouped for display, with no diagnostic', () => {
  for (const { name, input } of cases) {
    for (const partOrder of ['work-first', 'writing-first', 'record-first', 'about-first']) {
      const base = input('');
      const each = { ...base, controls: { ...base.controls, partOrder } };
      assert.deepEqual(
        checkGrouping({ grouping: partGrouping(each) }, [pageOutline(each)]),
        [],
        `${name} ${partOrder}`,
      );
    }
  }
});

test('the sample: the poster, the band, five parts in their fixed order', () => {
  const input = inputOf(samplePair(), '', SAMPLE_SNAPSHOTS);
  assert.equal(posterLine(input).text, 'I make failure legible.');
  assert.equal(heroOf(input)?.id, 'top');
  assert.equal(figuresBand(input)?.figures.length, 4);
  assert.deepEqual(
    partsOf(input, pageOutline(input)).map((part) => part.id),
    ['work', 'writing', 'record', 'about', 'contact'],
  );
  const markup = html(input);
  // The aside is in the quote role, set italic by the composition (SS-M1).
  assert.match(
    markup,
    /class="ss-paren ss-paren--signal ss-poster__aside" data-type-role="quote">\(Engineer, writer, speaker\)/,
  );
  // Design issue 6: Writing's opener lists its sections; Contact's says its call once, as its head.
  assert.match(markup, /ss-part__toc[^>]*>[\s\S]*?>Essays<\/a>/);
  assert.doesNotMatch(
    markup,
    /ss-part__toc[^>]*>(?:(?!<\/p>)[\s\S])*?>Want to work together\?<\/a>/,
  );
  // Once on the page itself (the Index, after main, lists every section by name).
  const page = markup
    .slice(0, markup.indexOf('<div class="ss-index__sheet"'))
    .replace(/<[^>]+>/g, ' ');
  assert.equal((page.match(/Want to work together\?/g) ?? []).length, 1);
  // A long venue never holds one line (code review A): it has no nowrap class.
  for (const [, venue] of markup.matchAll(/<em class="ss-cite__venue">([^<]+)<\/em>/g)) {
    assert.ok([...venue!].length <= 24, venue);
  }
  // SS-M3: stars and forks each have a column header of their own in the
  // markup; their 390 layout is tests/e2e/swiss-signal.spec.ts's.
  assert.match(markup, />Stars<\/span><\/th>|>Stars<\/th>/);
  assert.match(markup, />Forks<\/span><\/th>|>Forks<\/th>/);
  // SS-M4: no contact row repeats its address as its label.
  for (const [, label, address] of markup.matchAll(
    /<dt[^>]*>([^<]+)<\/dt><dd><a [^>]*>([^<]+)</g,
  )) {
    assert.notEqual(label!.toLowerCase(), address!.toLowerCase());
  }
});

test('a long case title keeps its own class: no word fit, which is for the uppercase lines', () => {
  const pair = samplePair();
  const LONG =
    'Postmortem Template Kit: twelve templates and a command-line interviewer for incident reviews';
  const works = (pair.portfolio.works ?? []).map((work) =>
    work.slug === 'postmortem-template-kit' ? { ...work, title: LONG } : work,
  );
  const input = inputOf(
    { ...pair, portfolio: { ...pair.portfolio, works } },
    '',
    SAMPLE_SNAPSHOTS,
    { route: 'work', slug: 'postmortem-template-kit' },
  );
  const line = html(input).match(/<div class="ss-poster__line"[^>]*>/)![0];
  assert.match(line, /data-length="long"/);
  assert.doesNotMatch(line, /data-word=|--layout-ss-word/);
});

test('an outbound link prints its address breakable at its separators, never inside a word', () => {
  const markup = renderToStaticMarkup(<Out href="https://example.com/incident-history/24?a=b" />);
  assert.match(markup, /<span class="ss-addr" aria-hidden="true">/);
  const address = markup.slice(markup.indexOf('ss-addr'));
  assert.match(
    address,
    /https:\/<wbr\/>\/<wbr\/>example\.<wbr\/>com\/<wbr\/>incident-<wbr\/>history\/<wbr\/>24\?<wbr\/>a=<wbr\/>b/,
  );
  assert.equal(renderToStaticMarkup(<Out href="/work/kit" />), '');
});

test('a long venue renders without the one-line class, a short one with it (code review A)', () => {
  const pair = samplePair();
  const LONG = 'Proceedings of the ACM on Programming Languages';
  let changed = 0;
  const evidence = (pair.portfolio.evidence ?? []).map((entry) => {
    if (entry.type !== 'publication' || changed > 0) return entry;
    changed += 1;
    return { ...entry, venue: LONG };
  });
  assert.equal(changed, 1);
  const markup = html(
    inputOf({ ...pair, portfolio: { ...pair.portfolio, evidence } }, '', SAMPLE_SNAPSHOTS),
  );
  assert.match(markup, new RegExp(`<em>${LONG}</em>`));
  assert.doesNotMatch(markup, new RegExp(`class="ss-cite__venue">${LONG}`));
  // The sample's other venue is short and keeps its line.
  assert.match(markup, /<em class="ss-cite__venue">ACM Computing Surveys<\/em>/);
});

test("an untitled folded section: its summary's h3 names it, and its own hidden heading sits in the head the fold drops", () => {
  const pair = samplePair();
  const sections = (pair.portfolio.sections ?? []).map((section) =>
    section.id === 'patents' ? { ...section, title: undefined } : section,
  );
  const markup = html(
    inputOf(
      { ...pair, portfolio: { ...pair.portfolio, sections } } as ParsedPair,
      '',
      SAMPLE_SNAPSHOTS,
    ),
  );
  const at = markup.indexOf('data-section-id="patents"');
  const fold = markup.slice(markup.lastIndexOf('<details class="ss-fold"', at), at);
  assert.match(fold, /<summary class="ss-fold__summary"><h3 class="ss-fold__title"[^>]*>/);
  // The frame's own heading is the .ss-hidden one, the direct child of its
  // .ss-head, which styles.css hides inside a fold by element, not class.
  const frame = markup.slice(at, markup.indexOf('</header>', at));
  assert.match(
    frame,
    /<header class="ss-head ss-head--bare"><h3 id="patents--h" class="ss-hidden"/,
  );
});

test('posterLine=name: the h1 is the name itself, with no hidden prefix (SS-M5)', () => {
  const pair = samplePair();
  const site = {
    ...pair.site,
    variantControls: { 'swiss-signal': { version: 1, values: { posterLine: 'name' } } },
  };
  const input = inputOf({ ...pair, site } as ParsedPair, '', SAMPLE_SNAPSHOTS);
  assert.equal(posterLine(input).source, 'name');
  const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(html(input))![1]!;
  assert.doesNotMatch(h1, /ss-hidden/);
  assert.match(h1, /Anamika Devi/);
});
