import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { caseStudyOutline } from '@portfolio/kit/sections';
import { resolvePortfolioView } from '@portfolio/schema';
import { readPair, readUnitFiles } from '@portfolio/schema/node';
import { checkControlValues, contentIndex, routeHref } from '@portfolio/variant-contract';
import { CONTRACT_FIXTURES } from '@portfolio/variant-contract/node';
import {
  count,
  escaped,
  fixtureInput,
  inputFor,
  MANIFEST,
  pairOf,
  renderInput,
  REPO_ROOT,
  sampleInput,
} from './harness.test';

// P2 (variants-10 brief §5.2; design gate item 8): the home outline's folds
// and the case study page, on the bundled sample.

const foldsIn = (html: string) =>
  [
    ...html.matchAll(
      /<details class="ag-lite ag-fold"[\s\S]*?<\/summary>\s*<section[^>]*\sid="([^"]+)"/g,
    ),
  ].map(([, id]) => id!);

test('home folds the full record, About’s minor parts and the other works sections, each with its id', () => {
  const html = renderInput(sampleInput());
  const folded = foldsIn(html);
  for (const id of [
    'experience',
    'education',
    'publications',
    'talks',
    'awards',
    'patents',
    'press',
    'elsewhere',
    'on-github',
    'skills',
    'off-the-page',
    'stack-i-currently-reach-for',
    'engagements',
    'incident-history',
    'looking',
    'listening-a-small-experiment',
  ]) {
    assert.ok(folded.includes(id), `${id} folds`);
  }
  for (const id of [
    'work-showcase',
    'essays',
    'at-a-glance',
    'words-from-collaborators',
    'about',
    'now',
    'quote',
  ]) {
    assert.ok(!folded.includes(id), `${id} stays open`);
    assert.match(html, new RegExp(`\\sid="${id}"`), `${id} renders`);
  }
  // Closed: no fold renders open, and each summary reads as content with a count.
  assert.equal(count(html, /<details[^>]*\sopen/g), 0);
  assert.match(html, /Principal Engineer, Reliability, Solstice Payments, 2023–now/);
});

test('the case study is the composition’s own page: one h1, the fact sheet, the parts by anchor', () => {
  const home = sampleInput();
  const input = { ...home, route: { route: 'work' as const, slug: 'postmortem-template-kit' } };
  const outline = caseStudyOutline(input);
  assert.ok(outline, 'the route has a case study');
  const html = renderInput(input);
  assert.equal(count(html, /<h1[\s>]/g), 1);
  assert.match(html, /class="ag ag--case"/);
  assert.match(html, /<dl class="ag-facts__list">/);
  for (const part of outline!.parts) {
    assert.match(html, new RegExp(`\\sid="${part.anchor}"`), `${part.key} has its anchor`);
  }
  assert.match(html, /Instead of/);
});

const sampleWith = (controls?: Record<string, unknown>) => {
  const read = readPair({
    portfolio: path.join(REPO_ROOT, 'portfolio.example.yml'),
    site: path.join(REPO_ROOT, 'site.example.yml'),
  });
  assert.ok(read.ok);
  const unit = readUnitFiles(REPO_ROOT);
  return inputFor(controls ? pairOf(read.pair.portfolio, controls) : pairOf(read.pair.portfolio), {
    unit: { snapshots: unit.snapshots },
  });
};

/** The input with one image asset derived and ready, its WebP renditions up to 2400w. */
const withReady = (input: ReturnType<typeof sampleInput>, id: string) => {
  const asset = input.media[id]!;
  const webp = (width: number) => ({
    url: `/media/${id}/w${width}.webp`,
    name: `w${width}`,
    mime: 'image/webp',
    bytes: width * 40,
    width,
    height: Math.round((width * 2) / 3),
  });
  const ready = {
    ...asset,
    derived: {
      state: 'ready' as const,
      derivedAt: '2026-10-30T00:00:00.000Z',
      value: {
        sha256: 'c'.repeat(64),
        mime: 'image/png',
        bytes: 900_000,
        width: 2400,
        height: 1600,
        aspectRatio: 1.5,
        renditions: [480, 960, 1600, 2400].map(webp),
      },
    },
  };
  return { ...input, media: { ...input.media, [id]: ready } as typeof input.media };
};

// The code review's low 5: an owner's sky photograph from outside any works
// section (here the complete fixture's portrait) still carries its credit.
test('an owner’s sky photograph from outside the works sections is credited from the media itself', () => {
  const dir = path.dirname(
    CONTRACT_FIXTURES.find((each) => each.name === 'complete')!.files.portfolio,
  );
  const read = readPair(CONTRACT_FIXTURES.find((each) => each.name === 'complete')!.files);
  assert.ok(read.ok);
  const { snapshots, media } = readUnitFiles(dir);
  const input = withReady(
    inputFor(pairOf(read.pair.portfolio, { backdropMedia: 'avatar' }), {
      unit: { snapshots, ...(media ? { media } : {}) },
    }),
    'avatar',
  );
  assert.equal(input.controls.backdropMedia, 'avatar');
  const html = renderInput(input);
  assert.match(html, /class="pf-backdrop ag-sky__photo"/);
  const credit = html.match(/<p class="ag-foot__credit"[\s\S]*?<\/p>/)?.[0] ?? '';
  assert.match(credit, /Credit avatar/);
});

