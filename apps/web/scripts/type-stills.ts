// The type stills' build side (P-5, thumbnail-pipeline.md §3): which still
// each first-party self-hosted typography pack needs and which of its
// vendored woff2 files it's set from, the check that the committed stills
// still match those files and the record `pnpm stills:type` wrote, and the
// files registry generation serves under /_portfolio/studio/. A record that
// no longer matches fails closed: generation refuses to serve it, and
// type-stills.test.ts fails, so a font update can't leave a still behind.
// Nothing here removes a file.

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  servedStillName,
  servedStillUrl,
  stillFace,
  TYPE_STILL_ROLES,
  TYPE_STILL_TEXT,
  type TypeStillEntry,
  type TypeStillRecord,
  type TypeStillRole,
} from '../src/lib/studio/type-stills';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const HOST = path.resolve(HERE, '..');
export const REPO_ROOT = path.resolve(HOST, '..', '..');
/** The committed stills and their record. */
export const TYPE_STILLS_DIR = path.join(HOST, 'studio-stills', 'type');
export const TYPE_STILLS_RECORD = path.join(TYPE_STILLS_DIR, 'stills.json');
/** Where generation serves them, which git ignores, at /_portfolio/studio/. */
export const STUDIO_OUT = path.join(HOST, 'public', '_portfolio', 'studio');
/** The platform's typography packs, as the repository holds them. */
export const TYPOGRAPHY_PACKS_DIR = path.join(
  REPO_ROOT,
  'packages',
  'appearance-typography',
  'packs',
);

/** What a typography pack's manifest says that a still needs. */
export interface TypeManifest {
  readonly id: string;
  readonly name: string;
  readonly roles: Readonly<Record<string, Readonly<Record<string, unknown>> | undefined>>;
  readonly fontAssets?: readonly {
    readonly family: string;
    readonly file: string;
    readonly weight: number | readonly [number, number];
    readonly style: string;
    readonly unicodeRange?: string;
  }[];
}

/** A typography pack: its manifest, and the directory its files sit in. */
export interface TypePack {
  readonly manifest: TypeManifest;
  readonly dir: string;
}

/** What one still sets, and from which files: the shot's input. */
export interface TypeStillSpec {
  readonly pack: string;
  readonly name: string;
  readonly role: TypeStillRole;
  readonly text: string;
  readonly face: TypeStillEntry['face'];
  /** Each source file, absolute, with its repository path. */
  readonly sources: readonly { readonly path: string; readonly file: string }[];
}

/** Whether a pack ships its own fonts, so its row shows stills, not its stack. */
export const selfHosted = (manifest: Pick<TypeManifest, 'fontAssets'>): boolean =>
  (manifest.fontAssets?.length ?? 0) > 0;

