#!/usr/bin/env node
/**
 * config.mjs: commands for the portfolio's documents (#4, items 19 and 22;
 * #10, items 3 and 6). Run it through `pnpm config:validate`,
 * `pnpm config:migrate`, or `pnpm config:ids-fix`; the first two build the
 * variant registry first, and each runs this file with tsx.
 *
 *   pnpm config:validate [dir] [--origin <url>] [--json]
 *
 * validate reads the pair in a directory, portfolio.{yml,yaml,json} and
 * site.{yml,yaml,json}, and once it loads, the snapshots/ and media/media.json
 * beside it, the way startup does, and prints every record it finds: where,
 * its code and severity, what's wrong, and how to fix it. The checks that
 * compare a draft with the live revision run at publish and import, not here.
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
 *   pnpm config:migrate <file> [--set <portfolio|site>.<path>=<value>]...
 *     [--drop-unknown] [--origin <url>] [--summary] [--write --out <dir>]
 *
 * migrate reads a file in the old one-file format, or a schemaVersion 2
 * portfolio document, and prints what this release's documents would be: the
 * schemaVersion 3 portfolio document, and for the old format the site
 * document too. It lists each field it moves, the values it needs with the
 * ids this build accepts, the section ids it gives, the record and media ids
 * it mints, what to look at, the comments it can't keep, the new pair's
 * diagnostics, a diff of the portfolio document, and the whole site document.
 * A version 2 portfolio's site document doesn't change; the site.yml beside
 * it, if there is one, tells which sections it hides. A file already at this
 * release's version is current, and nothing changes. It writes nothing without
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
 *   --write               Write portfolio.yml, and for the old format
 *                         site.yml (portfolio.json and site.json for a JSON
 *                         file), into --out.
 *   --out <dir>           Where --write puts them. Made when it's missing.
 *
 * Exit status: 0 when the file is already current, or nothing stops the
 * migration (with --write, once both documents are written); 2 when it needs
 * a value, a decision on unknown keys, or a fix for a problem the new
 * documents would have; 1 for anything else, such as a bad argument, a file
 * it can't read or migrate, a document already at --out, or an --out it
 * can't write into.
 *
 *   pnpm config:ids-fix [dir | portfolio-file] [--write]
 *
 * ids-fix gives every section, record, and media asset of a schemaVersion 3
 * portfolio document that has no id, a malformed one, or a repeat of an
 * earlier one an id of its own, minted from its title. It edits the text in
 * place, so a YAML document keeps its comments and both formats their key
 * order; a malformed id's references follow it. Without --write it prints
 * the ids it would give and changes nothing.
 *
 *   dir             The directory that holds portfolio.yml, .yaml, or .json,
 *                   or the portfolio document itself. Defaults to the
 *                   repository's config directory.
 *   --write         Write the ids into the document.
 *
 * Exit status: 0 when every entry has an id, or the ids were written (or
 * would be, without --write); 1 for anything else.
 *
 * Relative paths are taken from the directory pnpm ran in (INIT_CWD).
 */
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
  detectFormat,
  DOCUMENT_MAX_BYTES,
  fixIds,
  parseSource,
  redactSecrets,
} from '@portfolio/schema';
import { formatMigration, migrate, parseSet } from '@portfolio/schema/migrate';
import { formatRecords, loadPair, pairFileNames, readUnitFiles } from '@portfolio/schema/node';

/**
 * What this build registers (#5): the interim appearance catalog, the content
 * extensions, and the contract's live checks, as startup checks the pair
 * against them, from the registry `pnpm build:registry` generates. Imported
 * dynamically, since tsx hands an .mjs file the host's TypeScript modules as
 * CommonJS, whose names a static import can't see.
 */
async function hostCatalog() {
  const { liveContext } = await import('../src/lib/variants.ts');
  return liveContext();
}

