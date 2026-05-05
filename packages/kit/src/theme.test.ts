import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveTheme } from './theme';

const ALL = ['light', 'dark', 'bright', 'black'] as const;
const BASIC = ['light', 'dark'] as const;

test('light passes through on any variant', () => {
  assert.equal(resolveTheme('light', ALL, () => 'light'), 'light');
  assert.equal(resolveTheme('light', BASIC, () => 'dark'), 'light');
});

test('dark passes through on any variant', () => {
  assert.equal(resolveTheme('dark', ALL, () => 'light'), 'dark');
  assert.equal(resolveTheme('dark', BASIC, () => 'light'), 'dark');
});

test('bright passes through when supported', () => {
  assert.equal(resolveTheme('bright', ALL, () => 'light'), 'bright');
});

test('bright falls back to light when not supported', () => {
  assert.equal(resolveTheme('bright', BASIC, () => 'dark'), 'light');
});

test('black passes through when supported', () => {
  assert.equal(resolveTheme('black', ALL, () => 'light'), 'black');
});

test('black falls back to dark when not supported', () => {
  assert.equal(resolveTheme('black', BASIC, () => 'light'), 'dark');
});

test('system resolves to light when prefers-color-scheme=light', () => {
  assert.equal(resolveTheme('system', ALL, () => 'light'), 'light');
  assert.equal(resolveTheme('system', BASIC, () => 'light'), 'light');
});

test('system resolves to dark when prefers-color-scheme=dark', () => {
  assert.equal(resolveTheme('system', ALL, () => 'dark'), 'dark');
});

test('system never resolves to bright or black', () => {
  // Even on a variant that supports bright/black, system stays in {light, dark}.
  assert.equal(resolveTheme('system', ALL, () => 'light'), 'light');
});
