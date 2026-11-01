// `pnpm catalog:fonts <command>`: the fonts typography packs ship, and where
// each came from (docs/appearance.md, "Shipping fonts"). It never fetches.
//
//   pnpm catalog:fonts vendor <pack> <package> <files...> [--into <dir>]   copy WOFF2 files and the package's license into the pack
//   pnpm catalog:fonts verify                                              hold every pack's fonts to its fonts.provenance.json
//
// A file ending in "?" is optional, under the fit rule (packs-plan §3.2, as
// review R4 has it): one whose range meets printable Basic Latin is added
// only while the pack's Latin faces stay at or under 102,400 B, taken by
// package and path whatever order they're vendored in; any other, such as a
// latin-ext subset, which a Latin page never loads, is always added. One it
// leaves out is printed and recorded in fonts.provenance.json's dropped
// list. --into fonts puts the files and the license in the pack's fonts/
// directory.
//
// vendor reads <package> from node_modules, where the lead's pnpm add put
// it at an exact version with its integrity in the lockfile: the pack's
// own package's node_modules first, then the repository root's. Each of
// <files...> is a path inside the package, such as
// files/inter-latin-400-normal.woff2. It copies them and the package's
// LICENSE into the pack, writes their entries into fonts.provenance.json,
// and prints what the package's own stylesheet says of each file, for the
// manifest's fontAssets. verify runs the check `pnpm check:appearance`
// runs. --root <dir> reads another checkout, as the tests do.

import { existsSync, realpathSync } from 'node:fs';
import path from 'node:path';
import {
  FONT_FIT_BYTES,
  fontProvenanceReport,
  packPackages,
  vendorFonts,
  VendorError,
} from '@portfolio/appearance/node';
import { REGISTRY_ID_PATTERN } from '@portfolio/schema';
import { REPO_ROOT } from './registry-options';

const USAGE =
  'Usage: pnpm catalog:fonts vendor <pack> <package> <files...> [--into <dir>] | verify  [--root <dir>]\n';
const TAG = '[catalog:fonts]';

const relative = (root: string, file: string) =>
  path.relative(root, file).split(path.sep).join('/') || '.';

/** An npm package name, scoped or not, with no path segment that could climb out of node_modules. */
const NPM_NAME = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;

/** Whether `child` is inside `parent`, not `parent` itself. */
const within = (parent: string, child: string) => {
  const relation = path.relative(parent, child);
  return relation !== '' && !relation.startsWith('..') && !path.isAbsolute(relation);
};

/** Every typography pack directory named `id` under `root`'s packages, with its package's directory. */
function packDirs(root: string, id: string): { dir: string; packageDir: string }[] {
  return packPackages(root)
    .filter((pkg) => pkg.kind === 'typography' && pkg.packs)
    .map((pkg) => ({
      packs: path.join(root, pkg.packs!),
      dir: path.join(root, pkg.packs!, id),
      packageDir: path.join(root, pkg.dir),
    }))
    .filter(({ packs, dir }) => within(packs, dir) && existsSync(path.join(dir, 'manifest.json')))
    .map(({ dir, packageDir }) => ({ dir, packageDir }));
}

/** Where `name` is installed for the pack's package: its own node_modules, then the root's. */
function installed(root: string, packageDir: string, name: string): string | null {
  for (const base of [packageDir, root]) {
    const dir = path.join(base, 'node_modules', ...name.split('/'));
    if (existsSync(path.join(dir, 'package.json'))) return realpathSync(dir);
  }
  return null;
}

