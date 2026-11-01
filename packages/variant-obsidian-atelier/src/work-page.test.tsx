import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { caseStudyOutline, pageOutline } from '@portfolio/kit/sections';
import { composeSchemas, resolvePortfolioView, type ParsedPair } from '@portfolio/schema';
import { readPair, readUnitFiles } from '@portfolio/schema/node';
import {
  buildRenderInput,
  validateManifest,
  type RouteTarget,
  type VariantManifest,
  type VariantRenderInput,
} from '@portfolio/variant-contract';
import { checkOutline, CONTRACT_FIXTURES, contractFixture } from '@portfolio/variant-contract/node';
import ObsidianAtelier from '.';
import { platesOf } from './work-page';

// A work's own page (redesign, stream C, OA-M5, S3, S5): on every contract
// fixture's routed works, the outline holds and the page is the
// composition's own; the case's stops are named by plate, never by the
// case's fields; the analytical column runs in without the kit's part
// headings; plates come only from what the work holds; and the reflection
// wall's floor names it and the way on.

Object.assign(globalThis, { React });

const PACKAGE = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const RAW = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
const MANIFEST = (() => {
  const result = validateManifest(RAW, { packageName: PACKAGE.name });
  assert.ok(result.ok);
  return result.manifest as VariantManifest;
})();
const { PortfolioSchema } = composeSchemas();
const SITE = (() => {
  const read = readPair(contractFixture('complete').files);
  assert.ok(read.ok);
  return read.pair.site;
})();

function inputOf(
  pair: ParsedPair,
  route: RouteTarget,
  idPrefix = '',
  dir?: string,
): VariantRenderInput {
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
    route,
    basePath: '',
    origin: 'https://rowan.test',
    requestTime: '2026-10-23T12:00:00Z',
    idPrefix,
  });
}

function fixturePair(name: string) {
  const fixture = contractFixture(name);
  const read = readPair(fixture.files);
  assert.ok(read.ok, JSON.stringify(read));
  return { pair: read.pair, dir: fixture.files.portfolio.replace(/\/portfolio\.yml$/, '') };
}

const html = (input: VariantRenderInput) => renderToStaticMarkup(<ObsidianAtelier input={input} />);
const text = (markup: string) =>
  markup
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
const headings = (markup: string) =>
  [...markup.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/g)].map(
    ([, level, inner]) => `h${level} ${text(inner!)}`,
  );

/** A portfolio of the test's own: a routed work citing a clipping, a figure, and an award, and a second room. */
const CASE = {
  schemaVersion: 3,
  locale: 'en',
  direction: 'ltr',
  identity: { name: 'Rowan Vale', tagline: 'Maker of small tools' },
  signature: 'kit',
  featured: ['tracer'],
  works: [
    {
      id: 'kit',
      slug: 'kit',
      title: 'The Kit',
      medium: 'software',
      summary: 'A kit for writing better reviews.',
      role: 'Author',
      period: { start: '2022-01' },
      tools: ['TypeScript', 'Markdown'],
      evidence: ['clip', 'mttd', 'prize'],
      cover: { asset: 'kit-cover' },
      links: [{ url: 'https://example.com/kit', label: 'GitHub' }],
      highlights: ['Used by twelve teams'],
      caseStudy: {
        challenge: 'Reviews were late.',
        context: 'Thirty-eight services.',
        role: 'I wrote it.',
        decisions: [
          { decision: 'Ask questions.', rationale: 'Fields invite one word.' },
          { decision: 'Edit together.', alternatives: 'A form.' },
        ],
        evidence: 'Attendance doubled.',
        outcomes: 'Detection got faster.',
        reflection: 'The questions mattered most.',
      },
    },
    { id: 'tracer', title: 'Tracer', medium: 'software', summary: 'A small tracer.' },
  ],
  evidence: [
    {
      id: 'clip',
      type: 'press',
      title: 'A piece about it',
      url: 'https://example.com/piece',
      excerpt: 'The closest thing to a shared rubric.',
      author: 'A Writer',
      publication: 'A Journal',
      publishedAt: '2025-05-12',
    },
    {
      id: 'mttd',
      type: 'metric',
      statement: 'Mean time to detect, after the reviews',
      metric: { key: 'mttd-minutes', value: 3, unit: 'minutes' },
    },
    {
      id: 'prize',
      type: 'award',
      title: 'A Practitioner Award',
      organization: 'USENIX',
      receivedAt: '2025',
      description: 'For the kit.',
    },
  ],
  media: [{ id: 'kit-cover', kind: 'image', source: 'media/kit.png', alt: 'The kit, fanned.' }],
  sections: [
    { kind: 'hero', id: 'top', tagline: 'Small tools, carefully made.' },
    { kind: 'works', id: 'projects', title: 'Projects', items: ['kit', 'tracer'] },
  ],
};

