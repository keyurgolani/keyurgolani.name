import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { caseStudyOutline, isRoutedWork } from '@portfolio/kit/sections';
import { resolvePortfolioView, type ParsedPair } from '@portfolio/schema';
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
import Schematic from '.';
import { detailOf } from './model';

// A work's own page in Schematic, the detail sheet, as the server sends it,
// for every routed work of the sample and of every contract fixture: the
// work's title its one h1, the outline rules holding, ids once, every
// in-page fragment and label landing, every part the outline names at its
// anchor, the decisions numbered as change notices, and the drawing index
// pointing its sheets back at home.

Object.assign(globalThis, { React });

const PACKAGE = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const RAW = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
const ROOT = new URL('../../../', import.meta.url);
const MANIFEST = (() => {
  const result = validateManifest(RAW, { packageName: PACKAGE.name, exports: PACKAGE.exports });
  assert.ok(result.ok, JSON.stringify(result.ok ? [] : result.diagnostics));
  return result.manifest as VariantManifest;
})();

function inputOf(pair: ParsedPair, slug: string, idPrefix = ''): VariantRenderInput {
  return buildRenderInput({
    view: resolvePortfolioView(pair, {}, { mediaBase: '/media' }),
    manifest: MANIFEST,
    route: { route: 'work', slug },
    basePath: '',
    origin: 'https://rowan.test',
    requestTime: '2026-10-26T12:00:00Z',
    idPrefix,
  });
}

const pairs: [string, ParsedPair][] = [
  [
    'sample',
    (() => {
      const read = readPair({
        portfolio: new URL('portfolio.example.yml', ROOT).pathname,
        site: new URL('site.example.yml', ROOT).pathname,
      });
      assert.ok(read.ok);
      return read.pair;
    })(),
  ],
  ...CONTRACT_FIXTURES.map(({ name }): [string, ParsedPair] => {
    const read = readPair(contractFixture(name).files);
    assert.ok(read.ok, name);
    return [name, read.pair];
  }),
];

function casePages() {
  return pairs.flatMap(([name, pair]) => {
    const view = resolvePortfolioView(pair, {}, { mediaBase: '/media' });
    return view.portfolio.works.filter(isRoutedWork).flatMap((work) =>
      ['', 'pv-'].map((prefix) => ({
        name: `${name}${prefix ? ' (prefixed)' : ''} /work/${work.slug}`,
        work,
        input: inputOf(pair, work.slug, prefix),
      })),
    );
  });
}

const html = (input: VariantRenderInput) => renderToStaticMarkup(<Schematic input={input} />);
const unescape = (text: string) =>
  text
    .replace(/&amp;/g, '&')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<');

test("the fact sheet marks each value with its content's language, each recognition with its own entry's (P2 review)", () => {
  const files = contractFixture('complete').files;
  const copy = path.join(mkdtempSync(path.join(tmpdir(), 'sx-case-')), 'portfolio.yml');
  writeFileSync(
    copy,
    readFileSync(files.portfolio, 'utf8')
      .replace('    slug: project-name\n', '    slug: project-name\n    lang: pt\n')
      .replace('  - id: repository-name\n', '  - id: repository-name\n    lang: fr\n'),
  );
  const read = readPair({ ...files, portfolio: copy });
  assert.ok(read.ok, JSON.stringify(read));
  const markup = html(inputOf(read.pair, 'project-name'));
  const facts = /class="sx-tb sx-dfacts"[\s\S]*?<\/div><\/header>/.exec(markup)?.[0] ?? markup;
  assert.match(facts, /<span lang="pt">Project role<\/span>/);
  assert.match(facts, /<span lang="pt">Project organization<\/span>/);
  assert.match(facts, /<span lang="pt">Project technology<\/span>/);
  assert.match(facts, /<span lang="fr">Repository name<\/span>/);
  assert.match(facts, /<span lang="pt">Client name<\/span>/);
});

test('a work with no role, period, tools, organization or evidence: its fact sheet holds only what it has, one full row (P2 review)', () => {
  const files = contractFixture('complete').files;
  const copy = path.join(mkdtempSync(path.join(tmpdir(), 'sx-case-')), 'portfolio.yml');
  writeFileSync(
    copy,
    readFileSync(files.portfolio, 'utf8')
      .replace('    period: { start: 2022-01, end: 2023-05 }\n    role: Project role\n', '')
      .replace('    organization: Project organization\n    tools: [Project technology]\n', '')
      .replace('    evidence: [repository-name, client-name]\n', ''),
  );
  const read = readPair({ ...files, portfolio: copy });
  assert.ok(read.ok, JSON.stringify(read));
  const markup = html(inputOf(read.pair, 'project-name'));
  const facts =
    /<div class="sx-tb sx-dfacts"[^>]*>([\s\S]*?)<\/div><\/header>/.exec(markup)?.[1] ?? '';
  const cells = [...facts.matchAll(/<div class="sx-tb__cell" data-span="(\d)">/g)].map((m) => m[1]);
  assert.deepEqual(cells, ['4'], 'the medium alone, across the row');
  assert.match(facts, />Medium</);
  assert.doesNotMatch(facts, /<span class="sx-tb__value"[^>]*><\/span>/, 'no empty value');
});

