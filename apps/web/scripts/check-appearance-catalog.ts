// What `pnpm check:appearance` checks of the catalog's governance (#20),
// beside #19's computed gate: the per-axis pack gates over every pack
// registry generation compiled, the catalog lock and the third-party
// notices, the Research records, and the packs registry generation left
// out. Every finding names its pack and axis, and in CI each becomes a
// failure record through ci/run.mjs (ci/lib/reports.mjs), with the token
// role, display mode, and tuple where it has them.

import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  AXIS_BY_KIND,
  AXIS_NAMES,
  type ExcludedPack,
  type PackManifest,
} from '@portfolio/appearance';
import {
  baseLockProblems,
  catalogPacks,
  gatePack,
  LOCK_FILE,
  lockedPacks,
  lockProblems,
  NOTICES_FILE,
  packPackages,
  renderNotices,
  researchRecords,
  responsiblePack,
  type AppearanceCheck,
  type BaseLock,
  type NoticePack,
} from '@portfolio/appearance/node';
import type { RegistryResult } from '@portfolio/variant-contract/node';
import { REPO_ROOT } from './registry-options';

/** A failure record's fields, less the gate and command ci/run.mjs gives it. */
export interface CatalogRecord {
  readonly schemaVersion: '1.1';
  readonly test: string;
  readonly pack?: string;
  readonly axis?: string;
  readonly tokenRole?: string;
  readonly displayMode?: string;
  readonly tuple?: string;
  readonly rule?: string;
  readonly asset?: string;
  readonly expected?: string | number;
  readonly actual?: string | number;
}

export interface CatalogFindings {
  /** One line per finding, as the command prints them. */
  readonly lines: readonly string[];
  /** One failure record per finding, for CI. */
  readonly records: readonly CatalogRecord[];
  /** What it checked, for the summary line. */
  readonly counts: {
    readonly gated: number;
    readonly locked: number;
    readonly research: number;
  };
}

/**
 * Writes each record into the failure records ci/run.mjs reads, one file
 * apiece, when ci/run.mjs runs this check: it sets CI_GATE and CI_REPRO.
 * Outside it, nothing is written. This is ci/lib/reports.mjs's
 * writeFailureRecord() and currentGate(), which a build source can't import,
 * since the fixture host's build copies no ci/ (tests/harness/fixture-host.mjs);
 * check-appearance-catalog.test.ts holds the two to one format.
 */
export function writeCatalogRecords(
  records: readonly CatalogRecord[],
  env: Readonly<Record<string, string | undefined>> = process.env,
): string[] {
  if (!env.CI_GATE) return [];
  const dir = path.join(
    path.resolve(env.CI_REPORTS_DIR ?? path.join(REPO_ROOT, 'reports')),
    'failures',
  );
  fs.mkdirSync(dir, { recursive: true });
  return records.map((record) => {
    const fields: Record<string, unknown> = {
      ...record,
      gate: env.CI_GATE,
      reproCommand: env.CI_REPRO ?? `pnpm ci:${env.CI_GATE}`,
    };
    const written = Object.fromEntries(
      Object.entries(fields).filter(([, value]) => value !== undefined && value !== ''),
    );
    const file = path.join(dir, `${env.CI_GATE}-${Date.now()}-${randomUUID()}.json`);
    fs.writeFileSync(file, `${JSON.stringify(written, null, 2)}\n`);
    return file;
  });
}

const read = (root: string, file: string): string | null => {
  try {
    return fs.readFileSync(path.join(root, file), 'utf8');
  } catch {
    return null;
  }
};

/** The pack a contrast failure excludes (#20), which check.ts in @portfolio/appearance/node decides. */
export { responsiblePack };

