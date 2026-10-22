import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  detectFormat,
  DOCUMENT_MAX_BYTES,
  parseSource,
  type Context,
  type Diagnostic,
  type Portfolio,
} from '@portfolio/schema';
import { findPair, pairFileNames, type PairFiles } from '@portfolio/schema/node';
import type { CatalogReader, LiveRevision } from './port';
import {
  checkUnit,
  isSnapshotKind,
  type DocumentInput,
  type DocumentName,
  type UnitChecks,
  type UnitDiagnostic,
} from './unit';
import { publicationUnitOf } from './view';

// SourceCatalogReader (#3, item 19): read-only's CatalogReader, which
// replaces #1's documents adapter. It builds one in-memory revision from
// PORTFOLIO_SOURCE_DIR with checkUnit(), the code the store builds a
// revision with: the pair at the top level (#4, item 4), and beside it an
// optional snapshots/ of <kind>.json files and an optional media/media.json,
// the layout #3's export-revision writes and #10 reads. bundle.json and
// media/blobs/ are #10's and #3's to read; this ignores them, and every
// other file. The pair is checked as served, by #4's startup rule as #5
// amends it: an unregistered variant and stale controls only warn, and any
// other blocks-preview or blocks-publish record stops startup, as a
// snapshot or a media document that doesn't parse does. It reads the
// directory once at startup, except under `next dev`, where it reads it
// again whenever a file changes, and renders the bundled examples when the
// directory holds neither document. It writes nothing.

/** A startup finding about the source directory, as #1's startup log prints it. */
export interface SourceFinding {
  readonly severity: 'fatal' | 'warning';
  /** A stable reason, such as `source_missing`, or a diagnostic code such as `schema.invalid`. */
  readonly code: string;
  readonly message: string;
  /** The file, relative to the source directory, such as site.yml or snapshots/controls.json. */
  readonly file?: string;
  /** One of the unit's documents, or, for #10's records, the snapshots beside them. */
  readonly document?: DocumentName | 'snapshots';
  /** JSON pointer into the document. */
  readonly path?: string;
  readonly line?: number;
  readonly column?: number;
  readonly stableId?: string;
  readonly remediation?: string;
}

export interface SourceCatalogOptions {
  /** Absolute PORTFOLIO_SOURCE_DIR. */
  readonly sourceDir: string;
  readonly mode: 'production' | 'development';
  /** The bundled examples, rendered under next dev when the directory holds neither document. */
  readonly examples?: PairFiles;
  /** The build's checks: the pair is checked as served, with validateLive when they have it. */
  readonly checks: UnitChecks;
  /** The ids an old-format record suggests, as #4's findPair takes them. */
  readonly context?: Context;
  /** Whether a portfolio's name is a bundled sample's, which production refuses. */
  readonly isSampleIdentity?: (name: string) => boolean;
  /** Receives the findings of every re-reading under next dev. */
  readonly report: (finding: SourceFinding) => void;
}

/** read-only's CatalogReader. Its revision is always `live`. */
export type SourceCatalogReader = CatalogReader;

export type OpenSourceResult =
  | {
      readonly ok: true;
      readonly reader: SourceCatalogReader;
      readonly findings: readonly SourceFinding[];
    }
  | { readonly ok: false; readonly findings: readonly SourceFinding[] };

const INVALID_SOURCE =
  'The portfolio source failed validation. The config.fatal lines in the server log say where.';
const DIRECTORY = 'PORTFOLIO_SOURCE_DIR';

/** Every top-level name the reader reads or refuses, so an edit to any of them is seen. */
const WATCHED = /^(?:(?:portfolio|site)\.(?:yml|yaml|json)|portfolio\.toml)$/;
const SNAPSHOTS = 'snapshots';
const MEDIA = path.join('media', 'media.json');
/** Like #4's own reads: a byte order mark aside, this many bytes always hold more than a file may. */
const READ_LIMIT = DOCUMENT_MAX_BYTES + 4;

export function sourceCatalogReader(options: SourceCatalogOptions): OpenSourceResult {
  const first = load(options);
  if (!first.ok) return { ok: false, findings: first.findings };
  if (options.mode === 'production') {
    const live = first.revision;
    return {
      ok: true,
      findings: first.findings,
      reader: Object.freeze({ getLive: async () => live }),
    };
  }

  let current: { fingerprint: string; revision?: LiveRevision } = first;
  const reader: SourceCatalogReader = Object.freeze({
    async getLive() {
      if (fingerprint(options) !== current.fingerprint) {
        const next = load(options);
        for (const finding of next.findings) options.report(finding);
        current = next.ok ? next : { fingerprint: next.fingerprint };
      }
      if (!current.revision) throw new Error(INVALID_SOURCE);
      return current.revision;
    },
  });
  return { ok: true, findings: first.findings, reader };
}

