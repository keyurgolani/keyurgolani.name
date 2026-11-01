import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { AuditSink } from '../audit/sink';
import {
  authPaths,
  checkPrivateDir,
  preparePrivateDir,
  writePrivateFile,
} from '../data/layout.mjs';
import { recordOwnerModule } from '../load-trace';
import { revokeAllSessionFiles } from './session-files.mjs';

// The credential fingerprint at owner startup (#2). Every session records
// the fingerprint of the hash it signed in under, and one under another
// hash no longer counts. A new hash also revokes every session at the
// restart, as revoke-sessions does, so going back to the old hash later
// brings none of them back. ephemeral/auth/fingerprint holds the last one
// the server started with, and the change goes in the audit log. The
// first write makes ephemeral/auth/, at 0700.

recordOwnerModule('core/auth/fingerprint');

/**
 * Compares `fingerprint` with the one the data directory holds and writes it
 * there. A changed one revokes every session first, then appends
 * `credential_changed`, by the operator. A missing or empty file is written
 * with neither.
 */
export async function syncCredentialFingerprint({
  dataDir,
  fingerprint,
  audit,
  now = Date.now,
}: {
  readonly dataDir: string;
  readonly fingerprint: string;
  readonly audit: AuditSink;
  readonly now?: () => number;
}): Promise<'written' | 'changed' | 'same'> {
  const file = authPaths(dataDir).fingerprint;
  await checkPrivateDir(dataDir, path.dirname(file));
  let previous: string | null = null;
  try {
    previous = (await readFile(file, 'utf8')).trim();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  if (previous === fingerprint) return 'same';
  await preparePrivateDir(dataDir, path.dirname(file));
  if (previous === null || previous === '') {
    await writePrivateFile(file, `${fingerprint}\n`);
    return 'written';
  }
  // Revoked before the new fingerprint is written: a crash in between
  // revokes again at the next start, never not at all.
  await revokeAllSessionFiles(dataDir, now());
  await writePrivateFile(file, `${fingerprint}\n`);
  await audit.record({ type: 'credential_changed', actor: 'operator', outcome: 'success' });
  return 'changed';
}
