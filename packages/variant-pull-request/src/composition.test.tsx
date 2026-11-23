import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CORE_SECTION_KINDS, resolvePortfolioView, type ParsedPair } from '@portfolio/schema';
import { readPair } from '@portfolio/schema/node';
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
import { checkGrouping, pageOutline, worksOf } from '@portfolio/kit/sections';
import PullRequest from '.';
import { nextTab, pairRows } from './enhancements/review';
import { RENDERERS } from './home';
import { GROUPING } from './parts';

// Pull Request's pages over the bundled sample and every contract fixture:
// one h1, the change's title; one main; unique ids under the prefix; every
// fragment landing; the outline check clean; nothing hidden leaking. Without
// a script the page is complete (issue #270, contract): all four panels in
// order, the tabs real links, every diff whole, the commits and checks
// native disclosures, and Approve and merge a real link. A work's own page
// is its whole diff under its title.

Object.assign(globalThis, { React });

const PACKAGE = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const RAW = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
const REPO = new URL('../../../', import.meta.url);

const MANIFEST = (() => {
  const result = validateManifest(RAW, { packageName: PACKAGE.name, exports: PACKAGE.exports });
  assert.ok(result.ok, JSON.stringify(result.ok ? [] : result.diagnostics));
  return result.manifest as VariantManifest;
})();

function inputOf(
  pair: ParsedPair,
  idPrefix = '',
  route: VariantRenderInput['route'] = { route: 'home' },
): VariantRenderInput {
  return buildRenderInput({
    view: resolvePortfolioView(pair, {}, { mediaBase: '/media' }),
    manifest: MANIFEST,
    route: route as never,
    basePath: '',
    origin: 'https://rowan.test',
    requestTime: '2026-10-28T12:00:00Z',
    idPrefix,
  });
}

function pairOf(name: string): ParsedPair {
  const files =
    name === 'sample'
      ? {
          portfolio: new URL('portfolio.example.yml', REPO).pathname,
          site: new URL('site.example.yml', REPO).pathname,
        }
      : contractFixture(name).files;
  const read = readPair(files);
  assert.ok(read.ok, `${name}: ${JSON.stringify(read)}`);
  return read.pair;
}

const PAIRS = ['sample', ...CONTRACT_FIXTURES.map(({ name }) => name)];
const html = (input: VariantRenderInput) => renderToStaticMarkup(<PullRequest input={input} />);
const ids = (markup: string) => [...markup.matchAll(/\sid="([^"]+)"/g)].map(([, id]) => id!);
const fragments = (markup: string) =>
  [...markup.matchAll(/\shref="#([^"]+)"/g)].map(([, id]) => decodeURIComponent(id!));
const count = (markup: string, pattern: RegExp) => markup.match(pattern)?.length ?? 0;

test('the manifest: every core kind bespoke, home and work its own, one review island, the phone bar reserved', () => {
  assert.deepEqual([...MANIFEST.renderedKinds].sort(), [...CORE_SECTION_KINDS].sort());
  assert.deepEqual(Object.keys(RENDERERS).sort(), [...MANIFEST.renderedKinds].sort());
  assert.deepEqual(MANIFEST.routes, { home: 'bespoke', work: 'bespoke', views: [] });
  assert.equal(MANIFEST.compositionFamily, 'document');
  assert.equal(MANIFEST.motionIntent, 'subtle');
  assert.equal(MANIFEST.performanceTier, 'light');
  assert.equal(MANIFEST.budgets?.animation, 0);
  assert.deepEqual(
    MANIFEST.enhancements?.map(({ id, requires }) => [id, requires]),
    [['review', []]],
  );
  assert.ok(MANIFEST.scrollReserve?.blockEnd, 'the phone bar is reserved');
  assert.equal(MANIFEST.visitorControl.placement, 'footer');
});

for (const name of PAIRS) {
  test(`${name}: one h1, one main, unique ids, every fragment lands, the outline clean, nothing hidden leaks`, () => {
    for (const prefix of ['', 'p-']) {
      const input = inputOf(pairOf(name), prefix);
      const markup = html(input);
      assert.equal(count(markup, /<h1[\s>]/g), 1, `${name} h1`);
      assert.equal(count(markup, /<main[\s>]/g), 1, `${name} main`);
      const all = ids(markup);
      assert.equal(new Set(all).size, all.length, `${name} duplicate ids`);
      const known = new Set(all);
      for (const fragment of fragments(markup))
        assert.ok(known.has(fragment), `${name} #${fragment}`);
      assert.doesNotMatch(markup, new RegExp(HIDDEN_CANARY), name);
      assert.deepEqual(
        checkOutline(markup, input.ids, { sections: pageOutline(input).sections }),
        [],
        name,
      );
    }
  });
}