type Loaded =
  | { ok: true; revision: LiveRevision; findings: SourceFinding[]; fingerprint: string }
  | { ok: false; findings: SourceFinding[]; fingerprint: string };

const DIRECTORY_FINDINGS = {
  missing: ['source_missing', `${DIRECTORY} names a directory that doesn't exist.`],
  // The likely mistake when moving from PORTFOLIO_PATH, which named the file.
  'not-directory': [
    'source_not_directory',
    `${DIRECTORY} names a file, not a directory. Set it to the directory that holds portfolio.yml and site.yml.`,
  ],
  unreadable: ['source_unreadable', `The server can't read the ${DIRECTORY} directory.`],
} as const;

function fatal(code: string, message: string, extra: Partial<SourceFinding> = {}): SourceFinding {
  return { severity: 'fatal', code, message, ...extra };
}

/** A diagnostic record as a finding: blocking records are fatal, warnings stay warnings. */
function recordFinding(
  record: Diagnostic | UnitDiagnostic,
  names: Partial<Record<DocumentName, string>> | undefined,
): SourceFinding {
  const file = names?.[record.document as DocumentName];
  const { stableId } = record as { stableId?: string };
  return {
    severity: record.severity === 'warning' ? 'warning' : 'fatal',
    code: record.code,
    ...(file !== undefined ? { file } : {}),
    document: record.document,
    path: record.pointer,
    ...(record.line !== undefined ? { line: record.line, column: record.column } : {}),
    ...(stableId !== undefined ? { stableId } : {}),
    message: record.message,
    remediation: record.remediation,
  };
}

function load(options: SourceCatalogOptions): Loaded {
  const { sourceDir, mode } = options;
  const stamp = fingerprint(options);
  const findings: SourceFinding[] = [];
  const fail = (...found: SourceFinding[]): Loaded => ({
    ok: false,
    findings: [...findings, ...found],
    fingerprint: stamp,
  });

  const found = findPair(sourceDir, options.context);
  let files: PairFiles;
  let usingExamples = false;
  if (found.ok) {
    files = found.files;
  } else if (found.directory) {
    const [code, message] = DIRECTORY_FINDINGS[found.directory];
    return fail(fatal(code, message));
  } else if (mode !== 'production' && options.examples && found.missing?.length === 2) {
    // A fresh clone has neither, and `pnpm dev` shows the examples. Only both.
    findings.push({
      ...fatal(
        'source_empty',
        `${DIRECTORY} holds neither document, so next dev renders the bundled examples. Production refuses to start without both.`,
      ),
      severity: 'warning',
    });
    files = options.examples;
    usingExamples = true;
  } else {
    // A missing or doubled document, or one in the old format with no site document.
    const names = pairFileNames(found);
    return fail(...found.diagnostics.map((record) => recordFinding(record, names)));
  }

  const names = { portfolio: path.basename(files.portfolio), site: path.basename(files.site) };
  const portfolio = readDocument(files.portfolio, 'portfolio');
  const site = readDocument(files.site, 'site');
  if (!portfolio.ok || !site.ok) {
    return fail(...[portfolio, site].flatMap((read) => (read.ok ? [] : [read.finding])));
  }
  // The examples stand alone: nothing beside them in the directory is theirs.
  const extras = usingExamples ? NO_EXTRAS : readExtras(sourceDir);
  if (!extras.ok) return fail(...extras.findings);

  const checked = checkUnit(
    {
      portfolio: portfolio.input,
      site: site.input,
      ...(extras.media ? { media: extras.media } : {}),
    },
    servedChecks(options.checks, extras.snapshots),
  );
  const records = checked.diagnostics.map((record) =>
    recordFinding(record, { ...names, media: MEDIA }),
  );
  if (!checked.ok) return fail(...records);
  findings.push(...records);
  const { unit } = checked;

  const identity = (unit.portfolio.model as Portfolio).identity.name;
  if (!usingExamples && options.isSampleIdentity?.(identity)) {
    const parsed = parseSource(portfolio.input.sourceText, portfolio.input.format);
    const sample = fatal(
      'sample_identity',
      mode === 'production'
        ? '/identity/name is the bundled sample. Replace the sample with your own portfolio.'
        : '/identity/name is the bundled sample. Production refuses to start with it.',
      {
        file: names.portfolio,
        document: 'portfolio',
        path: '/identity/name',
        ...(parsed.ok ? parsed.locate(['identity', 'name']) : {}),
      },
    );
    if (mode === 'production') return fail(sample);
    findings.push({ ...sample, severity: 'warning' });
  }

  const revision: LiveRevision = Object.freeze({
    state: 'live' as const,
    revisionId: `doc-${sourceDigest(
      [names.portfolio, portfolio.input.sourceText],
      [names.site, site.input.sourceText],
      ...extras.texts,
    )}`,
    unitHash: unit.unitHash,
    unit: publicationUnitOf(unit),
  });
  return { ok: true, revision, findings, fingerprint: stamp };
}

