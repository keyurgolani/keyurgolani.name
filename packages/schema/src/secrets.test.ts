import test from 'node:test';
import assert from 'node:assert/strict';
import { findSecrets, redactSecrets, secretKind } from './secrets';

// Every secret-shaped value is built at run time, so none sits in the repository.
const SHAPES = {
  'github-token': [
    `ghp_${'a1'.repeat(18)}`,
    `gho_${'B'.repeat(36)}`,
    `ghu_${'c'.repeat(40)}`,
    `ghs_${'D'.repeat(36)}`,
    `ghr_${'e'.repeat(36)}`,
    `github_pat_${'F0_'.repeat(8)}`,
  ],
  'private-key': [
    `-----BEGIN ${'PRIVATE'} KEY-----`,
    `-----BEGIN RSA ${'PRIVATE'} KEY-----\nMII`,
    `-----BEGIN OPENSSH ${'PRIVATE'} KEY-----`,
    `-----BEGIN PGP ${'PRIVATE'} KEY BLOCK-----`,
  ],
  'phc-hash': [
    `$argon2id$v=19$m=65536,t=3,p=4$${'c2FsdA'}$${'aGFzaA'}`,
    `$scrypt$ln=16,r=8,p=1$${'c2FsdA'}$${'aGFzaA'}`,
    `$pbkdf2-sha256$29000$${'c2FsdA'}$${'aGFzaA'}`,
  ],
  'bcrypt-hash': [`$2b$12$${'R'.repeat(53)}`, `$2y$10$${'./'.repeat(26)}x`],
  'aws-key-id': [`AKIA${'Q7'.repeat(8)}`],
} as const;

test('each secret shape is recognized, inside other text too', () => {
  for (const [kind, samples] of Object.entries(SHAPES)) {
    for (const sample of samples) {
      assert.equal(secretKind(sample), kind, sample);
      assert.equal(secretKind(`see: ${sample} (pasted)`), kind, sample);
    }
  }
});

test('text that only resembles a secret is left alone', () => {
  for (const text of [
    'ghp_short',
    `xghp_${'a'.repeat(36)}`,
    `-----BEGIN ${'PUBLIC'} KEY-----`,
    `-----BEGIN CERTIFICATE-----`,
    `$2b$12$${'R'.repeat(20)}`,
    `akia${'Q'.repeat(16)}`,
    `AKIA${'Q'.repeat(15)}`,
    '$5 off, $10 total',
    'https://github.com/rowan',
  ]) {
    assert.equal(secretKind(text), undefined, text);
  }
});

test('findSecrets reports values and keys by path, extension data included', () => {
  const token = SHAPES['github-token'][0];
  const key = SHAPES['private-key'][0];
  const aws = SHAPES['aws-key-id'][0];
  assert.deepEqual(
    findSecrets({
      identity: { name: 'Rowan', tagline: `token ${token}` },
      links: [{ url: 'https://rowan.name' }, { label: aws }],
      extensions: { '@other/x': { deep: [[{ pem: key }]] } },
      [token]: { below: aws },
    }),
    [
      { path: ['identity', 'tagline'], kind: 'github-token', in: 'value' },
      { path: ['links', 1, 'label'], kind: 'aws-key-id', in: 'value' },
      { path: ['extensions', '@other/x', 'deep', 0, 0, 'pem'], kind: 'private-key', in: 'value' },
      // A secret-shaped key is reported at its object, and nothing below it.
      { path: [], kind: 'github-token', in: 'key' },
    ],
  );
  assert.deepEqual(findSecrets({ a: [1, true, null, 'plain'] }), []);
});

test('redactSecrets replaces every secret in a message', () => {
  const token = SHAPES['github-token'][0];
  const bcrypt = SHAPES['bcrypt-hash'][0];
  assert.equal(
    redactSecrets(`/a/${token} and ${bcrypt}, then ${token} again`),
    '/a/[secret] and [secret], then [secret] again',
  );
  assert.equal(redactSecrets('/identity/name'), '/identity/name');
});
