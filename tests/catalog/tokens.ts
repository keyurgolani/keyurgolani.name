// Every tuple's resolved tokens (#20 PR 3's rehearsal): what each tuple of
// a static smoke shard renders, as resolveTokens() gives it, the generated
// schemes' reference records included. A shard writes two files under
// reports/catalog/tokens/shard-<n>/:
//
// - tuples.ndjson.gz: one line per tuple, its ids, the axes it fell back
//   on, and the SHA-256 of each token map it renders: its language's, its
//   profile's, and each color set its display mode renders (print and
//   prefers-contrast: more included, as check:appearance reads them);
// - maps.json.gz: each of those maps once, by its digest.
//
// Tuples share most maps, so the shard's files stay a few megabytes.

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import {
  createAppearanceRegistry,
  resolveTokens,
  type GeneratedSchemes,
} from '../../packages/appearance/src/index';
import { setsForMode } from '../../packages/appearance/src/node/index';
import { schemeSets, type ColorSetName } from '../../packages/appearance/src/sets';
import type { DisplayMode } from '@portfolio/schema';
import type { BuildMeta } from '../quality/cells';
import type { Tuple } from '../quality/coverage';

/** One tuple's line: its ids, what fell back, and each map's digest. */
export interface TupleTokens extends Tuple {
  readonly fallbackAxes: readonly string[];
  readonly language: string;
  readonly typography: string;
  readonly color: Readonly<Partial<Record<ColorSetName, string>>>;
}

const digest = (value: unknown) =>
  `sha256-${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;

/** Each tuple's resolved tokens, and every map they name, once by digest. */
export function resolvedTokens(
  meta: BuildMeta,
  tuples: readonly Tuple[],
  generated: GeneratedSchemes = {},
): { lines: TupleTokens[]; maps: Map<string, unknown> } {
  const registry = createAppearanceRegistry(meta);
  const maps = new Map<string, unknown>();
  const keep = (value: unknown) => {
    const key = digest(value);
    if (!maps.has(key)) maps.set(key, value);
    return key;
  };
  const lines: TupleTokens[] = [];
  for (const tuple of tuples) {
    const scheme = registry.packs.colorScheme.get(tuple.colorScheme);
    const sets = scheme?.manifest.generator
      ? generated[tuple.colorScheme]
        ? schemeSets(generated[tuple.colorScheme]!, generated[tuple.colorScheme]!.highContrast)
        : {}
      : scheme
        ? schemeSets(scheme.sets, scheme.manifest.highContrast, scheme.manifest.derivation)
        : {};
    const color: Partial<Record<ColorSetName, string>> = {};
    let fallbackAxes: readonly string[] = [];
    let language = '';
    let typography = '';
    for (const name of setsForMode(sets, tuple.displayMode as DisplayMode)) {
      const resolved = resolveTokens(
        registry,
        {
          designLanguage: tuple.designLanguage,
          colorScheme: tuple.colorScheme,
          typography: tuple.typography,
          polarity: name === 'light' || name === 'high-contrast-light' ? 'light' : 'dark',
          highContrast: name.startsWith('high-contrast'),
        },
        { generated },
      );
      color[name] = keep(resolved.color);
      fallbackAxes = resolved.fallbackAxes;
      language = keep(resolved.language);
      typography = keep({ roles: resolved.typography, measures: resolved.measures });
    }
    lines.push({ ...tuple, fallbackAxes, language, typography, color });
  }
  return { lines, maps };
}

/** Writes a shard's two token files under `dir`, and says where and how much. */
export function writeTokens(
  dir: string,
  shard: number,
  { lines, maps }: ReturnType<typeof resolvedTokens>,
): {
  readonly dir: string;
  readonly tuples: number;
  readonly maps: number;
  readonly bytes: number;
} {
  const out = path.join(dir, 'catalog', 'tokens', `shard-${shard}`);
  fs.mkdirSync(out, { recursive: true });
  const tuples = gzipSync(lines.map((line) => JSON.stringify(line)).join('\n') + '\n');
  const unique = gzipSync(JSON.stringify(Object.fromEntries(maps)));
  fs.writeFileSync(path.join(out, 'tuples.ndjson.gz'), tuples);
  fs.writeFileSync(path.join(out, 'maps.json.gz'), unique);
  return { dir: out, tuples: lines.length, maps: maps.size, bytes: tuples.length + unique.length };
}
