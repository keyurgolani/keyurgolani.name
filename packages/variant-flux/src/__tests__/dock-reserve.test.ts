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
  // A control focus reaches already in view rests wherever the reserve lets it stand, so the
  // reserve holds the tallest dock and the widest ring, and 1px more. The dock measured 67.1px at
  // 16px root text (--layout-fx-bar-box); under more contrast it stands taller, by language: 99.1px
  // on Material Expressive, 95.1px on Claymorphic, 93.1px on Art Deco, 89.1px on Blueprint. The
  // widest ring reaches 8px (Art Deco). In rem, so it grows with the root's text as the dock does.
  assert.match(MANIFEST.scrollReserve.blockEnd, /rem$/);
  const px = scrollReservePx(MANIFEST.scrollReserve.blockEnd)!;
  assert.ok(px >= 99.1 + 8 + 1, `${px}px`);
});

test("a control Tab brings up from below a phone's dock stops clear of it by the dock, the ring's reach and more", () => {
  const margins = RULES.filter(
    (rule) =>
      rule.selector === "[data-variant='flux'] :is(a, button, summary)" &&
      valueOf(rule.body, 'scroll-margin-block-end') !== undefined,
  );
  assert.equal(margins.length, 1, "one rule sets the controls' scroll margin");
  const margin = valueOf(margins[0]!.body, 'scroll-margin-block-end')!.replace(/\s+/g, ' ');
  // The dock's token, then the ring's offset and width on top of the space the token leaves, which
  // the dock's own growth under more contrast takes up.
  for (const term of [
    '--layout-fx-bar-box',
    '--ui-focus-offset',
    '--ui-focus-width',
    '--space-s',
  ]) {
    assert.match(margin, new RegExp(`var\\(${term}\\)`), term);
  }
});
