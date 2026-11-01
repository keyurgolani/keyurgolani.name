// Where each font a typography pack ships came from. A pack that ships a
// WOFF2 file holds fonts.provenance.json beside its manifest, one entry per
// file: its path in the pack, its SHA-256, the npm package, version, and
// path inside it the file was copied from, and its license, by SPDX id and
// the license file the pack ships beside it. `pnpm check:appearance` and
// `pnpm catalog:fonts verify` hold every pack to it: each WOFF2 listed,
// each listed one there with the bytes its digest names, and each license
// file present, so an image build never needs the registry to trust a font.
//
// vendorFonts() is how files get there: `pnpm catalog:fonts vendor` copies
// named WOFF2 files and the package's license from a package already in
// node_modules, which the lockfile pinned with its integrity, and writes
// their entries. Nothing here fetches.

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { UPSTREAM_LICENSES } from '../manifests';
import { packPackages } from './catalog';
import { meetsRange } from './compile';
import { BASIC_LATIN, readFontMetrics } from './font-metrics';

export const FONT_PROVENANCE_FILE = 'fonts.provenance.json';
export const FONT_PROVENANCE_VERSION = 1;

/** Where a vendored file came from: an npm package, or, in a fixture package alone, `fixture`. */
export type FontSource =
  { readonly package: string; readonly version: string; readonly path: string } | 'fixture';

export interface FontProvenanceEntry {
  /** Its path in the pack's directory, with `/` separators and no leading `./`. */
  readonly file: string;
  /** The hex SHA-256 of its bytes. */
  readonly sha256: string;
  readonly source: FontSource;
  /** Its license, by SPDX id, and the license file the pack ships beside it. */
  readonly license: { readonly spdx: string; readonly file: string };
  /** Whether its declared range meets printable Basic Latin, so a Latin page loads it: what the fit rule counts. */
  readonly latin?: boolean;
  /** Vendored as optional: the fit rule keeps it while the pack's Latin faces stay within the cap. */
  readonly optional?: boolean;
}

/** An optional file the fit rule left out, and why: its bytes would take the Latin faces past the cap. */
export interface DroppedFont {
  readonly package: string;
  readonly version: string;
  readonly path: string;
  readonly bytes: number;
}

export interface FontProvenance {
  readonly version: typeof FONT_PROVENANCE_VERSION;
  readonly fonts: readonly FontProvenanceEntry[];
  /** The optional files the fit rule left out, by package and path. */
  readonly dropped?: readonly DroppedFont[];
}

/** Why a pack's fonts don't match their provenance. */
export interface ProvenanceProblem {
  /** The file it's about, relative to the pack's directory. */
  readonly file: string;
  readonly message: string;
  readonly remedy: string;
}

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const posix = (file: string) => file.split(path.sep).join('/');
const SHA256 = /^[0-9a-f]{64}$/;
const RELATIVE = /^(?:[A-Za-z0-9][A-Za-z0-9._-]*\/)*[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** Every .woff2 file under `dir`, relative to it with `/` separators, sorted. */
export function woff2Files(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => !entry.isDirectory() && /\.woff2$/i.test(entry.name))
    .map((entry) => posix(path.relative(dir, path.join(entry.parentPath, entry.name))))
    .sort();
}

