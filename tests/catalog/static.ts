// The scheduled cross-product's static smoke (#20): every tuple of the
// registered cross-product checked in Node, with no browser. A tuple is in
// the cross-product when #19's resolver renders it as asked under demo
// (plan.ts's crossProduct, which resolves each one); here each tuple's
// packs and variant are held to what registry generation compiled and
// served:
//
// - compile: each pack's compiled stylesheet, each font a profile ships,
//   and the variant's stylesheet are where the metadata module says, with
//   the bytes it hashed;
// - token coverage, bundle size, and boundary isolation: the per-axis pack
//   gates (pack-gates.ts) over each pack's compiled files;
// - the contrast table: #19's gate over the tuple's language, scheme, and
//   profile in its display mode, and the scheme's hierarchy.
//
// What a tuple shares with others is checked once and read for each, so a
// tuple costs a few lookups after its resolve. A finding names one pack,
// its axis, and every tuple it fails, so one bad pack is one finding, not
// one per tuple.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  AXIS_BY_KIND,
  createAppearanceRegistry,
  PACK_AXES,
  type PackAxis,
  type PackManifest,
} from '../../packages/appearance/src/index';
import {
  checkAppearance,
  gatePack,
  responsiblePack,
} from '../../packages/appearance/src/node/index';
import type { BuildMeta } from '../quality/cells';
import type { Tuple } from '../quality/coverage';

/** One static smoke finding: what failed, the pack or variant it's on, and the tuples it fails. */
export interface StaticFinding {
  readonly check: 'compile' | 'pack gate' | 'contrast' | 'hierarchy';
  readonly axis: PackAxis | 'variant';
  /** The pack, or for the variant axis the variant. */
  readonly id: string;
  readonly message: string;
  /** Every tuple it fails, in plan order. */
  readonly tuples: readonly Tuple[];
}

interface FileRef {
  readonly url: string;
  readonly sha256: string;
}

/** Whether the file `ref` names under apps/web/public has the bytes registry generation hashed, or why not. */
function servedProblem(web: string, ref: FileRef, what: string): string | null {
  const file = path.join(web, 'public', ...ref.url.split('/').filter(Boolean));
  if (!existsSync(file)) return `${what} ${ref.url} isn't in apps/web/public`;
  const sha = createHash('sha256').update(readFileSync(file)).digest('hex');
  return sha === ref.sha256 ? null : `${what} ${ref.url} isn't the file registry generation hashed`;
}

const bytesOf = (web: string, ref: FileRef) =>
  new Uint8Array(readFileSync(path.join(web, 'public', ...ref.url.split('/').filter(Boolean))));

/**
 * The static smoke over `tuples`, against the build in `web` (apps/web after
 * build:registry, which writes the metadata module and the files it serves).
 */
