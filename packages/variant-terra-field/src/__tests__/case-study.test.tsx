import test from 'node:test';
import assert from 'node:assert/strict';
import { caseStudyOutline, isRoutedWork } from '@portfolio/kit/sections';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import { checkOutline } from '@portfolio/variant-contract/node';
import { caseModel, PART_WORDS, relatedTerms } from '../model';
import {
  count,
  escaped,
  FIXTURE_NAMES,
  fixtureInput,
  fragmentLinks,
  idsIn,
  inputFor,
  MANIFEST,
  pairOf,
  renderInput,
  sampleInput,
} from './harness.test';

// A work's own page in Terra Field, as the server sends it: the work's
// title its one h1, the short field with the cover over its arc, the ruled
// fact sheet, an index of the account whose every link lands on its part,
// the parts under their horizon-line heads in Terra's words, the decisions
// numbered in order, the cited records in their home forms, and the way on.

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

test('the manifest routes a work to the composition’s own page', () => {
  assert.equal(MANIFEST.routes.work, 'bespoke');
});

test('every routed work’s page: one h1, its title; ids once; every fragment and label landing', () => {
  const pages = casePages();
  assert.ok(pages.length >= 3, 'the sample and the fixtures route some works');
  for (const { name, work, input } of pages) {
    const html = renderInput(input);
    assert.match(html, /data-tf-page="case"/, `${name}: the case page renders`);
    const findings = checkOutline(html, input.ids);
    assert.deepEqual(findings, [], `${name}: ${JSON.stringify(findings, null, 1)}`);
    const h1s = [...html.matchAll(/<h1\b[^>]*>(.*?)<\/h1>/g)];
    assert.equal(h1s.length, 1, `${name}: one h1`);
    assert.equal(h1s[0]![1], escaped(work.title), `${name}: the h1 is the work's title`);
    const ids = idsIn(html);
    assert.equal(new Set(ids).size, ids.length, `${name}: an id repeats`);
    const known = new Set([...ids, input.ids.main]);
    for (const fragment of fragmentLinks(html))
      assert.ok(known.has(fragment), `${name}: #${fragment} lands nowhere`);
    for (const [, labels] of html.matchAll(/\saria-labelledby="([^"]+)"/g))
      for (const label of labels!.split(' '))
        assert.ok(known.has(label), `${name}: aria-labelledby ${label} names nothing`);
    assert.equal(count(html, /data-renderer="shared"/g), 0, `${name}: nothing shared`);
    assert.doesNotMatch(html, /<(ul|ol|dl)[^>]*><\/\1>/, `${name}: an empty list`);
    assert.doesNotMatch(html, /<figure[^>]*><\/figure>/, `${name}: an empty figure`);
  }
});

test('every part the outline names has its section at the outline’s anchor, in Terra’s words, in order', () => {
  for (const { name, input } of casePages()) {
    const outline = caseStudyOutline(input)!;
    const html = renderInput(input);
    let at = -1;
    for (const part of outline.parts) {
      const index = html.indexOf(`id="${part.anchor}"`);
      assert.ok(index > at, `${name}: ${part.key} in order at its anchor`);
      at = index;
      assert.ok(html.includes(escaped(PART_WORDS[part.key])), `${name}: ${part.key}'s head`);
    }
    // No schema field name stands as a head.
    for (const head of ['Challenge', 'Context', 'Constraints', 'Outcomes', 'Reflection'])
      assert.doesNotMatch(html, new RegExp(`<h2[^>]*>(<[^>]+>)*${head}<`), `${name}: ${head}`);
  }
});

test('the decisions are numbered in order, each its own heading under the part', () => {
  const input = sampleInput();
  const work = input.portfolio.works.find(
    (each) => isRoutedWork(each) && (each.caseStudy.decisions?.length ?? 0) > 1,
  );
  assert.ok(work && isRoutedWork(work), 'the sample has a case with decisions');
  const html = renderInput(onWork(input, work.slug));
  const list = /<ol class="tf-decisions"[^>]*>(.*?)<\/ol>/s.exec(html)?.[1] ?? '';
  const numbers = [...list.matchAll(/tf-decision__no[^>]*>(\d+)</g)].map(([, n]) => Number(n));
  assert.deepEqual(
    numbers,
    work.caseStudy.decisions!.map((_, index) => index + 1),
  );
  assert.equal(count(list, /<h3\b/g), work.caseStudy.decisions!.length);
});

