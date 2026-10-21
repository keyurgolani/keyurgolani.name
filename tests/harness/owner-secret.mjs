// The owner profile's secret for one test run (#2): a password made for the
// run, and its hash from the owner CLI's own hash-password, given the
// password twice on standard input that isn't a terminal, as --stdin needs.
// The profile matrix and `pnpm smoke:profiles` start owner with it, and seed
// both as canaries: no response may carry the password or the hash.
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** This repo's owner CLI, under the Node running the harness. */
export const OWNER_CLI = [
  process.execPath,
  path.join(REPO_ROOT, 'apps', 'web', 'bin', 'owner.mjs'),
];

/**
 * A password made for this run and the hash hash-password prints for it.
 * `command` runs the CLI, `owner.mjs` and what starts it, such as the image's
 * through a container runtime.
 *
 * @param {readonly string[]} [command]
 * @returns {{ password: string, hash: string }}
 */
export function ownerSecret(command = OWNER_CLI) {
  const password = `canary-password-${randomBytes(12).toString('hex')}`;
  const [file, ...args] = command;
  const result = spawnSync(file, [...args, 'hash-password', '--stdin'], {
    input: `${password}\n${password}\n`,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 120_000,
  });
  const hash = (result.stdout ?? '').replace(/\n$/, '');
  if (result.status !== 0 || !/^\$scrypt\$[^\s$]+\$[^\s$]+\$[^\s$]+$/.test(hash)) {
    throw new Error(
      `hash-password --stdin exited ${result.status ?? result.signal}: ${(result.stderr ?? '').trim()}`,
    );
  }
  return { password, hash };
}
