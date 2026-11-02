import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { resolvePortfolioView, type ParsedPair } from '@portfolio/schema';
import { readPair } from '@portfolio/schema/node';
import {
  buildRenderInput,
  validateManifest,
  type VariantManifest,
} from '@portfolio/variant-contract';
import { CONTRACT_FIXTURES, contractFixture } from '@portfolio/variant-contract/node';
import SpatialBento from '.';
import { changeIn, percentOf } from './figures';

// tsx compiles JSX to React.createElement calls, so the test supplies React.
Object.assign(globalThis, { React });

// SPA-1: the case sheet's figures come from the case's own words and the
// awards the work cites, numbered under one caption system, and a case
// with none of that draws none, leaving no hole.

const PACKAGE = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const RAW = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
const MANIFEST = (() => {
  const result = validateManifest(RAW, { packageName: PACKAGE.name });
  assert.ok(result.ok);
  return result.manifest as VariantManifest;
})();
const REPO = new URL('../../../', import.meta.url).pathname;

function sample(): ParsedPair {
  const read = readPair({
    portfolio: `${REPO}portfolio.example.yml`,
    site: `${REPO}site.example.yml`,
  });
  assert.ok(read.ok, JSON.stringify(read));
  return read.pair;
}

function casePage(pair: ParsedPair, slug: string): string {
  const input = buildRenderInput({
    view: resolvePortfolioView(pair, {}, { mediaBase: '/media' }),
    manifest: MANIFEST,
    route: { route: 'work', slug },
    basePath: '',
    origin: 'https://rowan.test',
    requestTime: '2026-10-23T12:00:00Z',
    idPrefix: '',
  });
  return renderToStaticMarkup(<SpatialBento input={input} />);
}

/** `markup` as the text it reads as: no tags, spaces folded. */
const text = (markup: string) =>
  markup
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** The part of the sheet `key` names, its section's markup. */
function part(markup: string, key: string): string {
  const at = markup.indexOf(`data-part="${key}"`);
  assert.ok(at >= 0, key);
  return markup.slice(at, markup.indexOf('</section>', at));
}

test('a change is read only from numbers the owner’s sentence states: number words count, quantifiers don’t', () => {
  // "fourteen minutes to three" draws: number words are numbers.
  assert.deepEqual(
    changeIn(
      'Mean time to detect fell from fourteen minutes to three after the reviews rebuilt the alerting taxonomy. The kit is now open source.',
    ),
    {
      kind: 'figure',
      measure: 'Mean time to detect',
      from: { words: 'fourteen', value: 14 },
      to: { words: 'three', value: 3 },
      unit: 'minutes',
    },
  );
  // "from 48% to 95%" draws, as a share of the whole.
  assert.deepEqual(changeIn('Review attendance rose from 48% to 95% of the invited engineers.'), {
    kind: 'share',
    measure: 'Review attendance',
    from: { words: '48%', value: 48 },
    to: { words: '95%', value: 95 },
  });
  assert.deepEqual(changeIn('Coverage went from roughly forty percent to 90 percent.')?.from, {
    words: 'roughly forty percent',
    value: 40,
  });
  // Later in the text, after another sentence; digits with a short unit.
  assert.equal(
    changeIn('It shipped. p99 latency dropped from 1,200 ms to 300 ms.')?.kind,
    'figure',
  );
  // "roughly half to nearly all" states no number, so it draws nothing; nor does no change, one
  // figure, the same figure twice, two units on no shared scale, or a share past the whole.
  for (const none of [
    undefined,
    '',
    'Review attendance went from roughly half the invited engineers to nearly all of them, and every postmortem has been published within seven days.',
    'Attendance went from some to most.',
    'Attendance went from a third to three quarters.',
    'The templates mattered less than the questions in them.',
    'It took fourteen minutes.',
    'Errors went from three to three.',
    'Builds fell from two hours to nine minutes.',
    'Load went from 80% to 120%.',
  ]) {
    assert.equal(changeIn(none), undefined, String(none));
  }
  assert.equal(percentOf('nearly 95%'), 95);
  assert.equal(percentOf('nearly all'), undefined);
  assert.equal(percentOf('120%'), undefined);
});

