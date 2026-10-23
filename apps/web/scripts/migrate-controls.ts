// `pnpm variants:migrate-controls --site <path> [--write]` (#5, Slice 5,
// item 3). It steps each variant's stored control values in a site document
// to the controls version its manifest declares, by the manifest's own
// migrations, and prints what changes and a diff of the document. It writes
// the file only with --write, in place, and through a symbolic link to the
// file the link names, with that file's mode, owner, and group. A YAML
// document keeps every line it doesn't change, comments included; a JSON
// document is written whole, in its own indent. Once it has written, a
// second run finds every entry current and changes nothing. Values for a
// variant this build doesn't register, or from a newer release of one, stay
// as they are.
//
// Exit status: 0 once it has printed the plan (with --write, once the file
// is written); 1 for a wrong argument, a file it can't read or write, a
// document that isn't a site document this release reads, a link whose file
// is named for the other format, a file whose owner and group this user
// can't give the new one, or text the edits can't be made in, such as YAML
// with a complex key (`? key`). Each 1 leaves the file as it is.
//
// Relative paths are taken from the directory pnpm ran in (INIT_CWD).

// First: REGISTRY comes from the server-only variant registry (#6).
import './server-only.cjs';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import {
  applyEdits,
  detectFormat,
  DOCUMENT_MAX_BYTES,
  jsonIndent,
  readSite,
  redactSecrets,
  type DocumentFormat,
} from '@portfolio/schema';
import { unifiedDiff } from '@portfolio/schema/migrate';
import {
  planControlsMigration,
  type ControlChange,
  type ControlsMigrationEntry,
  type VariantRegistry,
} from '@portfolio/variant-contract';
import { REGISTRY } from '../src/lib/variants';

const USAGE = 'Usage: pnpm variants:migrate-controls --site <path> [--write]';

export interface CommandIo {
  /** Where relative paths start: the directory pnpm ran in. */
  readonly cwd: string;
  readonly out: (text: string) => void;
  readonly err: (text: string) => void;
}

class UsageError extends Error {}

/** Runs the command against `registry` and returns its exit status. */
export function migrateControlsCommand(
  args: readonly string[],
  registry: VariantRegistry,
  io: CommandIo,
): number {
  try {
    return run(args, registry, io);
  } catch (error) {
    if (error instanceof UsageError) {
      io.err(`${error.message}\n${USAGE}\n`);
      return 1;
    }
    throw error;
  }
}

function run(args: readonly string[], registry: VariantRegistry, io: CommandIo): number {
  let parsed;
  try {
    parsed = parseArgs({
      args: [...args],
      options: {
        site: { type: 'string' },
        write: { type: 'boolean', default: false },
        help: { type: 'boolean', short: 'h', default: false },
      },
    });
  } catch (error) {
    throw new UsageError((error as Error).message);
  }
  const { values } = parsed;
  if (values.help) {
    io.out(`${USAGE}\n`);
    return 0;
  }
  if (values.site === undefined) throw new UsageError('Give the site document with --site.');
  const given = values.site;
  const file = path.resolve(io.cwd, given);
  let format: DocumentFormat;
  try {
    format = detectFormat(file);
  } catch (error) {
    throw new UsageError(`${given}: ${(error as Error).message}`);
  }

  // The file itself, which a symbolic link names: what's read and replaced.
  let target: string;
  let text: string;
  try {
    target = fs.realpathSync(file);
    if (fs.statSync(target).size > DOCUMENT_MAX_BYTES) {
      io.err(`${given} is larger than a site document this release reads.\n`);
      return 1;
    }
    text = fs.readFileSync(target, 'utf8');
  } catch {
    io.err(`${given} can't be read.\n`);
    return 1;
  }
  // The server reads the document in the format the link's name says, and
  // other tools read the file in the one its own name says, so when the two
  // differ, either format could leave one of them unable to read it.
  const own = namedFormat(target);
  if (own !== undefined && own !== format) {
    io.err(
      `${given} links to ${path.basename(target)}, a file named for the other format, so it's left as it is. Give the link and the file the same extension, then run it again.\n`,
    );
    return 1;
  }
  const read = readSite(text, format, { name: given });
  if (!read.value) {
    io.err(
      `${given} isn't a site document this release reads. Run pnpm config:validate to see why.\n`,
    );
    return 1;
  }

  const plan = planControlsMigration(read.value, registry);
  const lines = plan.entries.map((entry) => `${given}: ${describe(entry)}\n`);
  if (plan.edits.length === 0) {
    io.out(redactSecrets(`${lines.join('')}Nothing to migrate in ${given}.\n`));
    return 0;
  }
  let after: string;
  try {
    // A JSON document is written whole, so it keeps its own indent.
    after = applyEdits(
      text,
      format,
      plan.edits,
      format === 'json' ? { indent: jsonIndent(text) } : {},
    );
  } catch {
    io.out(redactSecrets(lines.join('')));
    io.err(
      `${given} has text the migration can't edit in place, such as a YAML complex key (? key), so it's left as it is. Make the changes above by hand, or write that entry as plain key: value lines and run it again.\n`,
    );
    return 1;
  }
  const diff = unifiedDiff(text, after, { before: given, after: given });
  io.out(redactSecrets(`${lines.join('')}\n${diff ?? `${after}\n`}`));
  if (!values.write) {
    io.out(`\nRun it again with --write to write ${given}.\n`);
    return 0;
  }
  try {
    replace(target, after);
  } catch (error) {
    io.err(
      error instanceof OwnerError
        ? `${given} belongs to uid ${error.uid} and gid ${error.gid}, which a file this user writes can't keep, so it's left as it is. Run the command as that user, or with sudo.\n`
        : `${given} can't be written.\n`,
    );
    return 1;
  }
  io.out(`\nWrote ${given}.\n`);
  return 0;
}

