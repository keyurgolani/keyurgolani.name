import test from 'node:test';
import assert from 'node:assert/strict';
import { LAYER_ORDER } from '../layers';
import { COLOR_ROLES } from '../tokens';
import { compilePlatform, platformStylesheet } from './platform';

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
