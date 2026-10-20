#!/usr/bin/env node
/**
 * config.mjs: commands for the portfolio's documents (#4, items 19 and 22).
 * Run it through `pnpm config:validate` or `pnpm config:migrate`, which build
 * the variant registry first and run this file with tsx.
 *
 *   pnpm config:validate [dir] [--origin <url>] [--json]
 *
 * validate reads the pair in a directory, portfolio.{yml,yaml,json} and
 * site.{yml,yaml,json}, the way startup does, and prints every record it
 * finds: where, its code and severity, what's wrong, and how to fix it.
 *
 *   dir             The directory that holds the pair. Defaults to the
 *                   repository's config directory, which `pnpm dev` reads.
 *   --origin <url>  The site's origin, such as https://example.com, to check
 *                   links against. Without it, those checks are listed as not
 *                   checked.
 *   --json          Print the records as JSON instead.
 *
 * Exit status: 0 when nothing blocks the pair (warnings may remain); 1 when
 * something does, the directory can't be read, or an argument is wrong.
 *
 *   pnpm config:migrate <old-file> [--set <portfolio|site>.<path>=<value>]...
 *     [--drop-unknown] [--origin <url>] [--summary] [--write --out <dir>]
 *
 * migrate reads a file in the old one-file format and prints what this
 * release's portfolio and site documents would be: each field it moves, the
 * values it needs with the ids this build accepts, the section ids it gives,
 * the comments it can't keep, the new pair's diagnostics, a diff of the
 * portfolio document, and the whole site document. It writes nothing without
 * --write, never over a file that exists, and never to the old file. While
 * the old file holds secret-shaped text, it shows where, and no value, diff,
 * or document.
 *
 *   --set <path>=<value>  A value the migration needs, such as
 *                         site.appearance.colorScheme=warm. One per value.
 *   --drop-unknown        Drop the keys the old schema dropped when it read
 *                         the file, instead of stopping on them.
 *   --origin <url>        The site's real public origin, such as
 *                         https://example.com, to check the new pair's links
 *                         against. Without it, those checks are listed as not
 *                         checked; the old meta.url is never used for them.
 *   --summary             Leave every value the documents hold out of the
 *                         report, so it can go to a log.
 *   --write               Write portfolio.yml and site.yml (portfolio.json
 *                         and site.json for a JSON file) into --out.
 *   --out <dir>           Where --write puts them. Made when it's missing.
 *
 * Exit status: 0 when the file is already current, or nothing stops the
 * migration (with --write, once both documents are written); 2 when it needs
 * a value, a decision on unknown keys, or a fix for a problem the new
 * documents would have; 1 for anything else, such as a bad argument, a file
 * it can't read or migrate, a document already at --out, or an --out it
 * can't write into.
 *
 * Relative paths are taken from the directory pnpm ran in (INIT_CWD).
 */
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { detectFormat, DOCUMENT_MAX_BYTES, redactSecrets } from '@portfolio/schema';
import { formatMigration, migrate, parseSet } from '@portfolio/schema/migrate';
import { formatRecords, loadPair, pairFileNames } from '@portfolio/schema/node';

/**
 * What this build registers: the appearance catalog the host builds from its
 * variants, and its content extensions. Imported dynamically, since tsx
 * hands an .mjs file the host's TypeScript modules as CommonJS, whose names
 * a static import can't see.
 */
async function hostCatalog() {
  const [{ listManifests }, { createAppearanceCatalog }, { CONTENT_EXTENSIONS }] =
    await Promise.all([
      import('../src/lib/registry.ts'),
      import('../src/server/appearance-catalog.ts'),
      import('../src/server/content-extensions.ts'),
    ]);
  return { catalog: createAppearanceCatalog(listManifests()), extensions: CONTENT_EXTENSIONS };
}

const VALIDATE_USAGE = 'Usage: pnpm config:validate [dir] [--origin <url>] [--json]';
const MIGRATE_USAGE = [
  'Usage: pnpm config:migrate <old-file> [--set <portfolio|site>.<path>=<value>]...',
  '         [--drop-unknown] [--origin <url>] [--summary] [--write --out <dir>]',
].join('\n');

/** Where `pnpm dev` reads the pair: the repository's config directory. */
const CONFIG_DIR = fileURLToPath(new URL('../../../config', import.meta.url));

class UsageError extends Error {}

/** A file the migration won't write, because something holds its name. */
class InTheWay extends Error {}

/** A bare http or https origin, as startup takes PORTFOLIO_ORIGIN, or undefined. */
function bareOrigin(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  return /^https?:$/.test(url.protocol) && url.origin === value ? url.origin : undefined;
}

