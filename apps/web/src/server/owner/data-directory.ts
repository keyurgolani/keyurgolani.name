import 'server-only';
import { prepareAuthDirectories } from '@portfolio/core/owner';
import type { ConfigIssue, DeploymentConfig } from '../config';
import { recordOwnerModule } from '../load-trace';

// The data.directory startup requirement (#2, until #3 takes it over): owner
// needs PORTFOLIO_DATA_DIR, a directory the server's user can write. This
// creates ephemeral/auth/sessions/ and audit/ there at 0700, and proves a
// write, a sync, and a rename work, the way session records are written. A
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
}: {
  readonly config: DeploymentConfig;
}): Promise<readonly ConfigIssue[]> {
  if (config.dataDir === undefined) return [fatal('required')];
  const problem = await prepareAuthDirectories(config.dataDir);
  return problem === null ? [] : [fatal(problem)];
}

function fatal(code: string): ConfigIssue {
  return { severity: 'fatal', key: KEY, code, message: MESSAGES[code] ?? MESSAGES['required']! };
}