// The code review's low 6: the cover's caption is the owner's caption alone,
// never the alt text again (a screen reader would hear it twice), and a picture
// that isn't ready and has no caption leaves no empty item behind.
test('the case cover’s caption never repeats its alt, and an unready picture with no caption leaves no empty item', () => {
  const plain = withReady(sampleInput(), 'postmortem-template-kit-cover');
  const portfolio = {
    ...plain.portfolio,
    works: plain.portfolio.works!.map((work) =>
      work.slug === 'postmortem-template-kit'
        ? { ...work, media: [...(work.media ?? []), { asset: 'small-traces-cover' }] }
        : work,
    ),
  };
  const input = {
    ...plain,
    portfolio,
    route: { route: 'work' as const, slug: 'postmortem-template-kit' },
  } as typeof plain;
  const html = renderInput(input);
  const alt = plain.media['postmortem-template-kit-cover']!.alt!;
  const caption = html.match(/<figcaption class="ag-sig__body"[\s\S]*?<\/figcaption>/)?.[0] ?? '';
  assert.ok(caption, 'the cover sheet renders');
  assert.ok(!caption.includes(escaped(alt)), 'the caption doesn’t repeat the alt');
  assert.doesNotMatch(html, /<li>\s*<\/li>/);
});

// The case's sub-nav names its parts by anchor, and a part can be there by its
// cited records alone (the evidence part with no evidence text): on every
// contract fixture's and the sample's case studies, every in-page link lands,
// and every link to home's anchors lands on home. The sample runs with a sky
// photograph too, the automatic pick's and the owner's, so the footer's
// credit renders (code review blocker 1).
test('every in-page link on every case study lands on an id, and every link to home lands on home', () => {
  const pairs: { name: string; input: ReturnType<typeof sampleInput> }[] = CONTRACT_FIXTURES.map(
    (fixture) => ({ name: fixture.name, input: fixtureInput(fixture.name) }),
  );
  pairs.push({ name: 'sample', input: sampleInput() });
  pairs.push({
    name: 'sample, the sky photographed',
    input: withReady(sampleInput(), 'looking-dusk'),
  });
  pairs.push({
    name: 'sample, the owner’s sky',
    input: withReady(sampleWith({ backdropMedia: 'looking-morning' }), 'looking-morning'),
  });
  const idsIn = (html: string) =>
    new Set([...html.matchAll(/\sid="([^"]+)"/g)].map(([, id]) => id!));
  const missing: string[] = [];
  let pages = 0;
  let credits = 0;
  for (const { name, input } of pairs) {
    const homeIds = idsIn(renderInput(input));
    const home = routeHref(input, { route: 'home' });
    for (const work of input.portfolio.works ?? []) {
      const routed = { ...input, route: { route: 'work' as const, slug: work.slug ?? work.id } };
      if (!caseStudyOutline(routed)) continue;
      pages += 1;
      const html = renderInput(routed);
      if (html.includes('class="ag-foot__credit"')) credits += 1;
      const ids = idsIn(html);
      for (const [, href] of html.matchAll(/\shref="([^"]*#[^"]+)"/g)) {
        const [path, id] = href!.split('#') as [string, string];
        const lands = path === '' ? ids.has(id) : path === home ? homeIds.has(id) : true;
        if (!lands) missing.push(`${name} /work/${work.slug ?? work.id}: ${href}`);
      }
    }
  }
  assert.ok(pages >= 9, `${pages} case studies`);
  assert.ok(credits >= 2, `${credits} case pages carry the sky's credit`);
  assert.deepEqual(missing, []);
});

// K-8: the sky photograph by media ref. A stale value, an asset the view doesn't
// hold (controls.dangling-ref) or a section's id (controls.invalid), renders the
// default: the page is the same markup as with no value at all.

for (const [value, code] of [
  ['looking-gone', 'controls.dangling-ref'],
  ['work-showcase', 'controls.invalid'],
] as const) {
  test(`a stale backdropMedia (${code}) renders the default sky`, () => {
    const plain = sampleWith();
    const stale = sampleWith({ backdropMedia: value });
    const view = resolvePortfolioView(pairOf(plain.portfolio), {}, { mediaBase: '/media' });
    const problems = checkControlValues(
      MANIFEST,
      { version: 1, values: { backdropMedia: value } },
      contentIndex(view.portfolio, view.media),
    );
    assert.deepEqual(
      problems.map((problem) => problem.code),
      [code],
    );
    assert.equal(stale.controls.backdropMedia, null);
    assert.equal(renderInput(stale), renderInput(plain));
    assert.doesNotMatch(renderInput(stale), /pf-backdrop/);
  });
}

test('an owner’s backdropMedia lays the kit’s MediaBackdrop in the sky and at the horizon, credited', () => {
  const plain = sampleWith({ backdropMedia: 'looking-morning' });
  assert.equal(plain.controls.backdropMedia, 'looking-morning');
  const webp = (width: number) => ({
    url: `/media/looking-morning/w${width}.webp`,
    name: `w${width}`,
    mime: 'image/webp',
    bytes: width * 40,
    width,
    height: Math.round((width * 9) / 16),
  });
  const asset = plain.media['looking-morning']!;
  const ready = {
    ...asset,
    derived: {
      state: 'ready' as const,
      derivedAt: '2026-10-30T00:00:00.000Z',
      value: {
        sha256: 'a'.repeat(64),
        mime: 'image/png',
        bytes: 900_000,
        width: 2400,
        height: 1350,
        aspectRatio: 16 / 9,
        renditions: [480, 960, 1600, 2400].map(webp),
      },
    },
  };
  const html = renderInput({
    ...plain,
    media: { ...plain.media, 'looking-morning': ready } as typeof plain.media,
  });
  assert.equal(count(html, /class="pf-backdrop ag-sky__photo"/g), 1);
  assert.equal(count(html, /class="pf-backdrop ag-horizon__img"/g), 1);
  // The sky's picture takes the WebP renditions up to 1600w alone (the Looking section's own picture keeps all).
  const sky = html.match(/<img class="pf-backdrop ag-sky__photo"[^>]*>/)?.[0] ?? '';
  assert.match(sky, /w1600\.webp 1600w/);
  assert.doesNotMatch(sky, /w2400/);
  assert.match(html, /data-backdrop-asset="looking-morning"/);
  assert.match(html, /The sky is drawn over [\s\S]*?<a href="#looking">Looking<\/a>/);
});

test('the automatic sky offers the 1600w rendition to a wide window when the photograph has one (the approval’s item 9)', () => {
  const plain = sampleWith();
  const asset = plain.media['looking-dusk']!;
  const webp = (width: number) => ({
    url: `/media/looking-dusk/w${width}.webp`,
    name: `w${width}`,
    mime: 'image/webp',
    bytes: width * 40,
    width,
    height: Math.round((width * 2) / 3),
  });
  const ready = {
    ...asset,
    derived: {
      state: 'ready' as const,
      derivedAt: '2026-10-30T00:00:00.000Z',
      value: {
        sha256: 'b'.repeat(64),
        mime: 'image/png',
        bytes: 900_000,
        width: 2400,
        height: 1600,
        aspectRatio: 1.5,
        renditions: [480, 960, 1600, 2400].map(webp),
      },
    },
  };
  const html = renderInput({
    ...plain,
    media: { ...plain.media, 'looking-dusk': ready } as typeof plain.media,
  });
  const sky = html.match(/<div class="ag-sky"[\s\S]*?<div class="ag-sky__curtains">/)?.[0] ?? '';
  assert.match(sky, /w1600\.webp 1600w/);
  assert.match(sky, /sizes="100vw"/);
});

test('home shows what the owner wrote that the fallback shows (the content sweep): tools, places, skills, links by label', () => {
  const html = renderInput(sampleInput());
  for (const text of [
    'AWS Lambda', // a work's every tool
    'Read the curriculum', // a link's own label
    'Srisailam, India', // a photograph's place
    'The last bus back from Mysore', // a frame's caption
    'Kafka', // a role's skills
    'Founder, NITK Open Source Group', // a degree's achievements
    '10.4230/LIPIcs.FSTTCS.2016.42', // a publication's DOI
    'Documentary', // an external work's categories
    'Visit gallery', // its call
    'Bandcamp', // a release's link
    'Producer, composer', // its role
  ]) {
    assert.ok(html.includes(escaped(text)), text);
  }
});

// The code review's blocker 2: what has no page of its own shows on home. A
// work without a case study shows its description, an episode its show
// notes, the signature release its tracks, and the thesis section its
// subtitle beside the standfirst.
test('home shows what has no page of its own: descriptions, show notes, a signature’s tracks, the thesis subtitle', () => {
  const sample = renderInput(sampleInput());
  assert.match(sample, /eleven cold-started Lambdas/, 'small-traces’ description');
  assert.match(sample, /no game-day tradition/, 'chaos-curriculum’s description');
  const complete = renderInput(fixtureInput('complete'));
  assert.match(complete, /Episode show notes\./, 'an episode’s show notes');
  assert.match(complete, /Thesis subtitle/, 'the thesis section’s subtitle');
  const music = renderInput(fixtureInput('music'));
  for (const track of ['Abertura', 'Ponte Velha']) assert.match(music, new RegExp(track), track);
});

// The code review's low 7 (lesson 9's print nav): the rule that folds the
// capsule's destinations into the Index under 56rem is the screen's alone, so
// a sheet of paper under that width keeps them.
test('the capsule’s destinations fold away under 56rem on screen only, never on paper', () => {
  const css = readFileSync(
    path.join(REPO_ROOT, 'packages/variant-aurora-glass/src/styles.css'),
    'utf8',
  );
  const hiding = [
    ...css.matchAll(
      /@media ([^{]*)\{\s*\[data-variant='aurora-glass'\] \.ag-capsule \.ag-capsule__dest \{\s*display: none;/g,
    ),
  ].map(([, query]) => query!.trim());
  assert.deepEqual(hiding, ['screen and (max-width: 56rem)']);
});

// The delta check's 1: a row's disclosure sits on a sheet whose title link
// stretches over it at z-index 1, so it's lifted over it, as the signature's
// links and tracks are (the e2e clicks it: aurora-glass-p2-sample.spec.ts).
test('a row’s disclosure lies over the sheet’s stretched link', () => {
  const css = readFileSync(
    path.join(REPO_ROOT, 'packages/variant-aurora-glass/src/styles.css'),
    'utf8',
  );
  assert.match(css, /\.ag-stretch::after \{[^}]*z-index: 1;/);
  assert.match(
    css,
    /:is\(\.ag-sig__links, \.ag-sig__tracks, \.ag-more\) \{\s*position: relative;\s*z-index: 2;/,
  );
});

// The delta check's 2: each disclosure's summary is named by what it holds,
// so a list of the page's controls tells them apart: its text, visible and
// hidden alike, is unique within the page, on the sample and every fixture.
test('every disclosure’s accessible name is unique within its page', () => {
  const textOf = (markup: string) =>
    markup
      .replace(/<[^>]+>/g, '')
      .replace(/&#x27;|&#39;/g, "'")
      .replace(/&amp;/g, '&')
      .replace(/\s+/g, ' ')
      .trim();
  const inputs = [
    { name: 'sample', input: sampleInput() },
    ...CONTRACT_FIXTURES.map((fixture) => ({
      name: fixture.name,
      input: fixtureInput(fixture.name),
    })),
  ];
  let seen = 0;
  for (const { name, input } of inputs) {
    const html = renderInput(input);
    const names = [
      ...html.matchAll(/<summary class="ag-more__summary"[^>]*>([\s\S]*?)<\/summary>/g),
    ].map(([, inner]) => textOf(inner!));
    seen += names.length;
    const twice = names.filter((each, index) => names.indexOf(each) !== index);
    assert.deepEqual(twice, [], `${name}: summaries named alike`);
  }
  assert.ok(seen >= 3, `${seen} disclosures`);
});

// The delta check's (a): on paper with no script, in an engine without
// ::details-content, a disclosure stays closed, so its summary must still show;
// the summary steps aside only where the style itself prints the text open.
test('a disclosure’s summary leaves the printed page only where ::details-content prints its text', () => {
  const css = readFileSync(
    path.join(REPO_ROOT, 'packages/variant-aurora-glass/src/styles.css'),
    'utf8',
  );
  const print = css.slice(css.indexOf('@media print {'));
  const supports = print.indexOf('@supports selector(::details-content) {');
  const hide = print.indexOf('.ag-more__summary {\n      display: none;');
  assert.ok(supports >= 0, 'the print rule for ::details-content');
  assert.ok(hide > supports, 'the summary hides inside the @supports block');
  assert.doesNotMatch(
    print,
    /\n  \[data-variant='aurora-glass'\] \.ag-more__summary \{\n    display: none;/,
  );
});

// The focus re-score (E, 31 Oct): a capsule destination's ring crossed the
// capsule's border and shadow below it, since the items stood 2.75rem in a
// capsule sized by the language's control height (2.5rem under
// platform-neutral). The capsule's inner height is now the items' own, so a
// ring, its offset and its width stay inside the capsule's padding box.
test('the capsule holds its items at their own height, so a focused item’s ring stays inside its padding box', () => {
  const css = readFileSync(
    path.join(REPO_ROOT, 'packages/variant-aurora-glass/src/styles.css'),
    'utf8',
  );
  assert.match(css, /--layout-capsule-item: max\(var\(--ui-control-height\), 2\.75rem\);/);
  assert.match(
    css,
    /--layout-chrome: calc\(var\(--layout-capsule-item\) \+ 2 \* var\(--layout-capsule-pad\)\);/,
  );
  const items = css.match(
    /:is\(\.ag-capsule__dest a, \.ag-capsule__index, \.ag-capsule__cta, \.ag-orn\) \{[^}]*\}/,
  )?.[0];
  assert.ok(items, 'the capsule items’ rule');
  assert.match(items!, /min-block-size: var\(--layout-capsule-item\);/);
});

// The design review's 1: the case title's phone size has a floor under the
// language's step, a tenth of the window, so "Postmortem" fits whole at 320
// (the e2e reads each word's line boxes: aurora-glass-p2-sample.spec.ts).
test('the case title on a phone is never larger than a tenth of the window', () => {
  const css = readFileSync(
    path.join(REPO_ROOT, 'packages/variant-aurora-glass/src/styles.css'),
    'utf8',
  );
  const phone = css.slice(css.indexOf('@media (max-width: 48rem)'));
  assert.match(phone, /\.ag-case \.ag-id__line \{\s*font-size: min\(var\(--type-step-5\), 10vw\);/);
});

// The design review's 2: a figure's statement of a sentence's length reads in
// the small note line under its value, as "Across three platform teams" does,
// not as a nine-line caption beside its neighbours' labels.
test('a figure’s long statement reads in the note line; a label stays the caption', () => {
  const html = renderInput(sampleInput());
  const figures = html.match(/<ul class="ag-lites ag-figures"[\s\S]*?<\/ul>/)?.[0] ?? '';
  assert.ok(figures, 'At a glance renders');
  assert.match(
    figures,
    /<p class="ag-figure__note" data-type-role="caption">(?:<span[^>]*>)?Years engineering, from research code/,
  );
  assert.doesNotMatch(
    figures,
    /<p class="ag-figure__caption"[^>]*>(?:<span[^>]*>)?Years engineering/,
  );
  assert.match(
    figures,
    /<p class="ag-figure__caption" data-type-role="body">(?:<span[^>]*>)?Services owned(?:<\/span>)?<\/p>/,
  );
});

// The design review's 3: "More about it" read as a dead link (accent, bold, no
// marker). It takes the folds' ring marker, smaller, filled when open, in the
// text's own colour.
test('a disclosure’s summary carries the folds’ ring marker, smaller, filled when open', () => {
  const css = readFileSync(
    path.join(REPO_ROOT, 'packages/variant-aurora-glass/src/styles.css'),
    'utf8',
  );
  const marker = css.match(/\.ag-more__summary::before \{[^}]*\}/)?.[0] ?? '';
  assert.match(marker, /inline-size: calc\(var\(--layout-bead\) \* 0\.75\);/);
  assert.match(marker, /border: 2px solid var\(--color-accent\);/);
  assert.match(marker, /border-radius: var\(--ui-radius-badge\);/);
  assert.match(
    css,
    /\.ag-more\[open\] > \.ag-more__summary::before[^{]*\{\s*background-color: var\(--color-accent\);/,
  );
  const summary =
    css.match(/\[data-variant='aurora-glass'\] \.ag-more__summary \{[^}]*\}/)?.[0] ?? '';
  assert.doesNotMatch(summary, /accent-text/);
});

// The lead's ruling on Aurora x Flux at mobile (distinct): on a phone the signature sheet hangs
// from the pane's foot off the pane's column, from the second track to the end, and laps the
// pane's empty foot alone, never the primary action above it (the delta design check; the
// pair's box score is the lead's recorded acceptance in tests/variants/distinct.json).
test('on a phone the signature sheet hangs from the pane’s foot off its column', () => {
  const css = readFileSync(
    path.join(REPO_ROOT, 'packages/variant-aurora-glass/src/styles.css'),
    'utf8',
  );
  const phone = css.slice(css.indexOf('@media (max-width: 48rem)'));
  const sig = phone.match(/\n  \[data-variant='aurora-glass'\] \.ag-sig \{[^}]*\}/)?.[0] ?? '';
  assert.match(sig, /grid-column: 2 \/ -1;/);
  assert.match(sig, /margin-block-start: calc\(-1 \* var\(--rhythm-group\)\);/);
});

// The default recipe's print cells (the quality inventory): on paper every authored field
// prints. The Index prints in the flow as the page's contents, its heading and every section
// title with it, the signature's back-reference prints, and the phone's screen-only cuts (the
// band sub-navs, the capsule's destinations and call) are the screen's alone.
test('on paper the Index, the back-reference and every section title print', () => {
  const css = readFileSync(
    path.join(REPO_ROOT, 'packages/variant-aurora-glass/src/styles.css'),
    'utf8',
  );
  const print = css.slice(css.indexOf('@media print {'));
  assert.doesNotMatch(print, /\.ag-backref/);
  assert.doesNotMatch(print, /\.ag:not\(\[data-ag-live\]\) \.ag-index \{\s*display: none;/);
  assert.match(print, /\.ag-index \{\s*display: block;\s*position: static;/);
  for (const rule of [
    /\.ag-band__nav \{\s*display: none;/,
    /\.ag-capsule :is\(\.ag-capsule__dest, \.ag-capsule__cta, \.ag-wide\) \{\s*display: none;/,
  ]) {
    const at = css.search(rule);
    assert.ok(at > 0, String(rule));
    const media = css.slice(0, at).match(/@media [^{]*\{[^@]*$/)?.[0] ?? '';
    assert.match(media, /^@media screen and \(max-width: 48rem\)/, String(rule));
  }
});

// The default recipe's 390 cell: the hero's action sits a ring's reach higher in a pane whose
// foot is that much deeper, so the focused ring lies clear of the signature sheet, and the sheet
// itself doesn't move (Aurora x Flux's measured boxes stand).
test('on a phone the action keeps a ring’s reach clear above the signature sheet', () => {
  const css = readFileSync(
    path.join(REPO_ROOT, 'packages/variant-aurora-glass/src/styles.css'),
    'utf8',
  );
  const phone = css.slice(css.indexOf('@media (max-width: 48rem)')).replace(/\s+/g, ' ');
  const reach = 'var(--ui-focus-offset) + 2 * var(--ui-focus-width)';
  assert.ok(
    phone.includes(
      `.ag-opening[data-sheet='yes'] .ag-id { padding-block-end: calc( var(--rhythm-group) + ${reach} ); }`,
    ),
  );
  assert.ok(
    phone.includes(
      `.ag-opening[data-sheet='yes'] .ag-id__acts { margin-block-start: calc( var(--space-xs) - (${reach}) ); }`,
    ),
  );
});

// The default recipe's forced-colors cells (focus contrast 57/57/27): forced colors drop a
// background image, so Aurora's frosted surfaces, whose surface is one, went transparent over
// the sky's photograph, and every ring was drawn over the photo. Under forced colors the sky
// and the horizon's photograph go, and every surface takes Canvas; a focused capsule item paints
// over its neighbours, so their fills don't cut its ring.
test('under forced colors the sky goes and every frosted surface takes Canvas', () => {
  const css = readFileSync(
    path.join(REPO_ROOT, 'packages/variant-aurora-glass/src/styles.css'),
    'utf8',
  );
  const forced = [...css.matchAll(/@media \(forced-colors: active\) \{([\s\S]*?)\n\}/g)]
    .map(([, body]) => body)
    .join('\n')
    .replace(/\s+/g, ' ');
  assert.match(forced, /:is\(\.ag-sky, \.ag-horizon__photo\) \{ display: none; \}/);
  for (const surface of [
    '.ag-pane',
    '.ag-lite',
    '.ag-capsule',
    '.ag-orn',
    '.ag-call',
    '.ag-facts',
    '.ag-sec--split > .ag-sec__head',
    '[data-visitor-control-slot]',
  ]) {
    assert.ok(forced.includes(surface), surface);
  }
  assert.match(forced, /background-color: var\(--color-canvas\);/);
  assert.match(forced, /\.ag-capsule a:focus-visible \{ position: relative; z-index: 1; \}/);
});

// The default recipe's reflow at 320 and root text at 1024: nothing clips its own words (the capsule's
// name and call wrap between their words at every width, row 150, a fold's first line everywhere, and the
// Menu's word steps aside for its mark, its name kept), and at enlarged text the capsule folds as a narrow
// screen's does, never past the page.
test('at 320 nothing in the capsule or a fold clips its words, and the capsule folds when the text grows', () => {
  const css = readFileSync(
    path.join(REPO_ROOT, 'packages/variant-aurora-glass/src/styles.css'),
    'utf8',
  ).replace(/\s+/g, ' ');
  // The name and the call are never cut and never split a word, at every width (row 150): no ellipsis,
  // no clip, no one-line hold, a box never narrower than the longest word, and no break inside one.
  for (const rule of [/\.ag-capsule__name \{([^}]*)\}/, /\.ag-capsule__cta-text \{([^}]*)\}/]) {
    const body = rule.exec(css)?.[1] ?? '';
    assert.ok(body.includes('min-inline-size: min-content;'), body);
    assert.ok(body.includes('overflow-wrap: normal;'), body);
    assert.doesNotMatch(
      body,
      /white-space: nowrap|text-overflow|overflow: hidden|anywhere|break-word/,
    );
  }
  assert.doesNotMatch(css, /\.ag-capsule__(?:name|cta-text) \{[^}]*text-overflow/);
  assert.doesNotMatch(css, /\.ag-capsule > \.ag-capsule__cta \{[^}]*min-inline-size: 0;/);
  // A fold's first line wraps at every width and text size, not only at 320 (row 62).
  const first = /\.ag-fold__first \{([^}]*)\}/.exec(css)?.[1] ?? '';
  assert.ok(
    first.includes('grid-column: 2 / -1;') && first.includes('overflow-wrap: anywhere;'),
    first,
  );
  assert.doesNotMatch(first, /white-space: nowrap|text-overflow: ellipsis|overflow: hidden/);
  // The Menu's word stays on screen (one name, "Menu"), and the name keeps its size at 320: the
  // 20rem step that set it a size down never applied (a plainer selector than the size's own, row
  // 150), so it goes, and no 20rem rule is left (row 150's fix round).
  assert.ok(!css.includes('.ag-capsule .ag-narrow { position: absolute;'));
  assert.ok(!css.includes('@media (max-width: 20rem) {'));
  assert.ok(!css.includes('.ag-capsule__name { font-size: var(--type-step--1); }'));
  // And the rest of its room comes from its spacing (row 150, the 320 probe), its end padding kept:
  // s, 3xs and xs at 320, growing back to m, xs and s past it at a tenth of the viewport's growth
  // each, four tenths in all, not in one step (row 150, the coordinator's (f): a step put 27px on
  // the row's need at 320.01, and a header on one line at 320 took two again at 324).
  const ramp = (lo: string, hi: string) =>
    `clamp( var(--space-${lo}), var(--space-${lo}) + (100vw - 320px) * 0.1, var(--space-${hi}) )`;
  const flat = (text: string) => text.replace(/\( /g, '(').replace(/ \)/g, ')');
  const capsule = /\.ag-capsule \{ grid-column: 2;([^}]*)\}/.exec(css)?.[1] ?? '';
  assert.ok(flat(capsule).includes(`padding-inline-start: ${flat(ramp('s', 'm'))};`), capsule);
  assert.ok(flat(css).includes(`column-gap: ${flat(ramp('3xs', 'xs'))};`));
  assert.ok(
    flat(css).includes(
      `.ag-capsule .ag-capsule__index { padding-inline: ${flat(ramp('xs', 's'))}; }`,
    ),
  );
  // The capsule never wraps (its name and call wrap inside it, between words); it folds its
  // destinations into the Index under the chrome's 64em in its text's em, what it needs beside the
  // ornament plus a margin (row 150), and to the phone's under 44em.
  assert.doesNotMatch(css, /\.ag-capsule \{[^}]*flex-wrap: wrap;/);
  assert.match(css, /\.ag-chrome \{[^}]*container: ag-chrome \/ inline-size;/);
  assert.ok(css.includes('@container ag-chrome (max-width: 64em) {'));
  assert.ok(!css.includes('@container ag-chrome (max-width: 52em) {'));
  assert.ok(css.includes('@container ag-chrome (max-width: 44em) {'));
  // Above 75rem and under 70em in its own em, the capsule takes the row's start and fills it to
  // the ornament, by its own properties (row 150's look ruling).
  assert.match(
    css,
    /@media screen and \(width > 75rem\) \{\s*@container ag-chrome \(max-width: 70em\) \{\s*\[data-variant='aurora-glass'\] \.ag-capsule \{\s*inline-size: 100cqi;/,
  );
});

// The default recipe's print cells (8c3919e02): the capsule's plain link to the Index prints,
// since the Index it names prints too; only the controls a sheet can't press go.
test('on paper the capsule keeps its link to the printed Index', () => {
  const css = readFileSync(
    path.join(REPO_ROOT, 'packages/variant-aurora-glass/src/styles.css'),
    'utf8',
  );
  const print = css.slice(css.indexOf('@media print {')).replace(/\s+/g, ' ');
  assert.ok(
    print.includes(
      '.ag .ag-capsule :is(button, .ag-orn--capsule:not([hidden])) { display: none; }',
    ),
  );
  assert.ok(print.includes('.ag .ag-capsule .ag-capsule__index--plain { display: inline-flex; }'));
  assert.ok(!print.includes(':is(button, .ag-capsule__index) { display: none; }'));
});

// The default recipe's reduced-motion cells (543045b7d): a note inside Pause, aria-hidden, was
// visible text outside its name (axe's label-content-name-mismatch). The note is plain text right
// after the button, its description, hidden while live, shown only where its Pause is, and not printed.
test('a still Pause’s note is plain text after it, its description, where its Pause is', () => {
  const css = readFileSync(
    path.join(REPO_ROOT, 'packages/variant-aurora-glass/src/styles.css'),
    'utf8',
  );
  const tsx = readFileSync(
    path.join(REPO_ROOT, 'packages/variant-aurora-glass/src/chrome/ornament.tsx'),
    'utf8',
  );
  assert.match(
    tsx,
    /<\/button>\s*\{\/\*[\s\S]*?\*\/\}\s*<span className="ag-orn__held" id=\{held\} data-ag-held="" hidden \/>/,
  );
  assert.doesNotMatch(tsx, /aria-label="Pause the sky"/);
  assert.doesNotMatch(tsx, /ag-orn__held"[^>]*aria-hidden/);
  const flat = css.replace(/\s+/g, ' ');
  assert.ok(flat.includes('.ag-capsule .ag-orn__held { display: none;'));
  assert.ok(flat.includes('.ag-capsule .ag-orn__held:not([hidden]) { display: inline-flex; }'));
  assert.ok(flat.includes('.ag-ornament .ag-orn__held { display: none; }'));
  assert.ok(flat.includes('.ag-orn__held[hidden] { display: none; }'));
  const print = flat.slice(flat.indexOf('@media print {'));
  assert.ok(print.includes('.ag .ag-capsule .ag-orn__held:not([hidden]) { display: none; }'));
});

// D's 1024 still shot (e19b657b9): "held" sat hard on the capsule's end. Its inline padding is the
// capsule items' own, the same token, not a value of its own. And it hangs below the row, under its
// Pause, not in it (row 150, the coordinator's (a)): in the row it widened it, so under reduced
// motion the capsule and the ornament no longer fitted at the 64em fold.
test('a still Pause’s note hangs below the row, on the capsule items’ own padding', () => {
  const css = readFileSync(
    path.join(REPO_ROOT, 'packages/variant-aurora-glass/src/styles.css'),
    'utf8',
  ).replace(/\s+/g, ' ');
  const items = css.indexOf(
    ':is(.ag-capsule__dest a, .ag-capsule__index, .ag-capsule__cta, .ag-orn) {',
  );
  assert.ok(items >= 0);
  const token = /padding-inline: ([^;]+);/.exec(css.slice(items, css.indexOf('}', items)))?.[1];
  assert.equal(token, 'var(--space-s)');
  const held = /\[data-variant='aurora-glass'\] \.ag-orn__held \{([^}]*)\}/.exec(css)?.[1] ?? '';
  assert.ok(held.includes(`padding-inline: ${token};`), held);
  assert.ok(held.includes('position: absolute;'), held);
  assert.ok(held.includes('inset-block-start: calc(100% + var(--space-2xs));'), held);
  assert.ok(css.includes('.ag-ornament { position: relative; }'));
  assert.ok(css.includes('.ag-ornament .ag-orn__held { inset-inline-start: 0; }'));
  assert.ok(css.includes('.ag-capsule .ag-orn__held { display: none; inset-inline-end: 0; }'));
});

// The default recipe's 390 print cell (49826dc90): the capsule ran off the sheet on one row, the
// name past one edge and the Index past the other, and its link printed both words. On paper the
// head wraps and the link prints Index alone.
test('on paper the capsule wraps to the sheet and its link reads Index', () => {
  const css = readFileSync(
    path.join(REPO_ROOT, 'packages/variant-aurora-glass/src/styles.css'),
    'utf8',
  );
  const print = css.slice(css.indexOf('@media print {')).replace(/\s+/g, ' ');
  assert.ok(print.includes(':is(.ag-capsule, .ag-capsule__dest) { flex-wrap: wrap; }'));
  assert.ok(print.includes('.ag-capsule .ag-narrow { display: none; }'));
  assert.ok(print.includes('.ag-capsule .ag-wide { display: inline; }'));
  // The print rule comes after the phone's, so it outweighs the narrow word's display there.
  assert.ok(
    css.indexOf('@media print {') >
      css.lastIndexOf('.ag-capsule .ag-narrow {\n    display: inline;'),
  );
});

// The delta shots under forced colors (8c3919e02): an accent-filled action kept its system-colour
// fill and text, and the forced text backplate hid its words. Under forced colors the action is
// the canvas with the text's colour and a ring of it, as a plain control is.
test('under forced colors an accent action is canvas, text and an outline, its words readable', () => {
  const css = readFileSync(
    path.join(REPO_ROOT, 'packages/variant-aurora-glass/src/styles.css'),
    'utf8',
  );
  const forced = [...css.matchAll(/@media \(forced-colors: active\) \{([\s\S]*?)\n\}/g)]
    .map(([, body]) => body)
    .join('\n')
    .replace(/\s+/g, ' ');
  assert.ok(
    forced.includes(
      ':is(.ag-btn, .ag-capsule .ag-capsule__cta) { border: 1px solid currentColor; background-color: var(--color-canvas); color: var(--color-text-primary); }',
    ),
  );
});

// D's delta check of the print shots (8c3919e02): below 75rem the capsule's Pause showed on paper
// ("||" at the right edge), its own rule (.ag-orn--capsule:not([hidden])) outweighing the print
// one; and no surface prints a shadow, the capsule and the actions with them.
test('on paper no capsule control prints, Pause among them, and nothing casts a shadow', () => {
  const css = readFileSync(
    path.join(REPO_ROOT, 'packages/variant-aurora-glass/src/styles.css'),
    'utf8',
  );
  const print = css.slice(css.indexOf('@media print {')).replace(/\s+/g, ' ');
  assert.ok(
    print.includes(
      '.ag .ag-capsule :is(button, .ag-orn--capsule:not([hidden])) { display: none; }',
    ),
  );
  assert.ok(
    print.includes(
      ':is( .ag-pane, .ag-lite, .ag-sheet, .ag-call, .ag-offer, .ag-band__pane, .ag-capsule, .ag-btn, .ag-orn ) { box-shadow: none; background-image: none; }',
    ),
  );
});
