import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import {
  credentialFingerprint,
  formatHash,
  HASH_CEILING,
  HASH_FLOOR,
  hashPassword,
  KEY_BYTES,
  normalizePassword,
  parameterProblem,
  parseHash,
  passwordProblem,
  SALT_BYTES,
  scryptMaxmem,
  verifyPassword,
} from './phc.mjs';

// The owner password hash (#2), shared by the server, apps/web/bin/owner.mjs,
// and the image: scrypt as a PHC string, with a floor and a ceiling on its
// parameters, and the NFKC and length rules for the password.

const PASSWORD = 'correct horse battery staple';
/** Parameters far below the floor, for tests that only need some hash. */
const CHEAP = { ln: 10, r: 8, p: 1 };

const base64 = (bytes: Buffer) => bytes.toString('base64').replace(/=+$/, '');

test('hashPassword writes the floor, and its string parses back and verifies', async () => {
  const phc = await hashPassword(PASSWORD);
  assert.match(phc, /^\$scrypt\$ln=17,r=8,p=1\$[A-Za-z0-9+/]{22}\$[A-Za-z0-9+/]{43}$/);
  const parsed = parseHash(phc);
  assert.ok(parsed.ok);
  assert.deepEqual(parsed.hash.params, HASH_FLOOR);
  assert.equal(parsed.hash.salt.length, SALT_BYTES);
  assert.equal(parsed.hash.key.length, KEY_BYTES);
  assert.equal(formatHash(parsed.hash), phc);
  assert.equal(await verifyPassword(PASSWORD, parsed.hash), true);
  assert.equal(await verifyPassword(`${PASSWORD}!`, parsed.hash), false);
  assert.notEqual(await hashPassword(PASSWORD, CHEAP), await hashPassword(PASSWORD, CHEAP));
});

test('the same password typed in another normal form verifies', async () => {
  // NFKC composes e and U+0301 into U+00E9, and splits the ligature U+FB01 into fi.
  const typed = 'cafe\u0301 \uFB01ne passphrase';
  const stored = 'caf\u00e9 fine passphrase';
  assert.equal(normalizePassword(typed), stored);
  const parsed = parseHash(await hashPassword(stored, CHEAP));
  assert.ok(parsed.ok);
  assert.equal(await verifyPassword(typed, parsed.hash), true);
});

test('a password is 15 to 256 code points, counted after NFKC', async () => {
  assert.equal(passwordProblem('a'.repeat(14)), 'too_short');
  assert.equal(passwordProblem('a'.repeat(15)), null);
  assert.equal(passwordProblem('a'.repeat(256)), null);
  assert.equal(passwordProblem('a'.repeat(257)), 'too_long');
  // 15 emoji are 30 UTF-16 code units, and 15 code points.
  assert.equal(passwordProblem('\u{1F511}'.repeat(15)), null);
  assert.equal(passwordProblem('\u{1F511}'.repeat(14)), 'too_short');
  // Eight ligatures are 16 letters once NFKC splits them.
  assert.equal(passwordProblem('\uFB01'.repeat(8)), null);
  await assert.rejects(hashPassword('too short'), RangeError);
});

test('parseHash takes only the exact PHC shape, and never repeats the text', () => {
  const salt = base64(randomBytes(SALT_BYTES));
  const key = base64(randomBytes(KEY_BYTES));
  const good = `$scrypt$ln=17,r=8,p=1$${salt}$${key}`;
  assert.ok(parseHash(good).ok);
  const malformed = [
    '',
    'canary-password-hash',
    `$argon2id$v=19$m=65536,t=3,p=4$${salt}$${key}`,
    `$scrypt$ln=17,r=8$${salt}$${key}`,
    `$scrypt$r=8,ln=17,p=1$${salt}$${key}`,
    `$scrypt$ln=017,r=8,p=1$${salt}$${key}`,
    `$scrypt$ln=17,r=8,p=1$${salt}==$${key}`,
    `$scrypt$ln=17,r=8,p=1$${salt}$${key}=`,
    `$scrypt$ln=17,r=8,p=1$${salt.slice(1)}$${key}`,
    `$scrypt$ln=17,r=8,p=1$${salt}$${key}$extra`,
    `$scrypt$ln=17,r=8,p=1$${salt}$${key.replace(/.$/, '-')}`,
    // A last character whose unused bits aren't zero: not the canonical spelling.
    `$scrypt$ln=17,r=8,p=1$${salt.replace(/.$/, '/')}$${key}`,
    ` ${good}`,
    `${good}\n`,
  ];
  for (const text of malformed) {
    assert.deepEqual(parseHash(text), { ok: false, reason: 'malformed' }, JSON.stringify(text));
  }
});

test('parameters below the floor or above the ceiling are named', () => {
  assert.equal(parameterProblem(HASH_FLOOR), null);
  assert.equal(parameterProblem(HASH_CEILING), null);
  assert.equal(parameterProblem({ ln: 16, r: 8, p: 1 }), 'below_floor');
  assert.equal(parameterProblem({ ln: 17, r: 7, p: 1 }), 'below_floor');
  assert.equal(parameterProblem({ ln: 17, r: 8, p: 0 }), 'below_floor');
  assert.equal(parameterProblem({ ln: 19, r: 8, p: 1 }), 'above_ceiling');
  assert.equal(parameterProblem({ ln: 17, r: 17, p: 1 }), 'above_ceiling');
  assert.equal(parameterProblem({ ln: 17, r: 8, p: 5 }), 'above_ceiling');
});

test('maxmem is twice what scrypt needs: 256 MiB at the floor, past the 32 MiB Node default', () => {
  assert.equal(scryptMaxmem(HASH_FLOOR), 256 * 1024 * 1024);
  assert.equal(scryptMaxmem(HASH_CEILING), 2 * 128 * 2 ** 18 * 16);
});

test('the fingerprint is base64url of the first 16 bytes of SHA-256 over the PHC string', () => {
  const phc = `$scrypt$ln=17,r=8,p=1$${'A'.repeat(22)}$${'A'.repeat(43)}`;
  assert.equal(credentialFingerprint(phc), 'MKhpw6F1Y5AkDvbeT_fgmw');
  assert.notEqual(credentialFingerprint(`${phc.slice(0, -1)}E`), credentialFingerprint(phc));
});
