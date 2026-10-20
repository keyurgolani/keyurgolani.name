import test from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { resolveTheme, type ThemePreference } from './theme';
import { isThemePreference, THEME_INIT_SCRIPT, themeInitScript } from './theme-init';

const ALL = ['light', 'dark', 'bright', 'black'] as const;
const BASIC = ['light', 'dark'] as const;

test('light passes through on any variant', () => {
  assert.equal(
    resolveTheme('light', ALL, () => 'light'),
    'light',
  );
  assert.equal(
    resolveTheme('light', BASIC, () => 'dark'),
    'light',
  );
});

test('dark passes through on any variant', () => {
  assert.equal(
    resolveTheme('dark', ALL, () => 'light'),
    'dark',
  );
  assert.equal(
    resolveTheme('dark', BASIC, () => 'light'),
    'dark',
  );
});

test('bright passes through when supported', () => {
  assert.equal(
    resolveTheme('bright', ALL, () => 'light'),
    'bright',
  );
});

test('bright falls back to light when not supported', () => {
  assert.equal(
    resolveTheme('bright', BASIC, () => 'dark'),
    'light',
  );
});

test('black passes through when supported', () => {
  assert.equal(
    resolveTheme('black', ALL, () => 'light'),
    'black',
  );
});

test('black falls back to dark when not supported', () => {
  assert.equal(
    resolveTheme('black', BASIC, () => 'light'),
    'dark',
  );
});

test('system resolves to light when prefers-color-scheme=light', () => {
  assert.equal(
    resolveTheme('system', ALL, () => 'light'),
    'light',
  );
  assert.equal(
    resolveTheme('system', BASIC, () => 'light'),
    'light',
  );
});

test('system resolves to dark when prefers-color-scheme=dark', () => {
  assert.equal(
    resolveTheme('system', ALL, () => 'dark'),
    'dark',
  );
});

test('system never resolves to bright or black', () => {
  // Even on a variant that supports bright/black, system stays in {light, dark}.
  assert.equal(
    resolveTheme('system', ALL, () => 'light'),
    'light',
  );
});

/** The data-theme themeInitScript() paints, given storage and the OS scheme. */
function paint(script: string, stored: string | null, osDark = false): string | undefined {
  const root = { dataset: {} as Record<string, string>, style: {} as Record<string, string> };
  runInNewContext(script, {
    localStorage: { getItem: () => stored },
    window: { matchMedia: () => ({ matches: osDark }) },
    document: { documentElement: root },
  });
  return root.dataset.theme;
}

test("the init script paints the page's default until the visitor picks a theme", () => {
  assert.equal(paint(themeInitScript('dark'), null), 'dark');
  assert.equal(paint(themeInitScript('light'), null, true), 'light');
  assert.equal(paint(themeInitScript('system'), null, true), 'dark');
  // The visitor's stored choice wins over the default.
  assert.equal(paint(themeInitScript('dark'), 'light'), 'light');
  // Bright and black paint as light and dark before the provider runs.
  assert.equal(paint(themeInitScript('black'), null), 'dark');
  assert.equal(paint(THEME_INIT_SCRIPT, null), 'light');
});

test('only a known preference reaches the init script', () => {
  const injected = "dark'; alert(1); '" as ThemePreference;
  assert.equal(themeInitScript(injected), THEME_INIT_SCRIPT);
});

test('a stored value the kit does not know paints the default, as the provider reads it', () => {
  for (const stored of ['purple', '', 'Dark', 'dark ', 'constructor', "light'; x='"]) {
    assert.equal(paint(themeInitScript('dark'), stored), 'dark', JSON.stringify(stored));
    assert.equal(isThemePreference(stored), false, JSON.stringify(stored));
  }
  for (const stored of ['light', 'dark', 'bright', 'black', 'system']) {
    assert.equal(isThemePreference(stored), true, stored);
  }
  assert.equal(paint(themeInitScript('dark'), 'bright'), 'light');
});
