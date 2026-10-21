import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { sha256 } from './sha256';

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex');
const node = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

test('it matches the published test vectors', () => {
  const encode = (text: string) => new TextEncoder().encode(text);
  assert.equal(
    hex(sha256(encode(''))),
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  );
  assert.equal(
    hex(sha256(encode('abc'))),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  );
  assert.equal(
    hex(sha256(encode('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'))),
    '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
  );
});

test("it matches Node's at every padding boundary and for long input", () => {
  for (const length of [1, 55, 56, 57, 63, 64, 65, 119, 120, 128, 1000, 100_000]) {
    const bytes = Uint8Array.from({ length }, (_, index) => (index * 31 + length) % 256);
    assert.equal(hex(sha256(bytes)), node(bytes), String(length));
  }
});
