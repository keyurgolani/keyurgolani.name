import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { appearanceCatalog } from '~/server/studio-appearance';
import { heldLine } from '~/lib/studio/compare';
import { CompareBar, CompareGrid, CompareSide, CompareWipe } from './compare';

// tsx compiles the variant packages' JSX, their Studio thumbnails included, to
// React.createElement calls, so the test supplies React, as pickers.test.tsx does.
Object.assign(globalThis, { React });

const CATALOG = appearanceCatalog();
const A = {
  variant: 'editorial-evidence',
  colorScheme: 'warm-parchment',
  typography: 'humanist-ui',
  designLanguage: 'platform-neutral',
  displayMode: 'system',
} as const;
const none = () => {};

test("Compare's bar names each difference as A vs B, and says everything else matches", () => {
  const html = renderToStaticMarkup(
    <CompareBar
      catalog={CATALOG}
      a={A}
      b={{ ...A, variant: 'kinetic-cosmos' }}
      mode="side"
      onMode={none}
      readable={false}
      onReadable={none}
      onSwap={none}
      onStop={none}
    />,
  );
  assert.match(html, /<strong>1 difference<\/strong>/);
  assert.match(html, /Composition: Editorial Evidence vs Kinetic Cosmos/);
  assert.match(html, /Everything else matches\./);
  assert.match(html, />Swap A and B</);
  assert.match(html, />Stop comparing</);
  assert.match(html, /aria-pressed="false"[^>]*>Readable 1024</);
  const same = renderToStaticMarkup(
    <CompareBar
      catalog={CATALOG}
      a={A}
      b={A}
      mode="grid"
      onMode={none}
      readable={false}
      onReadable={none}
      onSwap={none}
      onStop={none}
    />,
  );
  assert.match(same, /No differences yet/);
  assert.doesNotMatch(same, /Readable 1024/, 'the grid has no frame to read');
});

test('side by side is two panes headed A Pinned and B Editing, each its own fit room', () => {
  const html = renderToStaticMarkup(
    <CompareSide frameA={<iframe title="a" />} frameB={<iframe title="b" />} onBackToA={none} />,
  );
  assert.equal((html.match(/data-fit-room="true"/g) ?? []).length, 2);
  assert.match(html, /aria-label="A, pinned"[\s\S]*Go back to A/);
  assert.match(html, /aria-label="B, editing"[\s\S]*The controls change this one/);
  assert.equal((html.match(/<iframe/g) ?? []).length, 2);
});

