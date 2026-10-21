import test from 'node:test';
import assert from 'node:assert/strict';
import { canaries, CANARY_BODY, encodings, hashCanaries, SUMMARY_FIELDS } from './canaries.mjs';

// The leak scans look for each canary in every form a response could carry
// it, so a leak in an RSC payload or in escaped HTML fails them too.

const found = (body, root = 'app-root-canary') =>
  canaries(root).filter((canary) => body.includes(canary));

test('a canary is found as is, inside a JSON string once or twice, and escaped for HTML', () => {
  const summary = JSON.stringify({ proxyHops: 0, adapters: { catalog: 'documents' } });
  const bodies = {
    'a JSON body': summary,
    'an RSC payload': `self.__next_f.push([1,${JSON.stringify(`3:${summary}`)}])`,
    'a payload nested twice': JSON.stringify(JSON.stringify(summary)),
    'a payload with unicode escapes': summary.replace(/"/g, '\\u0022'),
    'HTML text': `<pre>${summary.replace(/"/g, '&quot;')}</pre>`,
    'an attribute with numeric escapes': `<div data-x="${summary.replace(/"/g, '&#34;')}">`,
    'an attribute with hex escapes': `<div data-x="${summary.replace(/"/g, '&#x22;')}">`,
  };
  for (const [where, body] of Object.entries(bodies)) {
    assert.ok(found(body).length > 0, `${where}: ${body}`);
  }
  // A canary made of letters, digits, and dashes reads the same in every form.
  assert.deepEqual(encodings(CANARY_BODY), [CANARY_BODY]);
  assert.ok(found(`{"draft":${JSON.stringify(CANARY_BODY)}}`).includes(CANARY_BODY));
  assert.deepEqual(found('<p>Rowan Fixture</p>'), []);
  for (const field of SUMMARY_FIELDS) assert.ok(encodings(field).length > 1, field);
});

test("a run's own secrets are canaries too, and the summary's fields can be left out for an owner session", () => {
  const hash = `$scrypt$ln=17,r=8,p=1$${'s'.repeat(22)}$${'k'.repeat(43)}`;
  assert.deepEqual(hashCanaries(hash), [hash, 's'.repeat(22), 'k'.repeat(43)]);
  const scan = canaries('app-root-canary', {
    secrets: ['canary-password-x', ...hashCanaries(hash)],
  });
  for (const body of ['canary-password-x', `"key":"${'k'.repeat(43)}"`, `salt ${'s'.repeat(22)}`]) {
    assert.ok(
      scan.some((canary) => body.includes(canary)),
      body,
    );
  }
  const signedIn = canaries('app-root-canary', { summary: false });
  assert.ok(!signedIn.some((canary) => '{"proxyHops":0,"adapters":{}}'.includes(canary)));
  assert.ok(signedIn.includes(CANARY_BODY));
});