/** The build's checks as a served pair gets them: live validation, and the snapshots as mounted. */
function servedChecks(
  checks: UnitChecks,
  snapshots: Readonly<Record<string, unknown>>,
): UnitChecks {
  return {
    ...checks,
    validate: (pair) => (checks.validateLive ? checks.validateLive(pair) : checks.validate(pair)),
    snapshots: () => snapshots,
  };
}

/**
 * 12 hex digits of a SHA-256 over each file's name and text (#1, item 3):
 * a change to any of them is a new revision. Each part's length goes first,
 * so no two lists hash the same.
 */
export function sourceDigest(...files: readonly (readonly [name: string, text: string])[]): string {
  const hash = createHash('sha256');
  for (const [name, text] of files) {
    for (const part of [name, text]) hash.update(`${part.length}:${part}`);
  }
  return hash.digest('hex').slice(0, 12);
}

/**
 * At most READ_LIMIT bytes of `file` as text, so an oversized file is never
 * read whole: the parser refuses what passes the limit. Throws as
 * node:fs does, and EISDIR for something that isn't a file.
 */
function readBounded(file: string): string {
  const fd = fs.openSync(/*turbopackIgnore: true*/ file, 'r');
  try {
    const stats = fs.fstatSync(fd);
    if (!stats.isFile()) {
      throw Object.assign(new Error('Not a file.'), { code: 'EISDIR' });
    }
    const chunks: Buffer[] = [];
    let length = 0;
    let want = Math.max(stats.size, 1);
    while (length < READ_LIMIT) {
      const chunk = Buffer.alloc(Math.min(want, READ_LIMIT - length));
      const read = fs.readSync(fd, chunk, 0, chunk.length, length);
      if (read === 0) break;
      chunks.push(chunk.subarray(0, read));
      length += read;
      want = 64 * 1024;
    }
    return Buffer.concat(chunks, length).toString('utf8');
  } finally {
    fs.closeSync(fd);
  }
}

type DocumentRead =
  | { readonly ok: true; readonly input: DocumentInput }
  | { readonly ok: false; readonly finding: SourceFinding };

/** One document of the pair, as #4's readPair reads it: source.missing or source.unreadable when it can't be. */
function readDocument(file: string, document: 'portfolio' | 'site'): DocumentRead {
  const name = path.basename(file);
  try {
    return {
      ok: true,
      input: { format: detectFormat(name), sourceText: readBounded(file), name },
    };
  } catch (error) {
    const missing = (error as NodeJS.ErrnoException).code === 'ENOENT';
    return {
      ok: false,
      finding: missing
        ? fatal('source.missing', `${name} doesn't exist.`, {
            file: name,
            document,
            path: '',
            remediation:
              'Add the document: portfolio.yml and site.yml, or their .yaml or .json forms. portfolio.example.yml and site.example.yml are ones to start from.',
          })
        : fatal('source.unreadable', `${name} can't be read.`, {
            file: name,
            document,
            path: '',
            remediation: `Make ${name} a file the server's user can read.`,
          }),
    };
  }
}

interface Extras {
  readonly ok: true;
  readonly snapshots: Readonly<Record<string, unknown>>;
  readonly media?: DocumentInput;
  /** Each file read, by its name under the source directory, for the revision's ID. */
  readonly texts: readonly (readonly [string, string])[];
}

const NO_EXTRAS: Extras = Object.freeze({ ok: true, snapshots: Object.freeze({}), texts: [] });

