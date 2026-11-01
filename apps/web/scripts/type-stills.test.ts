import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { servedStillName as budgetsName } from '../../../ci/check-budgets.mjs';
import {
  servedStillName,
  stillFace,
  TYPE_STILL_DPR,
  TYPE_STILL_FACES,
  TYPE_STILL_GEOMETRY,
  TYPE_STILL_TEXT,
  type TypeStillEntry,
  type TypeStillRecord,
} from '../src/lib/studio/type-stills';
import {
  checkTypeStills,
  platformTypePacks,
  pngSize,
  readRecord,
  REPO_ROOT,
  selfHosted,
  sha256,
  stillSpecs,
  TYPE_STILLS_DIR,
  writeStudioFiles,
  type StillReader,
  type StudioFile,
  type TypePack,
} from './type-stills';

// The typography picker's stills (P-5): each self-hosted platform pack's
// two, shot from its own vendored woff2 files, held to those files, to the
// record, and to Studio's image line in runtime-budgets.json. A record and
// its stills are built in memory here, from the packs' real fonts, so the
// check is proven both ways whether or not the committed stills are shot.

const packs = platformTypePacks();
const committed = readRecord();
const studio = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'runtime-budgets.json'), 'utf8'))
  .budgets.studio as { image: number; imagePerFile: number };

/** A PNG's signature and IHDR, `width` x `height`, then `seed` so each one's bytes differ. */
function png(width: number, height: number, seed: string): Uint8Array {
  const bytes = new Uint8Array(33 + seed.length);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  bytes.set(new TextEncoder().encode(seed), 33);
  return bytes;
}

/** A shot record for every pack the platform self-hosts, its stills held in `files`, its fonts real. */
function shotRecord(): { record: TypeStillRecord; files: Map<string, Uint8Array> } {
  const files = new Map<string, Uint8Array>();
  const stills: TypeStillEntry[] = packs.flatMap((pack) =>
    stillSpecs(pack).map((spec) => {
      const width = 40 + spec.text.length * 6;
      const height = TYPE_STILL_GEOMETRY[spec.role].linePx;
      const file = `${spec.pack}.${spec.role}.png`;
      const bytes = png(width * TYPE_STILL_DPR, height * TYPE_STILL_DPR, file);
      files.set(path.join(TYPE_STILLS_DIR, file), bytes);
      return {
        pack: spec.pack,
        role: spec.role,
        file,
        text: spec.text,
        width,
        height,
        pixelWidth: width * TYPE_STILL_DPR,
        pixelHeight: height * TYPE_STILL_DPR,
        bytes: bytes.length,
        sha256: sha256(bytes),
        face: spec.face,
        sources: spec.sources.map((source) => ({
          file: source.file,
          sha256: sha256(fs.readFileSync(source.path)),
        })),
      };
    }),
  );
  return { record: { version: 1, generator: 'test', dpr: TYPE_STILL_DPR, stills }, files };
}

/** Reads the stills from `files` and the fonts from disk; the directory holds `listed`. */
function reader(files: Map<string, Uint8Array>, listed?: readonly string[]): StillReader {
  return {
    read: (file) =>
      files.get(file) ?? (file.startsWith(TYPE_STILLS_DIR) ? null : fs.readFileSync(file)),
    list: () => listed ?? ['stills.json', ...[...files.keys()].map((file) => path.basename(file))],
  };
}

test('a full record of the self-hosted packs passes, and serves each still at its hashed name', () => {
  const { record, files } = shotRecord();
  const hosted = packs.filter(({ manifest }) => selfHosted(manifest));
  // The eight of slice 1, and technical-sans-mono on IBM Plex Mono (Mono (b)).
  assert.equal(hosted.length, 9);
  const checked = checkTypeStills({ record, reader: reader(files) });
  assert.deepEqual(checked.problems, []);
  assert.equal(checked.unshot, null);
  assert.equal(checked.files.length, 18);
  for (const file of checked.files) {
    assert.match(file.url, /^\/_portfolio\/studio\/[a-z0-9-]+-(?:aa|line)\.[0-9a-f]{12}\.png$/);
    assert.equal(file.url, `/_portfolio/studio/${file.name}`);
  }
});