/** `value` as a provenance record, or the first reason it isn't one. */
function parseProvenance(value: unknown): FontProvenance | string {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return "it isn't one JSON object.";
  const record = value as Record<string, unknown>;
  if (record.version !== FONT_PROVENANCE_VERSION) {
    return `its version is ${JSON.stringify(record.version)}, and this reads version ${FONT_PROVENANCE_VERSION}.`;
  }
  if (!Array.isArray(record.fonts)) return 'it has no fonts list.';
  for (const [index, entry] of record.fonts.entries()) {
    const at = `fonts[${index}]`;
    if (!entry || typeof entry !== 'object') return `${at} isn't an object.`;
    const { file, sha256: digest, source, license } = entry as Record<string, unknown>;
    if (typeof file !== 'string' || !RELATIVE.test(file)) {
      return `${at}.file must be a path inside the pack, such as inter-latin-400-normal.woff2.`;
    }
    if (typeof digest !== 'string' || !SHA256.test(digest)) {
      return `${at}.sha256 must be 64 lowercase hex digits.`;
    }
    if (source !== 'fixture') {
      const fields = source as Record<string, unknown> | null;
      if (
        !fields ||
        typeof fields !== 'object' ||
        typeof fields.package !== 'string' ||
        typeof fields.version !== 'string' ||
        typeof fields.path !== 'string' ||
        !fields.package ||
        !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(fields.version) ||
        !fields.path
      ) {
        return `${at}.source must name the package, its exact version, and the path inside it, or be "fixture".`;
      }
    }
    const terms = license as Record<string, unknown> | null;
    if (
      !terms ||
      typeof terms !== 'object' ||
      typeof terms.spdx !== 'string' ||
      typeof terms.file !== 'string' ||
      !RELATIVE.test(terms.file)
    ) {
      return `${at}.license must give its SPDX id and the license file in the pack.`;
    }
    const { latin, optional } = entry as Record<string, unknown>;
    if (latin !== undefined && typeof latin !== 'boolean')
      return `${at}.latin must be true or false.`;
    if (optional !== undefined && optional !== true)
      return `${at}.optional must be true when given.`;
  }
  if (record.dropped !== undefined) {
    if (!Array.isArray(record.dropped)) return 'its dropped list must be a list.';
    for (const [index, entry] of record.dropped.entries()) {
      const fields = entry as Record<string, unknown> | null;
      if (
        !fields ||
        typeof fields.package !== 'string' ||
        typeof fields.version !== 'string' ||
        typeof fields.path !== 'string' ||
        typeof fields.bytes !== 'number'
      ) {
        return `dropped[${index}] must give the package, version, path, and bytes of a file the fit rule left out.`;
      }
    }
  }
  return record as unknown as FontProvenance;
}

/** The pack's provenance record, null when it has none, or why it can't be read. */
export function readFontProvenance(dir: string): FontProvenance | null | { problem: string } {
  const file = path.join(dir, FONT_PROVENANCE_FILE);
  if (!fs.existsSync(file)) return null;
  let value: unknown;
  try {
    value = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    return { problem: `it isn't JSON (${(error as Error).message}).` };
  }
  const parsed = parseProvenance(value);
  return typeof parsed === 'string' ? { problem: parsed } : parsed;
}

/** A path inside `dir`, or null when `file` resolves outside it. */
function inside(dir: string, file: string): string | null {
  const root = path.resolve(dir);
  const target = path.resolve(root, file);
  return target.startsWith(`${root}${path.sep}`) ? target : null;
}

const VENDOR = 'Vendor it with pnpm catalog:fonts vendor <pack> <package> <files...>';

/**
 * Every way the fonts in the pack directory `dir` don't match its
 * provenance record: a WOFF2 it doesn't list, a listed file that isn't
 * there or whose bytes aren't the ones its digest names, a license file
 * the pack doesn't have or a license no pack ships under, `fixture` as a
 * source outside a fixture package, and a manifest copyright line no
 * license file holds (copyrightProblems()). A pack with no fonts and no
 * record has none.
 */
