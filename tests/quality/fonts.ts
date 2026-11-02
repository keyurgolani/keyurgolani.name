// pnpm quality:fonts -- <fonts.observed.txt> [--write] (#11, 11-4): checks a
// fonts.observed.txt downloaded from a scheduled run's quality-full reports
// before it becomes tests/quality/container/fonts.txt. It must be what a
// visual run in the pinned image writes: fonts.txt's header, then fc-list's
// font lines, sorted, each once. It prints how the list differs from the
// committed one. With --write it copies the file over fonts.txt byte for
// byte, and changes nothing else. Exits 1 on a problem, 2 on a usage error.

import { copyFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  expectedFonts,
  fontDifference,
  FONTS_FILE,
  normalizeFonts,
  observedFontsProblems,
} from './lib/visual';

export function parseFontsArgs(argv: readonly string[]): { file: string; write: boolean } {
  const args = argv[0] === '--' ? argv.slice(1) : [...argv];
  const write = args.includes('--write');
  const rest = args.filter((arg) => arg !== '--write');
  if (rest.length !== 1 || rest[0]!.startsWith('-')) {
    throw new Error('usage: pnpm quality:fonts -- <downloaded fonts.observed.txt> [--write]');
  }
  return { file: path.resolve(rest[0]!), write };
}

function main(argv: readonly string[]): number {
  let options: ReturnType<typeof parseFontsArgs>;
  try {
    options = parseFontsArgs(argv);
  } catch (error) {
    console.error(`[quality:fonts] ${(error as Error).message}`);
    return 2;
  }
  let text: string;
  try {
    text = readFileSync(options.file, 'utf8');
  } catch (error) {
    console.error(`[quality:fonts] ${(error as Error).message}`);
    return 1;
  }
  const problems = observedFontsProblems(text);
  for (const problem of problems) console.error(`[quality:fonts] ${problem}`);
  if (problems.length > 0) return 1;
  const observed = normalizeFonts(text);
  const { missing, extra } = fontDifference(expectedFonts(FONTS_FILE), observed);
  console.log(
    `[quality:fonts] ${observed.length} font(s); against fonts.txt, ${extra.length} new and ${missing.length} gone.`,
  );
  for (const font of extra) console.log(`+ ${font}`);
  for (const font of missing) console.log(`- ${font}`);
  if (options.write) {
    copyFileSync(options.file, FONTS_FILE);
    console.log(
      `[quality:fonts] wrote ${path.relative(process.cwd(), FONTS_FILE)}, byte for byte.`,
    );
  }
  return 0;
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
