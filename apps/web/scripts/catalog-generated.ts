// The generated schemes' reference records (#20 PR 3), which
// `pnpm catalog:generated` writes and `pnpm check:appearance` holds current.
// Each first-party, non-fixture generator scheme has a reference input
// (REFERENCE_SOURCES in @portfolio/appearance/node), and its record is what
// its generator makes of it, in `<package>/generated/<id>.json`:
//
// - a missing record, or one from another generator version, is stale, and
//   `pnpm catalog:generated` writes it;
// - a record that differs at the same generator version means the
//   generator changed without its version going up, which fails and which
//   the writer refuses, since stored output is pinned to its version;
// - but a record written before K-2, whose sets have none of the three
//   roles K-2 added (on-emphasis, focus-inverse, surface-lit), is current
//   when it matches in every other role and in its contrast report, less
//   the pairs that read those three: its sets get the three when they
//   render, worked out from the others as every derivation does, as a
//   stored draft's do, and rewriting it would change the digest an owner's
//   acceptance names;
// - and a record whose report reads fewer of the strictest readings than
//   the generator's does now (LANG-5c r2b added the shipping washes) is
//   current when everything else matches and its report is what those
//   readings make of the same sets: the colors didn't move, only what the
//   report reads did, so the generator keeps its version and the record
//   its bytes, and an owner's acceptance of it stands;
// - a reference output must pass its own contrast report;
// - an acceptance names only an image-derived scheme the package has.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  contrastReport,
  DERIVED_ROLES,
  generatedSchemeSets,
  type GeneratedSchemes,
} from '@portfolio/appearance';
import {
  readingName,
  SHIPPING_TYPOGRAPHY,
  STRICTEST_READINGS,
} from '@portfolio/appearance/generators';
import {
  catalogPacks,
  readAcceptance,
  REFERENCE_SOURCES,
  referenceFile,
  referenceRecord,
  renderReference,
  type DeclaredGenerator,
  type PackPackage,
  type ReferenceRecord,
} from '@portfolio/appearance/node';

/** One generator scheme's reference record: as committed, and as its generator makes it now. */
export interface GeneratedEntry {
  readonly id: string;
  readonly packageName: string;
  /** The record file, relative to the root. */
  readonly file: string;
  readonly declared: DeclaredGenerator;
  /** The committed text, or null when there's none. */
  readonly recorded: string | null;
  /** What the generator makes now, or null when it can't. */
  readonly record: ReferenceRecord | null;
  readonly text: string | null;
}

export interface GeneratedProblem {
  readonly pack: string;
  readonly message: string;
  /** Whether `pnpm catalog:generated` fixes it by writing the record. */
  readonly writable: boolean;
}

const posix = (file: string) => file.split(path.sep).join('/');

const readText = (file: string): string | null => {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return null;
  }
};

/** The version a committed record says its generator ran at, or null when it doesn't parse. */
function recordedVersion(text: string): number | null {
  try {
    const parsed = JSON.parse(text) as { result?: { generator?: { version?: unknown } } };
    const version = parsed.result?.generator?.version;
    return typeof version === 'number' ? version : null;
  } catch {
    return null;
  }
}

/**
 * What a record was made from: its reference source and the generator's
 * input, the seed or the asset with its pixel hash. JSON, so two compare as
 * text, or null when the text doesn't parse.
 */
function recordedInput(text: string): string | null {
  try {
    const parsed = JSON.parse(text) as { source?: unknown; result?: { input?: unknown } };
    return JSON.stringify({ source: parsed.source, input: parsed.result?.input });
  } catch {
    return null;
  }
}

const ADDITIONS: ReadonlySet<string> = new Set(DERIVED_ROLES);

/** Whether a record's sets have none of the roles K-2 added, as a record written before K-2 has. */
function beforeDerivedRoles(text: string): boolean {
  try {
    const tokens = (JSON.parse(text) as { result?: { tokens?: unknown } }).result?.tokens;
    const sets = (value: unknown): Record<string, unknown>[] =>
      value && typeof value === 'object'
        ? Object.entries(value).flatMap(([name, set]) =>
            name === 'highContrast' ? sets(set) : [set as Record<string, unknown>],
          )
        : [];
    return sets(tokens).every((set) => !Object.keys(set ?? {}).some((role) => ADDITIONS.has(role)));
  } catch {
    return false;
  }
}