test('the committed record is either every still, matching its fonts and inside Studio’s line, or none with the reason', () => {
  assert.ok(committed, 'apps/web/studio-stills/type/stills.json is committed');
  const checked = checkTypeStills();
  assert.deepEqual(checked.problems, []);
  if (committed.unshot !== undefined) {
    // Not shot yet, by the lead's ruling: nothing listed, nothing served, nothing else in the directory.
    assert.ok(checked.unshot && checked.unshot.length > 0);
    assert.deepEqual(committed.stills, []);
    assert.deepEqual(checked.files, []);
    return;
  }
  assert.equal(checked.files.length, 18);
  for (const file of checked.files) {
    assert.ok(
      file.bytes.length <= studio.imagePerFile,
      `${file.name} is ${file.bytes.length} B, over the ${studio.imagePerFile} B a still may be`,
    );
  }
  const total = checked.files.reduce((sum, file) => sum + file.bytes.length, 0);
  assert.ok(total <= studio.image, `the stills are ${total} B, over Studio's ${studio.image} B`);
});

test('an unshot record passes only empty, with a reason, and alone in its directory', () => {
  const { record, files } = shotRecord();
  const unshot = { ...record, stills: [], unshot: 'waits on LANG-5b' };
  const alone = checkTypeStills({ record: unshot, reader: reader(new Map(), ['stills.json']) });
  assert.deepEqual(alone.problems, []);
  assert.equal(alone.unshot, 'waits on LANG-5b');
  assert.match(
    checkTypeStills({
      record: { ...unshot, unshot: ' ' },
      reader: reader(new Map(), []),
    }).problems.join('\n'),
    /gives no reason/,
  );
  assert.match(
    checkTypeStills({ record: { ...record, unshot: 'x' }, reader: reader(files) }).problems.join(
      '\n',
    ),
    /says it is unshot and lists 18 still/,
  );
  assert.match(
    checkTypeStills({
      record: unshot,
      reader: reader(new Map(), ['stills.json', 'old.aa.png']),
    }).problems.join('\n'),
    /old\.aa\.png is in .* and in no record/,
  );
});

test('no system-font pack needs or may have a still', () => {
  const system = packs.filter(({ manifest }) => !selfHosted(manifest));
  assert.equal(system.length, 6);
  for (const pack of system) assert.deepEqual(stillSpecs(pack), [], pack.manifest.id);
  const { record, files } = shotRecord();
  const [still] = record.stills;
  const listed = {
    ...record,
    stills: [...record.stills, { ...still!, pack: system[0]!.manifest.id }],
  };
  assert.match(
    checkTypeStills({ record: listed, reader: reader(files) }).problems.join('\n'),
    new RegExp(`${system[0]!.manifest.id} is a system-font pack, and gets no still`),
  );
});

test('a still fails once a font it was shot from changes, or its own bytes or size do, and a failing check serves nothing', () => {
  const { record, files } = shotRecord();
  const [still, ...rest] = record.stills;
  const fontChanged = checkTypeStills({
    record: {
      ...record,
      stills: [
        {
          ...still!,
          sources: still!.sources.map((source) => ({ ...source, sha256: '0'.repeat(64) })),
        },
        ...rest,
      ],
    },
    reader: reader(files),
  });
  assert.match(fontChanged.problems.join('\n'), /which changed since: run pnpm stills:type/);
  assert.deepEqual(fontChanged.files, []);
  assert.match(
    checkTypeStills({
      record: { ...record, stills: [{ ...still!, sha256: 'f'.repeat(64) }, ...rest] },
      reader: reader(files),
    }).problems.join('\n'),
    new RegExp(`${still!.file.replace(/\./g, '\\.')} isn't the file the record lists`),
  );
  assert.match(
    checkTypeStills({
      record: { ...record, stills: [{ ...still!, pixelWidth: 1 }, ...rest] },
      reader: reader(files),
    }).problems.join('\n'),
    /and the record says 1x/,
  );
  // A still set in a face its role no longer sets fails too.
  assert.match(
    checkTypeStills({
      record: { ...record, stills: [{ ...still!, face: { ...still!.face, weight: 1 } }, ...rest] },
      reader: reader(files),
    }).problems.join('\n'),
    /no longer does/,
  );
});

test('a pack with no still, a still missing from disk, and a file in no record all fail', () => {
  const { record, files } = shotRecord();
  const [still, ...rest] = record.stills;
  const problems = checkTypeStills({
    record: { ...record, stills: rest },
    reader: reader(files),
  }).problems.join('\n');
  assert.match(problems, new RegExp(`${still!.pack}\\.${still!.role} has no still`));
  assert.match(
    problems,
    new RegExp(`${still!.file.replace(/\./g, '\\.')} is in .* and in no record`),
  );
  const gone = new Map(files);
  gone.delete(path.join(TYPE_STILLS_DIR, still!.file));
  assert.match(
    checkTypeStills({ record, reader: reader(gone) }).problems.join('\n'),
    /is in the record and not on disk/,
  );
  assert.match(
    checkTypeStills({ record: null }).problems.join('\n'),
    /no apps\/web\/studio-stills\/type\/stills\.json: run pnpm stills:type/,
  );
});

