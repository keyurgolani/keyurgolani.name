// Scratch, not committed: the opacity floor each language needs, with and without its texture.
import fs from 'node:fs';
import path from 'node:path';
import { anchorV1 } from '../../packages/appearance/src/derive';
import { gateLanguage, gateSet } from '../../packages/appearance/src/gate';
import { schemeSets, type SchemeSets } from '../../packages/appearance/src/sets';

const dir = 'packages/appearance-schemes/packs';
const sets: { id: string; sets: SchemeSets }[] = fs.readdirSync(dir).map((id) => {
  const m = JSON.parse(fs.readFileSync(path.join(dir, id, 'manifest.json'), 'utf8'));
  const base: Record<string, unknown> = {};
  for (const mode of ['light', 'dark'] as const) {
    if (m.anchors?.[mode]) base[mode] = anchorV1(m.anchors[mode], mode);
  }
  return { id, sets: schemeSets(base as never) };
});

function fails(tokens: Record<string, string>): number {
  const read = gateLanguage(tokens as never);
  if (!read.ok) throw new Error(read.problems.join('; '));
  let count = 0;
  for (const scheme of sets) {
    for (const [name, set] of Object.entries(scheme.sets)) {
      if (!set) continue;
      count += gateSet(set, name as never, read.language, { largeSignature: true }).filter(
        (p) => !p.passes,
      ).length;
    }
  }
  return count;
}

const ldir = 'packages/appearance-languages/packs';
for (const id of fs.readdirSync(ldir)) {
  const m = JSON.parse(fs.readFileSync(path.join(ldir, id, 'manifest.json'), 'utf8'));
  const tokens = m.tokens as Record<string, string>;
  const asIs = fails(tokens);
  if (asIs === 0) continue;
  const flat = { ...tokens, texture: 'none' };
  const floor = (base: Record<string, string>) => {
    for (let p = Number.parseFloat(tokens['surface-opacity']!); p <= 100; p += 1) {
      if (fails({ ...base, 'surface-opacity': `${p}%` }) === 0) return p;
    }
    return null;
  };
  console.log(
    JSON.stringify({
      id,
      tier: m.tier,
      opacity: tokens['surface-opacity'],
      texture: tokens.texture !== 'none',
      asIs,
      floorWithTexture: floor(tokens),
      floorWithoutTexture: floor(flat),
    }),
  );
}
