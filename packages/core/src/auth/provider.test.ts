import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveKey, hashPassword, parseHash } from './phc.mjs';
import { localPasswordProvider } from './provider';

// The owner-password provider (#2): the right password gets the owner's
// principal, and every failure costs one key derivation and looks the same,
// which the tests prove by counting derivations rather than by timing.

const PASSWORD = 'correct horse battery staple';
/** Parameters far below the floor. The provider checks with whatever the hash says. */
const CHEAP = { ln: 10, r: 8, p: 1 };

async function provider(now?: () => number) {
  const parsed = parseHash(await hashPassword(PASSWORD, CHEAP));
  assert.ok(parsed.ok);
  const derived: string[] = [];
  const derive: typeof deriveKey = (password, salt, params) => {
    derived.push(password);
    return deriveKey(password, salt, params);
  };
  return { auth: localPasswordProvider({ hash: parsed.hash, now, derive }), derived };
}

test('the owner password signs in as the owner, at the sign-in time', async () => {
  const { auth, derived } = await provider(() => 1_760_000_000_000);
  assert.deepEqual(await auth.verify({ password: PASSWORD }), {
    ok: true,
    principal: { id: 'owner', method: 'password', authTime: 1_760_000_000_000 },
  });
  assert.equal(derived.length, 1);
});

test('every credential failure runs one verification and answers the same', async () => {
  const { auth, derived } = await provider();
  const failures: [what: string, password: unknown][] = [
    ['missing', undefined],
    ['empty', ''],
    ['a number', 31337],
    ['null', null],
    ['an object', { toString: () => PASSWORD }],
    ['an array', [PASSWORD]],
    ['overlong', `${PASSWORD}${'x'.repeat(256)}`],
    ['wrong', `${PASSWORD}!`],
    ['wrong case', PASSWORD.toUpperCase()],
  ];
  for (const [what, password] of failures) {
    const before = derived.length;
    assert.deepEqual(await auth.verify({ password }), { ok: false }, what);
    assert.equal(derived.length - before, 1, `${what}: one derivation`);
  }
  // What it can't use, it never derives: a stand-in costs the same.
  assert.deepEqual(derived.slice(0, 7), ['', '', '', '', '', '', '']);
});
