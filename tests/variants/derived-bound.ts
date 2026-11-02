// `pnpm report:derived-bound [ref]` (the LANG-5 enforcement commit): for each
// first-party color scheme whose anchors differ from `ref`'s (HEAD~1 unless
// given), every derived role that moved while its own anchor stayed, measured
// against lead A's bound (pack-distinct.ts's DERIVED_BOUND: 2.0 ΔE00, the hue
// within 5°). Report only: it prints, and exits 0 whatever it finds, unless
// it can't read the packs or the ref.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deriveBaseSet, schemeSets } from '../../packages/appearance/src/sets';
import { DERIVED_BOUND, derivedShifts } from './pack-distinct';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PACKS = 'packages/appearance-schemes/packs';
const ref = process.argv[2] ?? 'HEAD~1';

interface SchemeManifest {
  readonly id: string;
  readonly version: string;
  readonly derivation?: string;
  readonly generator?: unknown;
  readonly anchors?: Record<string, Record<string, unknown>>;
  readonly highContrast?: unknown;
}

function derive(manifest: SchemeManifest) {
  const anchors = manifest.anchors ?? {};
  const base = Object.fromEntries(
    (['light', 'dark'] as const)
      .filter((mode) => anchors[mode])
      .map((mode) => [
        mode,
        deriveBaseSet((manifest.derivation ?? 'anchor-v1') as never, anchors[mode] as never, mode),
      ]),
  );
  const sets = schemeSets(
    base as never,
    manifest.highContrast as never,
    manifest.derivation as never,
    anchors as never,
  );
  return { anchors, sets: sets as unknown as Record<string, Record<string, string>> };
}

let changed = 0;
let beyond = 0;
for (const id of fs.readdirSync(path.join(ROOT, PACKS)).sort()) {
  const file = path.join(PACKS, id, 'manifest.json');
  if (!fs.existsSync(path.join(ROOT, file))) continue;
  const now = JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8')) as SchemeManifest;
  if (now.generator || !now.anchors) continue;
  let then: SchemeManifest;
  try {
    then = JSON.parse(
      execFileSync('git', ['show', `${ref}:${file}`], {
        cwd: ROOT,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }),
    );
  } catch {
    continue; // new at this ref, or not a pack there: nothing to compare
  }
  if (JSON.stringify(then.anchors) === JSON.stringify(now.anchors)) continue;
  changed += 1;
  const shifts = derivedShifts(derive(then), derive(now));
  const over = shifts.filter((shift) => !shift.within);
  beyond += over.length;
  console.log(
    `[derived-bound] ${id} ${then.version} -> ${now.version}: ${shifts.length} derived role(s) moved with their own anchor fixed, ${over.length} beyond ${DERIVED_BOUND.de} ΔE00 or ${DERIVED_BOUND.hue}° of hue`,
  );
  for (const shift of shifts) {
    console.log(
      `  ${shift.within ? 'within' : 'BEYOND, lead review'}: ${shift.set} ${shift.role} ${shift.from} -> ${shift.to}, ΔE00 ${shift.de}, hue ${shift.hue}°`,
    );
  }
}
console.log(
  `[derived-bound] against ${ref}: ${changed} scheme(s) re-anchored, ${beyond} derived shift(s) beyond the bound (report only)`,
);