test('the grouping declares no mistake, on the sample and every contract fixture', () => {
  const outlines = PAIRS.map((name) => pageOutline(inputOf(pairOf(name))));
  assert.deepEqual(checkGrouping({ grouping: GROUPING }, outlines), []);
});

test('without a script: the title, every panel in order, the tabs real links, every diff whole, disclosures native, the merge a real link', () => {
  const markup = html(inputOf(pairOf('complete')));
  assert.match(markup, /<h1[^>]*>Add <span>[^<]+<\/span> to your team<\/h1>/);
  const panels = [...markup.matchAll(/data-pr-panel="([a-z]+)"/g)].map(([, panel]) => panel);
  assert.deepEqual(panels, ['conversation', 'commits', 'checks', 'files']);
  // The tabs are plain fragment links to the panels, and nothing hides a panel on the server.
  for (const panel of panels) assert.match(markup, new RegExp(`href="#pr--${panel}"`));
  assert.doesNotMatch(markup, /data-pr-off/);
  // Every expanded part is in the page, and only the buttons that need a script wait for one.
  assert.equal(count(markup, /data-pr-more=""/g), count(markup, /data-pr-exp-row=""/g));
  assert.doesNotMatch(markup, /<table[^>]*data-pr-more=""[^>]*hidden/);
  assert.match(markup, /<details class="pr-commit__d">/);
  assert.match(markup, /<details class="pr-check__d">/);
  const merge = /<a class="pr-btn pr-btn--merge" href="([^"]+)"[^>]*data-pr-merge=""/.exec(markup);
  assert.ok(merge, 'Approve and merge is a link');
  assert.ok(!merge[1]!.startsWith('#'), `it goes somewhere real: ${merge[1]}`);
});

test("a work's own page: its title the h1, its whole diff with nothing behind Expand, a way back to the files", () => {
  const pair = pairOf('complete');
  const home = inputOf(pair);
  const routed = home.portfolio.sections
    .flatMap((section) => (section.kind === 'works' ? worksOf(section, home) : []))
    .filter((work) => work.caseStudy && work.slug);
  assert.ok(routed.length > 0);
  for (const work of routed) {
    const input = inputOf(pair, '', { route: 'work', slug: work.slug! });
    const markup = html(input);
    const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(markup)![1]!;
    assert.equal(h1, work.title.replace(/&/g, '&amp;'));
    assert.doesNotMatch(markup, /data-pr-exp-row/);
    assert.match(markup, /href="\/#pr--files"/);
    assert.deepEqual(checkOutline(markup, input.ids, {}), [], work.id);
  }
});

test("the tabs' list holds only the panel links, so it can be a tab list; Merge, a link to the merge box, follows it", () => {
  const markup = html(inputOf(pairOf('complete')));
  const nav = /<nav class="pr-tabs"[\s\S]*?<\/nav>/.exec(markup)![0];
  const list = /<ul class="pr-tabs__l"[\s\S]*?<\/ul>/.exec(nav)![0];
  const items = [...list.matchAll(/<li[\s>]/g)].length;
  assert.equal(items, count(list, /data-pr-tab="/g), 'every item is a panel link');
  assert.doesNotMatch(list, /data-pr-to-merge/);
  assert.match(nav.slice(nav.indexOf('</ul>')), /data-pr-to-merge=""/);
});

test("Merge links the contact section, Contact's own anchor, so a navigation link jumps to it; with none, the merge box", () => {
  const markup = html(inputOf(pairOf('complete')));
  assert.match(markup, /<a class="pr-tab" href="#contact" data-pr-to-merge="">/);
  const none = html(inputOf(pairOf('identity-only')));
  assert.match(none, /<a class="pr-tab" href="#pr--merge" data-pr-to-merge="">/);
});

test('the tabs move with the arrow keys, Home and End, round the ends', () => {
  assert.equal(nextTab('ArrowRight', 3, 4), 0);
  assert.equal(nextTab('ArrowDown', 1, 4), 2);
  assert.equal(nextTab('ArrowLeft', 0, 4), 3);
  assert.equal(nextTab('ArrowUp', 2, 4), 1);
  assert.equal(nextTab('Home', 2, 4), 0);
  assert.equal(nextTab('End', 0, 4), 3);
  assert.equal(nextTab('Enter', 0, 4), undefined);
});

test('the split view pairs each run of removals with the additions after it, context between', () => {
  const rows = (kinds: string) =>
    [...kinds].map((kind, row) => ({
      kind: kind === '-' ? ('del' as const) : kind === '+' ? ('add' as const) : ('other' as const),
      row,
    }));
  assert.deepEqual(pairRows(rows(' --++ +')), [
    { other: 0 },
    { del: 1, add: 3 },
    { del: 2, add: 4 },
    { other: 5 },
    { add: 6 },
  ]);
  assert.deepEqual(pairRows(rows('-+-+')), [
    { del: 0, add: 1 },
    { del: 2, add: 3 },
  ]);
});
