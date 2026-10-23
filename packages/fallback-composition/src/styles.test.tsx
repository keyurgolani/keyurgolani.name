import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

// The section links' target floor (WCAG 2.2 AA, 2.5.8) is the platform's:
// the links are #19's navigation primitive (#19, Slice 4), which the
// platform stylesheet sizes, 24 by 24 CSS px and 32 by 32 at 768 px and
// below. The composition only spaces them, so nothing here can undercut it.
const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');

/** Each rule's selector and body, comments left out. */
function rules(): { selector: string; body: string }[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  return [...text.matchAll(/([^{}]+)\{([^}]*)\}/g)].map(([, selector, body]) => ({
    selector: selector!.trim(),
    body: body!,
  }));
}

test("the section links are the navigation primitive's, and the composition sets no size on one", () => {
  const nav = rules().filter(({ selector }) => selector.includes('.fc-nav'));
  assert.deepEqual(
    nav.map(({ selector }) => selector),
    ["[data-variant='fallback'] .fc-nav [data-ui-slot='navigation.list']"],
  );
  for (const { selector, body } of rules()) {
    if (!/navigation|\.fc-nav\b.*\ba\b/.test(selector)) continue;
    assert.doesNotMatch(body, /(?:min-|max-)?(?:block|inline)-size|height|width|padding/, selector);
  }
});