export function fontProvenanceProblems(
  dir: string,
  options: { readonly fixture?: boolean } = {},
): ProvenanceProblem[] {
  const shipped = woff2Files(dir);
  const read = readFontProvenance(dir);
  if (read === null) {
    return shipped.length === 0
      ? []
      : [
          {
            file: FONT_PROVENANCE_FILE,
            message: `the pack ships ${shipped.length} WOFF2 file(s), ${shipped.join(', ')}, and no ${FONT_PROVENANCE_FILE} says where they came from.`,
            remedy: `${VENDOR}, which writes it, or write each file's entry by hand.`,
          },
        ];
  }
  if ('problem' in read) {
    return [
      {
        file: FONT_PROVENANCE_FILE,
        message: `${FONT_PROVENANCE_FILE} can't be read: ${read.problem}`,
        remedy: `Fix it to the shape docs/appearance.md's "Shipping fonts" gives, or ${VENDOR.toLowerCase()}.`,
      },
    ];
  }
  const problems: ProvenanceProblem[] = [];
  const listed = new Map<string, FontProvenanceEntry>();
  for (const entry of read.fonts) {
    if (listed.has(entry.file)) {
      problems.push({
        file: FONT_PROVENANCE_FILE,
        message: `${FONT_PROVENANCE_FILE} lists ${entry.file} twice.`,
        remedy: 'Keep one entry per file.',
      });
    }
    listed.set(entry.file, entry);
  }
  for (const file of shipped) {
    if (!listed.has(file)) {
      problems.push({
        file,
        message: `${file} is a font the pack ships, and ${FONT_PROVENANCE_FILE} doesn't list it.`,
        remedy: `${VENDOR}, or remove the file.`,
      });
    }
  }
  for (const entry of listed.values()) {
    const target = inside(dir, entry.file);
    const bytes =
      target && fs.existsSync(target) && fs.statSync(target).isFile()
        ? fs.readFileSync(target)
        : null;
    if (!bytes) {
      problems.push({
        file: entry.file,
        message: `${FONT_PROVENANCE_FILE} lists ${entry.file}, which the pack doesn't have.`,
        remedy: `Vendor the file again, or remove its entry.`,
      });
    } else if (sha256(bytes) !== entry.sha256) {
      problems.push({
        file: entry.file,
        message: `${entry.file}'s SHA-256 is ${sha256(bytes)}, and ${FONT_PROVENANCE_FILE} records ${entry.sha256}: it isn't the file that was vendored.`,
        remedy: `Vendor it again from ${typeof entry.source === 'string' ? 'its source' : `${entry.source.package}@${entry.source.version}`}; never edit a vendored font.`,
      });
    }
    const license = inside(dir, entry.license.file);
    if (!license || !fs.existsSync(license) || !fs.statSync(license).isFile()) {
      problems.push({
        file: entry.license.file,
        message: `${entry.file}'s license file, ${entry.license.file}, isn't in the pack.`,
        remedy: "Copy the package's license file into the pack beside the font; vendoring does.",
      });
    }
    if (!(UPSTREAM_LICENSES as readonly string[]).includes(entry.license.spdx)) {
      problems.push({
        file: entry.file,
        message: `${entry.file}'s license is ${entry.license.spdx}, and a pack ships fonts under ${UPSTREAM_LICENSES.join(', ')} alone.`,
        remedy: 'Ship a font under one of those licenses.',
      });
    }
    if (entry.source === 'fixture' && !options.fixture) {
      problems.push({
        file: entry.file,
        message: `${entry.file}'s source is "fixture", which only a fixture package's pack may say.`,
        remedy: 'Name the npm package, version, and path it came from.',
      });
    }
  }
  return [...problems, ...copyrightProblems(dir, read)];
}

/** One pack's provenance check, as the report lists it. */
export interface PackProvenance {
  readonly pack: string;
  readonly packageName: string;
  /** The pack's directory, relative to the repository root. */
  readonly dir: string;
  readonly fonts: number;
  readonly problems: readonly ProvenanceProblem[];
}

/**
 * Every typography pack under `root`'s packages that ships a font or has a
 * provenance record, fixture packages included, with its problems.
 */
export function fontProvenanceReport(root: string): PackProvenance[] {
  const report: PackProvenance[] = [];
  for (const pkg of packPackages(root)) {
    if (pkg.kind !== 'typography' || !pkg.packs) continue;
    const packsDir = path.join(root, pkg.packs);
    if (!fs.existsSync(packsDir)) continue;
    for (const pack of fs.readdirSync(packsDir, { withFileTypes: true })) {
      if (!pack.isDirectory()) continue;
      const dir = path.join(packsDir, pack.name);
      const fonts = woff2Files(dir).length;
      if (fonts === 0 && !fs.existsSync(path.join(dir, FONT_PROVENANCE_FILE))) continue;
      report.push({
        pack: pack.name,
        packageName: pkg.name,
        dir: posix(path.relative(root, dir)),
        fonts,
        problems: fontProvenanceProblems(dir, { fixture: pkg.fixture }),
      });
    }
  }
  return report;
}

/** The license files a package may ship, in the order vendoring looks for them. */
export const LICENSE_FILES = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'OFL.txt', 'OFL-1.1.txt'];

/** The name a package's license file takes in a pack: LICENSE-fontsource-inter.txt for @fontsource/inter. */
export const vendoredLicenseName = (packageName: string) =>
  `LICENSE-${packageName.replace(/^@/, '').replace(/[^A-Za-z0-9._-]+/g, '-')}.txt`;

