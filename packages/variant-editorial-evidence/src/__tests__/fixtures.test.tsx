import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import type { AppearanceCatalog, ParsedPair, UnitInput } from '@portfolio/schema';
import { loadPair, readUnitFiles } from '@portfolio/schema/node';
import { CONTRACT_FIXTURES, FIXTURES_DIR, HIDDEN_CANARY } from '@portfolio/variant-contract/node';
import { pageOutline } from '@portfolio/kit/sections';
import { checkOutline } from '@portfolio/variant-contract/node';
import { homeModel, isRoutedWork } from '../model';
import { chaptersOf } from '../navigation';
import { firstParagraph } from '../renderers/prose';
import { at, count, fragmentLinks, idsIn, inputFor, render } from './harness';

// Every contract fixture through Editorial Evidence (#13), as the server
// renders it: the home page, and the page of every work with a slug. These
// are the shapes #5 and #10 hold every composition to: a media-rich
// complete portfolio, academic, consulting, design, and engineering
// practices, a mixed practice right to left, identity only, a hundred
// works, long and duplicate titles, media that never arrives, sparse
// records, and hidden content that must not show.

/** The color schemes and typography presets the contract fixtures name, as their own test lists them. */
const IDS = {
  colorScheme: ['warm', 'warm-parchment', 'noir', 'ink-and-paper', 'nebula', 'aurora', 'solar'],
  typography: ['classic', 'humanist-ui', 'modernist', 'geometric', 'humanist'],
  displayMode: ['system', 'light', 'dark', 'high-contrast'],
} as const;
const CATALOG: AppearanceCatalog = {
  ids: (axis) => (axis in IDS ? IDS[axis as keyof typeof IDS] : null),
  generatorInput: () => undefined,
};

/** A contract fixture's pair and unit files, as a host reads them from its source directory. */
export function contractUnit(name: string): { pair: ParsedPair; unit: UnitInput } {
  const dir = path.join(FIXTURES_DIR, name);
  const result = loadPair(dir, { catalog: CATALOG });
  assert.ok(result.ok, `${name}: ${JSON.stringify(result.diagnostics, null, 2)}`);
  const { snapshots, media } = readUnitFiles(dir);
  return { pair: result.pair, unit: { snapshots, ...(media ? { media } : {}) } };
}

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
    // No block inside a paragraph: a browser would move it out, and hydration wouldn't match (React #418).
    assert.doesNotMatch(
      html,
      /<p\b[^>]*>(?:(?!<\/p>)[\s\S])*?<(?:div|h[1-6]|ul|ol|dl|figure|table|section|nav|blockquote)\b/,
      `${name}: a block inside a <p>`,
    );
    const ids = idsIn(html);
    assert.equal(new Set(ids).size, ids.length, `${name}: an id repeats`);
    for (const fragment of fragmentLinks(html)) assert.ok(ids.includes(fragment), fragment);

    // Every section the page renders has its own bespoke frame, and the outline holds.
    for (const idPrefix of ['', 'pv-']) {
      const prefixed = inputFor(pair, { unit, idPrefix });
      const markup = render(pair, { unit, idPrefix });
      const sections = pageOutline(prefixed).sections.map(({ id, anchor }) => ({ id, anchor }));
      assert.deepEqual(checkOutline(markup, prefixed.ids, { sections }), [], `${name} ${idPrefix}`);
      assert.doesNotMatch(markup, /data-renderer="shared"/, name);
    }
    // Pl. 1 comes before any chapter, and nothing from the reading order but the opening's comes before it.
    const model = homeModel(input);
    // Every section with an anchor but the hero lands in a chapter, or is the thesis the opening sets.
    const placed = new Set(
      chaptersOf(input, pageOutline(input)).flatMap(({ sections }) => sections.map(({ id }) => id)),
    );
    for (const section of pageOutline(input).sections) {
      if (section.href === undefined || section.kind === 'hero') continue;
      assert.ok(placed.has(section.id), `${name}: ${section.id} is in no chapter`);
    }
    if (model.lead) {
      const plate = at(html, 'class="ee-lead');
      const chapter = html.indexOf('class="ee-chapter"');
      if (chapter >= 0) assert.ok(plate < chapter, `${name}: Pl. 1 first`);
      const before = [...html.slice(0, plate).matchAll(/data-section-id="([^"]+)"/g)].map(
        ([, id]) => id,
      );
      assert.ok(
        before.every((id) => id === model.thesisSection?.id),
        `${name}: ${before.join(' ')} before Pl. 1`,
      );
    }
    // Every routed work has a page that renders, with its title as the one h1.
    for (const work of input.portfolio.works) {
      if (!isRoutedWork(work)) continue;
      const page = render(pair, { unit, route: { route: 'work', slug: work.slug } });
      assert.equal(count(page, /<h1\b/g), 1, `${name} ${work.slug}`);
      assert.doesNotMatch(page, new RegExp(HIDDEN_CANARY));
      assert.match(page, /class="ee-case__way"/);
      assert.doesNotMatch(page, /pf-case-study/);
      const pageIds = idsIn(page);
      assert.equal(new Set(pageIds).size, pageIds.length, `${name} ${work.slug}: an id repeats`);
    }
  });
}