test("each still sets its pack's own role, from the files of that face that hold its text", () => {
  const swiss = packs.find(({ manifest }) => manifest.id === 'swiss-grotesque')!;
  const [aa, line] = stillSpecs(swiss);
  assert.deepEqual(aa!.face, {
    role: 'display',
    family: 'Archivo',
    weight: 900,
    style: 'normal',
    tracking: '-0.03em',
  });
  assert.equal(aa!.text, TYPE_STILL_TEXT.aa);
  assert.deepEqual(
    aa!.sources.map(({ file }) => file),
    ['packages/appearance-typography/packs/swiss-grotesque/fonts/archivo-latin-wght-normal.woff2'],
  );
  assert.equal(line!.face.weight, 400);
  // A role whose face the pack ships no file of can't be shot.
  const broken: TypePack = {
    ...swiss,
    manifest: {
      ...swiss.manifest,
      roles: { ...swiss.manifest.roles, display: { 'font-family': '"Nowhere", serif' } },
    },
  };
  assert.throws(() => stillSpecs(broken), /ships no file of it/);
});

test("a PNG's size is read from its header, and anything else isn't a PNG", () => {
  assert.deepEqual(pngSize(png(72, 68, 'x')), { width: 72, height: 68 });
  assert.equal(pngSize(new Uint8Array(40)), null);
});

test("check:budgets names each still as Studio's catalog does", () => {
  for (const still of shotRecord().record.stills) {
    assert.equal(budgetsName(still), servedStillName(still));
  }
});

test("the catalog's role map names only self-hosted packs and roles they have, and Field Serif's Aa is its quote face", () => {
  const hosted = new Map(
    packs.filter(({ manifest }) => selfHosted(manifest)).map((pack) => [pack.manifest.id, pack]),
  );
  for (const [id, faces] of Object.entries(TYPE_STILL_FACES)) {
    const pack = hosted.get(id);
    assert.ok(pack, `${id} is a self-hosted platform pack`);
    for (const role of Object.values(faces))
      assert.ok(pack.manifest.roles[role!], `${id} has ${role}`);
  }
  const field = stillSpecs(hosted.get('field-serif')!);
  assert.deepEqual(
    field.map((spec) => [spec.role, spec.face.role, spec.face.family, spec.face.style]),
    [
      ['aa', 'quote', 'Fraunces Italic', 'normal'],
      ['line', 'display', 'Fraunces', 'normal'],
    ],
  );
  assert.deepEqual(
    ['console-mono', 'drafting-grotesk'].map((id) => stillFace(id, 'line')),
    ['label', 'label'],
  );
  // Technical Sans and Mono's body is a system face, so both its stills set the SemiBold file it
  // ships for its headings (600): its "Aa" its display face, its line its title face, never the
  // Medium that Drafting Grotesk's label line sets (B's strip review).
  const tsm = 'packages/appearance-typography/packs/technical-sans-mono/fonts';
  // And no two packs' line stills set one family at one weight.
  const lines = packs
    .flatMap((pack) => stillSpecs(pack))
    .filter((spec) => spec.role === 'line')
    .map((spec) => `${spec.face.family} ${spec.face.weight} ${spec.face.style}`);
  assert.equal(new Set(lines).size, lines.length, lines.join('; '));
  assert.deepEqual(
    stillSpecs(hosted.get('technical-sans-mono')!).map((spec) => [
      spec.role,
      spec.face.role,
      spec.face.family,
      spec.face.weight,
      spec.sources.map(({ file }) => file),
    ]),
    [
      ['aa', 'display', 'IBM Plex Mono', 600, [`${tsm}/ibmplexmono-semibold-latin1.woff2`]],
      ['line', 'title', 'IBM Plex Mono', 600, [`${tsm}/ibmplexmono-semibold-latin1.woff2`]],
    ],
  );
  assert.equal(stillFace('swiss-grotesque', 'aa'), 'display');
  // A role the pack doesn't have can't be shot.
  const swiss = hosted.get('swiss-grotesque')!;
  const { quote: _quote, ...roles } = swiss.manifest.roles;
  void _quote;
  assert.throws(
    () => stillSpecs({ ...swiss, manifest: { ...swiss.manifest, id: 'field-serif', roles } }),
    /set its quote role, which its manifest doesn't have/,
  );
});