/** What a package's own stylesheets say of one of its files: the @font-face values a manifest's fontAssets entry takes. */
export interface FaceHint {
  readonly family: string | null;
  readonly weight: string | null;
  readonly style: string | null;
  readonly unicodeRange: string | null;
}

/**
 * The manifest's copyright lines, "; "-joined in `provenance.copyright`, that
 * no license file the pack's fonts name holds verbatim (whitespace aside):
 * each shipped family's line comes from its package's own LICENSE.
 */
export function copyrightProblems(dir: string, record: FontProvenance): ProvenanceProblem[] {
  if (record.fonts.length === 0) return [];
  let copyright: unknown;
  try {
    copyright = (
      JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')) as {
        provenance?: { copyright?: unknown };
      }
    ).provenance?.copyright;
  } catch {
    return [];
  }
  const remedy =
    'Copy each family\'s copyright line verbatim from its package\'s LICENSE, and join them with "; ".';
  if (typeof copyright !== 'string' || copyright.trim() === '') {
    return [
      {
        file: 'manifest.json',
        message: `it ships ${record.fonts.length} font file(s) and its provenance.copyright gives no copyright line.`,
        remedy,
      },
    ];
  }
  const flat = (text: string) => text.replace(/\s+/g, ' ').trim();
  const names = [...new Set(record.fonts.map((entry) => entry.license.file))].sort();
  const files = names.map((file) => inside(dir, file));
  // A license file that isn't there is a problem of its own already.
  if (files.some((file) => !file || !fs.existsSync(file))) return [];
  const raw = files.map((file) => fs.readFileSync(file!, 'utf8'));
  const texts = raw.map(flat);
  const lines = copyright.split('; ').map(flat);
  const problems: ProvenanceProblem[] = lines
    .filter((line) => line !== '' && !texts.some((text) => text.includes(line)))
    .map((line) => ({
      file: 'manifest.json',
      message: `its provenance.copyright gives "${line}", which none of its fonts' license files says.`,
      remedy,
    }));
  // And every family is cited: each license file's own first copyright line is one of the manifest's.
  raw.forEach((text, index) => {
    // Its first line that starts "Copyright" and names a year (not the OFL's "Copyright
    // Holder" prose), up to a "<file>.ttf:" that repeats it per file, as Fontsource's do.
    const own =
      /^[ \t]*(Copyright\b(?=[^\n]*\d{4})[^\n]*?)[ \t]*(?:\S+\.(?:ttf|otf)[ \t]*:|$)/im.exec(
        text,
      )?.[1];
    if (!own) return;
    const line = flat(own);
    if (!lines.some((given) => given.includes(line))) {
      problems.push({
        file: 'manifest.json',
        message: `its provenance.copyright doesn't cite ${names[index]}'s line, "${line}".`,
        remedy,
      });
    }
  });
  return problems;
}

