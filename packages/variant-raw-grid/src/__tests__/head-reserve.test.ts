// Raw Grid's header row sticks to the window's top while the window is 32rem tall or more, and
// covers what sits under it. Focus that lands there without scrolling stays under it: at 1440 in
// Accessible Reading two of the index's column headings took focus under the row, with no scroll
// at their stop, since a Tab to a link already inside the window scrolls nothing and a scroll
// margin acts only on a scroll that happens. The manifest reserves the row's room as the root's
// scroll-padding, in the query the row sticks in, so the browser scrolls what Tab reaches clear.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { scrollReservePx } from '@portfolio/variant-contract';

const DIR = path.join(import.meta.dirname, '..', '..');
const MANIFEST = JSON.parse(readFileSync(path.join(DIR, 'manifest.json'), 'utf8')) as {
  contract: string;
  scrollReserve?: { blockStart?: string; blockEnd?: string; media?: string };
};
const CSS = readFileSync(path.join(DIR, 'src', 'styles.css'), 'utf8');

/** The largest space-s, in px: the platform's step s at its widest (20px). */
const SPACE_S_MAX = 20;

test("Raw Grid reserves its stuck header row's room at the window's block start, in the query the row sticks in", () => {
  // The row is static in a window under 32rem tall, so the reserve holds in the rest.
  assert.match(
    CSS,
    /@media \(height < 32rem\) \{\s*\[data-variant='raw-grid'\] \.rg-head \{\s*position: static;\s*\}\s*\}/,
  );
  assert.equal(MANIFEST.contract, '2.1');
  assert.ok(MANIFEST.scrollReserve, 'the manifest declares a scrollReserve');
  assert.equal(MANIFEST.scrollReserve.media, '(min-height: 32rem)');
  assert.equal(MANIFEST.scrollReserve.blockEnd, undefined);
  // The row is its --layout-head tall, at most 3.5rem, and what a link lands on clears it by a
  // space-s: the reserve is both, in rem so it grows with the root's text as the row does.
  const heads = [...CSS.matchAll(/--layout-head: (\d+(?:\.\d+)?)rem;/g)].map((m) => Number(m[1]));
  assert.ok(heads.length > 0, 'the sheet sets --layout-head in rem');
  assert.match(MANIFEST.scrollReserve.blockStart ?? '', /rem\)?$/);
  const px = scrollReservePx(MANIFEST.scrollReserve.blockStart!)!;
  assert.ok(px >= Math.max(...heads) * 16 + SPACE_S_MAX, `${px}px`);
  // The root's padding takes the room, so no scroll margin of the sheet's own adds it again.
  assert.doesNotMatch(CSS, /scroll-margin-block-start/);
});