test('no two stills set the same face at the same size, so none is byte-identical to another', () => {
  // The face a still sets, its text and its size decide its pixels: two specs alike there are one still.
  const seen = new Map<string, string>();
  for (const spec of packs.flatMap((pack) => stillSpecs(pack))) {
    const { family, weight, style, tracking } = spec.face;
    const key = JSON.stringify([spec.role, spec.text, family, weight, style, tracking]);
    const twin = seen.get(key);
    assert.equal(twin, undefined, `${twin} and ${spec.pack}.${spec.role} set the same face`);
    seen.set(key, `${spec.pack}.${spec.role}`);
  }
  // And the check refuses committed stills that are byte-identical, whatever their record says.
  const { record, files } = shotRecord();
  const [first, second, ...rest] = record.stills;
  const same = new Map(files);
  same.set(
    path.join(TYPE_STILLS_DIR, second!.file),
    files.get(path.join(TYPE_STILLS_DIR, first!.file))!,
  );
  const twinned = {
    ...record,
    stills: [
      first!,
      {
        ...second!,
        sha256: first!.sha256,
        bytes: first!.bytes,
        pixelWidth: first!.pixelWidth,
        pixelHeight: first!.pixelHeight,
      },
      ...rest,
    ],
  };
  const checked = checkTypeStills({ record: twinned, reader: reader(same) });
  assert.match(
    checked.problems.join('\n'),
    /are byte-identical: give one its pack's signature role/,
  );
  assert.deepEqual(checked.files, []);
  // The committed stills: every one's bytes its own.
  if (committed && committed.unshot === undefined) {
    const shas = committed.stills.map((still) => still.sha256);
    assert.equal(new Set(shas).size, shas.length, 'no two committed stills share their bytes');
  }
});

test("the build serves the stills it has and no earlier build's: one shot again replaces its name, and a file no build writes stops it", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-stills-'));
  try {
    const dir = path.join(root, 'studio');
    const staging = path.join(root, 'staging');
    const still = (name: string, byte: number): StudioFile => ({
      name,
      url: `/_portfolio/studio/${name}`,
      sha256: '',
      bytes: new Uint8Array([byte]),
    });
    const first = [
      still('book-serif-aa.000000000001.png', 1),
      still('book-serif-line.000000000002.png', 2),
    ];
    assert.deepEqual(writeStudioFiles(first, { dir, staging }), {
      written: first.map(({ name }) => name),
      unchanged: [],
      removed: [],
    });
    // Shot again: the line's bytes, so its name, change; the earlier name goes.
    const again = [first[0]!, still('book-serif-line.000000000003.png', 3)];
    assert.deepEqual(writeStudioFiles(again, { dir, staging }), {
      written: ['book-serif-line.000000000003.png'],
      unchanged: ['book-serif-aa.000000000001.png'],
      removed: ['book-serif-line.000000000002.png'],
    });
    assert.deepEqual(fs.readdirSync(dir).sort(), again.map(({ name }) => name).sort());
    // A still a gone process staged is cleared; one this process is staging, and a file that
    // isn't a still's, are left.
    const leftover = 'book-serif-aa.000000000009.png.999999999.tmp';
    const mine = `book-serif-aa.000000000009.png.${process.pid}.tmp`;
    for (const name of [leftover, mine, 'mine.txt']) fs.writeFileSync(path.join(staging, name), '');
    writeStudioFiles(again, { dir, staging });
    assert.deepEqual(fs.readdirSync(staging).sort(), [mine, 'mine.txt'].sort());
    // A file that isn't a still's is no build's: refused, and nothing written or removed.
    fs.writeFileSync(path.join(dir, 'notes.txt'), 'mine');
    assert.throws(() => writeStudioFiles(first, { dir, staging }), /holds notes\.txt/);
    // A name that isn't a still's is never written.
    assert.throws(
      () => writeStudioFiles([still('notes.png', 4)], { dir: path.join(root, 'other'), staging }),
      /notes\.png isn't a type still's served name/,
    );
    assert.deepEqual(
      fs.readdirSync(dir).sort(),
      [...again.map(({ name }) => name), 'notes.txt'].sort(),
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
