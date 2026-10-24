// Held packs (#20): approved packs that fail a gate no fix in scope can
// pass. Each keeps its seeded manifest, in full and as the prototype has
// it, in its package's `held/<id>/manifest.json`, beside a `gate.json`
// recording why: the failing checks, every failing role pair with its
// worst measured value and target, the scheme that fails worst, and, for a
// translucent language, the surface-opacity floor. Registry generation
// reads only `packs/`, so a held pack is never registered, selectable,
// published, exported, or bundled, as a Research record isn't.
//
// `pnpm catalog:held` writes each gate.json from the gate, as it runs now
// against every registered scheme and profile. `pnpm check:appearance`
// fails when one is stale, when a held manifest doesn't validate, when a
// held id is registered or held twice, or when a held pack passes now,
// so it can be promoted, in an owner-approved PR.

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import {
  AXIS_BY_KIND,
  AXIS_NAMES,
  findPack,
  gateLanguage,
  gateSet,
  gateTypography,
  schemeSets,
  validatePackManifest,
  type AppearanceRegistry,
  type DesignLanguageManifest,
  type GateTargets,
  type PackAxis,
  type PackKind,
  type PackManifest,
} from '@portfolio/appearance';
import type { PackPackage } from '@portfolio/appearance/node';

/** The directory beside `packs/` that holds them. */
export const HELD_DIR = 'held';
export const HELD_VERSION = 1;

/** What a held pack's gate.json records. */
export interface HeldRecord {
  readonly heldVersion: number;
  readonly id: string;
  readonly kind: PackKind;
  readonly tier: string;
  /** Why it's held, in a sentence. */
  readonly reason: string;
  /** The gate's causes: texture, which raises every target, and translucency, read over the worst backdrop. */
  readonly causes: readonly ('texture' | 'translucency')[];
  /** How many of the registered schemes it fails with, of how many. */
  readonly schemes: { readonly failing: number; readonly of: number };
  /** The scheme it fails worst with: its lowest measured value against the target. */
  readonly worst: HeldPair;
  /** Each failing role pair, at its worst across every scheme and profile, worst first. */
  readonly pairs: readonly HeldPair[];
  /**
   * For a translucent language, the least surface-opacity, in whole
   * percent, at which it passes: with its texture, and with none. Null
   * when not even 100% passes.
   */
  readonly opacityFloor?: {
    readonly withTexture: number | null;
    readonly withoutTexture: number | null;
  };
  /** The deferred work that would let it pass, as the scope file names it. */
  readonly unblockedBy: readonly string[];
}

export interface HeldPair {
  readonly set: string;
  readonly kind: string;
  readonly foreground: string;
  readonly ground: string;
  readonly backdrop?: string;
  readonly ratio: number;
  readonly target: number;
  /** The scheme it's measured with. */
  readonly scheme: string;
  /** For `pairs`, how many schemes it fails with. */
  readonly failing?: number;
}

export interface HeldPack {
  readonly id: string;
  readonly kind: PackKind;
  readonly axis: PackAxis;
  readonly packageName: string;
  /** Relative to the root, with `/` separators. */
  readonly dir: string;
  /** The manifest, when it validates. */
  readonly manifest: PackManifest | null;
  /** Its gate.json, as written, or null when missing or unreadable. */
  readonly recorded: string | null;
  readonly problems: readonly string[];
}

const posix = (file: string) => file.split(path.sep).join('/');

