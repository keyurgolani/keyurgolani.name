import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { resolvePortfolioView, type ParsedPair } from '@portfolio/schema';
import { readPair } from '@portfolio/schema/node';
import { caseStudyOutline, isRoutedWork, navigationModel } from '@portfolio/kit/sections';
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
import Shell from '.';
import { outlineFor } from './parts';
import {
  alsoWorksOf,
  citedOf,
  coverOf,
  historyOf,
  manSectionsOf,
  manTitleOf,
  plainInline,
  restMediaOf,
  seeAlsoOf,
} from './model';

// Shell's own case page, /work/<slug> (brief §5.6, P2), as the server sends
// it: a man(1) page whose title is the page's one h1; every part the
// outline names at its anchor; every case field the work has on the page;
// the index listing the page's sections; and the shell idiom (the command,
// the running head and foot) hidden from assistive tech.

Object.assign(globalThis, { React });

const PACKAGE = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const RAW = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));

const MANIFEST = (() => {
  const result = validateManifest(RAW, { packageName: PACKAGE.name, exports: PACKAGE.exports });
  assert.ok(result.ok, JSON.stringify(result.ok ? [] : result.diagnostics));
  return result.manifest as VariantManifest;
})();

function inputOf(pair: ParsedPair, slug: string, idPrefix = ''): VariantRenderInput {
  return buildRenderInput({
    view: resolvePortfolioView(pair, {}, { mediaBase: '/media' }),
    manifest: MANIFEST,
    route: { route: 'work', slug } as never,
    basePath: '',
    origin: 'https://rowan.test',
    requestTime: '2026-10-28T12:00:00Z',
    idPrefix,
  });
}

function pairOf(name: string): ParsedPair {
  const read = readPair(contractFixture(name).files);
  assert.ok(read.ok, `${name}: ${JSON.stringify(read)}`);
  return read.pair;
}

/** A pair from a portfolio document of the test's own. */
function ownPair(portfolio: unknown): ParsedPair {
  const base = pairOf('sparse');
  return { ...base, portfolio: portfolio as ParsedPair['portfolio'] };
}

const html = (input: VariantRenderInput) => renderToStaticMarkup(<Shell input={input} />);
const ids = (markup: string) => [...markup.matchAll(/\sid="([^"]+)"/g)].map(([, id]) => id!);
const fragments = (markup: string) =>
  [...markup.matchAll(/\shref="#([^"]+)"/g)].map(([, id]) => decodeURIComponent(id!));
const count = (markup: string, pattern: RegExp) => markup.match(pattern)?.length ?? 0;
const escaped = (text: string) =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');

/** Every routed work's page in the contract fixtures, with and without an id prefix. */
function casePages() {
  const pages: { name: string; input: VariantRenderInput }[] = [];
  for (const { name } of CONTRACT_FIXTURES) {
    const pair = pairOf(name);
    for (const work of pair.portfolio.works ?? []) {
      if (!isRoutedWork(work)) continue;
      for (const prefix of ['', 'p-']) {
        const input = inputOf(pair, work.slug, prefix);
        if (caseStudyOutline(input)) {
          pages.push({ name: `${name} /work/${work.slug}${prefix ? ' (prefixed)' : ''}`, input });
        }
      }
    }
  }
  return pages;
}

test('the manifest owns the work route', () => {
  assert.equal(MANIFEST.routes.work, 'bespoke');
});

