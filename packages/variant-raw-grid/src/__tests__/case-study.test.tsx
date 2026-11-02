import test from 'node:test';
import assert from 'node:assert/strict';
import { caseStudyOutline, isRoutedWork } from '@portfolio/kit/sections';
import { checkOutline } from '@portfolio/variant-contract/node';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import { caseStickers, caseTicker } from '../model';
import {
  count,
  escaped,
  FIXTURE_NAMES,
  fixtureInput,
  fragmentLinks,
  idsIn,
  MANIFEST,
  pairOf,
  renderInput,
  sampleInput,
  inputFor,
} from './harness.test';

// Raw Grid's own case page, /work/<slug>, as the server sends it: the work's
// title the page's one h1, every part the outline names at its anchor, the
// stickers and the fact sheet linking to cited records the page shows, the
// ticker over the work's highlights the fact sheet lists, every fragment
// landing, links to home's places leading home, and Work the current page.

/** The input on a work's own page. */
const onWork = (input: VariantRenderInput, slug: string): VariantRenderInput => ({
  ...input,
  route: { route: 'work', slug },
});

/** Every routed work's page in the sample and the contract fixtures. */
function casePages() {
  const pages: { name: string; input: VariantRenderInput }[] = [];
  const inputs = [
    ['sample', sampleInput()] as const,
    ...FIXTURE_NAMES.map((name) => [name, fixtureInput(name)] as const),
  ];
  for (const [name, input] of inputs) {
    for (const work of input.portfolio.works) {
      if (!isRoutedWork(work)) continue;
      const page = onWork(input, work.slug);
      if (caseStudyOutline(page)) pages.push({ name: `${name} /work/${work.slug}`, input: page });
    }
  }
  return pages;
}

const sampleCase = () => onWork(sampleInput(), 'postmortem-template-kit');

test('the manifest owns the work route', () => {
  assert.equal(MANIFEST.routes.work, 'bespoke');
});

test('every case page passes the outline check: one h1, the title; every part at its anchor; nothing shared', () => {
  const pages = casePages();
  assert.ok(pages.length >= 3, `only ${pages.length} case pages`);
  for (const { name, input } of pages) {
    const html = renderInput(input);
    const outline = caseStudyOutline(input)!;
    assert.deepEqual(checkOutline(html, input.ids, {}), [], name);
    assert.equal(count(html, /data-renderer="shared"/g), 0, `${name}: a shared section`);
    assert.equal(count(html, /<h1\b/g), 1, name);
    assert.match(
      html,
      new RegExp(`<h1 class="rg-name rg-case__title"[^>]*>${escaped(outline.work.title)}</h1>`),
      name,
    );
    const ids = idsIn(html);
    assert.equal(new Set(ids).size, ids.length, `${name}: an id repeats`);
    const known = new Set([...ids, input.ids.main]);
    for (const part of outline.parts) assert.ok(known.has(part.anchor), `${name}: ${part.key}`);
    for (const fragment of fragmentLinks(html))
      assert.ok(known.has(fragment), `${name}: #${fragment} lands nowhere`);
    for (const [, labels] of html.matchAll(/\saria-labelledby="([^"]+)"/g))
      for (const label of labels!.split(' '))
        assert.ok(known.has(label), `${name}: aria-labelledby ${label} names nothing`);
    // The stickers link to cited records the page shows; the ticker runs facts the fact sheet lists.
    for (const sticker of caseStickers(outline.work, input))
      assert.ok(known.has(`${input.ids.prefix}${sticker.id}`), `${name}: sticker ${sticker.id}`);
    for (const fact of caseTicker(outline.work, input))
      assert.ok(html.includes(`<li>${escaped(fact.text)}</li>`), `${name}: ${fact.text}`);
  }
});

