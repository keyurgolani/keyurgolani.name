import 'server-only';
import { ensurePrivateDir, prepareAuthDirectories } from '@portfolio/core/owner';
import type { ConfigIssue, DeploymentConfig } from '../config';
import { recordOwnerModule } from '../load-trace';
import { ownerStoreOf } from './store';

// The data.directory startup requirement (#2, #3): owner needs
// PORTFOLIO_DATA_DIR, a directory the server's user can write. #2's half
// creates ephemeral/auth/sessions/ and audit/ there at 0700, and proves a
// write, a sync, and a rename work, the way session records are written.
// #3's half runs the store's preflight, which makes its directories and
// checks it sits outside PORTFOLIO_SOURCE_DIR and holds a layout this build
// reads, then claims publication/server.json, so a second server refuses to
// start. Under `next dev`, the default .data is made if it's missing. A
// finding names the variable and the reason, never the path. Typed by
// shape, so this module doesn't import the composition root.

recordOwnerModule('server/owner/data-directory');

const KEY = 'PORTFOLIO_DATA_DIR';

const MESSAGES: Readonly<Record<string, string>> = {
  required:
    'The owner profile needs PORTFOLIO_DATA_DIR: a directory the server can write, such as ' +
    'the volume deploy/compose.owner.yml mounts at /var/lib/portfolio.',
  data_dir_missing: 'PORTFOLIO_DATA_DIR names no directory. Create it, or mount a volume there.',
  data_dir_unreachable:
    "The server can't reach PORTFOLIO_DATA_DIR: a directory above it doesn't let the server's " +
    'user look in, or a link loops.',
  data_dir_not_writable:
    "The server can't write in PORTFOLIO_DATA_DIR. Give the server's user (uid 1001 in the " +
    'image) write access, as the image does for /var/lib/portfolio.',
  data_dir_rename_failed:
    "The server can't rename files in PORTFOLIO_DATA_DIR. Use a local Linux volume.",
};

export async function check({
  config,
  owner,
}: {
  readonly config: DeploymentConfig;
  /** The owner branch's store (#3), which takes the directory's claim. */
  readonly owner?: object;
}): Promise<readonly ConfigIssue[]> {
  if (config.dataDir === undefined) return [fatal('required')];
  if (config.dataDirDefault) await ensurePrivateDir(config.dataDir).catch(() => {});
  const problem = await prepareAuthDirectories(config.dataDir);
  if (problem !== null) return [fatal(problem)];
  return (await ownerStoreOf(owner)?.checkDirectory()) ?? [];
}

function fatal(code: string): ConfigIssue {
  return { severity: 'fatal', key: KEY, code, message: MESSAGES[code] ?? MESSAGES['required']! };
}
