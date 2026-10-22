// A test-only next schema major for the store's migration tests (#3, item
// 25), so they show the path is generic; #10's real step reruns them. The
// next build's portfolio document is this build's at version NEXT, with one
// addition the step makes: `migration`, holding an id the step mints from
// the old text, and a title it carries over from the old `meta.title`. With
// no meta title, the title is a value only the owner can give, as
// `--set portfolio.migration.title=<value>`. The next build's validator
// reads a NEXT portfolio as this build's reads one at its own version, and
// finds one at this build's version an unsupported major, as #4's does:
// schema.version, blocks-preview.
import {
  applyEdits,
  parseSource,
  PORTFOLIO_SCHEMA_VERSION,
  SITE_SCHEMA_VERSION,
  type Diagnostic,
  type ParsedPair,
  type PublicationUnitResult,
  type SourceDocument,
} from '@portfolio/schema';
import {
  sha256,
  type MigrationValue,
  type SchemaVersions,
  type StoredUnit,
  type UnitChecks,
  type UnitMigration,
} from '../../catalog/unit';
import { recordOwnerModule } from '../../load-trace';
import { testChecks } from './fixtures';

recordOwnerModule('core/store/test-support/next-schema');

/** This build's schema version, both documents'. */
export const CURRENT = PORTFOLIO_SCHEMA_VERSION;
/** The next major's portfolio version. Its site document stays at SITE. */
export const NEXT = PORTFOLIO_SCHEMA_VERSION + 1;
/** This build's site document version, which the next major keeps. */
export const SITE = SITE_SCHEMA_VERSION;

export const CURRENT_VERSIONS: SchemaVersions = Object.freeze({ portfolio: CURRENT, site: SITE });
export const NEXT_VERSIONS: SchemaVersions = Object.freeze({ portfolio: NEXT, site: SITE });

/** Where the step's title goes, for `--set`. */
export const TITLE_PATH = 'portfolio.migration.title';

type Validate = UnitChecks['validate'];
type Pair = Parameters<Validate>[0];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function versionOf(document: SourceDocument): unknown {
  const read = parseSource(document.text, document.format);
  return read.ok && isRecord(read.data) ? read.data.schemaVersion : undefined;
}

const unsupported = (pointer: string, code: string, message: string): PublicationUnitResult => ({
  pair: null,
  notChecked: [],
  diagnostics: [
    {
      code,
      severity: 'blocks-preview',
      document: 'portfolio',
      pointer,
      message,
      remediation: `Set schemaVersion: ${NEXT}.`,
    } as Diagnostic,
  ],
});

/** A validator of the next build, over one of this build's. */
function nextValidator(validate: Validate): Validate {
  return (pair: Pair) => {
    const version = versionOf(pair.portfolio);
    if (version === CURRENT) {
      return unsupported(
        '/schemaVersion',
        'schema.version',
        `The portfolio document declares schemaVersion ${CURRENT}. This build reads ${NEXT}.`,
      );
    }
    if (version !== NEXT) return validate(pair);
    const read = parseSource(pair.portfolio.text, pair.portfolio.format);
    const migration = read.ok && isRecord(read.data) ? read.data.migration : undefined;
    if (
      !isRecord(migration) ||
      typeof migration.id !== 'string' ||
      typeof migration.title !== 'string'
    ) {
      return unsupported('/migration', 'schema.invalid', '/migration needs an id and a title.');
    }
    // The rest is this build's document.
    const text = applyEdits(pair.portfolio.text, pair.portfolio.format, [
      { op: 'delete', pointer: '/migration' },
      { op: 'set', pointer: '/schemaVersion', value: CURRENT },
    ]);
    const result = validate({ ...pair, portfolio: { ...pair.portfolio, text } });
    if (!result.pair) return result;
    const portfolio = { ...result.pair.portfolio, schemaVersion: NEXT, migration };
    return {
      ...result,
      pair: { ...result.pair, portfolio: portfolio as unknown as ParsedPair['portfolio'] },
    };
  };
}

const failed = (why: string): UnitMigration => ({
  status: 'failed',
  reasons: [why],
  summary: [why],
});

/** The step from CURRENT to NEXT, as #10's migrateDocuments() takes a stored unit. */
export function migrateToNext(
  unit: StoredUnit,
  options: { readonly set?: readonly MigrationValue[] } = {},
): UnitMigration {
  const read = parseSource(unit.portfolio.text, unit.portfolio.format);
  if (!read.ok || !isRecord(read.data)) return failed("The portfolio document doesn't parse.");
  if (read.data.schemaVersion === NEXT) return { status: 'current' };
  if (read.data.schemaVersion !== CURRENT) {
    return failed('The portfolio document declares a schemaVersion no migration step reads.');
  }
  const meta = read.data.meta;
  let title = isRecord(meta) && typeof meta.title === 'string' ? meta.title : undefined;
  for (const { path, value } of options.set ?? []) {
    if (path !== TITLE_PATH) return failed('A --set value has no place to go.');
    title = value;
  }
  // From the old bytes alone, so a dry run and the run mint the same one.
  const id = `migrated-${sha256(unit.portfolio.text).slice('sha256:'.length, 'sha256:'.length + 12)}`;
  const needs =
    title === undefined || title === ''
      ? [
          {
            path: TITLE_PATH,
            reason: 'The old portfolio document has no meta title to carry over.',
          },
        ]
      : [];
  const text = applyEdits(unit.portfolio.text, unit.portfolio.format, [
    { op: 'set', pointer: '/schemaVersion', value: NEXT },
    { op: 'set', pointer: '/migration', value: needs.length > 0 ? { id } : { id, title } },
  ]);
  return {
    status: needs.length > 0 ? 'blocked' : 'ready',
    from: CURRENT_VERSIONS,
    to: NEXT_VERSIONS,
    documents: {
      portfolio: { text, format: unit.portfolio.format },
      site: unit.site,
      ...(unit.media ? { media: unit.media } : {}),
    },
    ids: [{ id, owner: 'migration', pointer: '/migration/id', from: '/meta/title' }],
    needs,
    diagnostics: [],
    comments: [],
    secrets: [],
  };
}

/**
 * A line diff for the dry run: one hunk around what changed. #10's
 * unifiedDiff is what the CLI's checks pass.
 */
export function lineDiff(
  before: string,
  after: string,
  names: { readonly before: string; readonly after: string },
): string {
  if (before === after) return '';
  const a = before.replace(/\n$/, '').split('\n');
  const b = after.replace(/\n$/, '').split('\n');
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  return `${[
    `--- ${names.before}`,
    `+++ ${names.after}`,
    `@@ -${start + 1},${endA - start} +${start + 1},${endB - start} @@`,
    ...a.slice(start, endA).map((line) => `-${line}`),
    ...b.slice(start, endB).map((line) => `+${line}`),
  ].join('\n')}\n`;
}

/**
 * The checks of the next build, over this build's: its validators, its
 * versions, and, unless `migration` is false, the step and the diff.
 */
export function nextChecks(
  base: UnitChecks = testChecks(),
  { migration = true }: { readonly migration?: boolean } = {},
): UnitChecks {
  return {
    ...base,
    validate: nextValidator(base.validate),
    validateLive: nextValidator(base.validateLive ?? base.validate),
    versions: NEXT_VERSIONS,
    ...(migration ? { migration: { migrateDocuments: migrateToNext, unifiedDiff: lineDiff } } : {}),
  };
}
