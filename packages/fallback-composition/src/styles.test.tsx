import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

// The destinations' target floor (WCAG 2.2 AA, 2.5.8) is the platform's:
// the links are #19's navigation primitive (#19, Slice 4), which the
// platform stylesheet sizes, 24 by 24 CSS px and 32 by 32 at 768 px and
// below. The composition only spaces and shows them, so nothing here can
// undercut it, at any width.
const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');

/** Each style rule's selector and body, inside a media query or not, comments left out. */
function rules(): { selector: string; body: string }[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const found: { selector: string; body: string }[] = [];
  const open: string[] = [];
  let start = 0;
  for (let at = 0; at < text.length; at += 1) {
    if (text[at] === '{') {
      open.push(text.slice(start, at).trim());
      start = at + 1;
    } else if (text[at] === '}') {
      const head = open.pop() ?? '';
      if (!head.startsWith('@')) found.push({ selector: head, body: text.slice(start, at) });
      start = at + 1;
    }
  }
  return found;
}

test("the destinations are the navigation primitive's, and the composition sets no size on one", () => {
  const all = rules();
  assert.ok(all.length > 0);
  const nav = all.filter(({ selector }) => selector.includes('.fc-destinations'));
  assert.ok(nav.length > 0);
  for (const { selector, body } of nav) {
    // The list's spacing and whether it shows, nothing more.
    assert.doesNotMatch(body, /(?:min-|max-)?(?:block|inline)-size|height|width|padding/, selector);
  }
  for (const { selector, body } of all) {
    // The primitive's slots; the Menu's plain link isn't one.
    if (!/navigation\.|\.fc-(?:nav|destinations)\b.*\ba\b/.test(selector)) continue;
    assert.doesNotMatch(body, /(?:min-|max-)?(?:block|inline)-size|height|width|padding/, selector);
  }
});

test('every margin, padding, and gap is a shared space step, never a literal length', () => {
  for (const { selector, body } of rules()) {
    for (const [, property, value] of body.matchAll(/([a-z-]+)\s*:\s*([^;]+)/g)) {
      if (!/margin|padding|gap/.test(property!)) continue;
      for (const length of value!.match(/-?\d*\.?\d+(?:px|rem|em|vw|vh|%)/g) ?? []) {
        assert.fail(`${selector} ${property}: ${length} is a literal, not a --space-* step`);
      }
    }
  }
});