test("a work's own page carries its whole description and its other media's captions (the content sweep)", () => {
  const [, pair] = pairs.find(([name]) => name === 'complete')!;
  const text = unescape(html(inputOf(pair, 'project-name')).replace(/<[^>]+>/g, ''));
  assert.ok(text.includes('Project description.'), 'the description');
  assert.ok(text.includes('Project shot caption'), 'an image placement past the cover');
  assert.ok(text.includes('Project document caption'), 'a document placement, by its caption');
});

test('the manifest routes a work to its own detail sheet', () => {
  assert.equal(MANIFEST.routes.work, 'bespoke');
});

test('every routed work: one h1, its title; the outline holds; ids once; fragments and labels land', () => {
  const pages = casePages();
  assert.ok(pages.length >= 4, 'the sample and the fixtures route some works');
  for (const { name, work, input } of pages) {
    const markup = html(input);
    assert.match(markup, /data-sx-page="case"/, name);
    assert.deepEqual(checkOutline(markup, input.ids), [], name);
    const h1s = [...markup.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/g)];
    assert.equal(h1s.length, 1, `${name}: one h1`);
    assert.equal(unescape(h1s[0]![1]!), work.title, `${name}: the h1 is the work's title`);
    assert.doesNotMatch(markup, new RegExp(HIDDEN_CANARY), name);
    const ids = [...markup.matchAll(/\sid="([^"]+)"/g)].map(([, id]) => id!);
    assert.equal(new Set(ids).size, ids.length, `${name}: an id repeats`);
    if (input.ids.prefix) for (const id of ids) assert.ok(id.startsWith(input.ids.prefix), id);
    const known = new Set(ids);
    for (const [, fragment] of markup.matchAll(/\shref="#([^"]+)"/g))
      assert.ok(known.has(decodeURIComponent(fragment!)), `${name}: #${fragment} lands nowhere`);
    for (const [, labels] of markup.matchAll(/\saria-labelledby="([^"]+)"/g))
      for (const label of labels!.split(' '))
        assert.ok(known.has(label), `${name}: aria-labelledby ${label} names nothing`);
    // Every part the outline names has an element at its anchor.
    const outline = caseStudyOutline(input)!;
    for (const part of outline.parts)
      assert.ok(known.has(part.anchor), `${name}: the ${part.key} part has no ${part.anchor}`);
    // No block inside a paragraph, and no empty list or figure.
    for (const [para] of markup.matchAll(/<p[\s>](?:(?!<\/p>)[\s\S])*?<\/p>/g))
      assert.doesNotMatch(para.slice(2), /<(?:p|div|ul|ol|dl|section|figure|h[1-6])[\s>]/, name);
    assert.doesNotMatch(markup, /<(ul|ol|dl)[^>]*><\/\1>/, `${name}: an empty list`);
    // The drawing index's sheets point at home, never at this page.
    assert.doesNotMatch(markup, /class="sx-index__head"[^]*?href="#sx-sheet-/, name);
    // The figure doesn't link to the page it's on.
    assert.doesNotMatch(markup, new RegExp(`href="/work/${work.slug}"[^>]*>${'[^<]*'}</a></h3>`));
  }
});

test('the sample detail sheet: W-01 of the routed works, its views in order, ECNs numbered', () => {
  const [, pair] = pairs[0]!;
  const view = resolvePortfolioView(pair, {}, { mediaBase: '/media' });
  const work = view.portfolio.works.filter(isRoutedWork)[0]!;
  const input = inputOf(pair, work.slug);
  const outline = caseStudyOutline(input)!;
  const detail = detailOf(input, work, outline);
  assert.equal(detail.no, 'W-01');
  assert.equal(detail.views[0]!.key, 'elevation');
  const order = ['elevation', 'section', 'decisions', 'report', 'revision'];
  const keys = detail.views.map((v) => v.key);
  assert.deepEqual(
    keys,
    order.filter((key) => keys.includes(key as never)),
  );
  const markup = html(input);
  const decisions = work.caseStudy.decisions?.length ?? 0;
  assert.equal(markup.match(/class="sx-ecn"/g)?.length ?? 0, decisions);
  if (detail.home) assert.match(markup, new RegExp(`href="/#sx-sheet-`));
});