test('the sample case: the poster, the fact sheet, the bands in the parts’ order, the way on', () => {
  const html = renderInput(sampleCase());
  // Work is the current page, and each destination leads to its sheet on home.
  assert.match(
    html,
    /<a class="rg-go rg-head__dest" href="\/sample#rg--work"[^>]*aria-current="true"/,
  );
  assert.match(html, /href="\/sample#rg--record"/);
  // The stickers: the award in ink, then the write-up, each landing on its cell.
  assert.match(
    html,
    /<li class="rg-sticker" data-tone="emphasis" data-ui-surface="inverse"><a href="#srecon-practitioner-award">/,
  );
  assert.match(html, /<article class="rg-cell rg-item" id="srecon-practitioner-award"/);
  // The fact sheet holds only what the work has, with no repeat of the poster's meta line.
  assert.match(html, /<dt>Role<\/dt><dd>Author and maintainer<\/dd>/);
  assert.match(html, /<dt>Built with<\/dt><dd>TypeScript, Bun, Markdown<\/dd>/);
  assert.equal(count(html, /<dt>(?:When|Medium)<\/dt>/g), 0);
  // The parts in order, two short texts to a row, the lone outcome the width.
  const order = [...html.matchAll(/id="postmortem-template-kit--(\w+)"/g)].map(([, key]) => key);
  assert.deepEqual(order, [
    'title',
    'facts',
    'work',
    'challenge',
    'context',
    'role',
    'constraints',
    'decisions',
    'evidence',
    'outcomes',
    'reflection',
  ]);
  assert.equal(count(html, /<div class="rg-pair">/g), 2);
  assert.match(html, /<table class="rg-table rg-table--decisions">/);
  // Each cell's label is read with it on a phone, where the column heads are hidden; a missing
  // alternative is a dash under its label, read as none recorded.
  assert.equal(count(html, /rg-t-k" aria-hidden/g), 0);
  assert.equal(count(html, /<span class="rg-t-k">Why<\/span>/g), 2);
  assert.match(
    html,
    /<span class="rg-t-k">Instead of<\/span><span aria-hidden="true">—<\/span><span class="rg-hidden">None recorded<\/span>/,
  );
  // A lone short text is set across its band; one past a measure's worth, in two columns.
  assert.match(
    html,
    /id="postmortem-template-kit--outcomes" aria-labelledby="[^"]+" data-wide="set"/,
  );
  // The evidence's own words span its band; its cited records are cells under them.
  assert.match(
    html,
    /id="postmortem-template-kit--evidence"[^>]*>(?:(?!<\/section>)[\s\S])*?<div class="rg-cell"><div class="pf-rich-text"><p>Review attendance/,
  );
  // The next work in curation order, writing left out: small-traces, where home shows it.
  assert.match(html, /<a class="rg-cell rg-next__go" href="\/sample#small-traces">/);
  // Its title takes the name's fit, by its longest word.
  assert.match(
    html,
    /rg-next__go"[^>]*>(?:(?!<\/a>)[\s\S])*<span class="rg-name rg-next__title" style="--layout-name-chars:\d+"/,
  );
  assert.match(html, /<a class="rg-cell rg-next__all" href="\/sample#rg--work">/);
});

test('a bare case: no stickers, no fact sheet, no ticker, no next work, and still whole', () => {
  const input = inputFor(
    pairOf({
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
      sections: [{ kind: 'works', id: 'work', title: 'Work', items: ['atlas'] }],
    }),
    { route: { route: 'work', slug: 'atlas' } },
  );
  const html = renderInput(input);
  assert.equal(count(html, /rg-sticker"/g), 0);
  assert.equal(count(html, /rg-facts/g), 0);
  assert.match(html, /data-facts="none"/);
  assert.equal(count(html, /rg-ticker/g), 0);
  assert.equal(count(html, /rg-next__go/g), 0);
  // With no next work there's no way-on band: no lone All work cell the width.
  assert.equal(count(html, /rg-next/g), 0);
  assert.match(html, /id="atlas--challenge"/);
  assert.deepEqual(checkOutline(html, input.ids, {}), []);
});

test('decisions with no alternative anywhere drop the column: no dash, no label, no none recorded', () => {
  const input = inputFor(
    pairOf({
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
          caseStudy: {
            challenge: 'Hard.',
            decisions: [
              { decision: 'Ship small.', rationale: 'Less to undo.' },
              { decision: 'Write it down.' },
            ],
          },
        },
      ],
      sections: [{ kind: 'works', id: 'work', title: 'Work', items: ['atlas'] }],
    }),
    { route: { route: 'work', slug: 'atlas' } },
  );
  const html = renderInput(input);
  assert.match(html, /<table class="rg-table rg-table--decisions">/);
  assert.equal(count(html, /Instead of/g), 0);
  assert.equal(count(html, /None recorded|—/g), 0);
  assert.equal(count(html, /<span class="rg-t-k">Why<\/span>/g), 1);
  assert.deepEqual(checkOutline(html, input.ids, {}), []);
});
