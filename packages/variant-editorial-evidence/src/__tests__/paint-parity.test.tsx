import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PACKAGE_DIR, REPO_ROOT } from './harness';

// Paint parity (EE-LANG r2 L-4): where EE paints its own element with a Surface's paint, the
// Contents sheet with the overlay Surface's and, in the notes column, a case's fact sheet with the
// subtle Surface's, its layers are the primitive's own, the same colour role, so a change to the
// Surface's stack (a layer added, a token renamed) fails here instead of drifting.

const PRIMITIVES = path.join(
  REPO_ROOT,
  'packages',
  'appearance',
  'src',
  'primitives',
  'styles.css',
);
const V = "[data-variant='editorial-evidence']";

/** `css` without comments, its whitespace collapsed. */
const flat = (css: string) =>
  css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ')
    .replace(/\( /g, '(')
    .replace(/ \)/g, ')');

/** Every value of `property` in the rules whose whole selector is `selector`. */
function declared(css: string, selector: string, property: string): string[] {
  const text = flat(css);
  const values: string[] = [];
  let from = 0;
  for (;;) {
    const at = text.indexOf(`${selector} {`, from);
    if (at < 0) break;
    // The selector must start the rule: the text before it ends a block or a prelude.
    const before = text.slice(0, at).trimEnd();
    from = at + selector.length;
    if (before !== '' && !/[{};]$/.test(before)) continue;
    const body = text.slice(text.indexOf('{', at) + 1, text.indexOf('}', at));
    const match = new RegExp(`(?:^|;)\\s*${property}:\\s*([^;]+)`).exec(body);
    if (match) values.push(match[1]!.trim());
  }
  return values;
}

/**
 * What keeps EE's `selector` from painting the `emphasis` Surface's own stack, given both
 * stylesheets: each side must set `background-image` exactly once, the primitive's stack must name
 * its colour role and the language's layers, and EE's must be the same stack. Empty when it holds.
 */
export function parity(
  eeCss: string,
  primitivesCss: string,
  selector: string,
  emphasis: 'overlay' | 'subtle',
): string[] {
  const surfaceSelector = `[data-ui-slot='surface'][data-emphasis='${emphasis}']`;
  const surfaces = declared(primitivesCss, surfaceSelector, 'background-image');
  const own = declared(eeCss, selector, 'background-image');
  const problems: string[] = [];
  if (surfaces.length !== 1) {
    problems.push(`${surfaceSelector} sets background-image ${surfaces.length} times, not once`);
  }
  if (own.length !== 1) {
    problems.push(`${selector} sets background-image ${own.length} times, not once`);
  }
  if (problems.length > 0) return problems;
  const [surface, sheet] = [surfaces[0]!, own[0]!];
  // Not vacuous: the primitive's stack names its colour role and the language's layers.
  if (!new RegExp(`--color-surface-${emphasis}\\b`).test(surface)) {
    problems.push(`the ${emphasis} Surface's stack doesn't name --color-surface-${emphasis}`);
  }
  for (const layer of ['--ui-texture', '--ui-surface-opacity', '--ui-surface-material']) {
    if (!surface.includes(layer)) problems.push(`the ${emphasis} Surface's stack lacks ${layer}`);
  }
  if (sheet !== surface) {
    problems.push(`${selector} paints ${sheet}, not the ${emphasis} Surface's ${surface}`);
  }
  return problems;
}

const primitives = () => readFileSync(PRIMITIVES, 'utf8');
const ee = () => readFileSync(path.join(PACKAGE_DIR, 'src', 'styles.css'), 'utf8');

const SHEETS = [
  ['overlay', `${V} .ee-sheet`],
  ['subtle', `${V} .ee-case__facts > .ee-facts`],
] as const;

for (const [emphasis, selector] of SHEETS) {
  test(`${selector} paints the ${emphasis} Surface's own layers`, () => {
    assert.deepEqual(parity(ee(), primitives(), selector, emphasis), []);
  });
}

/** `css` with `selector`'s background-image (its first rule's) rewritten by `change`. */
function replaced(css: string, selector: string, change: (stack: string) => string): string {
  const text = flat(css);
  const [stack] = declared(text, selector, 'background-image');
  assert.ok(stack, `${selector} has a background-image to plant on`);
  const at = text.indexOf(`${selector} {`);
  const end = text.indexOf('}', at);
  const rule = text.slice(at, end);
  assert.ok(rule.includes(stack), `the plant finds ${selector}'s stack`);
  return text.slice(0, at) + rule.replace(stack, change(stack)) + text.slice(end);
}

// The planted checks run the real comparison on the real stylesheets, one thing changed in each.
for (const [emphasis, selector] of SHEETS) {
  const role = `--color-surface-${emphasis}`;
  const surfaceSelector = `[data-ui-slot='surface'][data-emphasis='${emphasis}']`;
  test(`the parity check bites for ${selector}: a layer or another role on either side fails it`, () => {
    const plants: [string, string, string, RegExp][] = [
      // EE's stack with a layer prepended, or its colour role swapped.
      [
        replaced(ee(), selector, (stack) => `var(--ui-noise), ${stack}`),
        primitives(),
        'EE + layer',
        /paints var\(--ui-noise\)/,
      ],
      [
        replaced(ee(), selector, (stack) => stack.replaceAll(role, '--color-surface-default')),
        primitives(),
        'EE role',
        /not the/,
      ],
      // The primitive's stack with a layer added, or its rule set twice.
      [
        ee(),
        replaced(primitives(), surfaceSelector, (stack) => `${stack}, var(--ui-noise)`),
        'primitive + layer',
        /not the/,
      ],
      [
        ee(),
        `${primitives()}\n${surfaceSelector} { background-image: none; }`,
        'primitive twice',
        /2 times, not once/,
      ],
      // EE's rule gone, so a selector the check misreads can't pass it.
      [
        ee().replaceAll(`${selector} {`, `${selector}-gone {`),
        primitives(),
        'EE gone',
        /0 times, not once/,
      ],
    ];
    for (const [eeCss, primitivesCss, name, message] of plants) {
      const problems = parity(eeCss, primitivesCss, selector, emphasis);
      assert.ok(problems.length > 0, `${name}: the planted mismatch fails`);
      assert.ok(
        problems.some((each) => message.test(each)),
        `${name}: ${problems.join('; ')}`,
      );
    }
  });
}
