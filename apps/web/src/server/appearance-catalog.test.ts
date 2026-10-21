import test from 'node:test';
import assert from 'node:assert/strict';
import type { AppearanceSelection } from '@portfolio/schema';
import { createAppearanceCatalog } from './appearance-catalog';

const catalog = createAppearanceCatalog();

const selection: AppearanceSelection = {
  variant: 'missing-variant',
  designLanguage: 'platform-neutral',
  colorScheme: 'warm',
  typography: 'classic',
  displayMode: 'system',
};

test('the display modes are the four the site document allows', () => {
  assert.deepEqual(catalog.ids('displayMode', selection), [
    'system',
    'light',
    'dark',
    'high-contrast',
  ]);
});

test('it names no variant, which the contract checks, and no other axis until #19', () => {
  for (const axis of ['variant', 'designLanguage', 'colorScheme', 'typography'] as const) {
    assert.equal(catalog.ids(axis, selection), null, axis);
  }
  assert.equal(catalog.generatorInput('brand-seed'), undefined);
});