test('the cover overlaps the arc only when its image is ready', () => {
  const read = sampleInput();
  const signature = read.portfolio.works.find((work) => work.id === read.portfolio.signature);
  assert.ok(signature && isRoutedWork(signature));
  const ready = renderInput(onWork(read, signature.slug));
  assert.match(ready, /<section class="tf-hero tf-hero--case"[^>]*data-cover=""/);
  assert.match(ready, /class="tf-page tf-casecover"/);
});

test('a case with no next one goes on to All work beside a related plate, labelled by what they share', () => {
  const portfolio = {
    schemaVersion: 3,
    locale: 'en',
    direction: 'ltr',
    identity: { name: 'Rowan Vale' },
    works: [
      {
        id: 'first',
        slug: 'first',
        title: 'First',
        medium: 'software',
        tags: ['latency'],
        tools: ['Rust'],
        caseStudy: { challenge: 'A first problem.' },
      },
      {
        id: 'second',
        slug: 'second',
        title: 'Second',
        medium: 'software',
        tools: ['Rust'],
        caseStudy: { challenge: 'A second problem.' },
      },
    ],
    sections: [{ id: 'work', kind: 'works', title: 'Selected work', items: ['first', 'second'] }],
  };
  const base = inputFor(pairOf(portfolio));
  const first = renderInput(onWork(base, 'first'));
  assert.match(first, /data-on="next"/, 'the first goes on to the next case study');
  assert.match(first, /href="\/sample\/work\/second"/);
  const last = onWork(base, 'second');
  const html = renderInput(last);
  assert.match(html, /data-on="all"/);
  assert.match(html, /All work/);
  const model = caseModel(last, caseStudyOutline(last)!);
  assert.equal(model.onward.kind, 'all');
  assert.ok(model.onward.kind === 'all' && model.onward.related);
  assert.deepEqual(model.onward.related.terms, ['software', 'Rust']);
  const label = /<p class="tf-label tf-kicker">(Related:.*?)<\/p>/.exec(html)?.[1] ?? '';
  assert.equal(label.replace(/<[^>]+>/g, ''), 'Related: also software, also Rust');
  // The masthead marks the destination that holds the work on home (S-4).
  assert.match(html, /<a href="[^"]*"(?: lang="[^"]*")? aria-current="page" data-tf-to="work"/);
  assert.equal(count(html, /aria-current=/g), 1);
  // The crumb goes back to the section that holds it on home.
  assert.match(html, /<a href="\/sample#work">Selected work<\/a>/);
});

test('related terms: the medium when they share it, then the shared tags and tools', () => {
  const related = { sameMedium: false, shared: ['TypeScript'] } as never;
  assert.deepEqual(relatedTerms(related, { medium: 'software' }), ['TypeScript']);
  const both = { sameMedium: true, shared: ['TypeScript'] } as never;
  assert.deepEqual(relatedTerms(both, { medium: 'software' }), ['software', 'TypeScript']);
});

test('from a work’s page the destinations go to home’s fields, and Contact to this page’s close', () => {
  const input = sampleInput();
  const signature = input.portfolio.works.find((work) => work.id === input.portfolio.signature);
  assert.ok(signature && isRoutedWork(signature));
  const html = renderInput(onWork(input, signature.slug));
  assert.match(html, /<a href="\/sample#tf--work"[^>]*data-tf-to="work"/);
  assert.doesNotMatch(html, /href="#tf--(work|writing|record|about)"/);
  assert.match(html, /class="tf-close"/);
});