function vendor(
  root: string,
  [id, name, ...files]: readonly string[],
  options: { readonly into?: string } = {},
): number {
  if (!id || !name || files.length === 0) {
    process.stderr.write(USAGE);
    return 2;
  }
  if (!REGISTRY_ID_PATTERN.test(id)) {
    process.stderr.write(
      `${TAG} ${JSON.stringify(id)} isn't a pack id, such as editorial-serif.\n`,
    );
    return 2;
  }
  if (!NPM_NAME.test(name)) {
    process.stderr.write(
      `${TAG} ${JSON.stringify(name)} isn't an npm package name, such as @fontsource/inter.\n`,
    );
    return 2;
  }
  const found = packDirs(root, id);
  if (found.length !== 1) {
    process.stderr.write(
      `${TAG} ${found.length === 0 ? `No typography pack is named ${id}.` : `${found.length} typography packs are named ${id}: ${found.map(({ dir }) => relative(root, dir)).join(', ')}.`}\n`,
    );
    return 1;
  }
  const [{ dir, packageDir }] = found as [{ dir: string; packageDir: string }];
  const source = installed(root, packageDir, name);
  if (!source) {
    process.stderr.write(
      `${TAG} ${name} isn't in node_modules. This never fetches: the lead adds the font package at an exact version first.\n`,
    );
    return 1;
  }
  try {
    const result = vendorFonts({
      packDir: dir,
      packageDir: source,
      files: files.filter((file) => !file.endsWith('?')),
      optional: files.filter((file) => file.endsWith('?')).map((file) => file.slice(0, -1)),
      into: options.into,
      packageName: name,
    });
    process.stdout.write(
      `${TAG} Vendored ${result.copied.length} file(s) from ${result.packageName}@${result.version} (${result.license}) into ${relative(root, dir)}:\n`,
    );
    for (const { entry, hint } of result.copied) {
      process.stdout.write(
        `${TAG}   ${entry.file} sha256 ${entry.sha256}${hint ? ` ${JSON.stringify(hint)}` : ''}\n`,
      );
    }
    for (const { file, bytes } of result.dropped) {
      process.stdout.write(
        `${TAG}   dropped by the fit rule: ${file}, ${bytes} B, which would take the pack's Latin faces past ${FONT_FIT_BYTES} B (recorded in fonts.provenance.json).\n`,
      );
    }
    process.stdout.write(
      `${TAG} The pack's fonts come to ${result.total} B: ${result.latin} B of faces a Latin page loads, which the fit rule and the pack gate count, and ${result.other} B of others, reported.\n`,
    );
    if (result.overCap) {
      process.stderr.write(
        `${TAG} Its required Latin faces alone come to more than ${FONT_FIT_BYTES} B, so pnpm check:appearance will fail the pack: vendor fewer of them, or mark some optional with a trailing "?".\n`,
      );
    }
    process.stdout.write(
      `${TAG} Add each to manifest.json's fontAssets and its cost, then run pnpm check:appearance.\n`,
    );
    return 0;
  } catch (error) {
    if (!(error instanceof VendorError)) throw error;
    process.stderr.write(`${TAG} ${error.message} Nothing was written.\n`);
    return 1;
  }
}

function verify(root: string): number {
  const report = fontProvenanceReport(root);
  let problems = 0;
  for (const pack of report) {
    for (const problem of pack.problems) {
      problems += 1;
      process.stderr.write(
        `${TAG} ${pack.dir}/${problem.file}: ${problem.message} ${problem.remedy}\n`,
      );
    }
    if (pack.problems.length === 0) {
      process.stdout.write(`${TAG} ${pack.dir}: ${pack.fonts} font file(s), each as vendored.\n`);
    }
  }
  if (problems > 0) {
    process.stderr.write(`${TAG} ${problems} problem(s).\n`);
    return 1;
  }
  process.stdout.write(
    `${TAG} ${report.reduce((sum, pack) => sum + pack.fonts, 0)} font file(s) in ${report.length} typography pack(s) match their provenance records.\n`,
  );
  return 0;
}

function main(argv: readonly string[]): number {
  const args = [...argv];
  let root = REPO_ROOT;
  const at = args.indexOf('--root');
  if (at !== -1) {
    const value = args[at + 1];
    if (!value) {
      process.stderr.write(USAGE);
      return 2;
    }
    root = path.resolve(value);
    args.splice(at, 2);
  }
  let into: string | undefined;
  const intoAt = args.indexOf('--into');
  if (intoAt !== -1) {
    into = args[intoAt + 1];
    if (!into) {
      process.stderr.write(USAGE);
      return 2;
    }
    args.splice(intoAt, 2);
  }
  const [command, ...rest] = args;
  if (command === 'vendor') return vendor(root, rest, into === undefined ? {} : { into });
  if (command === 'verify' && rest.length === 0) return verify(root);
  process.stderr.write(USAGE);
  return 2;
}

process.exitCode = main(process.argv.slice(2));