test('the sample’s case sheet draws only what its words state: the award, and the MTTD bars; the attendance sentence stays prose', () => {
  const markup = casePage(sample(), 'postmortem-template-kit');
  const figures = [...markup.matchAll(/<figure class="sb-fig[^"]*"[\s\S]*?<\/figure>/g)].map(
    ([figure]) => figure,
  );
  assert.equal(figures.length, 2);
  const [, detect] = figures as [string, string];
  // One caption system: each numbered in order down the sheet, its caption the words and figures it draws.
  const captions = figures.map((figure) =>
    text(/<figcaption[^>]*>([\s\S]*?)<\/figcaption>/.exec(figure)![1]!),
  );
  assert.deepEqual(
    captions.map((caption) => /Figure \d+\./.exec(caption)?.[0]),
    ['Figure 1.', 'Figure 2.'],
  );
  assert.match(captions[0]!, /^SREcon Practitioner Award USENIX, 2025 Figure 1\. For sustained/);
  // A change's caption says how it's drawn and both sides, not the sentence beside it again.
  assert.equal(read(detect), 'Figure 2. Mean time to detect, in minutes: from 14 to 3.');
  // Titled with what changed, in the owner's words, and its rows say each side.
  assert.match(detect, /^<figure class="sb-fig"><p class="sb-strong">Mean time to detect<\/p>/);
  assert.match(text(detect), /From 14 minutes To 3 minutes/);
  // The drawings are ink, still, and out of the tree.
  for (const figure of figures) {
    for (const [svg] of figure.matchAll(/<svg[^>]*>/g)) {
      assert.match(svg, /aria-hidden="true"/);
      assert.match(svg, /focusable="false"/);
    }
    assert.doesNotMatch(figure, /fill="(?!currentColor|none)/);
    assert.doesNotMatch(figure, /<animate|style=/);
  }
  // The before side is a tint under its outline; the after side is solid ink.
  assert.equal(count(detect, /fill-opacity="0.4"/g), 1);
  // Beside the opening words: the press line, then the award, not in What it showed.
  const sheet = markup.slice(markup.indexOf('<div class="sb-sheet">'));
  const opening = sheet.slice(0, sheet.indexOf('<div class="sb-sheet__parts"><section'));
  assert.match(
    opening,
    /<div class="sb-sheet__parts"><div class="pf-rich-text sb-prose">[\s\S]*<ul class="sb-ev" role="list"><li class="sb-press">[\s\S]*<li><figure class="sb-fig sb-dated">/,
  );
  assert.doesNotMatch(opening, /<h[2-6]/);
  // What it showed states no number for attendance: its words stay prose, with no drawing and no empty list.
  const showed = part(markup, 'evidence');
  assert.match(showed, /Review attendance went from roughly half/);
  assert.doesNotMatch(showed, /sb-fig|<ul class="sb-ev"|sb-press/);
  // What it changed keeps its half; its figure is the next stop, down beside Looking back.
  assert.doesNotMatch(markup, /data-part="(?:outcomes|reflection)" data-wide/);
  assert.doesNotMatch(part(markup, 'outcomes'), /sb-fig/);
  assert.match(
    markup,
    /<\/section><div class="sb-sheet__part" data-figure="" data-span=""><figure class="sb-fig"><p class="sb-strong">Mean time to detect<\/p>[\s\S]*?<\/figure><\/div><section id="[^"]*" class="sb-sheet__part" data-part="reflection">/,
  );
});

