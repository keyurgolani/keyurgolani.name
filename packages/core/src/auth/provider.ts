import { timingSafeEqual } from 'node:crypto';
import { recordOwnerModule } from '../load-trace';
import { deriveKey, normalizePassword, PASSWORD_MAX, type PasswordHash } from './phc.mjs';

// The replaceable sign-in boundary (#2), and v1's one provider: the owner's
// password, checked against the scrypt hash from the deployment secret.

recordOwnerModule('core/auth/provider');

/** Who signed in. v1 has one: the owner, by password. */
export interface Principal {
  readonly id: 'owner';
  readonly method: 'password';
  /** When, in milliseconds since the epoch. */
  readonly authTime: number;
}

export type Verification =
  { readonly ok: true; readonly principal: Principal } | { readonly ok: false };

export interface AuthProvider {
  /**
   * Checks one sign-in attempt. Every attempt costs exactly one key
   * derivation and fails the same way, whatever was wrong with it.
   */
  verify(input: { readonly password: unknown }): Promise<Verification>;
}

export interface LocalPasswordOptions {
  /** The configured hash, parsed and checked at startup. */
  readonly hash: Readonly<PasswordHash>;
  readonly now?: () => number;
  /** The key derivation. Tests count its calls. */
  readonly derive?: typeof deriveKey;
}

const FAILED: Verification = Object.freeze({ ok: false });

/**
 * The owner-password provider. A missing, empty, non-string, or overlong
 * password is derived in place of nothing usable, so it costs what a wrong
 * one does, and no failure says which it was.
 */
export function localPasswordProvider({
  hash,
  now = Date.now,
  derive = deriveKey,
}: LocalPasswordOptions): AuthProvider {
  return {
    async verify({ password }) {
      const normalized = typeof password === 'string' ? normalizePassword(password) : '';
      const usable = normalized !== '' && [...normalized].length <= PASSWORD_MAX;
      const key = await derive(usable ? normalized : '', hash.salt, hash.params);
      if (!timingSafeEqual(key, hash.key) || !usable) return FAILED;
      return {
        ok: true,
        principal: Object.freeze({ id: 'owner', method: 'password', authTime: now() }),
      };
    },
  };
}
