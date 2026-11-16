import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { shadowAbove } from './dock';

// On a phone the dock holds the window's block end, and whatever Tab or a jump brings into view
// stops above it (scroll-margin-block-end). The dock casts the design language's overlay shadow,
// which paints above the dock's box by its blur plus its spread less its downward offset, the
// most over its outer layers. Neumorphic's light, -12px -12px 24px in the canvas's colour, washed
// out the foot of a focused control's ring where Tab left it, 36px above the dock. The stop adds an
// allowance for that shadow, in px, on top of the dock's room and a ring's reach and 1px, so every
// pack, shipping or held, must reach no further above its box than the allowance.

const CSS = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
const LANGUAGES = new URL('../../appearance-languages/', import.meta.url);

/** A box-shadow's layers, split on its top-level commas. */
function layers(value: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let at = '';
  for (const char of value) {
    if (char === '(') depth += 1;
    if (char === ')') depth -= 1;
    if (char === ',' && depth === 0) {
      out.push(at.trim());
      at = '';
    } else at += char;
  }
  if (at.trim()) out.push(at.trim());
  return out;
}

/** A layer with its colour functions taken out, nested ones too. */
function withoutFunctions(layer: string): string {
  let out = '';
  let depth = 0;
  for (let i = 0; i < layer.length; i += 1) {
    const char = layer[i]!;
    if (char === '(') {
      depth += 1;
      out = out.replace(/[-\w]+$/, '');
    } else if (char === ')') depth -= 1;
    else if (depth === 0) out += char;
  }
  return out;
}

/**
 * How far a box-shadow paints above its box, in px: its blur plus its spread less its y offset,
 * the most over its outer layers, and never under 0. An inset layer paints inside the box.
 */
function upwardReach(value: string, where: string): number {
  if (value.trim() === 'none') return 0;
  let most = 0;
  for (const layer of layers(value)) {
    const words = withoutFunctions(layer).trim().split(/\s+/).filter(Boolean);
    if (words.includes('inset')) continue;
    const lengths = words
      .filter((word) => /^-?\d*\.?\d+(px)?$/.test(word) || /^-?\d*\.?\d+[a-z%]+$/i.test(word))
      .map((word) => {
        const px = /^(-?\d*\.?\d+)(px)?$/.exec(word);
        assert.ok(px, `${where}: ${word} isn't a px length in "${layer}"`);
        assert.ok(px[2] || Number(px[1]) === 0, `${where}: ${word} has no unit in "${layer}"`);
        return Number(px[1]);
      });
    assert.ok(lengths.length >= 2, `${where}: no offsets in "${layer}"`);
    const [, y, blur = 0, spread = 0] = lengths as [number, number, number?, number?];
    most = Math.max(most, blur + spread - y);
  }
  return most;
}

/** The phone's Tab stop, and the allowance in px it adds for the dock's shadow. */
function stop(): { margin: string; allowance: number } {
  const text = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [...text.matchAll(/([^{}]+)\{([^{}]*scroll-margin-block-end[^{}]*)\}/g)].filter(
    ([, selectors]) => /\.sb-footer\) :is\(a\[href\], button, summary, \[id\]\)/.test(selectors!),
  );
  assert.equal(rules.length, 1, 'one rule sets the stop');
  const margin = /scroll-margin-block-end:\s*([^;]+);/
    .exec(rules[0]![2]!)![1]!
    .replace(/\s+/g, ' ')
    .trim();
  const parts =
    /^calc\( ?var\(--ui-control-height\) \+ var\(--space-xl\) \+ (\d*\.?\d+)px \+ var\(--ui-focus-offset\) \+ var\(--ui-focus-width\) \+ 1px ?\)$/.exec(
      margin,
    );
  assert.ok(
    parts,
    `the stop clears the dock, an allowance in px for its shadow, and a ring's reach and 1px: ${margin}`,
  );
  return { margin, allowance: Number(parts[1]) };
}

test('a shadow reaches above its box by its blur and spread less its y offset, inset layers aside', () => {
  const light = 'color-mix(in srgb, var(--color-canvas) 85%, transparent)';
  assert.equal(upwardReach(`-12px -12px 24px ${light}`, 'light'), 36);
  assert.equal(upwardReach(`12px 12px 24px ${light}, -12px -12px 24px ${light}`, 'pair'), 36);
  assert.equal(upwardReach(`0 22px 60px ${light}`, 'glass'), 38);
  assert.equal(upwardReach(`0 32px 64px -32px ${light}`, 'spread in'), 0);
  assert.equal(upwardReach(`inset 0 -40px 80px ${light}, 0 2px 6px ${light}`, 'inset'), 4);
  assert.equal(upwardReach('6px 6px 0 var(--color-accent)', 'hard'), 0);
  assert.equal(upwardReach('none', 'none'), 0);
});

test("every pack's overlay shadow, shipping or held, reaches above the dock no further than Spatial Bento's allowance", () => {
  const most = stop().allowance;
  const over: string[] = [];
  let checked = 0;
  for (const shelf of ['packs', 'held']) {
    const dir = new URL(`${shelf}/`, LANGUAGES);
    for (const id of readdirSync(dir)) {
      const file = new URL(`${id}/manifest.json`, dir);
      if (!existsSync(file)) continue;
      const manifest = JSON.parse(readFileSync(file, 'utf8')) as {
        tokens?: Record<string, string>;
      };
      const shadow = manifest.tokens?.['shadow-overlay'];
      assert.ok(shadow, `${shelf}/${id} has no shadow-overlay`);
      const reach = upwardReach(shadow, `${shelf}/${id}`);
      if (reach > most) over.push(`${shelf}/${id}: ${reach}px above its box, over ${most}px`);
      checked += 1;
    }
  }
  assert.deepEqual(over, []);
  assert.ok(checked > 30, `${checked} packs checked`);
});

test("the phone's Tab stop clears the dock, its shadow's allowance, and a ring's reach and 1px", () => {
  assert.ok(stop().allowance > 0);
});

test("the dock's own lift reads its computed shadow the same way, so a ring Tab leaves in view clears it", () => {
  const dark = 'color(srgb 0.17 0.14 0.11 / 0.18)';
  const light = 'color(srgb 0.96 0.93 0.86 / 0.85)';
  assert.equal(shadowAbove(`${dark} 12px 12px 24px 0px, ${light} -12px -12px 24px 0px`), 36);
  assert.equal(shadowAbove('rgba(43, 36, 28, 0.22) 0px 22px 60px 0px'), 38);
  assert.equal(shadowAbove('rgb(0, 0, 0) 0px 32px 64px -32px'), 0);
  assert.equal(shadowAbove(`${light} 0px -40px 80px 0px inset, ${dark} 0px 2px 6px 0px`), 4);
  assert.equal(shadowAbove('none'), 0);
});
