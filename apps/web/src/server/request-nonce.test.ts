import test from 'node:test';
import assert from 'node:assert/strict';
import { previewCsp } from './preview-headers';
import { policyNonce } from './request-nonce';
import { studioCsp } from './studio-headers';

// The nonce a document's own tags carry under a nonce policy (#6, Slice 2):
// the one in the Content-Security-Policy proxy.ts puts on a Studio or a
// preview request.

test('the nonce is the one the policy proxy.ts writes names, and a policy with none has none', () => {
  const nonce = 'MVlEoQyHU2PoMq1Imu8oSA==';
  assert.equal(
    policyNonce(previewCsp(nonce, { mode: 'production', studioOrigin: 'https://rowan.test' })),
    nonce,
  );
  assert.equal(policyNonce(studioCsp(nonce, 'production')), nonce);
  for (const policy of [null, undefined, '', "frame-ancestors 'none'", "script-src 'self'"]) {
    assert.equal(policyNonce(policy), undefined, String(policy));
  }
});