const caseInput = (portfolio: unknown = CASE, idPrefix = '') =>
  inputOf(
    { portfolio: PortfolioSchema.parse(portfolio), site: SITE } as ParsedPair,
    { route: 'work', slug: 'kit' },
    idPrefix,
  );

test("every contract fixture's routed works: the outline holds, every id once, and the page is the composition's own", () => {
  let pages = 0;
  for (const { name } of CONTRACT_FIXTURES) {
    const { pair, dir } = fixturePair(name);
    const home = inputOf(pair, { route: 'home' }, '', dir);
    for (const { slug } of pageOutline(home).works) {
      for (const idPrefix of ['', 'pv-']) {
        const input = inputOf(pair, { route: 'work', slug }, idPrefix, dir);
        const outline = caseStudyOutline(input);
        assert.ok(outline, `${name} ${slug}`);
        const markup = html(input);
        assert.deepEqual(
          checkOutline(markup, input.ids).map(({ code, at }) => `${code} ${at}`),
          [],
          `${name} ${slug} ${idPrefix}`,
        );
        assert.match(markup, /class="oa-main oa-casepage"/, `${name} ${slug}`);
        assert.doesNotMatch(markup, /data-renderer="shared"/);
        const all = [...markup.matchAll(/\sid="([^"]+)"/g)].map(([, id]) => id!);
        assert.equal(new Set(all).size, all.length, `${name} ${slug}: ids repeat`);
        // The one h1 is the work's title.
        const h1 = headings(markup).filter((each) => each.startsWith('h1 '));
        assert.deepEqual(h1, [`h1 ${text(outline.work.title)}`], `${name} ${slug}`);
        pages += 1;
      }
    }
  }
  assert.ok(pages >= 8, `rendered ${pages} pages`);
});

test('the case reads as Atelier anatomy: the title block, the installation, the case bar named by plate, run-ins, the reflection wall, the next room', () => {
  const markup = html(caseInput());
  const words = text(markup);
  // The installation leads: the work on its wall, the room's title on its floor, the facts a museum label.
  assert.ok(markup.indexOf('class="oa-installation oa-wall"') < markup.indexOf('<h1'));
  assert.match(words, /Room I , catalogue No\. 1 of 2/);
  assert.match(
    markup,
    /<h1 id="oa--case-title" class="oa-entrance__title" data-type-role="display">The Kit<\/h1>/,
  );
  assert.doesNotMatch(markup, /oa-factsheet|<dl class="oa-factsheet"/);
  const label = markup.slice(
    markup.indexOf('id="oa--label-kit"'),
    markup.indexOf('</figcaption>', markup.indexOf('id="oa--label-kit"')),
  );
  assert.match(
    text(label),
    /Plate 1 of 4 The Kit , since 2022\. Software\. Author\. Made with TypeScript and Markdown\. A Practitioner Award, USENIX, 2025\. GitHub/,
  );
  // The stops are the plates, never the case's fields.
  const bar = markup.slice(
    markup.indexOf('data-oa-stops'),
    markup.indexOf('</ol>', markup.indexOf('data-oa-stops')),
  );
  assert.deepEqual(
    [...bar.matchAll(/<a [^>]*>([\s\S]*?)<\/a>/g)].map(([, inner]) => text(inner!)),
    [
      'Installation view',
      'Plate 2, the clipping',
      'Plate 3, the figure',
      'Plate 4, the citation',
      'Reflection wall',
    ],
  );
  assert.match(words, /The case Installation view .* Reflection wall 4 plates/);
  // No h2 is a kit part label; the analytical column runs in.
  const h2s = headings(markup).filter((each) => each.startsWith('h2 '));
  for (const label of [
    'h2 Challenge',
    'h2 Context',
    'h2 Role',
    'h2 Decisions',
    'h2 Evidence',
    'h2 Outcomes',
  ]) {
    assert.ok(!h2s.includes(label), `${label} is printed`);
  }
  assert.ok(h2s.includes('h2 The challenge.'));
  assert.ok(h2s.includes('h2 Two decisions.'));
  assert.ok(h2s.includes('h2 What changed.'));
  // Plates: the quote straight on its plate, the figure in its frame's mat, the award matted.
  assert.match(
    markup,
    /<div class="oa-caseplate__mat"><blockquote class="oa-caseplate__quote" cite="https:\/\/example\.com\/piece">/,
  );
  assert.match(
    markup,
    /<div class="oa-caseplate__frame"><div class="oa-caseplate__mat"><p class="oa-caseplate__figure"><data value="3">3<\/data>/,
  );
  assert.match(markup, /oa-caseplate--citation/);
  // The reflection wall's floor names it; the way on is the back matter's alone, one per room (C7).
  const wall = markup.slice(
    markup.indexOf('class="oa-reflection oa-wall"'),
    markup.indexOf('<footer class="oa-backmatter"'),
  );
  assert.match(text(wall), /The questions mattered most\. Reflection, Room I$/);
  assert.doesNotMatch(wall, /<a /);
  // The next room at the title size, to its room on home, as it has no page of its own.
  assert.equal(markup.match(/class="oa-nextroom__link"/g)?.length, 1);
  assert.match(markup, /<a class="oa-nextroom__link" href="\/#tracer">/);
  assert.match(text(markup), /Next, Room II, No\. 2 Tracer A small tracer\./);
  // The chrome and the plan reach home's places from here.
  assert.match(markup, /class="oa-chrome__mark" href="\/#oa--entrance"/);
  assert.doesNotMatch(
    markup.slice(markup.indexOf('<footer class="oa-colophon'), markup.length),
    /href="#oa--entrance"/,
  );
});