/** Reads at most `limit` bytes: the parser refuses a longer document anyway. */
function readBounded(file, limit) {
  const fd = fs.openSync(file, 'r');
  try {
    const buffer = Buffer.alloc(limit);
    let length = 0;
    while (length < limit) {
      const read = fs.readSync(fd, buffer, length, limit - length, length);
      if (read === 0) break;
      length += read;
    }
    return buffer.subarray(0, length).toString('utf8');
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Creates `file` with `text`, never over anything: the text goes to a temp
 * file beside it, synced to disk, then a hard link gives it the name, which
 * fails when the name is taken. Where the file system has no hard links, a
 * rename does, after checking the name is still free.
 */
function writeNew(file, text) {
  const temp = path.join(
    path.dirname(file),
    `.${path.basename(file)}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`,
  );
  const fd = fs.openSync(temp, 'wx');
  try {
    fs.writeFileSync(fd, text);
    fs.fsyncSync(fd);
  } catch (error) {
    fs.closeSync(fd);
    fs.rmSync(temp, { force: true });
    throw error;
  }
  fs.closeSync(fd);
  try {
    try {
      fs.linkSync(temp, file);
    } catch (error) {
      if (error.code === 'EEXIST') throw new InTheWay(file);
      if (fs.existsSync(file)) throw new InTheWay(file);
      fs.renameSync(temp, file);
    }
  } finally {
    fs.rmSync(temp, { force: true });
  }
}

async function migrateCommand(args) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      set: { type: 'string', multiple: true, default: [] },
      'drop-unknown': { type: 'boolean', default: false },
      origin: { type: 'string' },
      summary: { type: 'boolean', default: false },
      write: { type: 'boolean', default: false },
      out: { type: 'string' },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
  if (values.help) {
    process.stdout.write(`${MIGRATE_USAGE}\n`);
    return 0;
  }
  if (positionals.length !== 1) throw new UsageError('Give one old file to migrate.');
  if (values.write && values.out === undefined) throw new UsageError('--write needs --out <dir>.');
  if (!values.write && values.out !== undefined) throw new UsageError('--out goes with --write.');
  let set;
  try {
    set = values.set.map(parseSet);
  } catch (error) {
    throw new UsageError(error.message);
  }
  const origin = values.origin === undefined ? undefined : bareOrigin(values.origin);
  if (values.origin !== undefined && origin === undefined) {
    throw new UsageError('--origin takes an origin alone, such as https://example.com.');
  }

  const base = process.env.INIT_CWD || process.cwd();
  const given = positionals[0];
  const file = path.resolve(base, given);
  if (path.extname(file).toLowerCase() === '.toml') {
    process.stderr.write(
      `${given} is TOML, which this release doesn't read. Convert it to YAML or JSON first, then run pnpm config:migrate on that.\n`,
    );
    return 1;
  }
  let format;
  try {
    format = detectFormat(file);
  } catch (error) {
    throw new UsageError(`${given}: ${error.message}`);
  }
  let text;
  try {
    text = readBounded(file, DOCUMENT_MAX_BYTES + 4);
  } catch (error) {
    process.stderr.write(`Can't read ${given} (${error.code ?? 'error'}).\n`);
    return 1;
  }

  const migration = migrate(
    { text, format },
    {
      set,
      dropUnknown: values['drop-unknown'],
      ...(origin ? { origin } : {}),
      ...(await hostCatalog()),
    },
  );
  // Secret-shaped text never reaches the terminal or a log, even from the
  // owner's own file: the report flags it instead.
  const report = formatMigration(migration, { file: given, summary: values.summary });
  process.stdout.write(redactSecrets(report));

  if (migration.status === 'failed') return 1;
  if (migration.status === 'current') return 0;
  if (migration.status === 'blocked') return 2;
  if (!values.write) return 0;

  // A path under the directory pnpm ran in reads best relative to it.
  const shown = (file) => {
    const relative = path.relative(base, file);
    return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)
      ? relative
      : file;
  };
  const out = path.resolve(base, values.out);
  const extension = format === 'json' ? 'json' : 'yml';
  const targets = [
    [path.join(out, `portfolio.${extension}`), migration.portfolio.text],
    [path.join(out, `site.${extension}`), migration.site.text],
  ];
  try {
    for (const [target] of targets) {
      if (fs.existsSync(target) || isSymlink(target)) throw new InTheWay(target);
    }
    fs.mkdirSync(out, { recursive: true });
    const written = [];
    try {
      for (const [target, content] of targets) {
        writeNew(target, content);
        written.push(target);
      }
    } catch (error) {
      // Both documents or neither: take back the one this run made.
      for (const target of written) fs.rmSync(target, { force: true });
      throw error;
    }
  } catch (error) {
    if (error instanceof InTheWay) {
      process.stderr.write(
        `${shown(error.message)} already exists. The migration never replaces a file: pick another --out, or move that file away first. Nothing was written.\n`,
      );
      return 1;
    }
    // A file in the way of the directory, no permission, a full disk: one
    // line, never a stack trace.
    if (typeof error?.code === 'string') {
      const why = ['EEXIST', 'ENOTDIR'].includes(error.code)
        ? `${shown(out)} isn't a directory`
        : `Can't write into ${shown(out)} (${error.code})`;
      process.stderr.write(`${why}. Nothing was written.\n`);
      return 1;
    }
    throw error;
  }
  process.stdout.write(`\nWrote ${targets.map(([target]) => shown(target)).join(' and ')}.\n`);
  return 0;
}