export function staticSmoke(
  meta: BuildMeta,
  web: string,
  tuples: readonly Tuple[],
): StaticFinding[] {
  const registry = createAppearanceRegistry(meta);
  const packs = new Map<string, (typeof meta.PACKS & object)[number]>();
  for (const pack of meta.PACKS ?? [])
    packs.set(`${AXIS_BY_KIND[pack.kind]}:${pack.manifest.id}`, pack);

  // Each pack's own findings, once: what it compiled, and its pack gates.
  const ownFindings = new Map<string, { check: StaticFinding['check']; message: string }[]>();
  const packFindings = (axis: PackAxis, id: string) => {
    const key = `${axis}:${id}`;
    const cached = ownFindings.get(key);
    if (cached) return cached;
    const found: { check: StaticFinding['check']; message: string }[] = [];
    const pack = packs.get(key);
    if (!pack) {
      found.push({ check: 'compile', message: 'is in no metadata module entry' });
    } else {
      const generator = pack.kind === 'color-scheme' && pack.manifest.generator !== undefined;
      const files: { ref: FileRef; what: string }[] = [
        ...(pack.stylesheet ? [{ ref: pack.stylesheet, what: 'its compiled stylesheet' }] : []),
        ...(pack.fonts ?? []).map((ref) => ({ ref, what: 'its font' })),
      ];
      if (!pack.stylesheet && !generator) {
        found.push({ check: 'compile', message: 'compiled no stylesheet' });
      }
      const problems = files.flatMap(({ ref, what }) => servedProblem(web, ref, what) ?? []);
      for (const message of problems) found.push({ check: 'compile', message });
      if (problems.length === 0) {
        for (const failure of gatePack({
          kind: pack.kind,
          manifest: pack.manifest as PackManifest,
          stylesheet: pack.stylesheet
            ? { url: pack.stylesheet.url, bytes: bytesOf(web, pack.stylesheet) }
            : null,
          assets: (pack.fonts ?? []).map((ref) => ({ url: ref.url, bytes: bytesOf(web, ref) })),
        })) {
          found.push({ check: 'pack gate', message: `${failure.gate}: ${failure.message}` });
        }
      }
    }
    ownFindings.set(key, found);
    return found;
  };

  // Each variant's compiled stylesheet, once.
  const variantFindings = new Map<string, string[]>();
  const ofVariant = (id: string) => {
    const cached = variantFindings.get(id);
    if (cached) return cached;
    const entry = meta.VARIANTS.find(({ manifest }) => manifest.id === id) as
      { stylesheet?: FileRef | null } | undefined;
    const found = !entry
      ? ['is in no metadata module entry']
      : entry.stylesheet
        ? [servedProblem(web, entry.stylesheet, 'its compiled stylesheet')].flatMap((each) =>
            each ? [each] : [],
          )
        : [];
    variantFindings.set(id, found);
    return found;
  };

  // The contrast table, once over every combination, read by tuple.
  const check = checkAppearance(registry);
  const contrast = new Map<string, { axis: PackAxis; id: string; message: string }[]>();
  for (const failure of check.failures) {
    const { axis, id } = responsiblePack(failure);
    const { pair } = failure;
    for (const mode of failure.modes) {
      const key = `${failure.language}/${failure.scheme}/${failure.typography}/${mode}`;
      contrast.set(key, [
        ...(contrast.get(key) ?? []),
        {
          axis,
          id,
          message: `${pair.foreground}${pair.ground ? ` on ${pair.ground}` : ''} in ${pair.set} is ${pair.ratio}, under its ${pair.target} target (${pair.kind})`,
        },
      ]);
    }
  }
  const hierarchy = new Map<string, string[]>();
  for (const { scheme, set, first, second, distance } of check.hierarchy) {
    hierarchy.set(scheme, [
      ...(hierarchy.get(scheme) ?? []),
      `${first} and ${second} in ${set} sit ${distance} apart, closer than their pair keeps`,
    ]);
  }

  const findings = new Map<string, StaticFinding & { tuples: Tuple[] }>();
  const add = (
    check: StaticFinding['check'],
    axis: StaticFinding['axis'],
    id: string,
    message: string,
    tuple: Tuple,
  ) => {
    const key = `${check}\0${axis}\0${id}\0${message}`;
    const existing = findings.get(key);
    if (existing) existing.tuples.push(tuple);
    else findings.set(key, { check, axis, id, message, tuples: [tuple] });
  };
  for (const tuple of tuples) {
    for (const message of ofVariant(tuple.variant))
      add('compile', 'variant', tuple.variant, message, tuple);
    for (const axis of PACK_AXES) {
      for (const { check: kind, message } of packFindings(axis, tuple[axis])) {
        add(kind, axis, tuple[axis], message, tuple);
      }
    }
    const key = `${tuple.designLanguage}/${tuple.colorScheme}/${tuple.typography}/${tuple.displayMode}`;
    for (const { axis, id, message } of contrast.get(key) ?? [])
      add('contrast', axis, id, message, tuple);
    for (const message of hierarchy.get(tuple.colorScheme) ?? []) {
      add('hierarchy', 'colorScheme', tuple.colorScheme, message, tuple);
    }
  }
  return [...findings.values()];
}