/** The format a path's own name declares, if it names one. */
function namedFormat(file: string): DocumentFormat | undefined {
  try {
    return detectFormat(file);
  } catch {
    return undefined;
  }
}

/** The new file can't have the old one's owner and group, so it isn't written. */
class OwnerError extends Error {
  constructor(
    readonly uid: number,
    readonly gid: number,
  ) {
    super(`The file belongs to uid ${uid} and gid ${gid}.`);
  }
}

/** One entry's line: what happens to it, and each change a migration makes. */
function describe(entry: ControlsMigrationEntry): string {
  const name = `${entry.variant}'s controls`;
  switch (entry.status) {
    case 'migrated':
      return [
        `${name} migrate from version ${entry.from} to ${entry.to}:`,
        ...entry.changes.map((change) => `  ${describeChange(change)}`),
      ].join('\n');
    case 'current':
      return `${name} are current, at version ${entry.to}.`;
    case 'newer':
      return `${name} stay as they are: version ${entry.from} is newer than the installed package's. Upgrade the package to read them.`;
    case 'stuck':
      return `${name} stay as they are: no migration in the installed package steps from version ${entry.from}.`;
    case 'unregistered':
      return `${name} stay as they are: this build doesn't register ${entry.variant}.`;
  }
}

function describeChange(change: ControlChange): string {
  const value = (data: unknown) => JSON.stringify(data);
  switch (change.op) {
    case 'rename':
      return `renames ${change.control} to ${String(change.after)}`;
    case 'mapValue':
      return `maps ${change.control} from ${value(change.before)} to ${value(change.after)}`;
    case 'clamp':
      return `clamps ${change.control} from ${value(change.before)} to ${value(change.after)}`;
    case 'drop':
      return `drops ${change.control}`;
  }
}

/**
 * Replaces `target`, the file itself and never a link to it, with `text` in
 * one rename, so a reader sees the old document or the new one. The new file
 * is made beside it and gets its mode, owner, and group before any text, so
 * whoever could read the old one, such as the server's user through the
 * group, reads the new one. When this user can't give it that owner and
 * group, nothing changes and it throws an OwnerError.
 */
function replace(target: string, text: string): void {
  const { mode, uid, gid } = fs.statSync(target);
  const temp = path.join(
    path.dirname(target),
    `.${path.basename(target)}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`,
  );
  // Only this user can open it until it has the old file's mode.
  const fd = fs.openSync(temp, 'wx', 0o600);
  try {
    try {
      try {
        fs.fchownSync(fd, uid, gid);
      } catch {
        throw new OwnerError(uid, gid);
      }
      // After the owner, which can clear mode bits, and past the umask.
      fs.fchmodSync(fd, mode & 0o777);
      fs.writeFileSync(fd, text);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(temp, target);
  } catch (error) {
    fs.rmSync(temp, { force: true });
    throw error;
  }
}

const invoked = process.argv[1];
if (invoked !== undefined && pathToFileURL(path.resolve(invoked)).href === import.meta.url) {
  process.exitCode = migrateControlsCommand(process.argv.slice(2), REGISTRY, {
    cwd: process.env.INIT_CWD || process.cwd(),
    out: (text) => process.stdout.write(text),
    err: (text) => process.stderr.write(text),
  });
}
