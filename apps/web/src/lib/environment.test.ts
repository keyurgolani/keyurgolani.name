import test from 'node:test';
import assert from 'node:assert/strict';
import { DisplayModeSchema } from '@portfolio/schema';
import {
  DEFAULT_SELECTION,
  ENVIRONMENT_ATTRIBUTES,
  environmentAttributes,
  environmentSelection,
  type EnvironmentOverride,
} from './environment';

// The environment a preview renders under (#7, Slice 4, item 5): one pure
// function the server render and the preview agent both call.

test('each control sets its attribute on the boundary, and nothing set keeps what the site publishes (#7, Slice 4)', () => {
  assert.deepEqual(
    environmentAttributes(DEFAULT_SELECTION, {
      displayMode: 'dark',
      contrast: 'more',
      motion: 'reduce',
      enhancement: 'off',
    }),
    {
      'data-display-mode': 'dark',
      'data-contrast': 'more',
      'data-motion': 'reduced',
      'data-enhancement': 'off',
    },
  );
  const published = { displayMode: 'light', motionPolicy: 'respect-os' } as const;
  assert.deepEqual(environmentAttributes(published, {}), {
    'data-display-mode': 'light',
    'data-contrast': 'system',
    'data-motion': 'full',
    'data-enhancement': 'on',
  });
  // A display mode of system keeps the published one, and any other replaces it.
  assert.equal(
    environmentAttributes(published, { displayMode: 'system' })['data-display-mode'],
    'light',
  );
  for (const mode of DisplayModeSchema.options.filter((each) => each !== 'system')) {
    assert.equal(
      environmentAttributes(published, { displayMode: mode })['data-display-mode'],
      mode,
    );
  }
  assert.deepEqual(Object.keys(environmentAttributes(published, {})), [...ENVIRONMENT_ATTRIBUTES]);
});

test('motion only ever reduces: no override raises a site that reduces it, and system leaves the reader to reduce it (#7, Slice 4)', () => {
  const overrides: EnvironmentOverride[] = [{}, { motion: 'system' }, { motion: 'reduce' }];
  const reducing = { displayMode: 'system', motionPolicy: 'reduce' } as const;
  for (const override of overrides) {
    assert.equal(
      environmentAttributes(reducing, override)['data-motion'],
      'reduced',
      JSON.stringify(override),
    );
  }
  assert.equal(
    environmentAttributes(DEFAULT_SELECTION, { motion: 'reduce' })['data-motion'],
    'reduced',
  );
  assert.equal(
    environmentAttributes(DEFAULT_SELECTION, { motion: 'system' })['data-motion'],
    'full',
  );
});

test("a view's site gives the selection its published display mode and motion policy (#7, Slice 4)", () => {
  assert.deepEqual(
    environmentSelection({ appearance: { displayMode: 'high-contrast' }, motionPolicy: 'reduce' }),
    { displayMode: 'high-contrast', motionPolicy: 'reduce' },
  );
});
