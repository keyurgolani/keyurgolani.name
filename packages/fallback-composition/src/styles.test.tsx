import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

// The section links' target floor (WCAG 2.2 AA, 2.5.8), pinned here until
// #11's quality gate measures it in a browser.
const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');

function rule(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  assert.notEqual(start, -1, `styles.css has no ${selector} rule`);
  return css.slice(start, css.indexOf('}', start));
}

test('every section link is at least 24 by 24 CSS px, its label centered', () => {
  const links = rule("[data-variant='fallback'] .fc-nav a");
  assert.match(links, /min-block-size: 1\.5rem;/);
  assert.match(links, /min-inline-size: 1\.5rem;/);
  assert.match(links, /display: inline-flex;/);
  assert.match(links, /align-items: center;/);
  assert.match(links, /justify-content: center;/);
});