test('a share the words state is drawn as a bar on its whole, captioned with both sides', () => {
  const pair = sample();
  const shared = {
    ...pair,
    portfolio: {
      ...pair.portfolio,
      works: pair.portfolio.works!.map((each) =>
        each.id === 'postmortem-template-kit'
          ? {
              ...each,
              caseStudy: {
                ...each.caseStudy!,
                evidence: 'Review attendance rose from 48% to 95% of the invited engineers.',
              },
            }
          : each,
      ),
    },
  } as ParsedPair;
  const showed = part(casePage(shared, 'postmortem-template-kit'), 'evidence');
  const figure = /<figure class="sb-fig">[\s\S]*?<\/figure>/.exec(showed)?.[0];
  assert.ok(figure, 'What it showed draws its stated share');
  assert.equal(
    read(figure),
    'Figure 2. Review attendance, in percent of the whole: from 48% to 95%.',
  );
  assert.match(text(figure), /From 48% To 95%/);
  // Each bar is its share of the whole: 48 and 95 of 100, on a box 20 across.
  assert.match(figure, /<rect width="9.6"[^>]*fill-opacity="0.4"/);
  assert.match(figure, /<rect width="19"[^>]*fill="currentColor"/);
});

/** A figure's caption as it reads: no tags, spaces folded. */
const read = (figure: string) =>
  /<figcaption[^>]*>([\s\S]*?)<\/figcaption>/
    .exec(figure)![1]!
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const count = (markup: string, pattern: RegExp) => markup.match(pattern)?.length ?? 0;

test('a case with no change in its words, no award and no press line draws no figure and leaves no hole', () => {
  const pair = sample();
  const work = pair.portfolio.works!.find((each) => each.id === 'postmortem-template-kit')!;
  const bare = {
    ...pair,
    portfolio: {
      ...pair.portfolio,
      works: pair.portfolio.works!.map((each) =>
        each === work
          ? {
              ...work,
              evidence: [],
              caseStudy: {
                ...work.caseStudy!,
                evidence: 'Every postmortem has been published within seven days.',
                outcomes: 'The kit is now open source and used well beyond Solstice.',
              },
            }
          : each,
      ),
    },
  } as ParsedPair;
  const markup = casePage(bare, 'postmortem-template-kit');
  assert.doesNotMatch(markup, /sb-fig/);
  assert.doesNotMatch(markup, /data-part="outcomes" data-wide/);
  assert.doesNotMatch(markup, /<ul class="sb-ev"[^>]*><\/ul>|<div class="sb-ev"><\/div>/);
  // With nothing beside them, the opening words keep their own two measures.
  assert.match(markup, / sb-prose sb-sheet__about"/);
  // A press line that would leave What it showed empty stays in it.
  const quoteOnly = {
    ...bare,
    portfolio: {
      ...bare.portfolio,
      works: bare.portfolio.works!.map((each) =>
        each.id === work.id
          ? {
              ...each,
              evidence: ['how-to-write-a-postmortem-that-doesn-t-make-things-worse'],
              caseStudy: { ...each.caseStudy!, evidence: undefined },
            }
          : each,
      ),
    },
  } as ParsedPair;
  const kept = casePage(quoteOnly, 'postmortem-template-kit');
  assert.match(part(kept, 'evidence'), /sb-press/);
  assert.match(kept, / sb-prose sb-sheet__about"/);
});

test('on every contract fixture’s case pages, figures are numbered in order and none is empty', () => {
  let pages = 0;
  for (const { name } of CONTRACT_FIXTURES) {
    const read = readPair(contractFixture(name).files);
    assert.ok(read.ok, name);
    for (const work of read.pair.portfolio.works ?? []) {
      if (work.caseStudy === undefined || work.slug === undefined) continue;
      const markup = casePage(read.pair, work.slug);
      const numbers = [
        ...markup.matchAll(/<b lang="[^"]*">Figure (\d+)\.<\/b>|<b>Figure (\d+)\.<\/b>/g),
      ].map((match) => Number(match[1] ?? match[2]));
      assert.deepEqual(
        numbers,
        numbers.map((_, index) => index + 1),
        `${name} /work/${work.slug}`,
      );
      assert.doesNotMatch(markup, /<ul class="sb-ev"[^>]*><\/ul>|<div class="sb-ev"><\/div>/, name);
      pages += 1;
    }
  }
  assert.ok(pages > 3, `${pages} case pages`);
});
