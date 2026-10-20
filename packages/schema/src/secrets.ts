import { isPlainObject } from './json';

// Secret-shaped text, which no document may hold (#4, item 13): GitHub
// tokens, PEM private keys, PHC and bcrypt password hashes, and AWS access
// key IDs. Documents never interpolate environment values, so a secret in one
// was pasted there. Messages name the kind of secret, never the text.

export type SecretKind = 'github-token' | 'private-key' | 'phc-hash' | 'bcrypt-hash' | 'aws-key-id';

const PATTERNS: ReadonlyArray<readonly [SecretKind, RegExp]> = [
  // Personal, OAuth, user-to-server, server-to-server, and refresh tokens.
  ['github-token', /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,})/],
  ['private-key', /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----/],
  [
    'phc-hash',
    /\$(?:argon2(?:id|i|d)|scrypt|pbkdf2(?:-sha(?:1|256|384|512))?|balloon)(?:\$v=\d+)?\$[A-Za-z0-9=,+/.-]+\$[A-Za-z0-9+/.=-]+/,
  ],
  ['bcrypt-hash', /\$2[abxy]\$\d{2}\$[./A-Za-z0-9]{53}/],
  ['aws-key-id', /\bAKIA[0-9A-Z]{16}\b/],
];

export const SECRET_LABELS: Readonly<Record<SecretKind, string>> = {
  'github-token': 'a GitHub token',
  'private-key': 'a PEM private key',
  'phc-hash': 'a PHC password hash',
  'bcrypt-hash': 'a bcrypt password hash',
  'aws-key-id': 'an AWS access key ID',
};

/** The kind of secret the text holds, or undefined when it looks like none. */
export function secretKind(text: string): SecretKind | undefined {
  return PATTERNS.find(([, pattern]) => pattern.test(text))?.[0];
}

/** One secret-shaped string in a document. */
export interface SecretFinding {
  /** Path to the value, or to the object whose key is secret-shaped. */
  readonly path: readonly (string | number)[];
  readonly kind: SecretKind;
  readonly in: 'value' | 'key';
}

/** Every secret-shaped string in a parsed document, keys and extension data included. */
export function findSecrets(document: unknown): SecretFinding[] {
  const found: SecretFinding[] = [];
  const walk = (node: unknown, path: readonly (string | number)[]): void => {
    if (typeof node === 'string') {
      const kind = secretKind(node);
      if (kind) found.push({ path, kind, in: 'value' });
    } else if (Array.isArray(node)) {
      node.forEach((child, index) => walk(child, [...path, index]));
    } else if (isPlainObject(node)) {
      for (const [key, child] of Object.entries(node)) {
        const kind = secretKind(key);
        // A secret-shaped key would put the secret in every pointer below it.
        if (kind) found.push({ path, kind, in: 'key' });
        else walk(child, [...path, key]);
      }
    }
  };
  walk(document, []);
  return found;
}

/** Replaces anything secret-shaped in a message or pointer, so no log line repeats it. */
export function redactSecrets(text: string): string {
  let redacted = text;
  for (const [, pattern] of PATTERNS) {
    redacted = redacted.replace(new RegExp(pattern.source, 'g'), '[secret]');
  }
  return redacted;
}