test('plates come from what the work holds: no figure without a cited metric, and the cover is Plate 1', () => {
  const input = caseInput();
  const outline = caseStudyOutline(input)!;
  assert.deepEqual(
    platesOf(outline.work, input).map((plate) => plate.name),
    ['Plate 2, the clipping', 'Plate 3, the figure', 'Plate 4, the citation'],
  );
  const plain = Object.fromEntries(
    Object.entries(CASE.works[0]!).filter(([key]) => key !== 'evidence' && key !== 'cover'),
  );
  const bare = caseInput({ ...CASE, works: [plain, CASE.works[1]] });
  const markup = html(bare);
  assert.equal(platesOf(caseStudyOutline(bare)!.work, bare).length, 0);
  // With no plate and no cover, there's no case bar of one stop.
  assert.doesNotMatch(markup, /data-oa-stops/);
  assert.doesNotMatch(markup, /oa-caseplate/);
});

test('the wall beside the words holds plates alone: the notes and the highlights read in the column (OBS-3)', () => {
  const markup = html(caseInput());
  const rows = [...markup.matchAll(/<section [^>]*class="oa-case__row"[\s\S]*?<\/section>/g)].map(
    ([row]) => row,
  );
  // A row a part, each part taking the next plate, and none set across as a bare row.
  assert.deepEqual(
    rows.map((row) => /data-oa-row="([^"]+)"/.exec(row)![1]),
    ['challenge', 'decisions', 'evidence', 'outcomes'],
  );
  assert.ok(rows.every((row) => !row.includes('data-bare')));
  // What stands beside a part comes before its words, so it can hang from where they start.
  for (const row of rows) {
    const plate = row.indexOf('class="oa-case__plate"');
    assert.ok(plate >= 0 && plate < row.indexOf('class="oa-case__text"'));
  }
  // The three plates beside the first three parts; What changed, with no plate left, has its highlights.
  assert.deepEqual(
    rows.map((row) =>
      /class="oa-case__plate"(?: data-oa-place="[^"]+")?><(\w+) class="([\w-]+)/
        .exec(row)!
        .slice(1)
        .join('.'),
    ),
    ['figure.oa-caseplate', 'figure.oa-caseplate', 'figure.oa-caseplate', 'ul.oa-highlights'],
  );
  // A plate is a place of its own, named as its row is, so the head marks the row's stop while the plate is read.
  assert.match(rows[0]!, /class="oa-case__plate" data-oa-place="Plate 2, the clipping"/);
  // The challenge takes Plate 2; its context and the owner's part run in under its words.
  const challenge = rows[0]!;
  assert.match(challenge, /data-oa-place="Plate 2, the clipping"/);
  const words = challenge.slice(challenge.indexOf('class="oa-case__text"'));
  assert.match(
    text(words),
    /The challenge\. Reviews were late\. Context Thirty-eight services\. My part I wrote it\./,
  );
  // The notes are words: none hangs on the wall.
  assert.doesNotMatch(markup, /class="oa-case__plate"[^>]*><dl/);
});

test('in a plate, the ids carry the prefix and the case bar links stay on the page', () => {
  const markup = html(caseInput(CASE, 'pv-'));
  for (const [, href] of markup
    .matchAll(/data-oa-stops[\s\S]*?<\/ol>/g)
    .next()
    .value![0].matchAll(/href="([^"]+)"/g)) {
    assert.match(href!, /^#pv-oa--/);
    assert.ok(markup.includes(`id="${href!.slice(1)}"`), href);
  }
});