test('every case page passes the outline check: one h1, the title; every part at its anchor; nothing shared', () => {
  const pages = casePages();
  assert.ok(pages.length >= 4, `only ${pages.length} case pages`);
  for (const { name, input } of pages) {
    const markup = html(input);
    const outline = caseStudyOutline(input)!;
    assert.deepEqual(checkOutline(markup, input.ids, {}), [], name);
    assert.equal(count(markup, /data-renderer="shared"/g), 0, `${name}: a shared section`);
    assert.equal(count(markup, /<h1\b/g), 1, name);
    assert.match(
      markup,
      new RegExp(`<h1 class="sh-man__title"[^>]*>${escaped(outline.work.title)}</h1>`),
      name,
    );
    const all = ids(markup);
    assert.equal(new Set(all).size, all.length, `${name}: an id repeats`);
    for (const id of all) assert.ok(id.startsWith(input.ids.prefix), `${name}: ${id} unprefixed`);
    const known = new Set([...all, input.ids.main]);
    for (const part of outline.parts) assert.ok(known.has(part.anchor), `${name}: ${part.key}`);
    for (const fragment of fragments(markup))
      assert.ok(known.has(fragment), `${name}: #${fragment} lands nowhere`);
    for (const [, labels] of markup.matchAll(/\saria-labelledby="([^"]+)"/g))
      for (const label of labels!.split(' '))
        assert.ok(known.has(label), `${name}: aria-labelledby ${label} names nothing`);
    // Each man section is a block the index lands on, in ~/work.
    for (const section of manSectionsOf(outline.work, outline, input, outline.related)) {
      assert.match(
        markup,
        new RegExp(`<section class="sh-block sh-man__sec" id="${section.anchor}"[^>]*data-cwd="~/`),
        `${name}: ${section.key}`,
      );
      assert.match(markup, new RegExp(`data-sh-target="${section.anchor}"`), `${name}: row`);
    }
    assert.doesNotMatch(markup, new RegExp(HIDDEN_CANARY), name);
    // The shell idiom is never read aloud.
    assert.equal(count(markup, /class="sh-cmd"(?! aria-hidden="true")/g), 0, `${name}: sh-cmd`);
    assert.equal(count(markup, /class="sh-man__run[^"]*"(?! aria-hidden="true")/g), 0, name);
  }
});

test('every case field the work has is on its page', () => {
  for (const { name, input } of casePages()) {
    const markup = html(input);
    const work = caseStudyOutline(input)!.work;
    // The page's text and a field's, alike in their quotes, entities and spaces.
    const flat = (text: string) =>
      text
        .replace(/&#x27;|&#39;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/[\u2018\u2019]/g, "'")
        .replace(/[\u201c\u201d]/g, '"')
        .replace(/\s+/g, ' ')
        .trim();
    const shown = flat(markup.replace(/<[^>]+>/g, ' '));
    const words = (text: string | undefined) => {
      if (!text?.trim()) return;
      // A run of the field's own words, as its rich text prints them.
      const plain = flat(plainInline(text)).split(' ').slice(0, 4).join(' ');
      assert.ok(shown.includes(plain), `${name}: "${plain}"`);
    };
    words(work.summary);
    words(work.description);
    words(work.role);
    words(work.organization);
    for (const tool of work.tools ?? []) words(tool);
    for (const highlight of work.highlights ?? []) words(highlight);
    const study = work.caseStudy;
    for (const key of [
      'challenge',
      'context',
      'role',
      'constraints',
      'evidence',
      'outcomes',
      'reflection',
    ] as const)
      words(study[key]);
    for (const decision of study.decisions ?? []) {
      words(decision.decision);
      words(decision.rationale);
      words(decision.alternatives);
    }
    for (const link of work.links ?? [])
      assert.ok(markup.includes(`href="${escaped(link.url)}"`), `${name}: ${link.url}`);
    for (const record of citedOf(work, input))
      assert.ok(markup.includes(`id="${input.ids.prefix}${record.id}"`), `${name}: ${record.id}`);
  }
});

test('a bare case: NAME, SYNOPSIS, its one part and AUTHORS; no HISTORY, no SEE ALSO, still whole', () => {
  const input = inputOf(
    ownPair({
      schemaVersion: 3,
      locale: 'en',
      direction: 'ltr',
      identity: { name: 'Rowan Case' },
      works: [
        {
          id: 'atlas',
          slug: 'atlas',
          title: 'Atlas',
          medium: 'system',
          caseStudy: { challenge: 'Hard.' },
        },
      ],
      evidence: [],
      chronology: [],
      links: [],
      sections: [{ kind: 'works', id: 'work', title: 'Work', items: ['atlas'] }],
    }),
    'atlas',
  );
  const markup = html(input);
  const keys = [...markup.matchAll(/data-man="([\w-]+)"/g)].map(([, key]) => key);
  assert.deepEqual(keys, ['name', 'synopsis', 'challenge', 'authors']);
  assert.match(markup, /ATLAS\(1\)/);
  assert.deepEqual(checkOutline(markup, input.ids, {}), []);
  assert.equal(count(markup, /sh-man__cover/g), 0);
});

test('the man page model: the title, the cited records, HISTORY and SEE ALSO, the sections in order', () => {
  assert.equal(
    manTitleOf({ id: 'a', slug: 'small-traces', medium: 'software' }),
    'SMALL-TRACES(1)',
  );
  assert.equal(manTitleOf({ id: 'a', slug: 'quiet', medium: 'writing' }), 'QUIET(7)');
  const input = {
    portfolio: {
      evidence: [
        { id: 'award', type: 'award', title: 'Prize' },
        { id: 'press', type: 'press', title: 'Story' },
      ],
    },
    controls: {},
    ids: { prefix: 'p-' },
    media: {
      a: { id: 'a', kind: 'image', derived: { state: 'ready' } },
      b: { id: 'b', kind: 'image', derived: { state: 'ready' } },
      clip: { id: 'clip', kind: 'video', derived: { state: 'ready' } },
    },
  } as unknown as Parameters<typeof manSectionsOf>[2];
  const cited = citedOf({ evidence: ['press', 'gone', 'award', 'press'] }, input);
  assert.deepEqual(
    cited.map(({ id }) => id),
    ['press', 'award'],
  );
  assert.deepEqual(
    historyOf(cited).map(({ id }) => id),
    ['award'],
  );
  const see = seeAlsoOf(cited, [
    { id: 'b', shared: ['TypeScript'] },
    { id: 'c', shared: [] },
  ]);
  assert.deepEqual(
    see.records.map(({ id }) => id),
    ['press'],
  );
  assert.deepEqual(
    see.works.map(({ id }) => id),
    ['b'],
  );
  const sections = manSectionsOf(
    { id: 'w', description: 'Words.', evidence: ['award', 'press'] },
    {
      parts: [
        { key: 'challenge', anchor: 'p-w--challenge' },
        { key: 'decisions', anchor: 'p-w--decisions' },
      ],
    },
    input,
    [{ shared: [] }],
  );
  assert.deepEqual(
    sections.map(({ key }) => key),
    ['name', 'synopsis', 'description', 'challenge', 'decisions', 'history', 'see-also', 'authors'],
  );
  assert.equal(sections[0]!.anchor, 'p-w--name');
  assert.equal(sections.find(({ key }) => key === 'see-also')!.label, 'See also');
  // A cover that is the first picture leaves DESCRIPTION nothing to show from the pictures.
  const keysOf = (media: readonly string[], cover?: string) =>
    manSectionsOf(
      {
        id: 'w',
        media: media.map((asset) => ({ asset })) as never,
        ...(cover ? { cover: { asset: cover } as never } : {}),
      },
      { parts: [] },
      input,
    ).map(({ key }) => key);
  assert.deepEqual(keysOf(['a']), ['name', 'synopsis', 'authors']);
  // What can't show as a picture (not an image, or not in the view) is no picture to describe,
  // and the first one that shows is the cover.
  assert.deepEqual(keysOf(['clip', 'a']), ['name', 'synopsis', 'authors']);
  assert.deepEqual(keysOf(['a', 'gone']), ['name', 'synopsis', 'authors']);
  assert.deepEqual(keysOf(['a'], 'clip'), ['name', 'synopsis', 'authors']);
  assert.deepEqual(keysOf(['a', 'b']), ['name', 'synopsis', 'description', 'authors']);
  assert.deepEqual(keysOf(['a'], 'b'), ['name', 'synopsis', 'description', 'authors']);
  assert.deepEqual(coverOf({ media: [{ asset: 'clip' }, { asset: 'b' }] } as never, input), {
    asset: 'b',
  });
  assert.deepEqual(
    restMediaOf({ cover: { asset: 'clip' }, media: [{ asset: 'a' }] } as never, input),
    [],
  );
});

test('SEE ALSO names works with their own page first, then the others that share a tag or a tool', () => {
  const input = {
    portfolio: {
      works: [
        {
          id: 'self',
          title: 'Self',
          medium: 'software',
          tools: ['TypeScript', 'Bun'],
          tags: ['ops'],
        },
        { id: 'routed', slug: 'routed', title: 'Routed', medium: 'writing', tags: ['ops'] },
        {
          id: 'site',
          title: 'Site',
          medium: 'software',
          tools: ['TypeScript', 'Bun'],
          url: 'https://x.test',
        },
        { id: 'plain', title: 'Plain', medium: 'object', tools: ['Bun'] },
        { id: 'apart', title: 'Apart', medium: 'software', tools: ['Rust'] },
      ],
    },
    controls: {},
  } as unknown as Parameters<typeof alsoWorksOf>[1];
  const also = alsoWorksOf(input.portfolio.works[0]!, input, [
    { id: 'routed', href: '/work/routed', shared: ['ops'] },
  ]);
  assert.deepEqual(
    also.map(({ id, href, routed, name, section }) => ({ id, href, routed, name, section })),
    [
      { id: 'routed', href: '/work/routed', routed: true, name: 'routed', section: 7 },
      { id: 'site', href: 'https://x.test', routed: false, name: 'site', section: 1 },
      { id: 'plain', href: undefined, routed: false, name: 'plain', section: 7 },
    ],
  );
  assert.deepEqual(also[1]!.shared, ['TypeScript', 'Bun']);
});

test("every case page's session starts with the no-script mark, alone in its noscript, with no style", () => {
  const pages = casePages();
  assert.ok(pages.length > 0);
  for (const { name, input } of pages) {
    const markup = html(input);
    assert.match(
      markup,
      /<div class="sh-session" data-sh-session=""[^>]*><noscript><i data-sh-nojs="" hidden=""><\/i><\/noscript><main /,
      name,
    );
    assert.equal(count(markup, /<noscript>/g), 1, name);
    const noscript = /<noscript>([\s\S]*?)<\/noscript>/.exec(markup)![1]!;
    assert.equal(noscript, '<i data-sh-nojs="" hidden=""></i>', name);
    assert.doesNotMatch(noscript, /style/, name);
  }
});

test('the way on: Next goes to the next work, All work to the work destination', () => {
  const two = ownPair({
    schemaVersion: 3,
    locale: 'en',
    direction: 'ltr',
    identity: { name: 'Rowan Case' },
    works: ['atlas', 'beacon'].map((slug) => ({
      id: slug,
      slug,
      title: slug === 'atlas' ? 'Atlas' : 'Beacon',
      medium: 'system',
      caseStudy: { challenge: 'Hard.' },
    })),
    evidence: [],
    chronology: [],
    links: [],
    sections: [{ kind: 'works', id: 'work', title: 'Work', items: ['atlas', 'beacon'] }],
  });
  const pages = [
    ...casePages(),
    ...['atlas', 'beacon'].map((slug) => ({
      name: `own /work/${slug}`,
      input: inputOf(two, slug),
    })),
  ];
  let nexts = 0;
  for (const { name, input } of pages) {
    const markup = html(input);
    const outline = caseStudyOutline(input)!;
    const on = markup.slice(markup.indexOf('<nav class="sh-man__on"'));
    const nav = on.slice(0, on.indexOf('</nav>'));
    if (outline.next) {
      nexts += 1;
      assert.ok(nav.includes(`href="${escaped(outline.next.href)}"`), `${name}: Next`);
      assert.match(nav, /Next:/, name);
      assert.ok(nav.includes(`>${escaped(outline.next.title)}</a>`), `${name}: its title`);
      assert.match(nav, new RegExp(`sh-cmd__verb">man</span>`), `${name}: man <slug>`);
      assert.ok(nav.includes(escaped(outline.next.slug)), `${name}: the slug`);
    } else assert.doesNotMatch(nav, /Next:/, name);
    const work = navigationModel(outlineFor(input)).primary.find(({ id }) => id === 'work');
    const all = nav.match(/<p class="sh-man__go sh-man__all"><a href="([^"]+)"/)?.[1];
    assert.equal(all, escaped(work?.href ?? outline.home), `${name}: All work`);
  }
  assert.ok(nexts > 0, 'no case page in the fixtures has a next work');
});

test('a cited record keeps its fields, and one with no title is named by who it is from', () => {
  const input = inputOf(
    ownPair({
      schemaVersion: 3,
      locale: 'en',
      direction: 'ltr',
      identity: { name: 'Rowan Case' },
      works: [
        {
          id: 'atlas',
          slug: 'atlas',
          title: 'Atlas',
          medium: 'system',
          caseStudy: { challenge: 'Hard.' },
          evidence: ['said', 'fig', 'paper', 'prize', 'study', 'filed', 'spoke'],
        },
      ],
      evidence: [
        {
          id: 'said',
          type: 'testimonial',
          statement: 'It held under load.',
          source: {
            name: 'Ada Quinn',
            role: 'Staff engineer',
            organization: 'Northwind',
            url: 'https://ada.test/',
          },
          links: [{ url: 'https://thread.test/x', label: 'Thread' }],
        },
        {
          id: 'fig',
          type: 'metric',
          statement: 'Requests served at p99.',
          metric: { key: 'p99-latency', value: 40, unit: 'ms' },
        },
        {
          id: 'paper',
          type: 'publication',
          title: 'On Atlas',
          url: 'https://paper.test/on-atlas',
          pdfUrl: 'https://paper.test/on-atlas.pdf',
          slidesUrl: 'https://slides.test/atlas',
          videoUrl: 'https://video.test/atlas',
          doi: 'doi:10.1000/atlas',
        },
        { id: 'prize', type: 'award', statement: 'For care.', organization: 'Guild' },
        {
          id: 'study',
          type: 'publication',
          title: 'A study',
          url: 'https://study.test/',
          authors: ['Ada Quinn', 'Rowan Case'],
          links: [{ url: 'https://study.test/', label: 'Again' }],
        },
        {
          id: 'filed',
          type: 'patent',
          title: 'A method',
          status: 'granted',
          inventors: ['Rowan Case'],
          assignee: 'Northwind',
        },
        { id: 'spoke', type: 'talk', title: 'A talk', format: 'lightning' },
      ],
      chronology: [],
      links: [],
      sections: [{ kind: 'works', id: 'work', title: 'Work', items: ['atlas'] }],
    }),
    'atlas',
  );
  const markup = html(input);
  assert.deepEqual(checkOutline(markup, input.ids, {}), []);
  // No record hangs under a blank name.
  assert.equal(count(markup, /<dt>(?:\s|<b>\s*<\/b>)*<\/dt>/g), 0);
  assert.equal(count(markup, /<b>\s*<\/b>/g), 0);
  const record = (id: string) => {
    const at = markup.indexOf(`id="${id}"`);
    assert.ok(at > 0, id);
    return markup.slice(at, markup.indexOf('</dd></div>', at));
  };
  // The testimonial is named by its source, with the source's role and organization.
  assert.match(record('said'), /<dt><a[^>]*href="https:\/\/ada\.test\/"[^>]*>Ada Quinn<\/a><\/dt>/);
  assert.match(record('said'), /Staff engineer/);
  assert.match(record('said'), /Northwind/);
  assert.match(record('said'), /href="https:\/\/thread\.test\/x"/);
  // The metric by what it counts.
  assert.match(record('fig'), /<dt><b>p99-latency<\/b><\/dt>/);
  assert.match(record('fig'), /40 ms/);
  // The publication keeps its PDF, slides, video and DOI, its address on its name.
  const paper = record('paper');
  assert.match(paper, /<dt><a[^>]*href="https:\/\/paper\.test\/on-atlas"/);
  for (const url of [
    'https://paper.test/on-atlas.pdf',
    'https://slides.test/atlas',
    'https://video.test/atlas',
    'https://doi.org/10.1000/atlas',
  ])
    assert.ok(paper.includes(`href="${url}"`), url);
  assert.equal(count(paper, /href="https:\/\/paper\.test\/on-atlas"/g), 1, 'the address once');
  // Its people, and its words for what the schema stores as values.
  assert.match(record('study'), /Ada Quinn and Rowan Case/);
  assert.equal(count(record('study'), /href="https:\/\/study\.test\/"/g), 1, 'the address once');
  assert.match(record('filed'), /Rowan Case/);
  assert.match(record('filed'), /Northwind/);
  assert.match(record('filed'), /, granted</);
  assert.match(record('spoke'), / lightning talk</);
  assert.doesNotMatch(record('spoke'), / lightning</);
  // The untitled award in HISTORY, named by who gave it.
  const at = markup.indexOf('id="prize"');
  const prize = markup.slice(at, markup.indexOf('</li>', at));
  assert.match(prize, /<b>Guild<\/b>/);
  assert.doesNotMatch(prize, /, Guild/);
});
