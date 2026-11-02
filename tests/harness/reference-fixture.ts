// The CI reference fixture (#9), for every suite that mounts it: the profile
// matrix's demo app, and the route specs, which run on the fixture host's
// build. It imports nothing registry generation writes, so a suite that
// never generated this checkout's registry can load it.
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * A fictional full export, with private-record and private-media canaries,
 * which demo mounts read-only. The server only reads it.
 */
export const REFERENCE_FIXTURE = fileURLToPath(
  new URL('../fixtures/reference-export', import.meta.url),
);

/**
 * A copy of the reference fixture's own files in `to`, with no dotfile a
 * checkout picked up beside them, such as a .DS_Store, which would make the
 * reference unavailable: the demo refuses any file bundle.json doesn't list.
 * Its directory's name keeps the fixture's, which the leak scans look for.
 */
export function copyReferenceFixture(
  to = mkdtempSync(path.join(tmpdir(), `${path.basename(REFERENCE_FIXTURE)}-`)),
): string {
  cpSync(REFERENCE_FIXTURE, to, {
    recursive: true,
    filter: (from) => from === REFERENCE_FIXTURE || !path.basename(from).startsWith('.'),
  });
  return to;
}

/** The copy of the fixture demo mounts in this process, gone as the process exits. */
export const REFERENCE_MOUNT = copyReferenceFixture();
process.once('exit', () => rmSync(REFERENCE_MOUNT, { recursive: true, force: true }));