const VALIDATE_USAGE = 'Usage: pnpm config:validate [dir] [--origin <url>] [--json]';
const MIGRATE_USAGE = [
  'Usage: pnpm config:migrate <file> [--set <portfolio|site>.<path>=<value>]...',
  '         [--drop-unknown] [--origin <url>] [--summary] [--write --out <dir>]',
].join('\n');
const IDS_FIX_USAGE = 'Usage: pnpm config:ids-fix [dir | portfolio-file] [--write]';

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

  const site = siteBeside(file);
  const migration = migrate(
    { text, format },
    {
      set,
      dropUnknown: values['drop-unknown'],
      ...(origin ? { origin } : {}),
      ...(site ? { site } : {}),
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
    ...(migration.site ? [[path.join(out, `site.${extension}`), migration.site.text]] : []),
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

/**
 * The site document beside a portfolio document, which tells a version 2
 * portfolio's migration the sections it hides, or undefined when there's
 * none, or more than one, or it can't be read.
 */
function siteBeside(file) {
  const dir = path.dirname(file);
  const found = ['site.yml', 'site.yaml', 'site.json']
    .map((name) => path.join(dir, name))
    .filter((candidate) => candidate !== file && fs.existsSync(candidate));
  if (found.length !== 1) return undefined;
  try {
    return { text: readBounded(found[0], DOCUMENT_MAX_BYTES + 4), format: detectFormat(found[0]) };
  } catch {
    return undefined;
  }
}

/** The portfolio document in a directory: exactly one portfolio.{yml,yaml,json}. */
function portfolioIn(dir, shown) {
  const found = ['portfolio.yml', 'portfolio.yaml', 'portfolio.json'].filter((name) =>
    fs.existsSync(path.join(dir, name)),
  );
  if (found.length === 0) throw new UsageError(`${shown} holds no portfolio.yml, .yaml, or .json.`);
  if (found.length > 1) {
    throw new UsageError(`${shown} holds ${found.join(' and ')}. Keep one portfolio document.`);
  }
  return path.join(dir, found[0]);
}

async function idsFixCommand(args) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      write: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
  if (values.help) {
    process.stdout.write(`${IDS_FIX_USAGE}\n`);
    return 0;
  }
  if (positionals.length > 1) throw new UsageError('Give one directory or portfolio document.');
  const base = process.env.INIT_CWD || process.cwd();
  const target = positionals[0] === undefined ? CONFIG_DIR : path.resolve(base, positionals[0]);
  let file = target;
  try {
    if (fs.statSync(target).isDirectory()) file = portfolioIn(target, shownPath(base, target));
  } catch (error) {
    if (error instanceof UsageError) throw error;
    process.stderr.write(`${shownPath(base, target)} doesn't exist or can't be read.\n`);
    return 1;
  }
  const shown = shownPath(base, file);
  let format;
  try {
    format = detectFormat(file);
  } catch (error) {
    throw new UsageError(`${shown}: ${error.message}`);
  }
  if (isSymlink(file)) {
    process.stderr.write(`${shown} is a symbolic link. Run this on the file it points at.\n`);
    return 1;
  }
  let text;
  try {
    text = readBounded(file, DOCUMENT_MAX_BYTES + 4);
  } catch (error) {
    process.stderr.write(`Can't read ${shown} (${error.code ?? 'error'}).\n`);
    return 1;
  }
  const result = fixIds({ text, format });
  if (!result.ok) {
    const reasons = result.reasons.map((reason) => `  ${reason}\n`).join('');
    process.stderr.write(redactSecrets(`${shown} can't be fixed.\n${reasons}`));
    return 1;
  }
  if (result.fixes.length === 0) {
    process.stdout.write(
      `${shown} has an id on every section, record, and media asset. Nothing to fix.\n`,
    );
    return 0;
  }
  const why = {
    missing: 'it had none',
    invalid: "its id wasn't well formed",
    repeated: 'an earlier entry has its id',
  };
  const lines = result.fixes.flatMap(({ pointer, id, reason, references }) => [
    `  ${pointer} gets ${id}: ${why[reason]}.`,
    ...references.map((reference) => `    ${reference} names it too, and changes with it.`),
  ]);
  process.stdout.write(redactSecrets(`${shown}:\n${lines.join('\n')}\n`));
  if (!values.write) {
    process.stdout.write(
      `\nNothing was written. Run pnpm config:ids-fix with --write to write ${count(result.fixes.length, 'id')} into ${shown}.\n`,
    );
    return 0;
  }
  try {
    replaceFile(file, result.text);
  } catch (error) {
    process.stderr.write(`Can't write ${shown} (${error.code ?? 'error'}). Nothing was written.\n`);
    return 1;
  }
  process.stdout.write(`\nWrote ${count(result.fixes.length, 'id')} into ${shown}.\n`);
  return 0;
}

/** Replaces `file` with `text` all at once: a temp file beside it, synced, then renamed over it, keeping its mode. */
function replaceFile(file, text) {
  const { mode } = fs.statSync(file);
  const temp = path.join(
    path.dirname(file),
    `.${path.basename(file)}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`,
  );
  const fd = fs.openSync(temp, 'wx', mode & 0o777);
  try {
    fs.writeFileSync(fd, text);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  try {
    fs.renameSync(temp, file);
  } catch (error) {
    fs.rmSync(temp, { force: true });
    throw error;
  }
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
  const loaded = withUnitFiles(
    loadPair(dir, {
      ...(await hostCatalog()),
      ...(origin ? { canonicalOrigin: origin } : {}),
    }),
    dir,
  );
  const sample = await sampleIdentity(loaded);
  const result = sample ? { ...loaded, diagnostics: [...loaded.diagnostics, sample] } : loaded;
  const report = values.json
    ? `${JSON.stringify(jsonReport(result), null, 2)}\n`
    : textReport(result, shownPath(base, dir), origin !== undefined);
  // Records never quote a value, and this keeps it that way for the terminal.
  process.stdout.write(redactSecrets(report));
  return result.ok ? 0 : 1;
}

/**
 * The snapshots and the media document beside the pair, read the way startup
 * reads them once the pair loads: a blocking record in either stops it too.
 */
function withUnitFiles(loaded, dir) {
  if (!loaded.ok) return loaded;
  const found = readUnitFiles(dir).diagnostics;
  if (found.length === 0) return loaded;
  const diagnostics = [...loaded.diagnostics, ...found];
  if (found.every(({ severity }) => severity === 'warning')) return { ...loaded, diagnostics };
  const { portfolio, site } = loaded.sources;
  return {
    ok: false,
    diagnostics,
    notChecked: loaded.notChecked,
    files: { portfolio: portfolio.path, site: site.path },
  };
}

/**
 * A warning when the portfolio is still the bundled sample: the pair alone is
 * valid, and production refuses to start with it (#1), which no record says.
 */
async function sampleIdentity(result) {
  if (!result.ok) return null;
  const { isSampleIdentity } = await import('../src/lib/sample-identity.ts');
  if (!isSampleIdentity(result.pair.portfolio.identity.name)) return null;
  const { text, format } = result.sources.portfolio;
  const parsed = parseSource(text, format);
  return {
    code: 'sample.identity',
    severity: 'warning',
    document: 'portfolio',
    pointer: '/identity/name',
    ...(parsed.ok ? parsed.locate(['identity', 'name']) : {}),
    message: "/identity/name is the bundled sample's. Production refuses to start with it.",
    remediation: 'Replace the sample with your own portfolio, starting with identity.name.',
  };
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
  'ids-fix': { run: idsFixCommand, usage: IDS_FIX_USAGE },
};

async function main(argv) {
  const [command, ...args] = argv;
  const entry =
    command !== undefined && Object.hasOwn(COMMANDS, command) ? COMMANDS[command] : null;
  try {
    if (!entry) {
      throw new UsageError(
        command
          ? `There's no ${command} command.`
          : 'Name a command: validate, migrate, or ids-fix.',
      );
    }
    return await entry.run(args);
  } catch (error) {
    if (error instanceof UsageError || error?.code?.startsWith?.('ERR_PARSE_ARGS')) {
      const usage = entry ? entry.usage : `${VALIDATE_USAGE}\n${MIGRATE_USAGE}\n${IDS_FIX_USAGE}`;
      process.stderr.write(`${error.message}\n${usage}\n`);
      return 1;
    }
    throw error;
  }
}

process.exitCode = await main(process.argv.slice(2));
