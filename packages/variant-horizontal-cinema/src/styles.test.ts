import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Horizontal Cinema's stylesheet, read as rules: the phone's spacing, where a review measured
// it short (HOR-4, HOR-5).

/** Every rule of the stylesheet, comments gone. */
const CSS = readFileSync(new URL('./styles.css', import.meta.url), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
);

/** Each `@media <query> {` block's text, to its closing brace at column 0. */
const blocks = (query: string): string[] => {
  const found: string[] = [];
  for (let at = CSS.indexOf(`@media ${query} {`); at >= 0;) {
    const end = CSS.indexOf('\n}\n', at);
    found.push(CSS.slice(at, end));
    at = CSS.indexOf(`@media ${query} {`, end);
  }
  return found;
};

/** The declarations of every rule whose selector is exactly `selector`, in `within`, joined. */
const declared = (selector: string, within: string): string =>
  [...within.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(([, head]) => head!.trim().replace(/\s+/g, ' ') === selector)
    .map(([, , body]) => body)
    .join('');

const PHONE = '(max-width: 47.99rem)';
const at = (selector: string) => `[data-variant='horizontal-cinema'] ${selector}`;

test('on a phone the title card’s tagline band keeps space under it, with no bottom bar to give it (HOR-4)', () => {
  const phone = blocks(PHONE).join('\n');
  assert.match(declared(at('.hc-shell .hc-bar--bottom'), phone), /display: none;/);
  assert.match(declared(at('.hc-card__subtitles'), phone), /padding-block-end: var\(--space-l\);/);
});

test('on a phone the full record’s rows have room around and between their lines, on the scenes’ inset (HOR-5)', () => {
  const phone = blocks(PHONE).join('\n');
  const row = declared(at('.hc-record__summary'), phone);
  assert.match(row, /padding-block: var\(--space-xs\);/);
  assert.match(row, /gap: var\(--space-3xs\) var\(--space-s\);/);
  assert.doesNotMatch(row, /padding-block: 0;|row-gap: 0;/);
  assert.match(
    declared(at('.hc-record'), phone),
    /padding-inline: calc\(var\(--layout-inset\) \+ var\(--layout-pad\)\);/,
  );
});

test('on a laptop’s short window the strip steps its spacing down and widens two-section scenes, never its type (HOR-1)', () => {
  const short = blocks(
    '(min-width: 64rem) and (min-height: 44rem) and (max-height: 56rem) and (hover: hover) and (pointer: fine)',
  );
  assert.equal(short.length, 1);
  const block = short[0]!;
  // Only where the strip shows, below the 900 px window the strip was laid out for: a shell that
  // falls back top to bottom keeps the full top line, so the visitor control's ring clears the top.
  assert.match(
    declared(at(".hc[data-view='strip']:not(:has(.hc-shell[data-fit='over']))"), block),
    /--layout-pad-block: var\(--space-2xs\);/,
  );
  assert.match(block, /\[data-w='8'\]:has\(\.hc-section \+ \.hc-section\) \{\s*--layout-cols: 10;/);
  assert.match(block, /grid-column: span 5;/);
  // Spacing alone: no size, line height, or face changes, so every scene keeps its words as set.
  assert.doesNotMatch(block, /font-size|line-height|font-family|--type-/);
});

test('a scene that still overflows in a wider face opens a width wider, never shrinking its type', () => {
  const strip = blocks(
    '(min-width: 64rem) and (min-height: 44rem) and (hover: hover) and (pointer: fine)',
  ).join('\n');
  const room = (scene: string) =>
    declared(
      at(`.hc[data-view='strip'] .hc-shell:not([data-fit='over']) .hc-scene[data-room]${scene}`),
      strip,
    );
  assert.match(room("[data-w='4']"), /--layout-cols: 6;/);
  assert.match(room("[data-w='6']"), /--layout-cols: 8;/);
  // Eight columns, or the laptop's ten for two sections, open to the full twelve, a half each.
  assert.ok(strip.includes(".hc-scene[data-room][data-w='8'],"));
  assert.match(
    strip,
    /\.hc-scene\[data-room\]\[data-kind='sections'\]\[data-w='8'\]:has\(\.hc-section \+ \.hc-section\) \{\s*--layout-cols: 12;/,
  );
  assert.match(
    strip,
    /\.hc-scene\[data-room\]\[data-kind='sections'\]\[data-w='8'\]\s*\.hc-pic\s*> :is\(\.hc-section \+ \.hc-section, \.hc-section:has\(\+ \.hc-section\)\) \{\s*grid-column: span 6;/,
  );
  // A full-width signature work gives its words a column of its still's.
  assert.match(
    room(' .hc-lead'),
    /'still still still still still still \. words words words words words'/,
  );
  // Room alone: no rule keyed to it sets a size, line height, or face.
  for (const [, head, body] of strip.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (head!.includes('[data-room]'))
      assert.doesNotMatch(body!, /font-size|line-height|font-family|--type-|zoom|scale/);
  }
});

test('the stage, the top line’s links, and a folded scene’s title ring where nothing covers or clips them', () => {
  // The stage's ring is the frame's, over the stage's row, above its scenes.
  const ring = declared(at('.hc-frame:has(> .hc-stage:focus-visible)::after'), CSS);
  assert.match(ring, /grid-row: 1;/);
  assert.match(ring, /z-index: 1;/);
  assert.match(ring, /border: var\(--ui-focus-width\) solid var\(--color-focus\);/);
  assert.match(declared(at('.hc-frame'), CSS), /grid-template-columns: minmax\(0, 1fr\);/);
  // The top line's links ring in the matte's ink, over the platform's ring, at its width and offset.
  const chrome = declared(
    at(':is(.hc-chrome__name, .hc-chrome__nav a):focus-visible::before'),
    CSS,
  );
  assert.match(chrome, /border: var\(--ui-focus-width\) solid var\(--color-on-scrim\);/);
  assert.match(
    chrome,
    /inset: calc\(\(var\(--ui-focus-width\) \+ var\(--ui-focus-offset\)\) \* -1\);/,
  );
  // On a phone a folded scene's title keeps its ring's room inside the scene's clip.
  const summary = declared(at('.hc-fold__summary'), blocks(PHONE).join('\n'));
  assert.match(summary, /margin-inline: var\(--layout-ring\);/);
  assert.match(summary, /margin-block-end: var\(--layout-ring\);/);
});

test('a scene’s words arrive by moving alone, never dimmed, so a frame off screen keeps its contrast', () => {
  const arrive = CSS.slice(CSS.indexOf('@keyframes horizontal-cinema-arrive'));
  const body = arrive.slice(0, arrive.indexOf('\n}\n'));
  assert.match(body, /transform: translateX\(var\(--layout-arrive\)\);/);
  assert.doesNotMatch(body, /opacity|filter/);
});