/** One record per display mode a contrast failure renders in, naming the pack it excludes. */
export function contrastRecords(check: AppearanceCheck): CatalogRecord[] {
  return check.failures.flatMap((failure) => {
    const { axis, id } = responsiblePack(failure);
    const { pair } = failure;
    return failure.modes.map((mode) => ({
      schemaVersion: '1.1' as const,
      test: `contrast: ${pair.foreground}${pair.ground ? ` on ${pair.ground}` : ''} in ${pair.set}`,
      pack: id,
      axis,
      // A fill's roles read "signature-start to signature-end": the record names its first.
      tokenRole: pair.foreground.split(' ')[0],
      displayMode: mode,
      tuple: `${failure.language}/${failure.scheme}/${failure.typography}/${mode}`,
      rule: pair.kind,
      expected: pair.target,
      actual: pair.ratio,
    }));
  });
}

/** The hierarchy failures, each the scheme's. */
export function hierarchyRecords(check: AppearanceCheck): CatalogRecord[] {
  return check.hierarchy.map(({ scheme, set, first, second, distance }) => ({
    schemaVersion: '1.1' as const,
    test: `hierarchy: ${first} and ${second} in ${set}`,
    pack: scheme,
    axis: 'colorScheme',
    tokenRole: first,
    rule: 'hierarchy',
    actual: distance,
  }));
}

/** The pack problems #19's gate reads, each its pack's. */
export function problemRecords(check: AppearanceCheck): CatalogRecord[] {
  return check.problems.map(({ axis, id, message }) => ({
    schemaVersion: '1.1' as const,
    test: `pack: ${message}`.slice(0, 500),
    pack: id,
    axis,
  }));
}

/**
 * The lock at the change's base, which CATALOG_LOCK_BASE names as a git
 * ref, or null when it names none. CI's static job sets HEAD^1: under a
 * PR's merge commit, the base branch's tip, and on a push, the commit
 * before. The text is null when the base has no lock yet. A ref git can't
 * read fails, so a run asked to hold the lock to its base never quietly
 * doesn't.
 */
export function baseLock(
  env: Readonly<Record<string, string | undefined>> = process.env,
  root: string = REPO_ROOT,
): BaseLock | null {
  const ref = env.CATALOG_LOCK_BASE;
  if (!ref) return null;
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    git('rev-parse', '--verify', '--quiet', `${ref}^{commit}`);
  } catch {
    throw new Error(
      `CATALOG_LOCK_BASE is ${ref}, and git can't read it. Fetch it (CI's static job checks out with fetch-depth: 2), or unset it to check the lock against the packs alone.`,
    );
  }
  let text: string | null;
  try {
    text = git('show', `${ref}:${LOCK_FILE}`);
  } catch {
    text = null;
  }
  return { ref, text };
}

/**
 * The packs the third-party notices cover: every pack registry generation
 * registered, from any package, less the fixtures a flag admitted, which no
 * production build ships. The lock pins first-party packs alone, since
 * pnpm-lock.yaml pins an installed one; the notices cover both.
 */
export function noticePacks(result: Pick<RegistryResult, 'packs'>): NoticePack[] {
  return result.packs
    .filter(({ fixture }) => !fixture)
    .map((pack) => ({
      id: pack.manifest.id,
      axis: AXIS_BY_KIND[pack.kind],
      packageName: pack.packageName,
      manifest: pack.manifest as unknown as Record<string, unknown>,
    }));
}

/**
 * The catalog's governance checks over what registry generation read: its
 * result, less the excluded packs, and the excluded ones; and the lock at
 * the change's base, when there is one to hold the committed lock to.
 */
