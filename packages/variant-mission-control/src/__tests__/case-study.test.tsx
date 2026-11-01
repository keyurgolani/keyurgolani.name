import test from 'node:test';
import assert from 'node:assert/strict';
import { caseStudyOutline, isRoutedWork } from '@portfolio/kit/sections';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import { checkOutline } from '@portfolio/variant-contract/node';
import { caseModel, PART_WORDS } from '../case-model';
import {
  count,
  escaped,
  FIXTURE_NAMES,
  fixtureInput,
  fragmentLinks,
  idsIn,
  MANIFEST,
  renderInput,
  sampleInput,
} from './harness.test';

// A work's own page in Mission Control, as the server sends it: one board,
// the work's title its one h1; the brief beside the inspector; each part of
// the case study a panel at the outline's anchor in the operations log's
// words; the decisions a numbered log; the cited records as log rows; the
// board's index landing on every part; and the way on, the next case in
// curation order, else All work beside a related work.

/** The input on a routed work's own page. */
const onWork = (input: VariantRenderInput, slug: string): VariantRenderInput => ({
  ...input,
  route: { route: 'work', slug },
});

/** Every routed work of the sample and of every contract fixture, with its page's input. */
function casePages() {
  const bases = [
    ['sample', sampleInput()] as const,
    ['sample, prefixed', sampleInput('pv-')] as const,
    ...FIXTURE_NAMES.map((name) => [name, fixtureInput(name)] as const),
  ];
  return bases.flatMap(([name, base]) =>
    base.portfolio.works.filter(isRoutedWork).map((work) => ({
      name: `${name} /work/${work.slug}`,
      work,
      input: onWork(base, work.slug),
    })),
  );
}

const text = (html: string) => html.replace(/<[^>]+>/g, '');

test('the manifest routes a work to the composition’s own page and renders every core kind itself', () => {
  assert.equal(MANIFEST.routes.work, 'bespoke');
  assert.equal(MANIFEST.renderedKinds.length, 14);
});

test('every routed work’s page: one h1, its title; ids once; every fragment and label landing; nothing shared', () => {
  const pages = casePages();
  assert.ok(pages.length >= 3, 'the sample and the fixtures route some works');
  for (const { name, work, input } of pages) {
    const html = renderInput(input);
    assert.match(html, /data-mc-page="case"/, `${name}: the case page renders`);
    const findings = checkOutline(html, input.ids);
    assert.deepEqual(findings, [], `${name}: ${JSON.stringify(findings, null, 1)}`);
    const h1s = [...html.matchAll(/<h1\b[^>]*>(.*?)<\/h1>/g)];
    assert.equal(h1s.length, 1, `${name}: one h1`);
    assert.equal(text(h1s[0]![1]!), escaped(work.title), `${name}: the h1 is the work's title`);
    const ids = idsIn(html);
    assert.equal(new Set(ids).size, ids.length, `${name}: an id repeats`);
    const known = new Set([...ids, input.ids.main]);
    for (const fragment of fragmentLinks(html))
      assert.ok(known.has(fragment), `${name}: #${fragment} lands nowhere`);
    for (const [, labels] of html.matchAll(/\saria-labelledby="([^"]+)"/g))
      for (const label of labels!.split(' '))
        assert.ok(known.has(label), `${name}: aria-labelledby ${label} names nothing`);
    assert.equal(count(html, /data-renderer="shared"/g), 0, `${name}: nothing shared`);
    assert.equal(count(html, /<main\b/g), 1, `${name}: one main`);
    assert.doesNotMatch(html, /<(ul|ol|dl)[^>]*><\/\1>/, `${name}: an empty list`);
    assert.doesNotMatch(html, /<figure[^>]*><\/figure>/, `${name}: an empty figure`);
  }
});

test('every part the outline names is a panel at the outline’s anchor, in the log’s words, in the index', () => {
  for (const { name, input } of casePages()) {
    const outline = caseStudyOutline(input)!;
    const html = renderInput(input);
    for (const part of outline.parts) {
      assert.match(
        html,
        new RegExp(`id="${part.anchor}"[^>]*data-part="${part.key}"`),
        `${name}: ${part.key}`,
      );
      assert.ok(html.includes(escaped(PART_WORDS[part.key])), `${name}: ${part.key}'s words`);
      if (outline.parts.length > 1)
        assert.ok(html.includes(`href="${part.href}"`), `${name}: ${part.key} in the index`);
    }
    const decisions = outline.work.caseStudy.decisions?.length ?? 0;
    assert.equal(count(html, /class="mc-decision"/g), decisions, `${name}: the decision log`);
  }
});

test('the way on: the next case in curation order, else All work beside a related work', () => {
  for (const { name, input } of casePages()) {
    const outline = caseStudyOutline(input)!;
    const model = caseModel(input, outline);
    const html = renderInput(input);
    if (outline.next) {
      assert.equal(model.onward.kind, 'next', name);
      assert.ok(html.includes(`href="${outline.next.href}"`), `${name}: next links`);
      assert.match(html, /data-on="next"/);
    } else {
      assert.equal(model.onward.kind, 'all', name);
      assert.match(html, /data-on="all"/);
      assert.ok(html.includes(`href="${model.back.href}"`), `${name}: All work links back`);
    }
  }
});

test('the inspector shows only the fields the work has, and the chrome is home’s: Contact one tap away', () => {
  for (const { name, work, input } of casePages()) {
    const html = renderInput(input);
    if (work.role) assert.ok(html.includes(escaped(work.role)), `${name}: role`);
    if (!work.tools?.length) assert.doesNotMatch(html, /<dt>Tools<\/dt>/, `${name}: no tools row`);
    assert.match(html, /class="mc-rail"/, `${name}: the rail`);
    const contact = /href="([^"]*#[^"]*contact[^"]*)"/.exec(html);
    if (input.portfolio.sections.some(({ kind }) => kind === 'contact'))
      assert.ok(contact, `${name}: a link to contact`);
  }
});

test('a work’s lamps read once, in the page’s band beside its title, never again on the inspector’s bar', () => {
  let lit = 0;
  for (const { name, input } of casePages()) {
    const html = renderInput(input);
    const head = html.indexOf('class="mc-board__head"');
    const band = html.slice(head, html.indexOf('</header>', head));
    const facts = html.indexOf('mc-case__facts');
    if (facts >= 0) {
      const bar = html.slice(facts, html.indexOf('</header>', facts));
      assert.doesNotMatch(bar, /class="mc-lamp"/, `${name}: no lamp on the inspector’s bar`);
    }
    lit += count(band, /class="mc-lamp"/g);
  }
  assert.ok(lit > 0, 'some work’s page has its lamps in the band');
});