/** Every held pack in the packages given, sorted by package, then id. */
export function readHeld(root: string, packages: readonly PackPackage[]): HeldPack[] {
  const held: HeldPack[] = [];
  for (const pkg of packages) {
    const base = path.join(root, pkg.dir, HELD_DIR);
    if (!existsSync(base)) continue;
    for (const name of readdirSync(base).sort()) {
      const dir = path.join(base, name);
      const shown = posix(path.relative(root, dir));
      const problems: string[] = [];
      let manifest: PackManifest | null = null;
      let recorded: string | null = null;
      try {
        const parsed: unknown = JSON.parse(readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
        const checked = validatePackManifest(parsed, { kind: pkg.kind, packageName: pkg.name });
        if (checked.ok) manifest = checked.manifest as PackManifest;
        else
          problems.push(
            ...checked.diagnostics
              .filter(({ severity }) => severity === 'error')
              .map(({ message }) => `${shown}/manifest.json: ${message}`),
          );
      } catch (error) {
        problems.push(`${shown}/manifest.json doesn't read: ${(error as Error).message}`);
      }
      if (manifest && manifest.id !== name) {
        problems.push(`${shown} holds the pack ${manifest.id}: a held pack's directory is its id.`);
      }
      try {
        recorded = readFileSync(path.join(dir, 'gate.json'), 'utf8');
      } catch {
        problems.push(`${shown}/gate.json is missing. Run pnpm catalog:held.`);
      }
      held.push({
        id: manifest?.id ?? name,
        kind: pkg.kind,
        axis: AXIS_BY_KIND[pkg.kind],
        packageName: pkg.name,
        dir: shown,
        manifest,
        recorded,
        problems,
      });
    }
  }
  return held;
}

const floor2 = (value: number) => Math.floor(value * 100) / 100;

/** The gate's failing pairs for a language's tokens, against every registered, non-fixture scheme and profile. */
function failures(
  registry: AppearanceRegistry,
  tokens: DesignLanguageManifest['tokens'],
  targets: GateTargets,
): { pairs: HeldPair[]; schemes: { failing: Set<string>; of: number } } | null {
  const read = gateLanguage(tokens);
  if (!read.ok) return null;
  const typographies = [...registry.packs.typography.values()]
    .filter((entry) => !entry.fixture)
    .map((entry) => gateTypography(entry.manifest.roles, targets));
  // Profiles gate alike when they read the signature fill alike.
  const distinct = [...new Map(typographies.map((each) => [each.largeSignature, each])).values()];
  const schemes = [...registry.packs.colorScheme.values()]
    .filter((entry) => !entry.fixture && !entry.manifest.generator)
    .sort((a, b) => (a.manifest.id < b.manifest.id ? -1 : 1));
  const pairs: HeldPair[] = [];
  const failing = new Set<string>();
  for (const scheme of schemes) {
    const sets = schemeSets(scheme.sets, scheme.manifest.highContrast);
    for (const [name, set] of Object.entries(sets)) {
      if (!set) continue;
      for (const typography of distinct) {
        for (const pair of gateSet(set, name as never, read.language, typography, targets)) {
          if (pair.passes) continue;
          failing.add(scheme.manifest.id);
          pairs.push({
            set: pair.set,
            kind: pair.kind,
            foreground: pair.foreground,
            ground: pair.ground,
            ...(pair.backdrop ? { backdrop: pair.backdrop } : {}),
            ratio: pair.ratio,
            target: pair.target,
            scheme: scheme.manifest.id,
          });
        }
      }
    }
  }
  return { pairs, schemes: { failing, of: schemes.length } };
}

const severity = (pair: HeldPair) => pair.ratio / pair.target;
const byWorst = (a: HeldPair, b: HeldPair) =>
  severity(a) - severity(b) ||
  (a.scheme < b.scheme ? -1 : a.scheme > b.scheme ? 1 : 0) ||
  (a.set < b.set ? -1 : a.set > b.set ? 1 : 0);

/**
 * A held language's gate record, as the gate measures it now, or null when
 * it passes. A language the gate can't read has no record: heldFindings()
 * reports its read problems.
 */
export function heldRecord(
  registry: AppearanceRegistry,
  manifest: DesignLanguageManifest,
  targets: GateTargets,
): HeldRecord | null {
  const found = failures(registry, manifest.tokens, targets);
  if (!found || found.pairs.length === 0) return null;
  const groups = new Map<string, HeldPair[]>();
  for (const pair of found.pairs) {
    const key = `${pair.set} ${pair.kind} ${pair.foreground} ${pair.ground} ${pair.backdrop ?? ''}`;
    groups.set(key, [...(groups.get(key) ?? []), pair]);
  }
  const pairs = [...groups.values()]
    .map((group) => {
      const worst = [...group].sort(byWorst)[0]!;
      return {
        ...worst,
        ratio: floor2(worst.ratio),
        failing: new Set(group.map((p) => p.scheme)).size,
      };
    })
    .sort(byWorst);
  const worst = [...found.pairs].sort(byWorst)[0]!;
  const textured = manifest.tokens.texture !== 'none';
  const translucent = found.pairs.some((pair) => pair.backdrop !== undefined);
  const causes = [
    ...(textured ? (['texture'] as const) : []),
    ...(translucent ? (['translucency'] as const) : []),
  ];
  const passesAt = (tokens: DesignLanguageManifest['tokens']) => {
    const start = Math.ceil(Number.parseFloat(manifest.tokens['surface-opacity']));
    for (let percent = start; percent <= 100; percent += 1) {
      const at = failures(registry, { ...tokens, 'surface-opacity': `${percent}%` }, targets);
      if (at && at.pairs.length === 0) return percent;
    }
    return null;
  };
  // Each cause brings its sentence, and the work that would clear it.
  const unblockedBy = causes.map((cause) =>
    cause === 'texture'
      ? 'anchor-v2 textured targets (promoted from the backlog to #20 PR 2c: "anchor-v2 solver"), so a scheme meets the raised targets a texture sets'
      : 'translucency floors (promoted from the backlog to #20 PR 2c: "Translucency floors"), so a translucent surface keeps its contrast over the worst backdrop',
  );
  const sentence = causes.map((cause) =>
    cause === 'texture'
      ? `its texture raises every target by ${targets.textureRaise}, past where anchor-v1 solves each scheme's roles`
      : `its ${manifest.tokens['surface-opacity']} surfaces fall under the targets over a black or white backdrop`,
  );
  return {
    heldVersion: HELD_VERSION,
    id: manifest.id,
    kind: 'design-language',
    tier: manifest.tier,
    reason: `It fails check:appearance with ${found.schemes.failing.size} of ${found.schemes.of} color schemes: ${sentence.join(', and ')}.`,
    causes,
    schemes: { failing: found.schemes.failing.size, of: found.schemes.of },
    worst: { ...worst, ratio: floor2(worst.ratio) },
    pairs,
    ...(translucent
      ? {
          opacityFloor: {
            withTexture: passesAt(manifest.tokens),
            withoutTexture: passesAt({ ...manifest.tokens, texture: 'none' }),
          },
        }
      : {}),
    unblockedBy,
  };
}

/** A record as gate.json holds it. */
export const renderHeldRecord = (record: HeldRecord | null) =>
  `${JSON.stringify(record ?? { heldVersion: HELD_VERSION, passes: true }, null, 2)}\n`;

export interface HeldFindings {
  /** One line per held pack, with its reason. */
  readonly held: readonly string[];
  /** One line per finding. */
  readonly findings: readonly {
    readonly message: string;
    readonly pack: string;
    readonly axis: PackAxis;
  }[];
}

/** check:appearance's read of the held packs against the build's registry. */
export function heldFindings(
  registry: AppearanceRegistry,
  held: readonly HeldPack[],
  targets: GateTargets,
): HeldFindings {
  const lines: string[] = [];
  const findings: { message: string; pack: string; axis: PackAxis }[] = [];
  const seen = new Set<string>();
  for (const pack of held) {
    const name = AXIS_NAMES[pack.axis];
    for (const message of pack.problems) findings.push({ message, pack: pack.id, axis: pack.axis });
    if (seen.has(pack.id)) {
      findings.push({
        message: `The ${name} ${pack.id} is held twice: a held pack is held once.`,
        pack: pack.id,
        axis: pack.axis,
      });
    }
    seen.add(pack.id);
    const registered = (['designLanguage', 'colorScheme', 'typography'] as const).filter((axis) =>
      Boolean(findPack(registry, axis, pack.id)),
    );
    if (
      registered.length > 0 ||
      registry.variants.some(({ manifest }) => manifest.id === pack.id)
    ) {
      findings.push({
        message: `The held ${name} ${pack.id} is registered, so it's selectable: a held pack stays out of every registry until it passes its gate.`,
        pack: pack.id,
        axis: pack.axis,
      });
    }
    if (!pack.manifest) continue;
    if (pack.kind !== 'design-language') {
      findings.push({
        message: `The held ${name} ${pack.id} has no gate check:appearance can record: only design languages are held.`,
        pack: pack.id,
        axis: pack.axis,
      });
      continue;
    }
    // A language the gate can't read is that problem, never a pass.
    const read = gateLanguage((pack.manifest as DesignLanguageManifest).tokens);
    if (!read.ok) {
      for (const problem of read.problems) {
        findings.push({
          message: `The held ${name} ${pack.id} can't be read by the gate: ${problem}`,
          pack: pack.id,
          axis: pack.axis,
        });
      }
      continue;
    }
    const record = heldRecord(registry, pack.manifest as DesignLanguageManifest, targets);
    if (!record) {
      findings.push({
        message: `The held ${name} ${pack.id} passes its gate now: promote it to packs/ in an owner-approved PR.`,
        pack: pack.id,
        axis: pack.axis,
      });
      continue;
    }
    if (pack.recorded !== null && pack.recorded !== renderHeldRecord(record)) {
      findings.push({
        message: `${pack.dir}/gate.json is stale. Run pnpm catalog:held and commit it.`,
        pack: pack.id,
        axis: pack.axis,
      });
    }
    lines.push(`Held ${name} ${pack.id} (${record.tier}): ${record.reason}`);
  }
  return { held: lines, findings };
}
