import test from 'node:test';
import assert from 'node:assert/strict';
import { ThemePreferenceSchema, PortfolioSchema } from './portfolio';

test('ThemePreferenceSchema accepts light', () => {
  assert.equal(ThemePreferenceSchema.parse('light'), 'light');
});

test('ThemePreferenceSchema accepts dark', () => {
  assert.equal(ThemePreferenceSchema.parse('dark'), 'dark');
});

test('ThemePreferenceSchema accepts bright', () => {
  assert.equal(ThemePreferenceSchema.parse('bright'), 'bright');
});

test('ThemePreferenceSchema accepts black', () => {
  assert.equal(ThemePreferenceSchema.parse('black'), 'black');
});

test('ThemePreferenceSchema accepts system', () => {
  assert.equal(ThemePreferenceSchema.parse('system'), 'system');
});

test('ThemePreferenceSchema rejects unknown values', () => {
  assert.throws(() => ThemePreferenceSchema.parse('auto'));
  assert.throws(() => ThemePreferenceSchema.parse('foo'));
  assert.throws(() => ThemePreferenceSchema.parse(''));
});

test('PortfolioSchema default theme is system', () => {
  const out = PortfolioSchema.parse({ identity: { name: 'X' } });
  assert.equal(out.theme, 'system');
});

test('PortfolioSchema accepts theme=bright', () => {
  const out = PortfolioSchema.parse({ identity: { name: 'X' }, theme: 'bright' });
  assert.equal(out.theme, 'bright');
});
