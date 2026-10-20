import 'server-only';
import fs from 'node:fs';
import path from 'node:path';
import { parseSource, type AppearanceCatalog, type ContentExtension } from '@portfolio/schema';
import { findPair, pairFileNames, readPair, type PairFiles } from '@portfolio/schema/node';
import type { CatalogReader, LiveRevision } from './catalog-port';
import type { ConfigIssue, RuntimeMode } from './config';
import { frozenUnit, pairDigest, recordIssue } from './pair-records';

// The documents adapter: the CatalogReader for a mounted PORTFOLIO_SOURCE_DIR
// (#4, items 4 and 5). It reads the pair, one portfolio.{yml,yaml,json} and
// one site.{yml,yaml,json}, once at startup through loadPair's steps, and
// freezes the validated pair. Each record the check finds is an issue:
// blocking ones stop startup, and warnings are logged. Under `next dev` only,
// it re-validates whenever a document changes on disk, and renders the
// bundled examples when the directory holds neither document.

/** identity.name of each sample the image ships. A real deployment can't use one. */
export const BUNDLED_SAMPLE_NAMES: readonly string[] = ['Anamika Devi'];

/** Every name the adapter reads or refuses, so an edit to any of them is seen. */
const WATCHED = /^(?:(?:portfolio|site)\.(?:yml|yaml|json)|portfolio\.toml)$/;
const KEY = 'PORTFOLIO_SOURCE_DIR';
const INVALID_SOURCE =
  'The portfolio source failed validation. The config.fatal lines in the server log say where.';

export interface DocumentsCatalogOptions {
  /** Absolute path of PORTFOLIO_SOURCE_DIR. */
  readonly sourceDir: string;
  readonly mode: RuntimeMode;
  /** The bundled examples, rendered under `next dev` when the directory holds neither document. */
  readonly examples: PairFiles;
  /** The appearance ids this build registers. Without one, they go unchecked. */
  readonly catalog?: AppearanceCatalog;
  /** The content extensions documents are checked against. Others warn. */
  readonly extensions?: readonly ContentExtension[];
  /** The deployment's canonical origin, which links are checked against. */
  readonly origin?: string;
  /** Receives the findings of every re-validation under `next dev`. */
  readonly report: (issue: ConfigIssue) => void;
}

export type OpenDocumentsResult =
  | { readonly ok: true; readonly reader: CatalogReader; readonly issues: ConfigIssue[] }
  | { readonly ok: false; readonly issues: ConfigIssue[] };

export function openDocumentsCatalog(options: DocumentsCatalogOptions): OpenDocumentsResult {
  const first = loadRevision(options);
  if (!first.ok) return { ok: false, issues: first.issues };
  if (options.mode === 'production') {
    const live = first.revision;
    return { ok: true, issues: first.issues, reader: Object.freeze({ getLive: async () => live }) };
  }

  let current: { fingerprint: string; revision?: LiveRevision } = first;
  const reader: CatalogReader = Object.freeze({
    async getLive() {
      if (fingerprint(options) !== current.fingerprint) {
        const next = loadRevision(options);
        for (const issue of next.issues) options.report(issue);
        current = next.ok ? next : { fingerprint: next.fingerprint };
      }
      if (!current.revision) throw new Error(INVALID_SOURCE);
      return current.revision;
    },
  });
  return { ok: true, issues: first.issues, reader };
}

type Loaded =
  | { ok: true; revision: LiveRevision; issues: ConfigIssue[]; fingerprint: string }
  | { ok: false; issues: ConfigIssue[]; fingerprint: string };

const DIRECTORY_ISSUES = {
  missing: ['source_missing', `${KEY} names a directory that doesn't exist.`],
  // The likely mistake when moving from PORTFOLIO_PATH, which named the file.
  'not-directory': [
    'source_not_directory',
    `${KEY} names a file, not a directory. Set it to the directory that holds portfolio.yml and site.yml.`,
  ],
  unreadable: ['source_unreadable', `The server can't read the ${KEY} directory.`],
} as const;

function loadRevision(options: DocumentsCatalogOptions): Loaded {
  const { sourceDir, mode } = options;
  const stamp = fingerprint(options);
  const issues: ConfigIssue[] = [];
  const fail = (...found: ConfigIssue[]): Loaded => ({
    ok: false,
    issues: [...issues, ...found],
    fingerprint: stamp,
  });

  const ctx = {
    catalog: options.catalog,
    extensions: options.extensions,
    ...(options.origin ? { canonicalOrigin: options.origin } : {}),
  };
  const found = findPair(sourceDir, ctx);
  let files: PairFiles;
  let usingExamples = false;
  if (found.ok) {
    files = found.files;
  } else if (found.directory) {
    const [code, message] = DIRECTORY_ISSUES[found.directory];
    return fail(fatal(code, message));
  } else if (mode !== 'production' && found.missing?.length === 2) {
    // A fresh clone has neither, and `pnpm dev` shows the examples. Only both.
    issues.push({
      ...fatal(
        'source_empty',
        `${KEY} holds neither document, so next dev renders the bundled examples. Production refuses to start without both.`,
      ),
      severity: 'warning',
    });
    files = options.examples;
    usingExamples = true;
  } else {
    // A missing or doubled document, or one in the old format with no site document.
    const names = pairFileNames(found);
    return fail(...found.diagnostics.map((record) => recordIssue(record, KEY, names)));
  }

  const result = readPair(files, ctx);
  const names = pairFileNames(result);
  const records = result.diagnostics.map((record) => recordIssue(record, KEY, names));
  if (!result.ok) return fail(...records);
  issues.push(...records);
  const { pair, sources } = result;

  if (!usingExamples && isSampleIdentity(pair.portfolio.identity.name)) {
    const parsed = parseSource(sources.portfolio.text, sources.portfolio.format);
    const sample: ConfigIssue = {
      ...fatal(
        'sample_identity',
        mode === 'production'
          ? '/identity/name is the bundled sample. Replace the sample with your own portfolio.'
          : '/identity/name is the bundled sample. Production refuses to start with it.',
      ),
      file: sources.portfolio.name,
      document: 'portfolio',
      path: '/identity/name',
      ...(parsed.ok ? parsed.locate(['identity', 'name']) : {}),
    };
    if (mode === 'production') return fail(sample);
    issues.push({ ...sample, severity: 'warning' });
  }

  const revision: LiveRevision = Object.freeze({
    revisionId: `doc-${pairDigest(sources)}`,
    unit: frozenUnit(pair.portfolio, pair.site),
  });
  return { ok: true, revision, issues, fingerprint: stamp };
}

/** Changes whenever a document is added, removed, or rewritten, or the examples change while they render. */
function fingerprint({ sourceDir, examples }: DocumentsCatalogOptions): string {
  let names: string[];
  try {
    names = fs.readdirSync(/*turbopackIgnore: true*/ sourceDir);
  } catch (error) {
    return `unreadable:${(error as NodeJS.ErrnoException).code}`;
  }
  const watched = names.filter((name) => WATCHED.test(name)).sort();
  const files = watched.length
    ? watched.map((name) => path.join(/*turbopackIgnore: true*/ sourceDir, name))
    : [examples.portfolio, examples.site];
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

function fatal(code: string, message: string): ConfigIssue {
  return { severity: 'fatal', key: KEY, code, message };
}

function isSampleIdentity(name: string): boolean {
  const normalize = (value: string) =>
    value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
  return BUNDLED_SAMPLE_NAMES.some((sample) => normalize(sample) === normalize(name));
}
