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
// - a reference output must pass its own contrast report;
// - an acceptance names only an image-derived scheme the package has.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { GeneratedSchemes } from '@portfolio/appearance';
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
    if (recorded === text) continue;
    if (recorded === null) {
      problems.push({
        pack: pack.id,
        message: `${file} is missing. Run pnpm catalog:generated and commit it.`,
        writable: true,
      });
    } else if (recordedVersion(recorded) === declared.version) {
      problems.push({
        pack: pack.id,
        message: `${file} differs from what ${declared.id} version ${declared.version} makes now: the generator changed at the same version. Raise its version in @portfolio/appearance/generators and in ${pack.id}'s manifest, then run pnpm catalog:generated.`,
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
