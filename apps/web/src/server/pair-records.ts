import 'server-only';
import { createHash } from 'node:crypto';
import type { Diagnostic, Portfolio, Site } from '@portfolio/schema';
import type { PairFiles, PairSource } from '@portfolio/schema/node';
import type { PublicationUnit } from './catalog-port';
import type { ConfigIssue } from './config';
import { deepFreeze } from './freeze';

// What demo's sample adapter does with its loaded pair: its records as
// startup issues, its revision id, and its frozen publication unit.

/**
 * A diagnostic record as a startup issue, as `pnpm config:validate` prints
 * it: blocking records are fatal, warnings stay warnings. `names` are the
 * pair's file names, once there are both.
 */
export function recordIssue(
  record: Diagnostic,
  key: string,
  names?: Partial<PairFiles>,
): ConfigIssue {
  // A snapshot's or the media document's record names its own file (#10).
  const file =
    record.file ??
    (record.document === 'portfolio' || record.document === 'site'
      ? names?.[record.document]
      : undefined);
  return {
    severity: record.severity === 'warning' ? 'warning' : 'fatal',
    key,
    code: record.code,
    ...(file !== undefined ? { file } : {}),
    document: record.document,
    path: record.pointer,
    ...(record.line !== undefined ? { line: record.line, column: record.column } : {}),
    ...(record.stableId !== undefined ? { stableId: record.stableId } : {}),
    message: record.message,
    remediation: record.remediation,
  };
}

/** 12 hex digits of a SHA-256 over both documents' names and text: a change to either is a new revision. */
export function pairDigest(sources: { readonly [D in keyof PairFiles]: PairSource }): string {
  const hash = createHash('sha256');
  for (const source of [sources.portfolio, sources.site]) {
    // Each part's length first, so no two pairs hash the same text.
    for (const part of [source.name, source.text]) hash.update(`${part.length}:${part}`);
  }
  return hash.digest('hex').slice(0, 12);
}

/** The unit's derived data, as the snapshot and media readers hand it over (#10). */
export interface UnitData {
  readonly snapshots: Readonly<Record<string, unknown>>;
  readonly media?: unknown;
}

/** The pair and its derived data as the unit a revision publishes, frozen to the last field. */
export function frozenUnit(
  portfolio: Portfolio,
  site: Site,
  data: UnitData = { snapshots: {} },
): PublicationUnit {
  return Object.freeze({
    portfolio: deepFreeze(portfolio),
    site: deepFreeze(site),
    snapshots: deepFreeze({ ...data.snapshots }),
    ...(data.media === undefined ? {} : { media: deepFreeze(data.media) }),
  });
}
