import 'server-only';
import {
  authPaths,
  checkPrivateDir,
  ensurePrivateDir,
  isPrivateDirError,
  previewPaths,
  probeDataDirectory,
} from '@portfolio/core/owner';
import type { ConfigIssue, DeploymentConfig } from '../config';
import { recordOwnerModule } from '../load-trace';
import { ownerStoreOf } from './store';

// The data.directory startup requirement (#2, #3): owner needs
// PORTFOLIO_DATA_DIR, a directory the server's user can write. #3's half
// runs the store's preflight, which makes its directories, ephemeral/ and
// audit/ among them, and checks it sits outside PORTFOLIO_SOURCE_DIR and
// holds a layout this build reads, then claims publication/server.json, so
// a second server refuses to start. #2's half then proves a write, a sync,
// and a rename work in ephemeral/, the way session records are written, in
// a temporary directory it always removes, and checks the auth and preview
// directories under ephemeral/ that are there, as their readers do: a link,
// anything but a directory, or another user's stops startup, and a loosened
// mode is put back to 0700. It makes none of them: each writer makes its
// own at its first write. A start a later requirement refuses leaves the
// empty store and nothing more. Under `next dev`, the default .data is made
// if it's missing. A finding names the variable and the reason, never the
// path. Typed by shape, so this module doesn't import the composition root.

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
  data_dir_linked:
    'A directory under ephemeral/ in PORTFOLIO_DATA_DIR, such as ephemeral/auth/, is a symbolic ' +
    'link or not a directory, and the server never reads or writes sessions or grants through ' +
    'one. Remove it: the server makes the directory itself.',
  data_dir_not_private:
    'Another user owns a directory under ephemeral/ in PORTFOLIO_DATA_DIR, such as ' +
    "ephemeral/auth/, or its mode can't be set to 0700. Make it the server's own, or remove it: " +
    'the server makes the directory itself.',
};

/** The directories under ephemeral/ that hold auth state and preview grants, as their stores name them. */
function ownerDirectories(dataDir: string): readonly string[] {
  const auth = authPaths(dataDir);
  const preview = previewPaths(dataDir);
  return [auth.auth, auth.sessions, preview.root, preview.grants, preview.drafts];
}

export async function check({
  config,
  owner,
}: {
  readonly config: DeploymentConfig;
  /** The owner branch's store (#3), which takes the directory's claim. */
  readonly owner?: object;
}): Promise<readonly ConfigIssue[]> {
  const { dataDir } = config;
  if (dataDir === undefined) return [fatal('required')];
  if (config.dataDirDefault) await ensurePrivateDir(dataDir).catch(() => {});
  const store = ownerStoreOf(owner);
  if (!store) {
    const problem = await probeDataDirectory(dataDir);
    return problem === null ? [] : [fatal(problem)];
  }
  const issues = await store.checkDirectory();
  if (issues.some((issue) => issue.severity === 'fatal')) return issues;
  const problem = await probeDataDirectory(dataDir, { within: authPaths(dataDir).ephemeral });
  if (problem !== null) return [...issues, fatal(problem)];
  for (const dir of ownerDirectories(dataDir)) {
    try {
      await checkPrivateDir(dataDir, dir);
    } catch (error) {
      return [...issues, privateDirFinding(error) ?? fatal('data_dir_unreachable')];
    }
  }
  return issues;
}

/**
 * The finding for a directory the auth or grant store refused, from
 * startup's check or from a writer after it, such as the provider's first
 * fingerprint write. Null for any other error.
 */
export function privateDirFinding(error: unknown): ConfigIssue | null {
  if (!isPrivateDirError(error)) return null;
  return fatal(error.code === 'linked' ? 'data_dir_linked' : 'data_dir_not_private');
}

function fatal(code: string): ConfigIssue {
  return { severity: 'fatal', key: KEY, code, message: MESSAGES[code] ?? MESSAGES['required']! };
}