/**
 * A record's text as it read before K-2: its sets without the roles K-2
 * added, and its contrast report without the pairs that read them. For a
 * record made now, `fresh`, its `passes` is worked out again over the
 * rest; a committed record keeps its own. Null when it doesn't parse.
 */
function withoutDerivedRoles(text: string, fresh: boolean): string | null {
  const additions = ADDITIONS;
  const strip = (set: unknown) =>
    set && typeof set === 'object'
      ? Object.fromEntries(Object.entries(set).filter(([role]) => !additions.has(role)))
      : set;
  try {
    const parsed = JSON.parse(text) as {
      result?: {
        tokens?: Record<string, unknown> & { highContrast?: Record<string, unknown> };
        contrastReport?: { passes?: unknown; pairs?: unknown };
      };
    };
    const report = parsed.result?.contrastReport;
    const pairs = Array.isArray(report?.pairs)
      ? (report.pairs as { foreground?: unknown; ground?: unknown; passes?: unknown }[]).filter(
          (pair) =>
            !ADDITIONS.has(String(pair?.foreground)) && !ADDITIONS.has(String(pair?.ground)),
        )
      : report?.pairs;
    const kept =
      report && typeof report === 'object'
        ? {
            ...report,
            passes:
              fresh && Array.isArray(pairs)
                ? pairs.every((pair) => pair?.passes === true)
                : report.passes,
            pairs,
          }
        : report;
    const tokens = parsed.result?.tokens;
    const v1Tokens = tokens && {
      ...Object.fromEntries(
        Object.entries(tokens).map(([name, set]) => [
          name,
          name === 'highContrast' ? set : strip(set),
        ]),
      ),
      ...(tokens.highContrast && {
        highContrast: Object.fromEntries(
          Object.entries(tokens.highContrast).map(([name, set]) => [name, strip(set)]),
        ),
      }),
    };
    return JSON.stringify({
      ...parsed,
      result: parsed.result && { ...parsed.result, tokens: v1Tokens, contrastReport: kept },
    });
  } catch {
    return null;
  }
}

/** Whether `recorded` is `text`, or a record written before K-2 that matches it in every other role and pair. */
function sameRecord(recorded: string, text: string): boolean {
  if (recorded === text) return true;
  return (
    beforeDerivedRoles(recorded) &&
    withoutDerivedRoles(recorded, false) === withoutDerivedRoles(text, true)
  );
}

/** The readings an earlier record could have read: the strictest readings up to one added since, as readings are only ever added. */
const EARLIER_READINGS = STRICTEST_READINGS.slice(1).map((_, index) =>
  STRICTEST_READINGS.slice(0, index + 1),
);

/**
 * What the generator makes now, `text`, reported at the readings the
 * committed record's `reading` names instead, rendered as the writer
 * renders a record: so a record from before a reading was added compares
 * whole, its report included. Null when it names the readings `text` does,
 * or any this build doesn't have, or either doesn't parse.
 */
function atRecordedReadings(recorded: string, text: string): string | null {
  try {
    const reading = (JSON.parse(recorded) as { result?: { reading?: unknown } }).result?.reading;
    const record = JSON.parse(text) as ReferenceRecord;
    if (typeof reading !== 'string' || reading === record.result.reading) return null;
    const readings = EARLIER_READINGS.find((earlier) => readingName(earlier) === reading);
    if (!readings) return null;
    const sets = generatedSchemeSets(record.result.tokens);
    const pairs = readings.flatMap(
      ({ language }) => contrastReport(sets, language, SHIPPING_TYPOGRAPHY).pairs,
    );
    return renderReference({
      ...record,
      result: {
        ...record.result,
        reading,
        contrastReport: { passes: pairs.every((pair) => pair.passes), pairs },
      },
    });
  } catch {
    return null;
  }
}

/**
 * Whether a committed record is current for what its generator makes now,
 * `text`: the same text, or a record written before K-2 that matches it in
 * every other role and every other pair of its report, or either of those
 * at fewer of the strictest readings, with its report what they make now.
 */
export function recordCurrent(recorded: string | null, text: string): boolean {
  if (recorded === null) return false;
  if (sameRecord(recorded, text)) return true;
  const earlier = atRecordedReadings(recorded, text);
  return earlier !== null && sameRecord(recorded, earlier);
}

