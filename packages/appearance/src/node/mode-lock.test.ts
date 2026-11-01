import test from 'node:test';
import assert from 'node:assert/strict';
import { shippingSchemeSets } from '../test-support/packs';
import { compileSchemeStylesheet } from './compile';

// The packs plan's mode-lock check (§5.2): a single-mode scheme, such as
// liquid-dusk (dark) or poster-primaries (light), renders its native set in
// every display mode on screen, and its native high-contrast set under
// high contrast. Print stays light, as for every scheme.

/** The first rule of `css` whose selector list holds `selector` exactly, as its declarations. */
function firstRule(css: string, selector: string): string {
  for (const [, selectors, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (selectors!.split(',').some((each) => each.trim() === selector)) return body!;
  }
  assert.fail(`no rule for ${selector}`);
}

const canvas = (body: string) => /--color-canvas:\s*([^;]+);/.exec(body)?.[1];

test('a single-mode scheme renders its native set in every display mode, and print stays light', () => {
  const locked = shippingSchemeSets().filter(({ manifest }) => manifest.lockedMode);
  for (const id of ['liquid-dusk', 'poster-primaries'])
    assert.ok(
      locked.some((each) => each.id === id),
      `${id} is single-mode`,
    );
  for (const { id, manifest, sets } of locked) {
    const native = manifest.lockedMode!;
    const other = native === 'light' ? 'dark' : 'light';
    assert.equal(sets[other], undefined, `${id} has no ${other} set`);
    const css = compileSchemeStylesheet(id, sets);
    const [screen] = css.split(/\n\s*@media print/);
    for (const [, scheme] of screen!.matchAll(/color-scheme:\s*([a-z]+);/g)) {
      assert.equal(scheme, native, `${id} renders ${native} on screen`);
    }
    const mode = (value: string) => `[data-color-scheme="${id}"][data-display-mode="${value}"]`;
    for (const value of ['light', 'dark', 'system']) {
      assert.equal(canvas(firstRule(css, mode(value))), sets[native]!.canvas, `${id} ${value}`);
    }
    assert.equal(
      canvas(firstRule(css, mode('high-contrast'))),
      sets[`high-contrast-${native}`]!.canvas,
      `${id} high-contrast`,
    );
    assert.ok(/@media print \{[^@]*color-scheme: light;/.test(css), `${id} prints light`);
  }
});
