import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ENVIRONMENT_QUERY,
  environmentAttributes,
  environmentQuery,
  environmentValues,
} from './preview-environment';

// The environment a preview's query asks for (#7, Slice 1, item 8, and
// Slice 4): its attributes on the presentation boundary, and what the route
// table refuses.

test("a preview's query sets its environment's attributes, motion only reduces, and other parameters don't count (#7)", () => {
  const values = environmentValues(
    new URLSearchParams('displayMode=dark&contrast=more&motion=reduce&enhancement=off&utm=x'),
  );
  assert.deepEqual(values, {
    displayMode: 'dark',
    contrast: 'more',
    motion: 'reduce',
    enhancement: 'off',
  });
  assert.ok(values);
  assert.deepEqual(environmentAttributes(values), {
    'data-display-mode': 'dark',
    'data-contrast': 'more',
    'data-motion': 'reduced',
    'data-enhancement': 'off',
  });
  assert.deepEqual(environmentQuery(values), {
    displayMode: 'dark',
    contrast: 'more',
    motion: 'reduce',
    enhancement: 'off',
  });
  // Nothing asked for: the reader's own environment.
  assert.deepEqual(environmentValues(new URLSearchParams()), {});
  assert.deepEqual(environmentAttributes({}), {});
  // motion=system sets nothing, so a preview never moves more than the reader allows.
  assert.deepEqual(environmentAttributes({ motion: 'system' }), {});
});

test("an environment value the parameter doesn't take, an empty one, or one sent twice names nothing (#7)", () => {
  for (const [name, allowed] of Object.entries(ENVIRONMENT_QUERY)) {
    for (const value of allowed) {
      assert.deepEqual(environmentValues(new URLSearchParams({ [name]: value })), {
        [name]: value,
      });
    }
    const [first] = allowed;
    for (const query of [
      `${name}=`,
      `${name}=nope`,
      `${name}=${first.toUpperCase()}`,
      `${name}=${first}&${name}=${first}`,
    ]) {
      assert.equal(environmentValues(new URLSearchParams(query)), null, query);
    }
  }
});
