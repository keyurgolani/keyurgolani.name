import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

// What the release matrix found that the pull request's own cells never ran
// (v1.0.1-rc.1's run 45333743595): with the visitor's OS asking for reduced
// motion the boundary stays `full` under respect-os, so a transition keyed on
// `data-motion` alone still moved the Viewed bar; and in print at a phone's
// width the merge bar went, taking its "Approve and merge" text with it.

const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');

/** Each style rule's selector, body and the at-rules around it, comments left out. */
function rules(): { selector: string; body: string; at: readonly string[] }[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const found: { selector: string; body: string; at: readonly string[] }[] = [];
  const open: string[] = [];
  let start = 0;
  for (let at = 0; at < text.length; at += 1) {
    if (text[at] === '{') {
      open.push(text.slice(start, at).trim().replace(/\s+/g, ' '));
      start = at + 1;
    } else if (text[at] === '}') {
      const head = open.pop() ?? '';
      if (!head.startsWith('@'))
        found.push({
          selector: head,
          body: text.slice(start, at),
          at: open.filter((each) => each.startsWith('@')),
        });
      start = at + 1;
    }
  }
  return found;
}

const declares = (body: string, property: string) =>
  [...body.matchAll(new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`, 'g'))].map(([, value]) =>
    value!.trim(),
  );

test("every transition and animation runs only when the visitor's OS asks for no less motion", () => {
  const moving = rules().filter(({ body }) =>
    [...declares(body, 'transition'), ...declares(body, 'animation')].some(
      (value) => value !== 'none',
    ),
  );
  assert.ok(moving.length >= 3, 'the Viewed bar, the fold chevron and the branch joining main');
  for (const { selector, at } of moving)
    assert.ok(
      at.includes('@media (prefers-reduced-motion: no-preference)'),
      `${selector} moves outside @media (prefers-reduced-motion: no-preference)`,
    );
});

test('a reduced or static boundary stops every transition, the fold chevron included', () => {
  const stops = rules().filter(
    ({ selector, body }) =>
      /\[data-motion='reduced'\]/.test(selector) && declares(body, 'transition').includes('none'),
  );
  const selectors = stops.map(({ selector }) => selector).join(', ');
  for (const part of ['.pr-branch__join', '.pr-prog i', '.pr-fold::before'])
    assert.ok(selectors.includes(part), `${part} is stopped`);
  // A pseudo-element inside :is() matches nothing, so it stops nothing.
  for (const { selector } of stops) assert.doesNotMatch(selector, /:is\([^)]*::/, selector);
});

test("in print the phone's merge bar stays, in the page's flow, so Approve and merge is on paper", () => {
  const print = rules().filter(({ at }) => at.includes('@media print'));
  const bar = print.filter(({ selector }) => /\.pr-bar\b/.test(selector));
  assert.ok(
    bar.every(({ body }) => !declares(body, 'display').includes('none')),
    'print hides no merge bar',
  );
  assert.ok(
    bar.some(({ body }) => declares(body, 'position').includes('static')),
    'print puts the bar in the flow',
  );
});