test('the cover overlaps the arc only when its image is ready; as the pipeline left it, there is none', () => {
  let seen = 0;
  for (const name of FIXTURE_NAMES) {
    for (const media of ['ready', 'as-loaded'] as const) {
      const base = fixtureInput(name, media);
      for (const work of base.portfolio.works.filter(isRoutedWork)) {
        if (!work.cover && !(work.media?.length ?? 0)) continue;
        const html = renderInput(onWork(base, work.slug));
        if (media === 'as-loaded') {
          assert.doesNotMatch(html, /data-cover=""/, `${name} /work/${work.slug}: a cover`);
          assert.doesNotMatch(html, /tf-casecover/, `${name} /work/${work.slug}: a frame`);
        } else if (/data-cover=""/.test(html)) seen++;
      }
    }
  }
  assert.ok(seen > 0, 'some fixture routes a work whose ready image overlaps the arc');
});

test('the signature case: the hero on the accent, the fact sheet, the parts index, the cited records', () => {
  const input = sampleInput();
  const signature = input.portfolio.works.find((work) => work.id === input.portfolio.signature);
  assert.ok(signature && isRoutedWork(signature));
  const page = onWork(input, signature.slug);
  const html = renderInput(page);
  const model = caseModel(page, caseStudyOutline(page)!);
  // The hero's own page is the accent region (K-2).
  assert.match(
    html,
    /<section class="tf-hero tf-hero--case"[^>]*><div class="tf-page" data-ui-surface="accent">/,
  );
  // The ruled fact sheet, under its hidden head.
  const facts = /<section class="tf-page tf-casefacts"[^>]*>(.*?)<\/section>/s.exec(html)?.[1];
  assert.ok(facts, 'the fact sheet');
  assert.ok(count(facts, /<dt>/g) >= 3, 'its rows');
  assert.match(facts, /<dt>Role<\/dt>/);
  // The parts index: one link per part, each to its section, its label in the page's words.
  const index = /<nav class="tf-page tf-caseparts"([^>]*)>(.*?)<\/nav>/s.exec(html);
  assert.ok(index, 'the parts index');
  assert.deepEqual(
    [...index[2]!.matchAll(/<a href="([^"]+)"/g)].map(([, href]) => href),
    model.parts.map((part) => part.href),
  );
  // The cited records, under On the record.
  assert.ok(model.cited.length > 0, 'the sample cites records');
  const at = html.indexOf('<div class="tf-cited">');
  assert.ok(at > 0, 'the cited records');
  const records = html.slice(at);
  for (const record of model.cited)
    assert.ok(record.title && records.includes(escaped(record.title)), `${record.id} cited`);
});

