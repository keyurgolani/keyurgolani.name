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
  // Only where the strip shows, below the 900 px window the strip was laid out for.
  assert.match(
    declared(at(".hc[data-view='strip']"), block),
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
