import test from 'node:test';
import assert from 'node:assert/strict';
import { CONTRACT_FIXTURES, HIDDEN_CANARY } from '@portfolio/variant-contract/node';
import { homeModel } from '../model';
import { at, contractUnit, count, fragmentLinks, idsIn, inputFor, render } from './harness';

// Every contract fixture through Editorial Evidence (#13), as the server
// renders it: the home page, and the page of every work with a slug. These
// are the shapes #5 and #10 hold every composition to: a media-rich
// complete portfolio, academic, consulting, design, and engineering
// practices, a mixed practice right to left, identity only, a hundred
// works, long and duplicate titles, media that never arrives, sparse
// records, and hidden content that must not show.

for (const { name } of CONTRACT_FIXTURES) {
  test(`the ${name} fixture renders whole: one main, one h1, unique ids, and links that land`, () => {
    const { pair, unit } = contractUnit(name);
    const input = inputFor(pair, { unit });
    const html = render(pair, { unit });
    assert.equal(count(html, /<main\b/g), 1);
    assert.equal(count(html, /<h1\b/g), 1);
    assert.equal(count(html, /data-visitor-control-slot/g), 1);
    assert.doesNotMatch(html, new RegExp(HIDDEN_CANARY));
    assert.doesNotMatch(html, /<script|<style|<link/);
    const ids = idsIn(html);
    assert.equal(new Set(ids).size, ids.length, `${name}: an id repeats`);
    for (const fragment of fragmentLinks(html)) assert.ok(ids.includes(fragment), fragment);

    // The signature artifact comes before any supporting record.
    const model = homeModel(input);
    if (model.signature) {
      const signature = at(html, 'ee-plate--signature');
      for (const later of ['ee-plate--flagship', 'ee-proof', 'ee-archive']) {
        const index = html.indexOf(later);
        if (index >= 0) assert.ok(signature < index, `${name}: ${later}`);
      }
      // Nothing from the reading order comes between the opening and the signature.
      const between = html.slice(at(html, 'class="ee-region ee-work"'), signature);
      assert.doesNotMatch(between, /data-section-id=/, name);
    }
    // Every work with a page has one that renders, with its title as the one h1.
    for (const work of input.portfolio.works) {
      if (work.slug === undefined) continue;
      const page = render(pair, { unit, route: { route: 'work', slug: work.slug } });
      assert.equal(count(page, /<h1\b/g), 1, `${name} ${work.slug}`);
      assert.doesNotMatch(page, new RegExp(HIDDEN_CANARY));
      assert.match(page, /class="ee-breadcrumb"/);
      const pageIds = idsIn(page);
      assert.equal(new Set(pageIds).size, pageIds.length, `${name} ${work.slug}: an id repeats`);
    }
  });
}

test('the complete fixture shows every curation list: the signature, the flagships, the proof, and the archive', () => {
  const { pair, unit } = contractUnit('complete');
  const model = homeModel(inputFor(pair, { unit }));
  assert.ok(model.signature, 'a signature');
  assert.ok(model.flagships.length > 0, 'flagships');
  assert.ok(model.proof.length > 0, 'a proof strip');
  assert.ok(model.archive.length > 0, 'an archive');
  const html = render(pair, { unit });
  assert.match(html, /<details class="ee-archive__disclosure"/);
});

test('the mixed fixture, right to left, keeps the composition words marked English', () => {
  const { pair, unit } = contractUnit('mixed');
  const html = render(pair, { unit });
  assert.equal(pair.portfolio.direction, 'rtl');
  for (const word of ['Selected work', 'Proof', 'Archive', 'Signature work']) {
    if (!html.includes(`>${word}<`)) continue;
    assert.match(html, new RegExp(`<span lang="en">${word}</span>`), word);
  }
});

test('identity only: the name and nothing pretending to be content', () => {
  const { pair, unit } = contractUnit('identity-only');
  const html = render(pair, { unit });
  assert.doesNotMatch(html, /ee-plate|ee-proof|ee-archive|ee-nav/);
});