test('the marker and Field notes on a work’s page: a "This page" group of its parts', () => {
  const input = sampleInput();
  const signature = input.portfolio.works.find((work) => work.id === input.portfolio.signature);
  assert.ok(signature && isRoutedWork(signature));
  const page = onWork(input, signature.slug);
  const html = renderInput(page);
  const model = caseModel(page, caseStudyOutline(page)!);
  assert.match(html, /class="tf-marker/, 'the same marker as home');
  const at = html.indexOf('data-tf-page-group=""');
  assert.ok(at > 0, 'the group');
  const group = html.slice(at, html.indexOf('</li>', html.indexOf('</ul>', at)));
  assert.match(group, /This page/);
  for (const part of model.parts) assert.ok(group.includes(`href="${part.href}"`), part.key);
});

test('prefixed: every part anchor and the overview carry the prefix', () => {
  const input = sampleInput('pv-');
  const work = input.portfolio.works.find(
    (each) => isRoutedWork(each) && typeof each.description === 'string' && each.description !== '',
  );
  assert.ok(work && isRoutedWork(work), 'the sample has a work with a description');
  const page = onWork(input, work.slug);
  const model = caseModel(page, caseStudyOutline(page)!);
  const overview = model.parts.find((part) => part.key === 'overview');
  assert.ok(overview);
  assert.equal(overview.anchor, `pv-${work.id}--overview`);
  for (const part of model.parts) assert.ok(part.anchor.startsWith('pv-'), part.anchor);
  assert.ok(renderInput(page).includes(`id="pv-${work.id}--overview"`));
});

/** A portfolio whose Contact is an early call to action, not the close (code review MF1). */
function earlyCall(withContact: boolean) {
  const write = { label: 'Write', url: 'mailto:rowan@example.com' };
  return {
    schemaVersion: 3,
    locale: 'en',
    direction: 'ltr',
    identity: { name: 'Rowan Vale' },
    ...(withContact ? { contact: { message: 'Write any time.' } } : {}),
    works: [
      {
        id: 'only',
        slug: 'only',
        title: 'Only',
        medium: 'software',
        caseStudy: { challenge: 'A problem.' },
      },
    ],
    sections: [
      { id: 'hire', kind: 'cta', title: 'Work with me', primaryAction: write },
      { id: 'work', kind: 'works', title: 'Selected work', items: ['only'] },
      withContact
        ? { id: 'reach', kind: 'contact', title: 'Get in touch' }
        : { id: 'again', kind: 'cta', title: 'Still here', primaryAction: write },
    ],
  };
}

test('from a work’s page Contact lands on the page’s own close, with an early call to action too', () => {
  for (const withContact of [true, false]) {
    const page = onWork(inputFor(pairOf(earlyCall(withContact))), 'only');
    const html = renderInput(page);
    assert.deepEqual(checkOutline(html, page.ids), [], `contact section: ${withContact}`);
    const hrefs = [...html.matchAll(/<a href="([^"]+)"[^>]*data-tf-to="contact"/g)].map(
      ([, href]) => href!,
    );
    assert.ok(hrefs.length >= 1, 'Contact is linked');
    const known = new Set(idsIn(html));
    for (const href of hrefs) {
      assert.ok(href.startsWith('#'), href);
      assert.ok(known.has(href.slice(1)), `${href} lands on this page`);
    }
  }
});

test('a work that sits under Writing on home marks Writing current on its page, not Work (code re-review U8b)', () => {
  const portfolio = {
    schemaVersion: 3,
    locale: 'en',
    direction: 'ltr',
    identity: { name: 'Rowan Vale' },
    works: [
      {
        id: 'essay',
        slug: 'essay',
        title: 'An essay',
        medium: 'writing',
        caseStudy: { challenge: 'A problem.' },
      },
      {
        id: 'tool',
        slug: 'tool',
        title: 'A tool',
        medium: 'software',
        caseStudy: { challenge: 'Another problem.' },
      },
    ],
    sections: [
      { id: 'work', kind: 'works', title: 'Selected work', items: ['tool'] },
      { id: 'essays', kind: 'works', title: 'Essays', items: ['essay'] },
    ],
  };
  const base = inputFor(pairOf(portfolio));
  const page = onWork(base, 'essay');
  assert.equal(caseModel(page, caseStudyOutline(page)!).here, 'writing');
  const html = renderInput(page);
  assert.match(html, /aria-current="page" data-tf-to="writing"/);
  assert.equal(count(html, /aria-current=/g), 1);
});

test('with no Work field on home, All work goes to the section that lists the work (code re-review N4)', () => {
  const portfolio = {
    schemaVersion: 3,
    locale: 'en',
    direction: 'ltr',
    identity: { name: 'Rowan Vale' },
    works: [
      {
        id: 'essay',
        slug: 'essay',
        title: 'An essay',
        medium: 'writing',
        caseStudy: { challenge: 'A problem.' },
      },
    ],
    sections: [{ id: 'essays', kind: 'works', title: 'Essays', items: ['essay'] }],
  };
  const page = onWork(inputFor(pairOf(portfolio)), 'essay');
  const model = caseModel(page, caseStudyOutline(page)!);
  assert.ok(!model.home.fields.some((field) => field.id === 'work'), 'no Work field');
  assert.equal(model.onward.kind, 'all');
  assert.equal(model.onward.kind === 'all' && model.onward.href, model.place!.href);
  assert.match(model.place!.href, /#essays$/);
});