/** The @font-face block in the package's top-level stylesheets whose src names `file`, if one does. */
export function faceHint(packageDir: string, file: string): FaceHint | null {
  const base = path.basename(file);
  // The package's top-level stylesheets, as Fontsource ships them, then its css/ directory's, as IBM's.
  const sheets = ['', 'css'].flatMap((dir) => {
    try {
      return fs
        .readdirSync(path.join(packageDir, dir))
        .filter((name) => name.endsWith('.css'))
        .sort()
        .map((name) => path.join(dir, name));
    } catch {
      return [];
    }
  });
  for (const sheet of sheets) {
    const css = fs.readFileSync(path.join(packageDir, sheet), 'utf8');
    for (const [, block] of css.matchAll(/@font-face\s*\{([^}]*)\}/g)) {
      if (!block!.includes(base)) continue;
      const value = (property: string) =>
        new RegExp(`(?:^|[;\\s])${property}\\s*:\\s*([^;]+)`).exec(block!)?.[1]?.trim() ?? null;
      return {
        family: value('font-family')?.replace(/^['"]|['"]$/g, '') ?? null,
        weight: value('font-weight'),
        style: value('font-style'),
        unicodeRange: value('unicode-range'),
      };
    }
  }
  return null;
}

export interface VendorOptions {
  /** The pack's directory, packs/<id> in its package. */
  readonly packDir: string;
  /** The installed package's directory in node_modules. */
  readonly packageDir: string;
  /** The WOFF2 files to copy, as paths inside the package, such as files/inter-latin-400-normal.woff2. */
  readonly files: readonly string[];
  /**
   * Files the fit rule adds only while the pack's Latin faces, those whose
   * range meets printable Basic Latin, stay within `cap`. One whose range
   * doesn't meet it, such as a latin-ext subset, costs a Latin page nothing
   * (review R4) and is always added.
   */
  readonly optional?: readonly string[];
  /** The fit rule's cap, in bytes of the Latin faces the pack ships: 102,400 by default. */
  readonly cap?: number;
  /** A directory inside the pack the files and the license go into, such as fonts; the pack's own by default. */
  readonly into?: string;
  /** The package name asked for: the installed package.json must give the same one. */
  readonly packageName?: string;
}

/** The fit rule's cap (packs-plan §3.2, under review R4): a pack's Latin faces, at the typography font ceiling. */
export const FONT_FIT_BYTES = 102_400;

export interface VendorResult {
  readonly packageName: string;
  readonly version: string;
  readonly license: string;
  /** Each file as the pack now has it, with what the package's stylesheets say of it. */
  readonly copied: readonly {
    readonly entry: FontProvenanceEntry;
    readonly hint: FaceHint | null;
  }[];
  /** The optional files the fit rule left out this time, with their bytes. */
  readonly dropped: readonly { readonly file: string; readonly bytes: number }[];
  /** The bytes of every font the pack ships now. */
  readonly total: number;
  /** The bytes of its Latin faces, what the fit rule and the pack gate count. */
  readonly latin: number;
  /** Its other faces' bytes, reported: a Latin page never loads them. */
  readonly other: number;
  /** True when the required Latin faces alone are over the cap, which the pack gate will fail. */
  readonly overCap: boolean;
}

/** Why vendoring refused, before it wrote anything. */
export class VendorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VendorError';
  }
}

/**
 * Copies `files` and the package's license from an installed package into
 * the pack, and writes their entries into its fonts.provenance.json, in
 * place of any the files had, keeping the rest. It reads only the disk:
 * the package is the one node_modules already has. It checks everything
 * before it writes anything, and throws a VendorError naming the problem.
 */
