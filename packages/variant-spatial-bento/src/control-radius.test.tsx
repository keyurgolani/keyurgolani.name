import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// A design language's control radius shapes controls, never Spatial Bento's
// tiles (LANG-5c round 2, lead A's ruling). Material 3's full 999px control
// corner once turned the dense tiles into stadiums and an ellipse, and the
// album covers, talk tickets, and stage wells into pills, because those rules
// read --ui-radius-control. A tile takes the card radius (or the overlay's,
// when large) and an image or well the media radius; only the controls read
// the control radius: the buttons and the dock's links.

const CSS = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');

/** The controls that may read --ui-radius-control. */
const CONTROLS = [
  "[data-variant='spatial-bento'] .sb-btn",
  "[data-variant='spatial-bento'] .sb-dock a",
];

/** Every rule's selectors and declarations, nested rules flattened, comments dropped. */
function rules(css: string): { selectors: string[]; body: string }[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  return [...text.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selectors, body]) => ({
    selectors: selectors!
      .split(',')
      .map((selector) => selector.trim().replace(/\s+/g, ' '))
      .filter(Boolean),
    body: body!,
  }));
}

/** The selectors of the rules that read the control radius. */
function controlRadiusReaders(css: string): string[] {
  return rules(css)
    .filter(({ body }) => /var\(--ui-radius-control\)/.test(body))
    .flatMap(({ selectors }) => selectors);
}

test("only Spatial Bento's controls read the language's control radius; no tile, image, or well does", () => {
  const readers = controlRadiusReaders(CSS);
  assert.ok(readers.length > 0, 'the controls read it');
  assert.deepEqual(
    readers.filter((selector) => !CONTROLS.includes(selector)),
    [],
    'a rule outside the controls reads --ui-radius-control',
  );
  // The tiles' own corners come from the card and overlay radii.
  const tile = rules(CSS).filter(({ selectors }) =>
    selectors.some((selector) => /\.sb-tile(?:--dense|--large)?$/.test(selector)),
  );
  assert.ok(tile.some(({ body }) => /border-radius: var\(--ui-radius-card\)/.test(body)));
});

test('the control-radius reader catches a tile pointed back at the control radius', () => {
  const planted = `${CSS}\n[data-variant='spatial-bento'] .sb-tile--dense { border-radius: var(--ui-radius-control); }\n`;
  assert.deepEqual(
    controlRadiusReaders(planted).filter((selector) => !CONTROLS.includes(selector)),
    ["[data-variant='spatial-bento'] .sb-tile--dense"],
  );
});