/** The first family a stack names, unquoted. */
export function firstFamily(stack: string): string {
  return (stack.split(',')[0] ?? '').trim().replace(/^["']|["']$/g, '');
}

/** The [first, last] code point ranges a unicode-range descriptor names. */
function ranges(value: string): [number, number][] {
  return value
    .split(',')
    .map((part) => part.trim().replace(/^U\+/i, ''))
    .filter(Boolean)
    .map((part): [number, number] => {
      if (part.includes('?')) {
        return [
          Number.parseInt(part.replace(/\?/g, '0'), 16),
          Number.parseInt(part.replace(/\?/g, 'F'), 16),
        ];
      }
      const [first, last = first] = part.split('-');
      return [Number.parseInt(first!, 16), Number.parseInt(last!, 16)];
    });
}

const covers = (range: string | undefined, text: string) => {
  if (!range) return true;
  const spans = ranges(range);
  return [...text].every((char) => {
    const point = char.codePointAt(0)!;
    return spans.some(([first, last]) => point >= first && point <= last);
  });
};

const weighs = (weight: number | readonly [number, number], wanted: number) =>
  typeof weight === 'number' ? weight === wanted : wanted >= weight[0] && wanted <= weight[1];

const repoPath = (file: string) => path.relative(REPO_ROOT, file).split(path.sep).join('/');

/**
 * The stills a pack needs, one per role, each with the files of the face
 * the catalog's role map has it set (TYPE_STILL_FACES: display and body,
 * unless a pack's signature role differs) that hold the still's text: none
 * for a system-font pack. Throws when a self-hosted pack's role names a face
 * it ships no file of, or the role map names a role the pack doesn't have.
 */
export function stillSpecs(pack: TypePack): TypeStillSpec[] {
  const { manifest, dir } = pack;
  if (!selfHosted(manifest)) return [];
  return TYPE_STILL_ROLES.map((role) => {
    const face = stillFace(manifest.id, role);
    const values = manifest.roles[face];
    if (!values) {
      throw new Error(
        `the role map has ${manifest.id}'s ${role} still set its ${face} role, which its manifest doesn't have.`,
      );
    }
    const stack = typeof values['font-family'] === 'string' ? values['font-family'] : '';
    const family = firstFamily(stack);
    const weight = Number(values['font-weight'] ?? 400);
    const style = values['font-style'] === 'italic' ? 'italic' : 'normal';
    const tracking =
      typeof values['letter-spacing'] === 'string' ? values['letter-spacing'] : 'normal';
    const text = TYPE_STILL_TEXT[role];
    const candidates = (manifest.fontAssets ?? []).filter(
      (face) =>
        face.family === family && weighs(face.weight, weight) && covers(face.unicodeRange, text),
    );
    // The faces in the role's own style; or, as a browser matches a family that ships only
    // another style, such as Field Serif's "Fraunces Italic" (400 italic under its own name,
    // set upright by its roles), every face of that family.
    const styled = candidates.filter((face) => face.style === style);
    const faces = styled.length > 0 ? styled : candidates;
    if (faces.length === 0) {
      throw new Error(
        `${manifest.id}'s ${face} role sets ${family} ${weight} ${style}, and the pack ships no file of it that holds "${text}".`,
      );
    }
    return {
      pack: manifest.id,
      name: manifest.name,
      role,
      text,
      face: { role: face, family, weight, style, tracking },
      sources: faces.map((face) => {
        const absolute = path.resolve(dir, face.file);
        return { path: absolute, file: repoPath(absolute) };
      }),
    };
  });
}

/** The platform's typography packs, read from the repository, sorted by id. */
export function platformTypePacks(dir: string = TYPOGRAPHY_PACKS_DIR): TypePack[] {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const packDir = path.join(dir, entry.name);
      const manifest = JSON.parse(
        fs.readFileSync(path.join(packDir, 'manifest.json'), 'utf8'),
      ) as TypeManifest;
      return { manifest, dir: packDir };
    })
    .sort((a, b) => (a.manifest.id < b.manifest.id ? -1 : a.manifest.id > b.manifest.id ? 1 : 0));
}

export const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/** The committed record, or null when there's none. */
export function readRecord(file: string = TYPE_STILLS_RECORD): TypeStillRecord | null {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as TypeStillRecord;
  } catch {
    return null;
  }
}