export function vendorFonts({
  packDir,
  packageDir,
  files,
  optional = [],
  cap = FONT_FIT_BYTES,
  into = '',
  packageName,
}: VendorOptions): VendorResult {
  if (files.length === 0 && optional.length === 0) {
    throw new VendorError('Name at least one WOFF2 file to vendor.');
  }
  if (!fs.existsSync(path.join(packDir, 'manifest.json'))) {
    throw new VendorError(`${packDir} has no manifest.json, so it isn't a pack.`);
  }
  let pkg: { name?: unknown; version?: unknown; license?: unknown };
  try {
    pkg = JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8'));
  } catch {
    throw new VendorError(
      `${packageDir} has no readable package.json: install the package first (the lead adds font packages).`,
    );
  }
  const { name, version, license } = pkg;
  if (typeof name !== 'string' || typeof version !== 'string') {
    throw new VendorError(`${packageDir}/package.json gives no name and version.`);
  }
  if (packageName !== undefined && name !== packageName) {
    throw new VendorError(
      `${packageDir} is ${name}, not ${packageName}: the record would name the wrong package.`,
    );
  }
  if (typeof license !== 'string' || !(UPSTREAM_LICENSES as readonly string[]).includes(license)) {
    throw new VendorError(
      `${name}@${version} is licensed ${JSON.stringify(license)}, and a pack ships fonts under ${UPSTREAM_LICENSES.join(', ')} alone.`,
    );
  }
  const licenseSource = LICENSE_FILES.map((file) => path.join(packageDir, file)).find((file) =>
    fs.existsSync(file),
  );
  if (!licenseSource) {
    throw new VendorError(
      `${name}@${version} ships none of ${LICENSE_FILES.join(', ')}, so its license can't go with its fonts.`,
    );
  }
  const check = (file: string) => {
    const source = inside(packageDir, file);
    if (!source) throw new VendorError(`${file} resolves outside ${name}.`);
    if (!/\.woff2$/i.test(file)) throw new VendorError(`${file} isn't a .woff2 file.`);
    if (!fs.existsSync(source) || !fs.statSync(source).isFile()) {
      throw new VendorError(`${name}@${version} has no ${file}.`);
    }
    const bytes = fs.readFileSync(source);
    if (bytes.subarray(0, 4).toString('latin1') !== 'wOF2') {
      throw new VendorError(
        `${file} in ${name}@${version} isn't a WOFF2 font: its first bytes aren't wOF2.`,
      );
    }
    return { file: posix(path.normalize(file)), bytes };
  };
  const reads = files.map(check);
  if (into !== '' && !RELATIVE.test(into)) {
    throw new VendorError(`${into} isn't a directory inside the pack, such as fonts.`);
  }
  // A manifest names a pack's files in lowercase, so the copy takes the
  // source's file name lowercased, as IBMPlexMono-Medium-Latin1.woff2 becomes
  // ibmplexmono-medium-latin1.woff2. The bytes are never touched, and the
  // record keeps the path the file had in its package.
  const at = (file: string) => {
    const base = path.basename(file).toLowerCase();
    return into === '' ? base : `${into}/${base}`;
  };
  const optionalReads = optional.map(check);
  const targets = new Set<string>();
  for (const { file } of [...reads, ...optionalReads]) {
    const target = at(file);
    if (targets.has(target)) throw new VendorError(`Two of the files are named ${target}.`);
    targets.add(target);
  }
  const existing = readFontProvenance(packDir);
  if (existing && 'problem' in existing) {
    throw new VendorError(
      `${path.join(packDir, FONT_PROVENANCE_FILE)} can't be read: ${existing.problem}`,
    );
  }

  // Whether a face is one a Latin page loads: its declared range meets
  // printable Basic Latin. A new file's range is the one its package's
  // stylesheet gives it (what the manifest declares), else its cmap's; a file
  // the pack has already, its recorded flag, else its manifest entry's range.
  // One that can't be told counts as Latin, so the cap never undercounts.
  const latinRange = (range: string | null | undefined) =>
    range ? meetsRange(range, BASIC_LATIN[0], BASIC_LATIN[1]) : null;
  const newLatin = (file: string, bytes: Uint8Array) => {
    const fromHint = latinRange(faceHint(packageDir, file)?.unicodeRange);
    if (fromHint !== null) return fromHint;
    try {
      return readFontMetrics(bytes, file).basicLatin.length > 0;
    } catch {
      return true;
    }
  };
  let assets: { file?: unknown; unicodeRange?: unknown }[] = [];
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(packDir, 'manifest.json'), 'utf8')) as {
      fontAssets?: unknown;
    };
    if (Array.isArray(manifest.fontAssets)) assets = manifest.fontAssets;
  } catch {
    // An unreadable manifest is check:appearance's to report; here every face then counts.
  }
  const oldLatin = (entry: FontProvenanceEntry) =>
    entry.latin ??
    latinRange(
      assets.find((asset) => asset.file === `./${entry.file}` || asset.file === entry.file)
        ?.unicodeRange as string | undefined,
    ) ??
    true;

  // The fit rule (packs-plan §3.2, under review R4): every required file
  // ships, and so does every optional one that isn't Latin, since a Latin
  // page never loads it. The optional Latin ones are taken in one order,
  // by package and path, whatever order they were vendored in, each only
  // while the pack's Latin faces stay at or under the cap. One the pack had
  // already that no longer fits is refused, so the pack is always what
  // vendoring every file at once would make.
  const kept = (existing?.fonts ?? []).filter((entry) => !targets.has(entry.file));
  const sizeOf = (entry: FontProvenanceEntry) => {
    const file = inside(packDir, entry.file);
    return file && fs.existsSync(file) ? fs.statSync(file).size : 0;
  };
  const key = (pkg: string, file: string) => `${pkg}\u0000${file}`;
  const required = [
    ...kept
      .filter((entry) => !entry.optional)
      .map((entry) => ({ bytes: sizeOf(entry), latin: oldLatin(entry) })),
    ...reads.map(({ file, bytes }) => ({ bytes: bytes.length, latin: newLatin(file, bytes) })),
  ];
  let latin = required.reduce((sum, face) => sum + (face.latin ? face.bytes : 0), 0);
  const overCap = latin > cap;
  const candidates = [
    ...kept
      .filter((entry) => entry.optional)
      .map((entry) => ({
        entry,
        read: null,
        bytes: sizeOf(entry),
        latin: oldLatin(entry),
        order: key(
          typeof entry.source === 'string' ? entry.source : entry.source.package,
          typeof entry.source === 'string' ? entry.file : entry.source.path,
        ),
      })),
    ...optionalReads.map((read) => ({
      entry: null,
      read,
      bytes: read.bytes.length,
      latin: newLatin(read.file, read.bytes),
      order: key(name, read.file),
    })),
  ].sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0));
  const dropped: { file: string; bytes: number }[] = [];
  const optionalKept: (typeof optionalReads)[number][] = [];
  for (const candidate of candidates) {
    const fits = !candidate.latin || latin + candidate.bytes <= cap;
    if (fits && candidate.latin) latin += candidate.bytes;
    if (candidate.read) {
      if (fits) optionalKept.push(candidate.read);
      else dropped.push({ file: candidate.read.file, bytes: candidate.bytes });
    } else if (!fits) {
      throw new VendorError(
        `${candidate.entry!.file}, vendored as optional, no longer fits: with these files the pack's Latin faces would come to ${latin + candidate.bytes} B, over ${cap}. Move it out of the pack, then vendor again.`,
      );
    }
  }

  const licenseFile =
    into === '' ? vendoredLicenseName(name) : `${into}/${vendoredLicenseName(name)}`;
  if (into !== '') fs.mkdirSync(path.join(packDir, into), { recursive: true });
  fs.copyFileSync(licenseSource, path.join(packDir, licenseFile));
  const write = ({ file, bytes }: { file: string; bytes: Buffer }, isOptional: boolean) => {
    const target = at(file);
    fs.writeFileSync(path.join(packDir, target), bytes);
    const entry: FontProvenanceEntry = {
      file: target,
      sha256: sha256(bytes),
      source: { package: name, version, path: file },
      license: { spdx: license, file: licenseFile },
      latin: newLatin(file, bytes),
      ...(isOptional ? { optional: true as const } : {}),
    };
    return { entry, hint: faceHint(packageDir, file) };
  };
  const copied = [
    ...reads.map((read) => write(read, false)),
    ...optionalKept.map((read) => write(read, true)),
  ];
  const byFile = (a: { file: string }, b: { file: string }) =>
    a.file < b.file ? -1 : a.file > b.file ? 1 : 0;
  const fonts = [...kept, ...copied.map(({ entry }) => entry)].sort(byFile);
  // What it left out, by package and path: this time's, and earlier ones not vendored since.
  const vendored = new Set(
    fonts.flatMap((entry) =>
      typeof entry.source === 'string' ? [] : [key(entry.source.package, entry.source.path)],
    ),
  );
  const droppedNow = new Set(dropped.map(({ file }) => key(name, file)));
  const droppedAll: DroppedFont[] = [
    ...(existing?.dropped ?? []).filter(
      (entry) =>
        !vendored.has(key(entry.package, entry.path)) &&
        !droppedNow.has(key(entry.package, entry.path)),
    ),
    ...dropped.map(({ file, bytes }) => ({ package: name, version, path: file, bytes })),
  ].sort((a, b) => {
    const [x, y] = [key(a.package, a.path), key(b.package, b.path)];
    return x < y ? -1 : x > y ? 1 : 0;
  });
  const record: FontProvenance = {
    version: FONT_PROVENANCE_VERSION,
    fonts,
    ...(droppedAll.length > 0 ? { dropped: droppedAll } : {}),
  };
  fs.writeFileSync(
    path.join(packDir, FONT_PROVENANCE_FILE),
    `${JSON.stringify(record, null, 2)}\n`,
  );
  const sizes = fonts.map((entry) => ({
    bytes: sizeOf(entry),
    latin: entry.latin ?? oldLatin(entry),
  }));
  const total = sizes.reduce((sum, face) => sum + face.bytes, 0);
  const latinTotal = sizes.reduce((sum, face) => sum + (face.latin ? face.bytes : 0), 0);
  return {
    packageName: name,
    version,
    license,
    copied,
    dropped,
    total,
    latin: latinTotal,
    other: total - latinTotal,
    overCap,
  };
}