/** Every first-party, non-fixture generator scheme in `packages`, with its record. */
export function generatedEntries(
  root: string,
  packages: readonly PackPackage[],
): { entries: GeneratedEntry[]; problems: GeneratedProblem[] } {
  const entries: GeneratedEntry[] = [];
  const problems: GeneratedProblem[] = [];
  const shipping = packages.filter(
    (pkg) => !pkg.fixture && pkg.kind === 'color-scheme' && pkg.name.startsWith('@portfolio/'),
  );
  for (const pack of catalogPacks(root, shipping)) {
    const declared = (pack.manifest as { generator?: DeclaredGenerator } | null)?.generator;
    if (!declared) continue;
    const pkg = shipping.find(({ name }) => name === pack.packageName)!;
    const file = posix(path.join(pkg.dir, referenceFile(pack.id)));
    const recorded = readText(path.join(root, file));
    const source = Object.hasOwn(REFERENCE_SOURCES, pack.id)
      ? REFERENCE_SOURCES[pack.id]
      : undefined;
    if (!source) {
      problems.push({
        pack: pack.id,
        message: `The color scheme ${pack.id} is generated and has no reference input: add one to REFERENCE_SOURCES in packages/appearance/src/node/generated.ts.`,
        writable: false,
      });
      entries.push({
        id: pack.id,
        packageName: pack.packageName,
        file,
        declared,
        recorded,
        record: null,
        text: null,
      });
      continue;
    }
    const made = referenceRecord(root, pack.id, declared, source);
    if (!made.ok) {
      problems.push({
        pack: pack.id,
        message: `The color scheme ${pack.id} can't generate its reference record: ${made.problem}`,
        writable: false,
      });
      entries.push({
        id: pack.id,
        packageName: pack.packageName,
        file,
        declared,
        recorded,
        record: null,
        text: null,
      });
      continue;
    }
    const text = renderReference(made.record);
    entries.push({
      id: pack.id,
      packageName: pack.packageName,
      file,
      declared,
      recorded,
      record: made.record,
      text,
    });
    if (!made.record.result.contrastReport.passes) {
      const failing = made.record.result.contrastReport.pairs.filter(({ passes }) => !passes);
      problems.push({
        pack: pack.id,
        message: `The color scheme ${pack.id}'s reference output fails its own contrast report in ${failing.length} pair${failing.length === 1 ? '' : 's'}, first ${failing[0]!.foreground} on ${failing[0]!.ground} in ${failing[0]!.set}.`,
        writable: false,
      });
    }
    if (recordCurrent(recorded, text)) continue;
    const input = JSON.stringify({ source: made.record.source, input: made.record.result.input });
    if (recorded === null) {
      problems.push({
        pack: pack.id,
        message: `${file} is missing. Run pnpm catalog:generated and commit it.`,
        writable: true,
      });
    } else if (recordedInput(recorded) !== input) {
      // A new reference input, a seed or an image, isn't a new generator.
      problems.push({
        pack: pack.id,
        message: `${file} is from another reference input and is stale. Run pnpm catalog:generated and commit it.`,
        writable: true,
      });
    } else if (recordedVersion(recorded) === declared.version) {
      problems.push({
        pack: pack.id,
        message: `${file} differs from what ${declared.id} version ${declared.version} makes now from the same input: the generator changed at the same version. Raise its version in @portfolio/appearance/generators and in ${pack.id}'s manifest, then run pnpm catalog:generated.`,
        writable: false,
      });
    } else {
      problems.push({
        pack: pack.id,
        message: `${file} is from another ${declared.id} version and is stale. Run pnpm catalog:generated and commit it.`,
        writable: true,
      });
    }
  }
  for (const pkg of shipping) {
    const accepted = readAcceptance(path.join(root, pkg.dir));
    for (const id of Object.keys(accepted)) {
      const entry = entries.find((each) => each.id === id && each.packageName === pkg.name);
      if (!entry || entry.declared.input !== 'asset') {
        problems.push({
          pack: id,
          message: `${pkg.dir}/generated/acceptance.json accepts ${id}, which isn't an image-derived scheme in ${pkg.name}: remove it.`,
          writable: false,
        });
      }
    }
  }
  return { entries, problems };
}

/**
 * The reference outputs as generated sets, by scheme id, for the gate and
 * the cross-product: what a site with the reference input renders. An
 * image-derived scheme the owner hasn't accepted isn't registered, so the
 * gate and the cross-product never reach its sets.
 */
export function referenceSets(entries: readonly GeneratedEntry[]): GeneratedSchemes {
  const sets: Record<string, GeneratedSchemes[string]> = {};
  for (const entry of entries) if (entry.record) sets[entry.id] = entry.record.result.tokens;
  return sets;
}
