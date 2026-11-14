import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Studio's own native UI, in Studio's tokens (its chrome isn't a composition, so the shared layer
// doesn't reach it): its scrollbars, never hidden, a thumb that reads 3:1 on its track under more
// contrast; its form controls, carets and selection in its own scheme, light and dark; and forced
// colors left to the system.

const css = readFileSync(new URL('./studio.css', import.meta.url), 'utf8');

/** The body of the first rule whose selector line is `selector`, inside `within` if given. */
function body(selector: string, within?: string): string {
  const scope = within ? css.slice(css.indexOf(`${within} {`)) : css;
  const at = scope.indexOf(`\n${selector} {`);
  assert.ok(at >= 0, `${selector}${within ? ` in ${within}` : ''}`);
  return scope.slice(at, scope.indexOf('\n}', at));
}

/** The custom properties a rule body sets. */
function tokens(text: string): Map<string, string> {
  return new Map(
    [...text.matchAll(/^\s*(--[a-z0-9-]+): ([^;]+);$/gm)].map((match) => [match[1]!, match[2]!]),
  );
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((at) => {
    const channel = parseInt(hex.slice(at, at + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function ratio(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x! + 0.05) / (y! + 0.05);
}

/** A token's hex value in `layers`, the later layer winning, its var() references followed. */
function resolve(name: string, layers: Map<string, string>[]): string {
  const value = [...layers]
    .reverse()
    .find((layer) => layer.has(name))
    ?.get(name);
  assert.ok(value, name);
  const reference = /^var\((--[a-z0-9-]+)\)$/.exec(value);
  if (reference) return resolve(reference[1]!, layers);
  assert.match(value, /^#[0-9a-f]{6}$/, `${name}: ${value}`);
  return value;
}

test("Studio never hides a scrollbar: every bar it styles is thin at least, and every one's colors are its tokens", () => {
  assert.doesNotMatch(css, /scrollbar-width: none/);
  const colors = [...css.matchAll(/scrollbar-color: ([^;]+);/g)].map((match) => match[1]!);
  assert.ok(colors.length >= 3, `${colors.length} scrollbar-color declarations`);
  for (const value of colors)
    assert.match(
      value,
      /^(?:var\(--st-thumb\) transparent|var\(--studio-thumb\) transparent|auto)$/,
      value,
    );
});

test("the three rows that scrolled with no bar, the family chips, a phone's recipes and the split pickers' options, show a thin bar, in the thumb they inherit", () => {
  for (const [selector, within] of [
    ['.studio-picker__top .studio-families', undefined],
    [
      '  .studio-recipes__strip',
      '@media (max-width: 47.99rem) and (max-width: 1023.98px),\n  (max-height: 29.99rem) and (max-height: 599.98px)',
    ],
    ['  .studio-picker--languages', undefined],
    ['.studio-split__rail', undefined],
  ] as const) {
    const rule = body(selector, within);
    assert.match(rule, /scrollbar-width: thin;/, selector);
    assert.doesNotMatch(rule, /scrollbar-color/, `${selector} inherits the workspace's colors`);
  }
});

test("Studio's scrollbar thumb is a token, light and dark, and reads 3:1 on every ground it scrolls over, under more contrast too", () => {
  const light = tokens(body('.studio-shell--workspace'));
  const dark = tokens(body('  .studio-shell--workspace', '@media (prefers-color-scheme: dark)'));
  const more = tokens(body('  .studio-shell--workspace', '@media (prefers-contrast: more)'));
  const moreDark = tokens(
    body(
      '  .studio-shell--workspace',
      '@media (prefers-contrast: more) and (prefers-color-scheme: dark)',
    ),
  );
  for (const [label, layers] of [
    ['light', [light]],
    ['dark', [light, dark]],
    ['more contrast', [light, more]],
    ['more contrast, dark', [light, dark, more, moreDark]],
  ] as const) {
    const thumb = resolve('--st-thumb', [...layers]);
    for (const ground of ['--st-bg', '--st-raise', '--st-sunk']) {
      const behind = resolve(ground, [...layers]);
      assert.ok(ratio(thumb, behind) >= 3, `${label}: ${thumb} on ${ground} ${behind}`);
    }
  }
  const page = tokens(body('.studio'));
  const pageDark = tokens(body('  .studio', '@media (prefers-color-scheme: dark)'));
  for (const [label, layers] of [
    ['page, light', [page]],
    ['page, dark', [page, pageDark]],
  ] as const) {
    const thumb = resolve('--studio-thumb', [...layers]);
    const behind = resolve('--studio-canvas', [...layers]);
    assert.ok(ratio(thumb, behind) >= 3, `${label}: ${thumb} on ${behind}`);
  }
});

test("Studio's page and workspace draw their controls, carets, selection and scrollbars in Studio's scheme, light and dark", () => {
  const root = body(':root');
  assert.match(root, /color-scheme: light dark;/);
  const page = body('.studio');
  assert.match(page, /color-scheme: light;/);
  assert.match(page, /accent-color: var\(--studio-ink\);/);
  assert.match(page, /caret-color: var\(--studio-ink\);/);
  assert.match(page, /scrollbar-color: var\(--studio-thumb\) transparent;/);
  assert.match(body('  .studio', '@media (prefers-color-scheme: dark)'), /color-scheme: dark;/);
  const workspace = body('.studio-shell--workspace');
  assert.match(workspace, /accent-color: var\(--st-focus\);/);
  assert.match(workspace, /caret-color: var\(--st-ink\);/);
  assert.match(workspace, /scrollbar-color: var\(--st-thumb\) transparent;/);
  assert.match(body('.studio ::selection'), /background-color: var\(--studio-selection\);/);
  assert.match(body('.studio :autofill'), /-webkit-text-fill-color: var\(--studio-ink\);/);
});

test('under forced colors Studio leaves its scrollbars to the system', () => {
  assert.match(
    css,
    /@media \(forced-colors: active\) \{\n {2}\.studio,\n {2}\.studio \* \{\n {4}scrollbar-color: auto;/,
  );
});
