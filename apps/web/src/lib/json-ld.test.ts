import test from 'node:test';
import assert from 'node:assert/strict';
import { jsonLdScript } from './json-ld';

test('text that closes the script element stays inside the JSON', () => {
  const block = {
    '@type': 'Person',
    description: 'Builds </script><script>alert(1)</script> & <!-- more --> things',
  };
  const script = jsonLdScript(block);
  assert.doesNotMatch(script, /[<>&]/);
  assert.match(script, /\\u003c\/script\\u003e/);
  assert.deepEqual(JSON.parse(script), block);
});

test('a block with no markup serializes as plain JSON', () => {
  const block = { '@context': 'https://schema.org', '@type': 'WebSite', name: 'Rowan Test' };
  assert.equal(jsonLdScript(block), JSON.stringify(block));
});