/** snapshots/<kind>.json and media/media.json beside the pair, when they're there. */
function readExtras(
  sourceDir: string,
): Extras | { readonly ok: false; readonly findings: SourceFinding[] } {
  const findings: SourceFinding[] = [];
  const texts: [string, string][] = [];
  const snapshots: Record<string, unknown> = {};
  const listing = listSnapshots(sourceDir);
  if (!listing.ok) findings.push(listing.finding);
  for (const kind of listing.ok ? listing.kinds : []) {
    const file = path.join(SNAPSHOTS, `${kind}.json`);
    const read = readSnapshot(path.join(sourceDir, file), file);
    if (!read.ok) {
      findings.push(read.finding);
      continue;
    }
    snapshots[kind] = read.value;
    texts.push([file, read.text]);
  }

  let media: DocumentInput | undefined;
  try {
    const sourceText = readBounded(path.join(sourceDir, MEDIA));
    media = { format: 'json', sourceText, name: MEDIA };
    texts.push([MEDIA, sourceText]);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      findings.push(
        fatal('media_unreadable', `${MEDIA} can't be read.`, {
          file: MEDIA,
          document: 'media',
          remediation: `Make ${MEDIA} a file the server's user can read, or remove it.`,
        }),
      );
    }
  }
  if (findings.length > 0) return { ok: false, findings };
  return { ok: true, snapshots, ...(media ? { media } : {}), texts };
}

/** The kinds in snapshots/, each a `<kind>.json` file. Other names there are ignored. */
function listSnapshots(
  sourceDir: string,
):
  | { readonly ok: true; readonly kinds: readonly string[] }
  | { readonly ok: false; readonly finding: SourceFinding } {
  let names: string[];
  try {
    names = fs.readdirSync(/*turbopackIgnore: true*/ path.join(sourceDir, SNAPSHOTS));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return { ok: true, kinds: [] };
    return {
      ok: false,
      finding: fatal(
        'snapshots_unreadable',
        code === 'ENOTDIR'
          ? `${SNAPSHOTS} in ${DIRECTORY} is a file. Snapshots are files in a snapshots/ directory.`
          : `The server can't read the ${SNAPSHOTS} directory in ${DIRECTORY}.`,
        { file: SNAPSHOTS },
      ),
    };
  }
  const kinds = names
    .filter((name) => name.endsWith('.json'))
    .map((name) => name.slice(0, -'.json'.length))
    .filter(isSnapshotKind);
  return { ok: true, kinds: kinds.sort() };
}

/**
 * One snapshot file: at most 1 MiB of JSON, parsed under #4's guards for a
 * document (its size, depth, entries, and repeated keys). #10 will add a
 * reader of its own for these; this is the one place to swap it in.
 */
function readSnapshot(
  file: string,
  name: string,
):
  | { readonly ok: true; readonly value: unknown; readonly text: string }
  | { readonly ok: false; readonly finding: SourceFinding } {
  let text: string;
  try {
    text = readBounded(file);
  } catch {
    return {
      ok: false,
      finding: fatal('snapshot_unreadable', `${name} can't be read.`, {
        file: name,
        remediation: `Make ${name} a file the server's user can read, or remove it.`,
      }),
    };
  }
  const parsed = parseSource(text, 'json');
  if (parsed.ok) return { ok: true, value: parsed.data, text };
  const [problem] = parsed.problems;
  return {
    ok: false,
    finding: fatal(
      'snapshot_invalid',
      `${name} isn't a snapshot this build can read: ${problem?.message ?? "it isn't valid JSON."}`,
      {
        file: name,
        ...(problem?.line !== undefined ? { line: problem.line, column: problem.column } : {}),
        remediation: `Export the revision again, or remove ${name}.`,
      },
    ),
  };
}

/** Changes whenever a file the reader reads is added, removed, or rewritten, or the examples change while they render. */
function fingerprint({ sourceDir, examples }: SourceCatalogOptions): string {
  let names: string[];
  try {
    names = fs.readdirSync(/*turbopackIgnore: true*/ sourceDir);
  } catch (error) {
    return `unreadable:${(error as NodeJS.ErrnoException).code}`;
  }
  const watched = names.filter((name) => WATCHED.test(name)).sort();
  const files = watched.length
    ? watched.map((name) => path.join(/*turbopackIgnore: true*/ sourceDir, name))
    : examples
      ? [examples.portfolio, examples.site]
      : [];
  if (watched.length) {
    const listing = listSnapshots(sourceDir);
    if (listing.ok) {
      for (const kind of listing.kinds) {
        files.push(path.join(/*turbopackIgnore: true*/ sourceDir, SNAPSHOTS, `${kind}.json`));
      }
    } else {
      files.push(path.join(/*turbopackIgnore: true*/ sourceDir, SNAPSHOTS));
    }
    files.push(path.join(/*turbopackIgnore: true*/ sourceDir, MEDIA));
  }
  return files
    .map((file) => {
      try {
        const stat = fs.statSync(/*turbopackIgnore: true*/ file);
        return `${file}:${stat.mtimeMs}:${stat.size}`;
      } catch {
        return `${file}:missing`;
      }
    })
    .join('|');
}
