import test from 'node:test';
import assert from 'node:assert/strict';
import { ENVIRONMENT_QUERY, environmentQuery, environmentValues } from './preview-environment';

// The environment the dev fixture route's query asks for (#7, Slice 1, item
// 8), and what the route table refuses. environment.test.ts holds what it
// sets on the boundary.

test("the dev route's query names its environment, and other parameters don't count (#7)", () => {
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
  assert.deepEqual(environmentQuery(values), {
    displayMode: 'dark',
    contrast: 'more',
    motion: 'reduce',
    enhancement: 'off',
  });
  // Nothing asked for: the published environment.
  assert.deepEqual(environmentValues(new URLSearchParams()), {});
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