test('the wipe is a slider over both frames, the grid draws stills with no frame', () => {
  const wipe = renderToStaticMarkup(
    <CompareWipe frameA={<iframe title="a" />} frameB={<iframe title="b" />} at={30} onAt={none} />,
  );
  assert.match(
    wipe,
    /role="slider" tabindex="0" aria-label="Wipe between A and B" aria-valuemin="0" aria-valuemax="100" aria-valuenow="30" aria-valuetext="30% A, 70% B"/,
  );
  assert.match(wipe, /--wipe:30%/);
  const grid = renderToStaticMarkup(
    <CompareGrid
      catalog={CATALOG}
      a={A}
      b={A}
      vary="variant"
      onVary={none}
      onUse={none}
      onPin={none}
    />,
  );
  assert.doesNotMatch(grid, /<iframe/);
  // The grid of four: A and three, each but A with Use this and Pin as A, and the
  // rest of the compositions a page away, never a fifth plate on its own.
  assert.equal((grid.match(/class="studio-plate"/g) ?? []).length, 4);
  assert.equal((grid.match(/aria-label="Use this: make B [^"]+"[^>]*>Use this</g) ?? []).length, 3);
  assert.equal((grid.match(/aria-label="Pin as A: [^"]+"[^>]*>Pin as A</g) ?? []).length, 3);
  assert.equal(
    (grid.match(/class="studio-compare__tag">[^<]*</g) ?? []).join(),
    'class="studio-compare__tag">A<',
    'A alone wears a letter',
  );
  // Every poster is the composition's drawing in the plate's palette, never a committed still,
  // which is the v1 fixture with its slot names (P0-2a).
  assert.doesNotMatch(grid, /<img/);
  assert.equal((grid.match(/<svg class="studio-thumb"/g) ?? []).length, 4);
  // A plate's head is its name and actions: no language specimen, which read as a blob (DEM-3).
  assert.doesNotMatch(grid, /studio-plate__language|studio-language/);
  // Only the ready compositions are plates (A2): one still in progress is never a neighbour.
  const compositions = CATALOG.axes
    .find((entry) => entry.axis === 'variant')!
    .options.filter(({ status }) => status !== 'pending').length;
  if (compositions <= 4) assert.doesNotMatch(grid, /studio-compare__pager/);
  if (compositions > 4) {
    assert.match(
      grid,
      new RegExp(
        `Compositions 1 to 3 of ${compositions - 1} besides A<\\/span><button[^>]*>Next 3<`,
      ),
    );
  }
});

const nameOf = (axis: string, id: string) =>
  CATALOG.axes.find((entry) => entry.axis === axis)!.options.find((option) => option.id === id)!
    .name;

/** Each plate's accessible name, its letter if it wears one, and its visible name, in order. */
const platesOf = (html: string) =>
  [...html.matchAll(/<li class="studio-plate"[^>]*aria-label="([^"]*)"[\s\S]*?<\/li>/g)].map(
    ([plate, label]) => {
      const [, tag, shown] =
        /class="studio-plate__name">(?:<span class="studio-compare__tag">([^<]*)<\/span>)?([^<]*)</.exec(
          plate,
        )!;
      return { label: label!, tag: tag ?? null, shown: shown! };
    },
  );

test('Vary: Scheme names each plate by its scheme, only A wears a letter, and none reads B to D (M1)', () => {
  const grid = renderToStaticMarkup(
    <CompareGrid
      catalog={CATALOG}
      a={A}
      b={A}
      vary="colorScheme"
      onVary={none}
      onUse={none}
      onPin={none}
      live={(selection, _heavy, name) => <iframe title={`${name}: ${selection.colorScheme}`} />}
    />,
  );
  const plates = platesOf(grid);
  assert.equal(plates.length, 4);
  // A is Compare's A, so it keeps the letter; the others are their scheme's name and no more.
  assert.deepEqual(
    plates.map(({ tag }) => tag),
    ['A', null, null, null],
  );
  assert.equal(plates[0]!.shown, nameOf('colorScheme', A.colorScheme));
  assert.equal(plates[0]!.label, `A, pinned: ${plates[0]!.shown}`);
  for (const plate of plates) {
    assert.doesNotMatch(plate.label, /^[A-D]$/);
    assert.doesNotMatch(plate.shown, /^[A-D]$/);
    assert.notEqual(plate.shown, '');
  }
  for (const plate of plates.slice(1)) {
    assert.equal(plate.label, plate.shown, 'the accessible name says what the plate shows');
  }
  assert.equal(new Set(plates.map(({ shown }) => shown)).size, 4);
  assert.doesNotMatch(grid, /class="studio-compare__tag">[B-D]</);
});

test('the grid pages by Next 3, never "+30", named by its visible text and described by where it is (M3, WCAG 2.5.3)', () => {
  const grid = renderToStaticMarkup(
    <CompareGrid
      catalog={CATALOG}
      a={A}
      b={A}
      vary="colorScheme"
      onVary={none}
      onUse={none}
      onPin={none}
    />,
  );
  const others =
    CATALOG.axes
      .find((entry) => entry.axis === 'colorScheme')!
      .options.filter(({ status }) => status !== 'pending').length - 1;
  assert.ok(others > 3, 'the build offers more schemes than a page holds');
  const pager = new RegExp(
    `<span id="([^"]+)" class="studio-compare__position">Schemes 1 to 3 of ${others} besides A</span><button type="button" class="studio-barbutton" aria-describedby="([^"]+)">Next 3</button>`,
  ).exec(grid);
  assert.ok(pager, 'Next 3, described by the position line');
  assert.equal(pager[1], pager[2], 'the button points at its own position line');
  // No aria-label: the name is the visible text, so speech input can say what it sees.
  assert.doesNotMatch(grid, /<button[^>]*aria-label="Show/);
  assert.doesNotMatch(grid, />\+\d+</);
});

test('in the grid the bar names what every plate keeps of A, for the axis Vary picks, in place of A vs B (M1)', () => {
  const bar = (vary: 'variant' | 'colorScheme' | 'typography' | 'designLanguage') =>
    renderToStaticMarkup(
      <CompareBar
        catalog={CATALOG}
        a={A}
        b={{ ...A, variant: 'obsidian-atelier', colorScheme: 'neutral-slate' }}
        mode="grid"
        vary={vary}
        onMode={none}
        readable={false}
        onReadable={none}
        onSwap={none}
        onStop={none}
      />,
    );
  const scheme = bar('colorScheme');
  assert.match(
    scheme,
    /<p class="studio-compare__summary studio-compare__held">Varying the color scheme\. Every plate keeps A&#x27;s Editorial Evidence, Humanist UI, Platform Neutral and System mode\.<\/p>/,
  );
  // A against B describes a pair the grid doesn't show, so it goes; the tools stay.
  assert.doesNotMatch(scheme, /differences?</);
  assert.doesNotMatch(scheme, / vs /);
  assert.match(scheme, /aria-label="Compare layout"/);
  assert.match(scheme, />Swap A and B</);
  assert.match(scheme, />Stop comparing</);
  // Each Vary axis words itself, and the held picks are A's on the others, the mode last.
  assert.match(
    bar('variant'),
    /Varying the composition\. Every plate keeps A&#x27;s Warm Parchment, Humanist UI, Platform Neutral and System mode\./,
  );
  assert.match(
    bar('typography'),
    /Varying the typography\. Every plate keeps A&#x27;s Editorial Evidence, Warm Parchment, Platform Neutral and System mode\./,
  );
  assert.equal(
    heldLine(CATALOG, { ...A, displayMode: 'dark' }, 'designLanguage'),
    `Varying the design language. Every plate keeps A's ${nameOf('variant', A.variant)}, ${nameOf('colorScheme', A.colorScheme)}, ${nameOf('typography', A.typography)} and Dark mode.`,
  );
  // Side by side still says A against B.
  const side = renderToStaticMarkup(
    <CompareBar
      catalog={CATALOG}
      a={A}
      b={{ ...A, colorScheme: 'neutral-slate' }}
      mode="side"
      vary="colorScheme"
      onMode={none}
      readable={false}
      onReadable={none}
      onSwap={none}
      onStop={none}
    />,
  );
  assert.match(side, /<strong>1 difference<\/strong>/);
  assert.doesNotMatch(side, /Every plate keeps/);
});

test("Use this makes B the plate's whole selection, so its name says every pick that moves (M2)", () => {
  const b = { ...A, variant: 'obsidian-atelier' };
  const grid = renderToStaticMarkup(
    <CompareGrid
      catalog={CATALOG}
      a={A}
      b={b}
      vary="colorScheme"
      onVary={none}
      onUse={none}
      onPin={none}
    />,
  );
  // The name starts with the visible "Use this" (WCAG 2.5.3, Label in Name), then says the rest.
  const names = [...grid.matchAll(/aria-label="Use this: make B ([^"]+)"[^>]*>Use this</g)].map(
    ([, name]) => name!,
  );
  const schemes = platesOf(grid)
    .slice(1)
    .map(({ shown }) => shown);
  // Each plate is A's composition in its own scheme, so B moves on both.
  assert.equal(names.length, 3);
  assert.deepEqual(
    names,
    schemes.map((scheme) => `${nameOf('variant', A.variant)} with ${scheme}`),
  );
});

test("at a phone's width the grid's bar says what the A and B flip compares, never what plates keep (OWN-2)", () => {
  const html = renderToStaticMarkup(
    <CompareBar
      catalog={CATALOG}
      a={A}
      b={{ ...A, colorScheme: 'neutral-slate' }}
      mode="grid"
      vary="variant"
      compact
      onMode={none}
      readable={false}
      onReadable={none}
      onSwap={none}
      onStop={none}
    />,
  );
  assert.doesNotMatch(html, /Varying the/);
  assert.doesNotMatch(html, /studio-compare__held/);
  assert.match(html, /<strong>1 difference<\/strong>/);
  assert.match(html, /Everything else matches\. Flip between A and B below\./);
  assert.doesNotMatch(html, /Compare layout/, 'the phone has no layouts to pick');
});

test("a grid plate is its frame's shape, with none of the stage's reserve, so the frame meets its bottom (DEM-3)", () => {
  const css = readFileSync(new URL('../../studio.css', import.meta.url), 'utf8');
  const rule = (selector: string) => {
    const at = css.indexOf(`\n${selector} {`);
    assert.ok(at >= 0, selector);
    return css.slice(at, css.indexOf('}', at));
  };
  const view = rule('.studio-plate__view');
  // The stage keeps 2.75rem for the bar over its frame; inherited, it cut each plate's frame short.
  assert.match(view, /--studio-fit-reserve: 0px;/);
  assert.match(view, /aspect-ratio: 1440 \/ 900;/);
  // The plate as wide as its cell, or as the height under its one-line head allows at 16:10.
  assert.match(
    rule('.studio-plate'),
    /inline-size: min\(100%, calc\(\(50cqb - 0\.5rem - var\(--studio-plate-head\)\) \* 1\.6\)\);/,
  );
  assert.match(rule('.studio-compare__plates'), /container-type: size;/);
  assert.match(rule('.studio-plate__head'), /block-size: var\(--studio-plate-head\);/);
});
