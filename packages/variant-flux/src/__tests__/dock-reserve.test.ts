// Flux's dock, fixed at the window's foot on phones, covers what sits under it, and focus
// that lands there without scrolling stays under it. At 390x844 the #stats fold's "More" summary,
// reached with no scroll, sat at 737-783 under the dock at 776.9 (67.1px tall), its focus ring
// with it: its scroll-margin acts only when focus
// scrolls. The manifest reserves the dock's room as the root's scroll-padding, in the same media
// query the dock docks in, so the browser scrolls a control Tab reaches clear of it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { scrollReservePx } from '@portfolio/variant-contract';
import { rulesOf, valueOf } from './css-rules';

const DIR = path.join(import.meta.dirname, '..', '..');
const MANIFEST = JSON.parse(readFileSync(path.join(DIR, 'manifest.json'), 'utf8')) as {
  scrollReserve?: { blockEnd: string; media?: string };
};
const RULES = rulesOf(readFileSync(path.join(DIR, 'src', 'styles.css'), 'utf8'));

test("Flux reserves its phone dock's room at the window's block end, in the query the dock docks in", () => {
  const docked = RULES.filter(
    (rule) =>
      rule.selector === "[data-variant='flux'] .fx-bar" &&
      valueOf(rule.body, 'position') === 'fixed',
  );
  assert.equal(docked.length, 1, 'one rule docks the bar');
  const media = docked[0]!.at.find((at) => at.startsWith('@media '))?.slice('@media '.length);
  assert.ok(MANIFEST.scrollReserve, 'the manifest declares a scrollReserve');
  assert.equal(MANIFEST.scrollReserve.media, media);
  // The dock measured 67.1px at 16px root text (--layout-fx-bar-box), and the summary needs its
  // 4px ring clear of it too: the reserve is the dock and a clearance, in rem so it grows with
  // the root's text as the dock does.
  assert.match(MANIFEST.scrollReserve.blockEnd, /rem$/);
  const px = scrollReservePx(MANIFEST.scrollReserve.blockEnd)!;
  assert.ok(px >= 67.1 + 4 + 8, `${px}px`);
});