test('the complete fixture shows every curation list: Pl. 1, the plates, and the archive', () => {
  const { pair, unit } = contractUnit('complete');
  const model = homeModel(inputFor(pair, { unit }));
  assert.ok(model.lead, 'a lead');
  assert.ok(model.featured.length > 0, 'featured works');
  assert.ok(model.archive.length > 0, 'an archive');
  assert.ok(model.selection, 'a works section for the run');
  const html = render(pair, { unit });
  assert.match(html, /<details id="ee--archive" class="ee-archive"/);
  assert.ok(model.chapters.length <= 5);
});

test('the mixed fixture, right to left, keeps the composition words marked English', () => {
  const { pair, unit } = contractUnit('mixed');
  const html = render(pair, { unit });
  assert.equal(pair.portfolio.direction, 'rtl');
  for (const word of ['Practice', 'Work', 'Writing', 'Record', 'Contact', 'In this issue']) {
    if (!html.includes(`>${word}<`)) continue;
    assert.match(html, new RegExp(`<span lang="en">${word}</span>|lang="en">${word}<`), word);
  }
});

test('identity only: the name and nothing pretending to be content', () => {
  const { pair, unit } = contractUnit('identity-only');
  const html = render(pair, { unit });
  assert.doesNotMatch(html, /ee-lead|ee-chapter|ee-contents|ee-sheet|ee-archive/);
  assert.equal(count(html, /<h1\b/g), 1);
});

test("Record's long tail folds behind one disclosure, named and counted, each section keeping its frame (the length ruling)", () => {
  const { pair, unit } = contractUnit('complete');
  const input = inputFor(pair, { unit });
  const html = render(pair, { unit });
  const record = homeModel(input).chapters.find(({ id }) => id === 'record');
  assert.ok(record, 'a Record chapter');
  const folded = record.bands.filter((band) => band.folded).map(({ section }) => section);
  assert.ok(folded.length >= 2, `${folded.length} folded`);
  const fold = /<details id="ee--fold-record" class="ee-fold">[\s\S]*?<\/details>/.exec(html)?.[0];
  assert.ok(fold, 'the fold, closed');
  assert.match(fold, /<summary class="ee-band ee-fold__summary">[\s\S]*?The rest of the record/);
  for (const section of folded) {
    assert.match(
      fold,
      new RegExp(`<section id="${section.id}"[^>]*data-section-id="${section.id}"`),
    );
    // Its contents entry still points at it.
    assert.match(html, new RegExp(`href="#${section.id}" class="ee-sheet__entry"`));
  }
  // What stays open: the figures, the quotations, the first history, and the code.
  for (const { section } of record.bands.filter((band) => !band.folded)) {
    assert.doesNotMatch(fold, new RegExp(`<section id="${section.id}"`), section.id);
  }
  // The summary counts what the folded sections list.
  const counted = pageOutline(input)
    .sections.filter(({ id }) => folded.some((section) => section.id === id))
    .reduce((sum, section) => sum + section.count, 0);
  assert.match(fold, new RegExp(`>${counted} entries<`));
});