export function catalogFindings(
  root: string,
  result: RegistryResult,
  excluded: readonly ExcludedPack[],
  base: BaseLock | null = null,
): CatalogFindings {
  const lines: string[] = [];
  const records: CatalogRecord[] = [];
  const add = (
    line: string,
    record: Omit<CatalogRecord, 'schemaVersion' | 'test'> & { test?: string },
  ) => {
    lines.push(line);
    records.push({ schemaVersion: '1.1', test: record.test ?? line.slice(0, 500), ...record });
  };

  // The per-axis pack gates, over every pack registry generation compiled.
  for (const pack of result.packs) {
    const axis = AXIS_BY_KIND[pack.kind];
    for (const failure of gatePack({
      kind: pack.kind,
      manifest: pack.manifest as PackManifest,
      stylesheet: pack.stylesheet,
      assets: pack.assets,
    })) {
      add(`${AXIS_NAMES[axis]} ${failure.pack} (${failure.gate}): ${failure.message}`, {
        test: `pack gate ${failure.gate}`,
        pack: failure.pack,
        axis,
        rule: failure.gate,
        ...(failure.role ? { tokenRole: failure.role } : {}),
      });
    }
  }

  // Two registered packs on one axis with one display name: a derived counterpart takes its own.
  const names = new Map<string, string>();
  for (const pack of result.packs) {
    const manifest = pack.manifest as PackManifest;
    const key = `${pack.kind}:${manifest.name.toLowerCase().replace(/\s+/g, ' ')}`;
    const other = names.get(key);
    if (other) {
      add(
        `${AXIS_NAMES[AXIS_BY_KIND[pack.kind]]} ${manifest.id} is named ${manifest.name}, as ${other} is: every pack on an axis, a derived counterpart included, takes a distinct name.`,
        { pack: manifest.id, axis: AXIS_BY_KIND[pack.kind], rule: 'distinct-name' },
      );
    } else names.set(key, manifest.id);
  }

  // Every pack the platform ships must ship: a first-party pack excluded is a finding.
  for (const pack of excluded) {
    const axis = AXIS_BY_KIND[pack.kind];
    if (pack.packageName.startsWith('@portfolio/')) {
      add(
        `${AXIS_NAMES[axis]} ${pack.id} in ${pack.packageName} is excluded from the build: ${pack.reason}`,
        {
          pack: pack.id,
          axis,
          rule: 'excluded',
        },
      );
    }
  }

  // The lock, and the notices generated beside it.
  const locked = lockedPacks(root);
  for (const problem of lockProblems(read(root, LOCK_FILE), locked)) {
    add(problem.message, {
      test: 'catalog lock',
      ...(problem.pack ? { pack: problem.pack } : {}),
      ...(problem.axis ? { axis: problem.axis } : {}),
      asset: LOCK_FILE,
    });
  }
  // A lock edited along with its pack still holds to the base's: same version, same digest.
  for (const problem of base ? baseLockProblems(base, locked) : []) {
    add(problem.message, {
      test: 'catalog lock against its base',
      ...(problem.pack ? { pack: problem.pack } : {}),
      ...(problem.axis ? { axis: problem.axis } : {}),
      asset: LOCK_FILE,
    });
  }
  if (read(root, NOTICES_FILE) !== renderNotices(noticePacks(result))) {
    add(`${NOTICES_FILE} is stale. Run pnpm catalog:lock and commit it.`, {
      test: 'third-party notices',
      asset: NOTICES_FILE,
    });
  }

  // The Research records: well formed, and never an id anything else has.
  const packages = packPackages(root);
  const research = researchRecords(root, packages);
  const taken = new Map<string, string>([
    ...result.variants.map(({ manifest }) => [manifest.id, 'a variant'] as const),
    ...catalogPacks(root, packages).map(
      ({ id, axis }) => [id, `a ${AXIS_NAMES[axis]} pack`] as const,
    ),
  ]);
  const seen = new Set<string>();
  for (const { file, record, problems } of research) {
    for (const problem of problems) add(problem, { test: 'research record', asset: file });
    if (!record) continue;
    const owner = taken.get(record.id);
    if (owner || seen.has(record.id)) {
      add(
        `${file} is the Research record ${record.id}, an id ${owner ?? 'another research record'} has: an id names one thing.`,
        { test: 'research record', pack: record.id, asset: file },
      );
    }
    seen.add(record.id);
  }

  return {
    lines,
    records,
    counts: { gated: result.packs.length, locked: locked.length, research: research.length },
  };
}
