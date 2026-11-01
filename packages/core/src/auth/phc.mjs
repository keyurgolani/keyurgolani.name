// The owner password hash (#2): scrypt from node:crypto, written as a PHC
// string, $scrypt$ln=<log2 N>,r=<r>,p=<p>$<salt>$<key>, with a 16-byte salt
// and a 32-byte key in unpadded base64. Plain ESM with node:* imports only,
// so apps/web/bin/owner.mjs, in the repo and in the image, runs it with no
// build step. The server reaches it only through @portfolio/core/owner.
import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

// The owner load trace (#1, item 14), by the symbol load-trace.ts uses. This
// file imports nothing of the package's, so it records itself.
const TRACE = Symbol.for('keyurgolani.portfolio.owner-modules');
/** @type {{ [key: symbol]: Set<string> | undefined }} */
const holder = /** @type {any} */ (globalThis);
(holder[TRACE] ??= new Set()).add('core/auth/phc');

/**
 * @typedef {object} ScryptParams
 * @property {number} ln log2 of the scrypt cost N
 * @property {number} r block size
 * @property {number} p parallelism
 */

/**
 * @typedef {object} PasswordHash
 * @property {Readonly<ScryptParams>} params
 * @property {Buffer} salt
 * @property {Buffer} key
 */

/** The weakest parameters the owner profile accepts, and what hash-password writes. */
export const HASH_FLOOR = Object.freeze({ ln: 17, r: 8, p: 1 });
/** The strongest it accepts. Past these, one sign-in costs too much memory or time. */
export const HASH_CEILING = Object.freeze({ ln: 18, r: 16, p: 4 });
export const SALT_BYTES = 16;
export const KEY_BYTES = 32;
/** The password's length, in code points after NFKC. */
export const PASSWORD_MIN = 15;
export const PASSWORD_MAX = 256;

// Decimal parameters without leading zeros, then exactly 22 and 43
// characters of unpadded base64: 16 and 32 bytes.
const PHC =
  /^\$scrypt\$ln=(0|[1-9]\d{0,2}),r=(0|[1-9]\d{0,3}),p=(0|[1-9]\d{0,3})\$([A-Za-z0-9+/]{22})\$([A-Za-z0-9+/]{43})$/;

/**
 * The password as it is hashed and checked: NFKC, so the same password typed
 * in another normal form matches.
 *
 * @param {string} password
 * @returns {string}
 */
export function normalizePassword(password) {
  return password.normalize('NFKC');
}

/**
 * Why a password can't be the owner's, or null: `too_short` under 15 code
 * points after NFKC, `too_long` over 256.
 *
 * @param {string} password
 * @returns {'too_short' | 'too_long' | null}
 */
export function passwordProblem(password) {
  const length = [...normalizePassword(password)].length;
  if (length < PASSWORD_MIN) return 'too_short';
  if (length > PASSWORD_MAX) return 'too_long';
  return null;
}

/**
 * Reads a PHC string. Anything but the exact shape is `malformed`, and
 * nothing it returns repeats the text.
 *
 * @param {string} text
 * @returns {{ ok: true, hash: Readonly<PasswordHash> } | { ok: false, reason: 'malformed' }}
 */
export function parseHash(text) {
  const match = PHC.exec(text);
  if (!match) return { ok: false, reason: 'malformed' };
  const [, ln, r, p, salt = '', key = ''] = match;
  const saltBytes = Buffer.from(salt, 'base64');
  const keyBytes = Buffer.from(key, 'base64');
  // Each value has one unpadded spelling: its unused trailing bits are zero.
  if (base64(saltBytes) !== salt || base64(keyBytes) !== key) {
    return { ok: false, reason: 'malformed' };
  }
  const params = Object.freeze({ ln: Number(ln), r: Number(r), p: Number(p) });
  return { ok: true, hash: Object.freeze({ params, salt: saltBytes, key: keyBytes }) };
}

/**
 * Whether the parameters are outside what the owner profile accepts.
 *
 * @param {Readonly<ScryptParams>} params
 * @returns {'below_floor' | 'above_ceiling' | null}
 */
export function parameterProblem({ ln, r, p }) {
  if (ln < HASH_FLOOR.ln || r < HASH_FLOOR.r || p < HASH_FLOOR.p) return 'below_floor';
  if (ln > HASH_CEILING.ln || r > HASH_CEILING.r || p > HASH_CEILING.p) return 'above_ceiling';
  return null;
}

/**
 * @param {Readonly<PasswordHash>} hash
 * @returns {string}
 */
export function formatHash({ params, salt, key }) {
  return `$scrypt$ln=${params.ln},r=${params.r},p=${params.p}$${base64(salt)}$${base64(key)}`;
}

/**
 * scrypt's maxmem for `params`: twice the 128 * N * r bytes it needs. Node's
 * default of 32 MiB is too small at the floor.
 *
 * @param {Readonly<ScryptParams>} params
 * @returns {number}
 */
export function scryptMaxmem({ ln, r }) {
  return 2 * 128 * 2 ** ln * r;
}

/**
 * The key scrypt derives from `password`, already normalized.
 *
 * @param {string} password
 * @param {Buffer} salt
 * @param {Readonly<ScryptParams>} params
 * @returns {Promise<Buffer>}
 */
export function deriveKey(password, salt, params) {
  const options = { N: 2 ** params.ln, r: params.r, p: params.p, maxmem: scryptMaxmem(params) };
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_BYTES, options, (error, key) =>
      error ? reject(error) : resolve(key),
    );
  });
}

/**
 * A new PHC string for `password`, at the floor unless `params` says
 * otherwise; tests pass cheaper ones, which the owner profile refuses.
 * Throws on a password passwordProblem() refuses.
 *
 * @param {string} password
 * @param {Readonly<ScryptParams>} [params]
 * @returns {Promise<string>}
 */
export async function hashPassword(password, params = HASH_FLOOR) {
  const problem = passwordProblem(password);
  if (problem) {
    const bound = problem === 'too_short' ? `${PASSWORD_MIN} or more` : `${PASSWORD_MAX} or fewer`;
    throw new RangeError(`The password needs ${bound} characters.`);
  }
  const salt = randomBytes(SALT_BYTES);
  const key = await deriveKey(normalizePassword(password), salt, params);
  return formatHash({ params, salt, key });
}

/**
 * Whether `password` matches `hash`, compared in constant time.
 *
 * @param {string} password
 * @param {Readonly<PasswordHash>} hash
 * @returns {Promise<boolean>}
 */
export async function verifyPassword(password, hash) {
  const key = await deriveKey(normalizePassword(password), hash.salt, hash.params);
  return timingSafeEqual(key, hash.key);
}

/**
 * What a session records about the hash it was signed in under: base64url of
 * the first 16 bytes of SHA-256 over the PHC string. A new hash gives a new
 * fingerprint, which signs every session out.
 *
 * @param {string} phc
 * @returns {string}
 */
export function credentialFingerprint(phc) {
  return createHash('sha256').update(phc).digest().subarray(0, 16).toString('base64url');
}

/**
 * @param {Buffer} bytes
 * @returns {string}
 */
function base64(bytes) {
  return bytes.toString('base64').replace(/=+$/, '');
}