function isSymlink(file) {
  try {
    return fs.lstatSync(file).isSymbolicLink();
  } catch {
    return false;
  }
}

async function validateCommand(args) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      origin: { type: 'string' },
      json: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
  if (values.help) {
    process.stdout.write(`${VALIDATE_USAGE}\n`);
    return 0;
  }
  if (positionals.length > 1) throw new UsageError('Give one directory to validate.');
  const origin = values.origin === undefined ? undefined : bareOrigin(values.origin);
  if (values.origin !== undefined && origin === undefined) {
    throw new UsageError('--origin takes an origin alone, such as https://example.com.');
  }

  const base = process.env.INIT_CWD || process.cwd();
  const dir = positionals[0] === undefined ? CONFIG_DIR : path.resolve(base, positionals[0]);
  const result = loadPair(dir, {
    ...(await hostCatalog()),
    ...(origin ? { canonicalOrigin: origin } : {}),
  });
  const report = values.json
    ? `${JSON.stringify(jsonReport(result), null, 2)}\n`
    : textReport(result, shownPath(base, dir), origin !== undefined);
  // Records never quote a value, and this keeps it that way for the terminal.
  process.stdout.write(redactSecrets(report));
  return result.ok ? 0 : 1;
}

/** The records as startup logs them and Studio shows them, with the file names. */
function jsonReport(result) {
  const files = pairFileNames(result);
  return {
    ok: result.ok,
    ...(result.ok || !result.directory ? {} : { directory: result.directory }),
    ...(files ? { files } : {}),
    diagnostics: result.diagnostics,
    notChecked: result.notChecked,
  };
}

const DIRECTORY_PROBLEMS = {
  missing: "doesn't exist.",
  'not-directory': 'is a file. Give the directory that holds the pair, portfolio.yml and site.yml.',
  unreadable: "can't be read.",
};

function textReport(result, shownDir, withOrigin) {
  if (!result.ok && result.directory)
    return `${shownDir} ${DIRECTORY_PROBLEMS[result.directory]}\n`;
  const lines = [];
  const blocking = result.diagnostics.filter(({ severity }) => severity !== 'warning').length;
  if (result.ok) {
    const { portfolio, site } = pairFileNames(result);
    const warnings = result.diagnostics.length;
    const also = warnings === 0 ? '' : `, with ${count(warnings, 'warning')}`;
    lines.push(`${portfolio} and ${site} are valid${also}.`);
  } else {
    const verb = blocking === 1 ? 'blocks' : 'block';
    lines.push(`${shownDir} can't go live: ${count(blocking, 'record')} ${verb} it.`);
  }
  if (result.notChecked.length > 0) {
    lines.push(`Not checked: ${result.notChecked.join(', ')}.`);
    if (!withOrigin && result.notChecked.some((entry) => entry.startsWith('origin.'))) {
      lines.push("Pass --origin with the site's origin to check its links against it.");
    }
  }
  return `${formatRecords(result)}${lines.join('\n')}\n`;
}

function count(n, noun) {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

/** A path under the directory pnpm ran in reads best relative to it. */
function shownPath(base, file) {
  const relative = path.relative(base, file);
  if (relative === '') return '.';
  return !relative.startsWith('..') && !path.isAbsolute(relative) ? relative : file;
}

const COMMANDS = {
  validate: { run: validateCommand, usage: VALIDATE_USAGE },
  migrate: { run: migrateCommand, usage: MIGRATE_USAGE },
};

async function main(argv) {
  const [command, ...args] = argv;
  const entry =
    command !== undefined && Object.hasOwn(COMMANDS, command) ? COMMANDS[command] : null;
  try {
    if (!entry) {
      throw new UsageError(
        command ? `There's no ${command} command.` : 'Name a command: validate or migrate.',
      );
    }
    return await entry.run(args);
  } catch (error) {
    if (error instanceof UsageError || error?.code?.startsWith?.('ERR_PARSE_ARGS')) {
      const usage = entry ? entry.usage : `${VALIDATE_USAGE}\n${MIGRATE_USAGE}`;
      process.stderr.write(`${error.message}\n${usage}\n`);
      return 1;
    }
    throw error;
  }
}

process.exitCode = await main(process.argv.slice(2));