test('the practice lists and the all-figure works fold behind their heads on one column, each a summary with its count', () => {
  const { pair, unit } = contractUnit('complete');
  const html = render(pair, { unit });
  // Each band's fold: the section it's in, and what its one line says.
  const folds = [
    ...html.matchAll(
      /<section id="([^"]+)"[^>]*class="ee-band [^"]*"[^>]*>(?:(?!<section )[\s\S])*?<details class="ee-band__fold"><summary class="ee-band__fold-summary"[^>]*><span class="ee-archive__cue" aria-hidden="true"><\/span> (?:<span[^>]*>)?([^<]+)/g,
    ),
  ].map(([, id, line]) => [id, line]);
  const practice = pair.portfolio.practice!;
  const offers = (practice.services ?? []).reduce((sum, group) => sum + group.items.length, 0);
  const n = (count: number, one: string) => `${count} ${one}${count === 1 ? '' : 's'}`;
  const lists = Object.fromEntries(
    (pair.portfolio.sections ?? []).flatMap((section) =>
      section.kind === 'practice'
        ? section.part === 'skills'
          ? [[section.id, n(practice.skills!.length, 'group')]]
          : section.part === 'tools'
            ? [[section.id, n(practice.tools!.length, 'group')]]
            : section.part === 'services'
              ? [[section.id, n(offers, 'offer')]]
              : []
        : [],
    ),
  );
  const found = Object.fromEntries(folds);
  for (const [id, line] of Object.entries(lists)) assert.equal(found[id], line, id);
  // A works section folds only when every work in it is a figure: photographs or tracks.
  assert.ok(
    folds.some(([id]) => !(id! in lists)),
    'a works section of figures folds',
  );
  for (const [id, line] of folds) {
    if (id! in lists) continue;
    const section = pair.portfolio.sections?.find((s) => s.id === id);
    assert.equal(section?.kind, 'works', `${id} folds`);
    assert.match(line!, /^\d+ (photographs?|tracks?|works?)$/, id);
  }
});

test('the lede reads its first paragraph, the rest behind Read more, and nothing leaves the page', () => {
  const { pair: complete, unit } = contractUnit('complete');
  // The complete fixture's lede is one paragraph; the owner's About runs to three.
  const body = 'The **first** paragraph.\n\nThe second.\n\nThe third.';
  const pair = {
    ...complete,
    portfolio: {
      ...complete.portfolio,
      sections: (complete.portfolio.sections ?? []).map((section) =>
        section.kind === 'lede' ? { ...section, body } : section,
      ),
    },
  };
  const html = render(pair, { unit });
  const lede = pair.portfolio.sections.find((section) => section.kind === 'lede');
  assert.ok(lede && lede.kind === 'lede');
  assert.ok(firstParagraph(lede.body));
  const band = new RegExp(`<section id="${lede.id}"[\\s\\S]*?</section>`).exec(html)?.[0];
  assert.ok(band, 'the lede band');
  assert.match(
    band,
    /<details class="ee-more"><summary class="ee-band__fold-summary"[^>]*>[\s\S]*?Read more<\/summary>/,
  );
  // Every paragraph is in the markup: the first before the fold, the rest in it.
  const fold = band.indexOf('<details class="ee-more">');
  assert.ok(at(band, '<p>The <strong>first</strong> paragraph.</p>') < fold);
  assert.ok(at(band, '<p>The second.</p>') > fold);
  assert.ok(at(band, '<p>The third.</p>') > fold);
});

test('a lede splits only where a split keeps it whole', () => {
  assert.deepEqual(firstParagraph('One.\n\nTwo.\n\nThree.'), {
    first: 'One.',
    rest: 'Two.\n\nThree.',
  });
  assert.equal(firstParagraph('Only one.'), undefined);
  assert.equal(firstParagraph('- a list\n\nThen prose.'), undefined);
  assert.equal(firstParagraph('# A heading\n\nThen prose.'), undefined);
  assert.equal(firstParagraph('See [it][a].\n\nMore.\n\n[a]: https://example.com'), undefined);
  assert.equal(firstParagraph('Code next.\n\n```\nx\n```'), undefined);
});
