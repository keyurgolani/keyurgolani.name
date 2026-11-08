// Row 25's quiet wait against Flux's own chain (row25-quiet-rc2-hardening, part 1; lead A, 11-08):
// the contrast sampler reads a word's color again once its ancestors' attributes have held still
// QUIET_MS, so every gap between two steps of a page's chain must sit inside it, or the window
// closes between steps on any host. Inside it is enough while each step is a timer (lead A, 11-08):
// a step due before the wait would close fires first under any load, since a busy main thread holds
// up the page's timers and the wait's ticks alike and timers keep their order (part 1's load model,
// which two runs couldn't red). Flux's snap and each word's turn are setTimeouts at those durations
// (tabs.ts place() and setDrop()), never transitionend, animationend or frames. Flux's tab chain spaces its steps by its drop's transitions
// (enhancements/tabs.ts): the snap at max(160 ms, the stretch's duration), and each word's turn
// within the snap's own, `--motion-feedback` and 1.5 times it (styles.css). `--motion-feedback`
// resolves to min(the composition's --layout-motion-feedback, the language's fast duration x
// STILL_FACTOR), so the slot as set bounds it on every pack.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { QUIET_MS } from './a11y/contrast';

const read = (file: string) => readFileSync(new URL(`../../../${file}`, import.meta.url), 'utf8');

test("Flux's tab chain spaces its steps inside the sampler's quiet window, each a timer, on every pack", () => {
  const css = read('packages/variant-flux/src/styles.css');
  const tabs = read('packages/variant-flux/src/enhancements/tabs.ts');
  const slot = /--layout-motion-feedback:\s*(\d+)ms;/.exec(css);
  assert.ok(slot, "Flux's styles.css sets --layout-motion-feedback in ms");
  const feedback = Number(slot[1]);
  const snapTimes = [...css.matchAll(/calc\(var\(--motion-feedback\) \* ([\d.]+)\)/g)].map((m) =>
    Number(m[1]),
  );
  const floor =
    /Math\.max\((\d+), durationMs\(getComputedStyle\(drop\)\.transitionDuration\)\)/.exec(tabs);
  assert.ok(floor, "tabs.ts snaps at max(<floor>, the drop's transition duration)");
  // Each step a timer, so timer order covers it: the snap and the turns are setTimeouts, and the
  // chain waits on no transition or animation event and counts no frames.
  const chain = tabs.slice(tabs.indexOf('const setDrop = '), tabs.indexOf('const mark = '));
  assert.ok(chain.length > 0, "tabs.ts's setDrop() and place() are where the chain is");
  assert.match(chain, /snap = setTimeout\(/, 'the snap is a setTimeout');
  assert.match(chain, /turns\.push\(\s*setTimeout\(/, "each word's turn is a setTimeout");
  assert.doesNotMatch(
    chain,
    /transitionend|animationend|requestAnimationFrame|\.finished/,
    'the chain waits on no transition or animation event and counts no frames',
  );
  const gaps = {
    'the snap after the stretch': Math.max(Number(floor[1]), feedback),
    "a word's turn after the stretch": feedback,
    ...Object.fromEntries(
      snapTimes.map((times) => [`a word's turn after the snap (x${times})`, feedback * times]),
    ),
  };
  const bar = QUIET_MS;
  const over = Object.entries(gaps).filter(([, ms]) => ms >= bar);
  assert.deepEqual(
    over,
    [],
    `gaps at or over QUIET_MS ${bar} ms: ${over.map(([what, ms]) => `${what} ${ms} ms`).join('; ')}`,
  );
});
