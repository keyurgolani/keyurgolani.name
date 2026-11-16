import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Text colours in the stylesheet: a data colour is a mark's, with no text target, and some schemes
// set it near the canvas (Poster Primaries' second is 2.49:1 there). No text takes one: the
// figures set large take the accent text, the role every scheme solves to the text target.

const CSS = readFileSync(new URL('./styles.css', import.meta.url), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
);

/** Every rule's selector and its `color` value, the text's own colour (not a border's or ground's). */
function textColours(): { selector: string; value: string }[] {
  const out: { selector: string; value: string }[] = [];
  for (const rule of CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    for (const decl of rule[2]!.matchAll(/(?<![-\w])color\s*:\s*([^;]+)/g))
      out.push({ selector: rule[1]!.trim().replace(/\s+/g, ' '), value: decl[1]!.trim() });
  }
  return out;
}

test('no text takes a data colour', () => {
  const colours = textColours();
  assert.ok(colours.length > 20, 'the stylesheet sets text colours');
  assert.deepEqual(
    colours.filter(({ value }) => /--color-data-/.test(value)),
    [],
  );
});

test("the cover's metric, a chain dimension's value and a certificate's year take the accent text", () => {
  for (const selector of [
    ".sx-note__value[data-type-role='headline']",
    '.sx-chain__value',
    '.sx-cert__year',
  ]) {
    const set = textColours().filter(
      (each) => each.selector === `[data-variant='schematic'] ${selector}`,
    );
    assert.equal(set.length, 1, selector);
    assert.equal(set[0]!.value, 'var(--color-accent-text)', selector);
  }
});