/** The PNG signature and IHDR size of `bytes`, or null when it isn't a PNG. */
export function pngSize(bytes: Uint8Array): { width: number; height: number } | null {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 24 || signature.some((byte, at) => bytes[at] !== byte)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

/** A still generation serves: its name and URL under /_portfolio/studio/, and its bytes. */
export interface StudioFile {
  readonly name: string;
  readonly url: string;
  readonly sha256: string;
  readonly bytes: Uint8Array;
}

export interface TypeStillsCheck {
  readonly problems: readonly string[];
  readonly files: readonly StudioFile[];
  /** The record's reason when it lists no still yet, by the lead's ruling, else null. */
  readonly unshot: string | null;
}

/** How the check reads files: their bytes, null when missing, and a directory's names. */
export interface StillReader {
  readonly read: (file: string) => Uint8Array | null;
  readonly list: (dir: string) => readonly string[];
}

const DISK: StillReader = {
  read(file) {
    try {
      return new Uint8Array(fs.readFileSync(file));
    } catch {
      return null;
    }
  },
  list(dir) {
    try {
      return fs.readdirSync(dir);
    } catch {
      return [];
    }
  },
};

/**
 * Checks the committed stills against the packs and their files: every
 * self-hosted platform pack has both stills, no system-font pack has one,
 * each still's bytes are the record's, each was shot from the files its
 * role sets today, with their bytes unchanged, and nothing else is in the
 * directory. The files are what generation serves, when there's no problem.
 *
 * One other state passes: a record that lists no still and says why in
 * `unshot`, by the lead's ruling, with nothing else in the directory. It
 * serves nothing, and every self-hosted row then has no still. A record
 * with some stills and not others never passes.
 */
export function checkTypeStills({
  packs = platformTypePacks(),
  record = readRecord(),
  dir = TYPE_STILLS_DIR,
  reader = DISK,
}: {
  readonly packs?: readonly TypePack[];
  readonly record?: TypeStillRecord | null;
  readonly dir?: string;
  readonly reader?: StillReader;
} = {}): TypeStillsCheck {
  const problems: string[] = [];
  const rerun = 'run pnpm stills:type and commit what it writes';
  if (!record) {
    return { problems: [`no ${repoPath(TYPE_STILLS_RECORD)}: ${rerun}.`], files: [], unshot: null };
  }
  const recordName = path.basename(TYPE_STILLS_RECORD);
  if (record.unshot !== undefined) {
    if (typeof record.unshot !== 'string' || record.unshot.trim() === '') {
      problems.push('the record says it is unshot, and gives no reason.');
    }
    if (record.stills.length > 0) {
      problems.push(
        `the record says it is unshot and lists ${record.stills.length} still(s): ${rerun}.`,
      );
    }
    for (const name of reader.list(dir)) {
      if (name !== recordName) problems.push(`${name} is in ${repoPath(dir)} and in no record.`);
    }
    return { problems, files: [], unshot: problems.length > 0 ? null : record.unshot };
  }
  const wanted = new Map<string, TypeStillSpec>();
  for (const pack of packs) {
    try {
      for (const spec of stillSpecs(pack)) wanted.set(`${spec.pack}.${spec.role}`, spec);
    } catch (error) {
      problems.push((error as Error).message);
    }
  }
  const system = new Set(
    packs.filter(({ manifest }) => !selfHosted(manifest)).map(({ manifest }) => manifest.id),
  );
  const files: StudioFile[] = [];
  const listed = new Set<string>();
  for (const entry of record.stills) {
    const key = `${entry.pack}.${entry.role}`;
    listed.add(entry.file);
    if (system.has(entry.pack)) {
      problems.push(
        `${entry.pack} is a system-font pack, and gets no still: its row sets its own stack.`,
      );
      continue;
    }
    const spec = wanted.get(key);
    if (!spec) {
      problems.push(`the record lists ${key}, which no self-hosted platform pack needs.`);
      continue;
    }
    wanted.delete(key);
    if (entry.file !== `${entry.pack}.${entry.role}.png`) {
      problems.push(`${key}'s file is ${entry.file}, not ${entry.pack}.${entry.role}.png.`);
      continue;
    }
    const bytes = reader.read(path.join(dir, entry.file));
    if (!bytes) {
      problems.push(`${entry.file} is in the record and not on disk: ${rerun}.`);
      continue;
    }
    const size = pngSize(bytes);
    if (!size) {
      problems.push(`${entry.file} isn't a PNG.`);
      continue;
    }
    if (sha256(bytes) !== entry.sha256 || bytes.length !== entry.bytes) {
      problems.push(`${entry.file} isn't the file the record lists: ${rerun}.`);
      continue;
    }
    if (size.width !== entry.pixelWidth || size.height !== entry.pixelHeight) {
      problems.push(
        `${entry.file} is ${size.width}x${size.height}, and the record says ${entry.pixelWidth}x${entry.pixelHeight}.`,
      );
      continue;
    }
    if (entry.text !== spec.text || JSON.stringify(entry.face) !== JSON.stringify(spec.face)) {
      problems.push(
        `${key} sets a face or text its pack's ${entry.role} role no longer does: ${rerun}.`,
      );
      continue;
    }
    const shotFrom = entry.sources.map(({ file }) => file).sort();
    const setFrom = spec.sources.map(({ file }) => file).sort();
    if (JSON.stringify(shotFrom) !== JSON.stringify(setFrom)) {
      problems.push(
        `${key} was shot from ${shotFrom.join(', ')}, and its role sets ${setFrom.join(', ')} now: ${rerun}.`,
      );
      continue;
    }
    const changed = entry.sources.filter((source) => {
      const font = reader.read(path.join(REPO_ROOT, source.file));
      return !font || sha256(font) !== source.sha256;
    });
    if (changed.length > 0) {
      problems.push(
        `${key} was shot from ${changed.map(({ file }) => file).join(', ')}, which changed since: ${rerun}.`,
      );
      continue;
    }
    files.push({
      name: servedStillName(entry),
      url: servedStillUrl(entry),
      sha256: entry.sha256,
      bytes,
    });
  }
  // Two stills with the same bytes show two packs as one (lead A, P-5 slice 3): the role map
  // gives one of them its signature role instead.
  const bySha = new Map<string, string>();
  for (const file of files) {
    const twin = bySha.get(file.sha256);
    if (twin) {
      problems.push(
        `${twin} and ${file.name} are byte-identical: give one its pack's signature role in TYPE_STILL_FACES, then ${rerun}.`,
      );
    } else {
      bySha.set(file.sha256, file.name);
    }
  }
  for (const key of wanted.keys()) problems.push(`${key} has no still: ${rerun}.`);
  for (const name of reader.list(dir)) {
    if (name !== recordName && !listed.has(name)) {
      problems.push(`${name} is in ${repoPath(dir)} and in no record.`);
    }
  }
  return {
    problems,
    files: problems.length > 0 ? [] : files.sort((a, b) => (a.name < b.name ? -1 : 1)),
    unshot: null,
  };
}

/** A served still's name: its pack, its role, and the first 12 hex of its SHA-256. */
const STUDIO_NAME = /^[a-z0-9-]+-(?:aa|line)\.[0-9a-f]{12}\.png$/;

/** A file staged on its way into place: its name, then the pid that staged it. */
const STAGED = /^(.*)\.(\d+)\.tmp$/;

/** Whether the process with this pid is gone, so a file it staged is a leftover. */
function gone(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid < 1) return true;
  if (pid === process.pid) return false;
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    // EPERM: it runs, as another user.
    return (error as NodeJS.ErrnoException).code !== 'EPERM';
  }
}

