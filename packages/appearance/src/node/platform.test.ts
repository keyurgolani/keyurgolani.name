import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LAYER_ORDER } from '../layers';
import { COLOR_ROLES, LANGUAGE_KEYS } from '../tokens';
import { compilePlatform, layerRules, platformStylesheet } from './platform';
import { readLanguageStylesheet } from './stylesheet';

// The platform stylesheet (#19, Slice 2, item 3): the reset, utilities, and
// accessibility layers, where accessibility rules override tokens, not rules.

const css = platformStylesheet();

/** The declarations of the first block whose selector list is exactly `selectors`, under `within` if given. */
function declarations(selectors: string, within?: string): Map<string, string> {
  const scope = within ? css.slice(css.indexOf(`${within} {`)) : css;
  const start = scope.indexOf(`${selectors} {\n`);
  assert.ok(start >= 0, `no block for ${selectors}${within ? ` in ${within}` : ''}`);
  const body = scope.slice(start + selectors.length + 3, scope.indexOf('}', start));
  return new Map(
    body
      .split('\n')
      .map((line) => /^\s*([a-z0-9-]+): (.*);$/.exec(line))
      .filter((match): match is RegExpExecArray => match !== null)
      .map((match) => [match[1]!, match[2]!]),
  );
}

test('it starts with the layer order and holds the reset, utilities, and accessibility layers in order', () => {
  assert.ok(css.startsWith(`${LAYER_ORDER}\n`));
  assert.deepEqual(css.match(/^@layer [a-z-]+ \{/gm), [
    '@layer reset {',
    '@layer utilities {',
    '@layer accessibility {',
  ]);
});

test('the reset paints each boundary from its tokens', () => {
  const reset = declarations('  [data-appearance-boundary]', '@layer reset');
  assert.equal(reset.get('color'), 'var(--color-text-primary)');
  assert.equal(reset.get('background-color'), 'var(--color-canvas)');
  assert.equal(reset.get('font-family'), 'var(--type-body-font-family)');
  assert.equal(reset.get('line-height'), 'var(--type-body-line-height)');
  // A word wider than a 320px phone's line, such as a display headline's, wraps (#11, 1.4.10).
  assert.equal(reset.get('overflow-wrap'), 'anywhere');
});

test("the reset puts every id and focusable element below a variant's sticky chrome (Slice 3)", () => {
  const offset = declarations(
    '  [data-appearance-boundary] :is([id], a[href], area[href], button, input, select, textarea, summary, iframe, [tabindex], [contenteditable])',
    '@layer reset',
  );
  assert.deepEqual(Object.fromEntries(offset), {
    'scroll-margin-top': 'var(--layout-sticky-offset, 0px)',
  });
});

test("the primitives' rules join the platform's reset and utilities layers, under the accessibility layer (Slice 3)", () => {
  const primitives = readFileSync(new URL('../primitives/styles.css', import.meta.url), 'utf8');
  const reset = css.slice(css.indexOf('@layer reset {'), css.indexOf('@layer utilities {'));
  const utilities = css.slice(
    css.indexOf('@layer utilities {'),
    css.indexOf('@layer accessibility {'),
  );
  assert.ok(reset.includes("  [data-ui-slot='action'] {\n"), 'an action renders from the tokens');
  assert.ok(reset.includes("  [data-ui-slot='surface'][data-emphasis='prominent'] {\n"));
  assert.ok(
    utilities.includes('  [data-appearance-boundary] :focus-visible {\n'),
    'focus is an outline',
  );
  assert.ok(utilities.includes('  @keyframes fade-rise {\n'));
  // Every rule of theirs is here, once, in its own layer.
  for (const layer of ['reset', 'utilities'] as const) {
    const within = layer === 'reset' ? reset : utilities;
    for (const line of layerRules(primitives, layer).split('\n')) {
      if (/^\S.*\{$/.test(line)) assert.ok(within.includes(`\n  ${line}\n`), `${layer}: ${line}`);
    }
  }
  assert.equal(css.split('@layer reset {').length, 2, 'still one reset block');
  assert.throws(() => layerRules('@layer reset {}', 'utilities'), /no @layer utilities block/);
});

test('reduced motion keeps motion-fast feedback and stops or fades the rest', () => {
  for (const [selector, within] of [
    ['    [data-appearance-boundary]', '@media (prefers-reduced-motion: reduce)'],
    ['  [data-appearance-boundary][data-motion="reduced"]', '@layer accessibility'],
  ] as const) {
    const reduced = declarations(selector, within);
    assert.equal(reduced.has('--ui-motion-fast'), false);
    assert.equal(reduced.get('--ui-state-hover-transform'), 'none');
    assert.equal(reduced.get('--ui-state-active-transform'), 'none');
    assert.equal(reduced.get('--ui-motion-enter'), 'fade');
    assert.equal(reduced.get('--ui-motion-exit'), 'fade');
    assert.equal(reduced.get('--ui-motion-emphasis'), 'none');
  }
  const paused = declarations(
    '  [data-appearance-boundary][data-motion="static"]',
    '@layer accessibility',
  );
  assert.equal(paused.get('--ui-motion-fast'), '0s');
  assert.equal(paused.get('--ui-motion-enter'), 'none');
});

test('forced colors map every color role to a system color and drop the effects', () => {
  const forced = declarations('    [data-appearance-boundary]', '@media (forced-colors: active)');
  const roles = [...forced.keys()].filter((key) => key.startsWith('--color-'));
  assert.deepEqual(
    roles,
    COLOR_ROLES.map((role) => `--color-${role}`),
  );
  for (const role of roles) assert.match(forced.get(role)!, /^[A-Z][A-Za-z]+$/, role);
  for (const key of [
    '--ui-shadow-card',
    '--ui-shadow-overlay',
    '--ui-shadow-raised',
    '--ui-shadow-inset',
    '--ui-texture',
    '--ui-emphasis-glow',
  ]) {
    assert.equal(forced.get(key), 'none', key);
  }
  assert.equal(forced.get('--ui-backdrop-blur'), '0px');
  assert.equal(forced.get('--ui-surface-opacity'), '100%');
});

test('reduced transparency and a browser without backdrop-filter get opaque surfaces', () => {
  for (const within of [
    '@media (prefers-reduced-transparency: reduce)',
    '@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px)))',
  ]) {
    const opaque = declarations('    [data-appearance-boundary]', within);
    assert.deepEqual(Object.fromEntries(opaque), {
      '--ui-surface-opacity': '100%',
      '--ui-backdrop-blur': '0px',
    });
  }
});

test('high contrast makes the signature fill solid text-primary and drops the glow, however it is asked for', () => {
  const solid = 'linear-gradient(var(--color-text-primary), var(--color-text-primary))';
  const explicit = declarations(
    '  [data-appearance-boundary][data-display-mode="high-contrast"],\n  [data-appearance-boundary][data-contrast="more"]',
    '@layer accessibility',
  );
  const preferred = declarations(
    '    [data-appearance-boundary]',
    '@media (prefers-contrast: more)',
  );
  for (const block of [explicit, preferred]) {
    assert.equal(block.get('--ui-signature-fill'), solid);
    assert.equal(block.get('--ui-emphasis-glow'), 'none');
  }
});

test('every token a language may move, blur, or fade a part through is one the accessibility layer sets', () => {
  // Which --ui-* tokens the stylesheet reader lets each effect read.
  const accepted = (declaration: (token: string) => string, selector = '[data-ui-slot="a"]') =>
    LANGUAGE_KEYS.map((key) => `--ui-${key}`).filter(
      (token) => readLanguageStylesheet(`${selector} { ${declaration(token)}; }`).ok,
    );
  const moves = [
    ...new Set(
      ['transform', 'translate', 'scale', 'rotate'].flatMap((property) =>
        accepted((token) => `${property}: var(${token})`),
      ),
    ),
  ];
  const blurs = accepted((token) => `backdrop-filter: blur(var(${token}))`);
  // Opacity dims only a disabled or busy part, and never through surface-opacity.
  const fades = accepted((token) => `opacity: var(${token})`, '[data-ui-slot="a"]:disabled');
  assert.deepEqual(moves, ['--ui-state-hover-transform', '--ui-state-active-transform']);
  assert.deepEqual(blurs, ['--ui-backdrop-blur']);
  assert.deepEqual(fades, ['--ui-state-disabled-opacity', '--ui-state-loading-opacity']);
  // Reduced motion, a paused boundary, and print stop every move.
  for (const [selector, within] of [
    ['    [data-appearance-boundary]', '@media (prefers-reduced-motion: reduce)'],
    ['  [data-appearance-boundary][data-motion="reduced"]', '@layer accessibility'],
    ['  [data-appearance-boundary][data-motion="static"]', '@layer accessibility'],
    ['    [data-appearance-boundary]', '@media print'],
  ] as const) {
    const block = declarations(selector, within);
    for (const token of moves) assert.equal(block.get(token), 'none', `${within} ${token}`);
  }
  // Reduced transparency, a browser without backdrop-filter, forced colors, and print drop the
  // blur and make surfaces opaque. The two state opacities dim a disabled or loading part,
  // which every setting still shows.
  for (const within of [
    '@media (prefers-reduced-transparency: reduce)',
    '@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px)))',
    '@media (forced-colors: active)',
    '@media print',
  ]) {
    const block = declarations('    [data-appearance-boundary]', within);
    for (const token of blurs) assert.equal(block.get(token), '0px', `${within} ${token}`);
    assert.equal(block.get('--ui-surface-opacity'), '100%', within);
  }
});

test('every focusable part draws its focus ring in the accessibility layer, past anything a language sets (Slice 3)', () => {
  const ring = declarations(
    '  [data-appearance-boundary] [data-ui-slot]:focus-visible',
    '@layer accessibility',
  );
  assert.deepEqual(Object.fromEntries(ring), {
    outline: 'var(--ui-focus-width) var(--ui-focus-style) var(--color-focus)',
    'outline-offset': 'var(--ui-focus-offset)',
  });
  // A language may set the outline a focused part draws, even none, and the
  // compiler puts its rules in the language layer, which comes before the
  // accessibility layer: the ring wins, and the language shapes it only
  // through the focus tokens. tests/appearance renders the same case.
  for (const hiding of [
    '[data-ui-slot]:focus-visible { outline-style: none; }',
    "[data-ui-slot='action']:focus-visible { outline: none; }",
  ]) {
    assert.ok(readLanguageStylesheet(hiding).ok, hiding);
  }
  const order = LAYER_ORDER.replace(/^@layer |;$/g, '').split(', ');
  assert.ok(order.indexOf('language') < order.indexOf('accessibility'));
  assert.equal(order.at(-1), 'accessibility');
  // On a toast's status fill the ring takes on-status, which the gate holds
  // to the fill, since the focus color can fall under 3:1 there (#11).
  assert.deepEqual(
    Object.fromEntries(
      declarations(
        "  [data-appearance-boundary] [data-ui-slot='toast'][data-status] [data-ui-slot]:focus-visible",
        '@layer accessibility',
      ),
    ),
    { 'outline-color': 'var(--color-on-status)' },
  );
  // Forced colors give the ring the system highlight.
  assert.equal(
    declarations('    [data-appearance-boundary]', '@media (forced-colors: active)').get(
      '--color-focus',
    ),
    'Highlight',
  );
});

test('print is opaque and still', () => {
  const print = declarations('    [data-appearance-boundary]', '@media print');
  assert.equal(print.get('--ui-surface-opacity'), '100%');
  assert.equal(print.get('--ui-motion-standard'), '0s');
});

test('the platform file is named by its content', () => {
  const file = compilePlatform();
  assert.match(file.name, /^_platform\.[0-9a-f]{12}\.css$/);
  assert.equal(new TextDecoder().decode(file.bytes), css);
  assert.equal(compilePlatform().sha256, file.sha256);
});
