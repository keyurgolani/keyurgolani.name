import { randomBytes } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import path from 'node:path';
import { recordOwnerModule } from '../load-trace';
import { nodeFs, type FsPort } from './fs-port';
import { STORE_LAYOUT, storePaths, tempBeside, type StorePaths } from './layout';

// The owner startup preflight for the data directory (#3, item 3): it's
// there, the server's user can write it, it sits outside the source mount,
// and a write, a sync, and a rename work in it. It makes the store's
// directories at 0700 and writes store.json, the layout version, into a new
// store. Startup logs the code it returns and stops; nothing here names the
// path. Only local Linux volumes are supported.

recordOwnerModule('core/store/preflight');

export type PreflightCode =
  /** Nothing there, or a file. */
  | 'data_dir_missing'
  /** The server may not look in a directory above it, or a link loops. */
  | 'data_dir_unreachable'
  | 'data_dir_not_writable'
  | 'data_dir_rename_failed'
  /** It's inside PORTFOLIO_SOURCE_DIR, or holds it. */
  | 'data_dir_in_source'
  /** store.json names a layout this build doesn't read. */
  | 'store_layout_unsupported';

export interface PreflightOptions {
  readonly dataDir: string;
  /** The source mount, PORTFOLIO_SOURCE_DIR, which the data directory must stay out of. */
  readonly sourceDir?: string;
  readonly fs?: FsPort;
}

const errorCode = (error: unknown) => (error as NodeJS.ErrnoException)?.code;

/** Whether `inner` is `outer` or under it. */
function within(outer: string, inner: string): boolean {
  const relative = path.relative(outer, inner);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

async function resolved(dir: string): Promise<string> {
  try {
    return await realpath(dir);
  } catch {
    return path.resolve(dir);
  }
}

/**
 * The directories a store holds, each made at 0700. The data directory
 * itself is the operator's mount, so its mode stays theirs.
 */
export function storeDirectories(paths: StorePaths): readonly string[] {
  return [
    paths.drafts,
    paths.revisions,
    paths.publication,
    paths.events,
    paths.assets,
    paths.audit,
    paths.ephemeral,
  ];
}

/** Null when the data directory is ready, or what's wrong with it. */
export async function preflight({
  dataDir,
  sourceDir,
  fs = nodeFs,
}: PreflightOptions): Promise<PreflightCode | null> {
  try {
    const found = await fs.stat(dataDir);
    if (!found?.isDirectory) return 'data_dir_missing';
  } catch (error) {
    return errorCode(error) === 'ENOTDIR' ? 'data_dir_missing' : 'data_dir_unreachable';
  }
  if (sourceDir !== undefined) {
    const data = await resolved(dataDir);
    const source = await resolved(sourceDir);
    if (within(source, data) || within(data, source)) return 'data_dir_in_source';
  }
  const paths = storePaths(dataDir);
  try {
    for (const dir of storeDirectories(paths)) await fs.mkdir(dir, 'preflight.mkdir');
  } catch {
    return 'data_dir_not_writable';
  }

  const probe = path.join(paths.root, `.probe-${randomBytes(6).toString('hex')}`);
  const renamed = `${probe}.renamed`;
  try {
    try {
      await fs.writeFile(probe, 'probe\n', 'preflight.probe.write', { exclusive: true });
      await fs.fsync(probe, 'preflight.probe.fsync');
    } catch {
      return 'data_dir_not_writable';
    }
    try {
      await fs.rename(probe, renamed, 'preflight.probe.rename');
      await fs.fsync(paths.root, 'preflight.probe.dir.fsync');
    } catch {
      return 'data_dir_rename_failed';
    }
  } finally {
    await fs.remove(probe, 'preflight.probe.remove').catch(() => {});
    await fs.remove(renamed, 'preflight.probe.remove').catch(() => {});
  }

  return storeLayout(fs, paths);
}

/** Checks store.json, writing it into a store that has none yet. */
async function storeLayout(fs: FsPort, paths: StorePaths): Promise<PreflightCode | null> {
  let text: string | null = null;
  try {
    text = (await fs.readFile(paths.storeFile)).toString('utf8');
  } catch (error) {
    if (errorCode(error) !== 'ENOENT') return 'data_dir_not_writable';
  }
  if (text !== null) {
    try {
      const layout = (JSON.parse(text) as { layout?: unknown } | null)?.layout;
      return layout === STORE_LAYOUT ? null : 'store_layout_unsupported';
    } catch {
      return 'store_layout_unsupported';
    }
  }
  const temp = tempBeside(paths.storeFile);
  try {
    await fs.writeFile(temp, `${JSON.stringify({ layout: STORE_LAYOUT })}\n`, 'store.write');
    await fs.fsync(temp, 'store.fsync');
    await fs.rename(temp, paths.storeFile, 'store.rename');
    await fs.fsync(paths.root, 'store.dir.fsync');
    return null;
  } catch {
    await fs.remove(temp, 'store.temp.remove').catch(() => {});
    return 'data_dir_not_writable';
  }
}