/**
 * Writes the stills into `dir` under their served names, each through a
 * file in `staging` renamed into place, leaving a file that's already
 * there with the same bytes, and removes a still an earlier build served
 * that this one doesn't, as the registry's other served directories do
 * (packages/variant-contract's writeServedFiles): once the stills are shot
 * again, an earlier one is no generated list's, so the build's every file
 * there is one it serves (the profile matrix's #7). A name that isn't a
 * still's is refused, and nothing is written.
 */
export function writeStudioFiles(
  files: readonly StudioFile[],
  { dir = STUDIO_OUT, staging }: { readonly dir?: string; readonly staging: string },
): { written: string[]; unchanged: string[]; removed: string[] } {
  const misnamed = files.find(({ name }) => !STUDIO_NAME.test(name));
  if (misnamed) throw new Error(`${misnamed.name} isn't a type still's served name.`);
  if (path.resolve(staging) === path.resolve(dir)) {
    throw new Error(`${dir} can't be its own staging directory.`);
  }
  fs.mkdirSync(dir, { recursive: true });
  const names = new Set(files.map(({ name }) => name));
  const others = fs.readdirSync(dir).filter((name) => !names.has(name));
  const foreign = others.filter((name) => !STUDIO_NAME.test(name));
  if (foreign.length > 0) {
    throw new Error(
      `${dir} holds ${foreign.join(', ')}, which no build writes, so nothing was written there.`,
    );
  }
  fs.mkdirSync(staging, { recursive: true });
  // A still an earlier build staged and never renamed, its process gone, is a leftover.
  for (const name of fs.readdirSync(staging)) {
    const match = STAGED.exec(name);
    if (match && STUDIO_NAME.test(match[1]!) && gone(Number(match[2]))) {
      fs.rmSync(path.join(staging, name), { force: true });
    }
  }
  const written: string[] = [];
  const unchanged: string[] = [];
  for (const file of files) {
    const target = path.join(dir, file.name);
    let current: Buffer | undefined;
    try {
      current = fs.readFileSync(target);
    } catch {
      current = undefined;
    }
    if (current && Buffer.compare(current, Buffer.from(file.bytes)) === 0) {
      unchanged.push(file.name);
      continue;
    }
    const temporary = path.join(staging, `${file.name}.${process.pid}.tmp`);
    fs.writeFileSync(temporary, file.bytes);
    fs.renameSync(temporary, target);
    written.push(file.name);
  }
  const removed: string[] = [];
  for (const name of others) {
    fs.rmSync(path.join(dir, name), { force: true });
    removed.push(name);
  }
  return { written, unchanged, removed };
}
