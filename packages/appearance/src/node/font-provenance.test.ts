import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  copyrightProblems,
  faceHint,
  FONT_PROVENANCE_FILE,
  fontProvenanceProblems,
  fontProvenanceReport,
  readFontProvenance,
  vendoredLicenseName,
  vendorFonts,
  VendorError,
} from './font-provenance';
import { minimalWoff2, SAMPLE_METRICS } from '../test-support/woff2';

// Every font a typography pack ships against its fonts.provenance.json, and
// vendoring from a package already in node_modules, against scratch packs
// and a fake installed package. Nothing here reaches the network.

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const FIXTURE_PACK = path.join(ROOT, 'packages/appearance-fixtures-typography/packs/fixture-font');
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

const scratches: string[] = [];
test.after(() => {
  for (const dir of scratches) fs.rmSync(dir, { recursive: true, force: true });
});

function scratch(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'portfolio-fonts-'));
  scratches.push(dir);
  return dir;
}

/** A copy of the fixture-font pack, for a test to break. */
function fixtureCopy(): string {
  const dir = path.join(scratch(), 'fixture-font');
  fs.cpSync(FIXTURE_PACK, dir, { recursive: true });
  return dir;
}

const FAKE_COPYRIGHT =
  'Copyright 2024 The Fake Sans Project Authors (https://example.test/fake-sans)';
const FAKE_LICENSE = `${FAKE_COPYRIGHT}\n\nSIL OPEN FONT LICENSE Version 1.1\n`;

/** A fake installed font package: two WOFF2 files, its LICENSE, and the stylesheet that names them. */
function fakePackage(overrides: { license?: unknown; licenseFile?: string | null } = {}): {
  dir: string;
  files: Record<string, Uint8Array>;
} {
  const dir = path.join(scratch(), 'node_modules', '@fontsource', 'fake-sans');
  fs.mkdirSync(path.join(dir, 'files'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({
      name: '@fontsource/fake-sans',
      version: '5.2.6',
      license: 'license' in overrides ? overrides.license : 'OFL-1.1',
    }),
  );
  if (overrides.licenseFile !== null) {
    fs.writeFileSync(path.join(dir, overrides.licenseFile ?? 'LICENSE'), FAKE_LICENSE);
  }
  const files = {
    'files/fake-sans-latin-400-normal.woff2': minimalWoff2(),
    'files/fake-sans-latin-700-normal.woff2': minimalWoff2({
      ...{ unitsPerEm: 1000, xAvgCharWidth: 540, capHeight: 700, useTypoMetrics: false },
      advance: 540,
      hhea: { ascender: 900, descender: -250, lineGap: 0 },
      typo: { ascender: 800, descender: -200, lineGap: 0 },
    }),
  };
  for (const [file, bytes] of Object.entries(files)) fs.writeFileSync(path.join(dir, file), bytes);
  fs.writeFileSync(
    path.join(dir, 'index.css'),
    [
      '/* fake-sans-latin-400-normal */',
      '@font-face {',
      "  font-family: 'Fake Sans';",
      '  font-style: normal;',
      '  font-display: swap;',
      '  font-weight: 400;',
      "  src: url(./files/fake-sans-latin-400-normal.woff2) format('woff2');",
      '  unicode-range: U+0000-00FF,U+0131,U+0152-0153;',
      '}',
      '',
    ].join('\n'),
  );
  return { dir, files };
}

/** A scratch pack directory with a manifest, as vendoring requires, citing the fake package's copyright line. */
function emptyPack(): string {
  const dir = path.join(scratch(), 'packs', 'fake-type');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'manifest.json'),
    `${JSON.stringify({ provenance: { copyright: FAKE_COPYRIGHT } })}\n`,
  );
  return dir;
}

test("the repository's font packs, fixtures included, match their provenance records", () => {
  const report = fontProvenanceReport(ROOT);
  assert.deepEqual(
    report.map(({ dir, fonts, problems }) => [dir, fonts, problems]),
    [
      ['packages/appearance-fixtures-typography/packs/fixture-font', 1, []],
      ['packages/appearance-typography/packs/book-serif', 8, []],
      ['packages/appearance-typography/packs/console-mono', 4, []],
      ['packages/appearance-typography/packs/drafting-grotesk', 5, []],
      ['packages/appearance-typography/packs/field-serif', 6, []],
      ['packages/appearance-typography/packs/paste-up', 5, []],
      ['packages/appearance-typography/packs/screen-grotesque', 2, []],
      ['packages/appearance-typography/packs/shell-mono', 4, []],
      ['packages/appearance-typography/packs/swiss-grotesque', 4, []],
      ['packages/appearance-typography/packs/technical-sans-mono', 2, []],
      ['packages/budget-fixtures/fixture-type-font/packs/fixture-type-font', 1, []],
    ],
  );
});

test('a changed byte fails, naming the file, both digests, and the source to vendor again', () => {
  const dir = fixtureCopy();
  const file = path.join(dir, 'geist-latin.woff2');
  const bytes = fs.readFileSync(file);
  bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 1;
  fs.writeFileSync(file, bytes);
  const problems = fontProvenanceProblems(dir, { fixture: true });
  assert.equal(problems.length, 1);
  assert.equal(problems[0]!.file, 'geist-latin.woff2');
  assert.match(
    problems[0]!.message,
    new RegExp(`SHA-256 is ${sha256(bytes)}, and ${FONT_PROVENANCE_FILE} records 1b5ebfb3`),
  );
  assert.match(problems[0]!.remedy, /next@16\.2\.4/);
});

test('an unlisted font fails, and a pack that ships fonts with no record fails', () => {
  const dir = fixtureCopy();
  fs.mkdirSync(path.join(dir, 'extra'));
  fs.writeFileSync(path.join(dir, 'extra', 'more.woff2'), minimalWoff2());
  const problems = fontProvenanceProblems(dir, { fixture: true });
  assert.deepEqual(
    problems.map(({ file }) => file),
    ['extra/more.woff2'],
  );
  assert.match(problems[0]!.message, /doesn't list it/);

  fs.rmSync(path.join(dir, FONT_PROVENANCE_FILE));
  const none = fontProvenanceProblems(dir, { fixture: true });
  assert.equal(none.length, 1);
  assert.match(
    none[0]!.message,
    /ships 2 WOFF2 file\(s\), extra\/more\.woff2, geist-latin\.woff2, and no fonts\.provenance\.json/,
  );
});

test('a missing license file fails, and so do a listed font that is gone and a license no pack ships under', () => {
  const dir = fixtureCopy();
  fs.rmSync(path.join(dir, 'OFL.txt'));
  const missing = fontProvenanceProblems(dir, { fixture: true });
  assert.deepEqual(
    missing.map(({ file }) => file),
    ['OFL.txt'],
  );
  assert.match(missing[0]!.message, /license file, OFL\.txt, isn't in the pack/);

  fs.copyFileSync(path.join(FIXTURE_PACK, 'OFL.txt'), path.join(dir, 'OFL.txt'));
  const record = JSON.parse(fs.readFileSync(path.join(dir, FONT_PROVENANCE_FILE), 'utf8'));
  record.fonts[0].license.spdx = 'GPL-3.0';
  record.fonts.push({
    ...record.fonts[0],
    file: 'gone.woff2',
    license: { spdx: 'OFL-1.1', file: 'OFL.txt' },
  });
  fs.writeFileSync(path.join(dir, FONT_PROVENANCE_FILE), JSON.stringify(record));
  const messages = fontProvenanceProblems(dir, { fixture: true }).map(({ message }) => message);
  assert.equal(messages.length, 2, messages.join('\n'));
  assert.match(
    messages[0]!,
    /license is GPL-3\.0, and a pack ships fonts under OFL-1\.1, Apache-2\.0, MIT alone/,
  );
  assert.match(messages[1]!, /lists gone\.woff2, which the pack doesn't have/);
});

test('a record that is not the shape it reads, and "fixture" outside a fixture package, fail', () => {
  const dir = fixtureCopy();
  const file = path.join(dir, FONT_PROVENANCE_FILE);
  const record = JSON.parse(fs.readFileSync(file, 'utf8'));
  const write = (value: unknown) => fs.writeFileSync(file, JSON.stringify(value));
  write({ ...record, version: 2 });
  assert.match(fontProvenanceProblems(dir)[0]!.message, /version is 2/);
  write({
    ...record,
    fonts: [{ ...record.fonts[0], source: { package: 'next', version: '^16' } }],
  });
  assert.match(fontProvenanceProblems(dir)[0]!.message, /exact version/);
  fs.writeFileSync(file, '{');
  assert.match(fontProvenanceProblems(dir)[0]!.message, /isn't JSON/);
  write({ ...record, fonts: [{ ...record.fonts[0], source: 'fixture' }] });
  assert.deepEqual(fontProvenanceProblems(dir, { fixture: true }), []);
  assert.match(fontProvenanceProblems(dir)[0]!.message, /only a fixture package's pack may say/);
});

test('vendoring copies the named files and the license, and writes their entries', () => {
  const pkg = fakePackage();
  const pack = emptyPack();
  const result = vendorFonts({
    packDir: pack,
    packageDir: pkg.dir,
    files: ['files/fake-sans-latin-400-normal.woff2'],
  });
  const licenseFile = vendoredLicenseName('@fontsource/fake-sans');
  assert.equal(licenseFile, 'LICENSE-fontsource-fake-sans.txt');
  assert.equal(result.packageName, '@fontsource/fake-sans');
  assert.equal(result.version, '5.2.6');
  assert.deepEqual(
    new Uint8Array(fs.readFileSync(path.join(pack, 'fake-sans-latin-400-normal.woff2'))),
    pkg.files['files/fake-sans-latin-400-normal.woff2'],
  );
  assert.equal(fs.readFileSync(path.join(pack, licenseFile), 'utf8'), FAKE_LICENSE);
  assert.deepEqual(readFontProvenance(pack), {
    version: 1,
    fonts: [
      {
        file: 'fake-sans-latin-400-normal.woff2',
        sha256: sha256(pkg.files['files/fake-sans-latin-400-normal.woff2']!),
        source: {
          package: '@fontsource/fake-sans',
          version: '5.2.6',
          path: 'files/fake-sans-latin-400-normal.woff2',
        },
        license: { spdx: 'OFL-1.1', file: licenseFile },
        // Its stylesheet's range meets printable Basic Latin, so a Latin page loads it.
        latin: true,
      },
    ],
  });
  // What the package's own stylesheet says of the file, for fontAssets.
  assert.deepEqual(result.copied[0]!.hint, {
    family: 'Fake Sans',
    weight: '400',
    style: 'normal',
    unicodeRange: 'U+0000-00FF,U+0131,U+0152-0153',
  });
  assert.deepEqual(fontProvenanceProblems(pack), []);

  // Vendoring again adds the new file, replaces the old one's entry, and keeps the order.
  vendorFonts({
    packDir: pack,
    packageDir: pkg.dir,
    files: ['files/fake-sans-latin-700-normal.woff2', 'files/fake-sans-latin-400-normal.woff2'],
  });
  const again = readFontProvenance(pack);
  assert.ok(again && !('problem' in again));
  assert.deepEqual(
    again.fonts.map(({ file }) => file),
    ['fake-sans-latin-400-normal.woff2', 'fake-sans-latin-700-normal.woff2'],
  );
  assert.deepEqual(fontProvenanceProblems(pack), []);
  assert.equal(faceHint(pkg.dir, 'files/fake-sans-latin-700-normal.woff2'), null);
});

test('vendoring refuses, writing nothing, what it would not be able to stand behind', () => {
  const refuses = (pattern: RegExp, files: string[], pkg = fakePackage(), pack = emptyPack()) => {
    assert.throws(
      () => vendorFonts({ packDir: pack, packageDir: pkg.dir, files }),
      (error: unknown) => error instanceof VendorError && pattern.test(error.message),
    );
    assert.deepEqual(fs.readdirSync(pack), ['manifest.json'], 'nothing written');
  };
  const ok = 'files/fake-sans-latin-400-normal.woff2';
  refuses(/at least one/, []);
  refuses(/resolves outside/, ['../../../../etc/passwd.woff2']);
  refuses(/isn't a \.woff2 file/, ['package.json']);
  refuses(/has no files\/missing\.woff2/, ['files/missing.woff2']);
  refuses(/licensed "GPL-3\.0"/, [ok], fakePackage({ license: 'GPL-3.0' }));
  refuses(/licensed undefined/, [ok], fakePackage({ license: undefined }));
  refuses(/ships none of LICENSE/, [ok], fakePackage({ licenseFile: null }));
  const notFont = fakePackage();
  fs.writeFileSync(path.join(notFont.dir, 'files', 'fake.woff2'), 'text');
  refuses(/isn't a WOFF2 font/, ['files/fake.woff2'], notFont);
  const noManifest = path.join(scratch(), 'not-a-pack');
  fs.mkdirSync(noManifest);
  assert.throws(
    () => vendorFonts({ packDir: noManifest, packageDir: fakePackage().dir, files: [ok] }),
    /has no manifest\.json/,
  );
  // An OFL.txt is a license file too.
  const ofl = fakePackage({ licenseFile: 'OFL.txt' });
  const pack = emptyPack();
  vendorFonts({ packDir: pack, packageDir: ofl.dir, files: [ok] });
  assert.ok(fs.existsSync(path.join(pack, 'LICENSE-fontsource-fake-sans.txt')));
});

test('the fit rule adds optional files in order while the pack stays within its cap, and says what it left out', () => {
  const pkg = fakePackage();
  const pack = emptyPack();
  const regular = 'files/fake-sans-latin-400-normal.woff2';
  const bold = 'files/fake-sans-latin-700-normal.woff2';
  const size = (file: string) => pkg.files[file]!.length;
  // A cap that holds the regular face and not the bold.
  const result = vendorFonts({
    packDir: pack,
    packageDir: pkg.dir,
    files: [regular],
    optional: [bold],
    cap: size(regular) + size(bold) - 1,
    into: 'fonts',
  });
  assert.deepEqual(result.dropped, [{ file: bold, bytes: size(bold) }]);
  assert.equal(result.total, size(regular));
  assert.deepEqual(fs.readdirSync(path.join(pack, 'fonts')).sort(), [
    'LICENSE-fontsource-fake-sans.txt',
    'fake-sans-latin-400-normal.woff2',
  ]);
  const record = readFontProvenance(pack);
  assert.ok(record && !('problem' in record));
  assert.deepEqual(
    record.fonts.map(({ file, license }) => [file, license.file]),
    [['fonts/fake-sans-latin-400-normal.woff2', 'fonts/LICENSE-fontsource-fake-sans.txt']],
  );
  assert.deepEqual(fontProvenanceProblems(pack), []);
  // With room it's added, and the files already in the pack count toward the cap.
  const roomy = vendorFonts({
    packDir: pack,
    packageDir: pkg.dir,
    files: [],
    optional: [bold],
    cap: size(regular) + size(bold),
    into: 'fonts',
  });
  assert.deepEqual(roomy.dropped, []);
  assert.equal(roomy.total, size(regular) + size(bold));
  assert.throws(
    () => vendorFonts({ packDir: pack, packageDir: pkg.dir, files: [regular], into: '../out' }),
    /isn't a directory inside the pack/,
  );
  // A file named in capitals, as IBM's are, is copied under its name in lowercase, its bytes as they are.
  fs.copyFileSync(
    path.join(pkg.dir, regular),
    path.join(pkg.dir, 'files', 'FakeSans-Medium-Latin1.woff2'),
  );
  const upper = vendorFonts({
    packDir: pack,
    packageDir: pkg.dir,
    files: ['files/FakeSans-Medium-Latin1.woff2'],
    cap: Number.POSITIVE_INFINITY,
    into: 'fonts',
  });
  assert.equal(upper.copied[0]!.entry.file, 'fonts/fakesans-medium-latin1.woff2');
  assert.deepEqual(upper.copied[0]!.entry.source, {
    package: '@fontsource/fake-sans',
    version: '5.2.6',
    path: 'files/FakeSans-Medium-Latin1.woff2',
  });
  assert.deepEqual(fontProvenanceProblems(pack), []);
});

/** The fake package with a latin-ext file too, which its stylesheet gives Google's latin-ext range. */
function fakeWithExt() {
  const pkg = fakePackage();
  const ext = 'files/fake-sans-latin-ext-400-normal.woff2';
  const bytes = minimalWoff2({ ...SAMPLE_METRICS, advance: 520 });
  fs.writeFileSync(path.join(pkg.dir, ext), bytes);
  fs.appendFileSync(
    path.join(pkg.dir, 'index.css'),
    [
      '@font-face {',
      "  font-family: 'Fake Sans';",
      '  font-weight: 400;',
      `  src: url(./${ext}) format('woff2');`,
      '  unicode-range: U+0100-02BA,U+02BD-02C5,U+1E00-1EFF;',
      '}',
      '',
    ].join('\n'),
  );
  return { ...pkg, ext, extBytes: bytes };
}

test('under R4 the fit rule counts Latin faces alone, and keeps an optional face no Latin page loads', () => {
  const pkg = fakeWithExt();
  const regular = 'files/fake-sans-latin-400-normal.woff2';
  const bold = 'files/fake-sans-latin-700-normal.woff2';
  const size = (file: string) => fs.statSync(path.join(pkg.dir, file)).size;
  const pack = emptyPack();
  // A cap the regular face fills: the bold, Latin, is dropped, and the latin-ext face, which
  // only text past Basic Latin loads, ships whatever the cap.
  const result = vendorFonts({
    packDir: pack,
    packageDir: pkg.dir,
    files: [regular],
    optional: [bold, pkg.ext],
    cap: size(regular),
  });
  assert.deepEqual(result.dropped, [{ file: bold, bytes: size(bold) }]);
  assert.equal(result.latin, size(regular));
  assert.equal(result.other, size(pkg.ext));
  assert.equal(result.total, size(regular) + size(pkg.ext));
  assert.equal(result.overCap, false);
  const record = readFontProvenance(pack);
  assert.ok(record && !('problem' in record));
  assert.deepEqual(
    record.fonts.map(({ file, latin, optional }) => [file, latin, optional ?? false]),
    [
      ['fake-sans-latin-400-normal.woff2', true, false],
      ['fake-sans-latin-ext-400-normal.woff2', false, true],
    ],
  );
  // What it left out is recorded, by package and path, with its bytes.
  assert.deepEqual(record.dropped, [
    { package: '@fontsource/fake-sans', version: '5.2.6', path: bold, bytes: size(bold) },
  ]);
  assert.deepEqual(fontProvenanceProblems(pack), []);
  // Required Latin faces over the cap are flagged, for the pack gate to fail.
  const over = vendorFonts({
    packDir: emptyPack(),
    packageDir: pkg.dir,
    files: [regular, bold],
    cap: size(regular),
  });
  assert.equal(over.overCap, true);
});

test('the fit rule gives one pack whatever order its files were vendored in', () => {
  const pkg = fakeWithExt();
  const regular = 'files/fake-sans-latin-400-normal.woff2';
  const bold = 'files/fake-sans-latin-700-normal.woff2';
  const size = (file: string) => fs.statSync(path.join(pkg.dir, file)).size;
  const cap = size(regular) + size(bold);
  // All at once.
  const once = emptyPack();
  vendorFonts({
    packDir: once,
    packageDir: pkg.dir,
    files: [regular],
    optional: [pkg.ext, bold],
    cap,
  });
  // Optional first, then the required one: the bold, already in the pack, still fits.
  const split = emptyPack();
  vendorFonts({ packDir: split, packageDir: pkg.dir, files: [], optional: [bold, pkg.ext], cap });
  vendorFonts({ packDir: split, packageDir: pkg.dir, files: [regular], cap });
  assert.deepEqual(readFontProvenance(split), readFontProvenance(once));
  // A required file that leaves an optional one already shipped no room is refused, writing nothing.
  const tight = emptyPack();
  vendorFonts({
    packDir: tight,
    packageDir: pkg.dir,
    files: [],
    optional: [bold],
    cap: size(bold),
  });
  const before = fs.readFileSync(path.join(tight, FONT_PROVENANCE_FILE), 'utf8');
  assert.throws(
    () => vendorFonts({ packDir: tight, packageDir: pkg.dir, files: [regular], cap: size(bold) }),
    (error: unknown) =>
      error instanceof VendorError && /vendored as optional, no longer fits/.test(error.message),
  );
  assert.equal(fs.readFileSync(path.join(tight, FONT_PROVENANCE_FILE), 'utf8'), before);
  assert.ok(!fs.existsSync(path.join(tight, 'fake-sans-latin-400-normal.woff2')));
});

test('a pack that ships fonts cites every family, each license file’s own copyright line', () => {
  const dir = fixtureCopy();
  const record = readFontProvenance(dir);
  assert.ok(record && !('problem' in record));
  const manifestFile = path.join(dir, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  // A fragment that is in the license, but not the family's line, doesn't cite it.
  manifest.provenance.copyright = 'Copyright';
  fs.writeFileSync(manifestFile, JSON.stringify(manifest));
  const fragment = copyrightProblems(dir, record);
  assert.equal(fragment.length, 1);
  assert.match(
    fragment[0]!.message,
    /doesn't cite OFL\.txt's line, "Copyright 2024 The Geist Project Authors \(https:\/\/github\.com\/vercel\/geist-font\.git\)"/,
  );
  // And a pack that ships fonts with no copyright line at all fails.
  delete manifest.provenance.copyright;
  fs.writeFileSync(manifestFile, JSON.stringify(manifest));
  assert.match(copyrightProblems(dir, record)[0]!.message, /gives no copyright line/);
});

test("a manifest's copyright line has to be in the license file its fonts name", () => {
  const dir = fixtureCopy();
  const record = readFontProvenance(dir);
  assert.ok(record && !('problem' in record));
  assert.deepEqual(copyrightProblems(dir, record), []);
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  manifest.provenance.copyright = `${manifest.provenance.copyright}; Copyright 2099 Someone Else`;
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest));
  const problems = fontProvenanceProblems(dir, { fixture: true });
  assert.equal(problems.length, 1);
  assert.equal(problems[0]!.file, 'manifest.json');
  assert.match(
    problems[0]!.message,
    /"Copyright 2099 Someone Else", which none of its fonts' license files says/,
  );
});

test("a hint comes from a package's css/ directory too, where IBM's packages keep their stylesheets", () => {
  const pkg = fakePackage();
  fs.mkdirSync(path.join(pkg.dir, 'css'));
  fs.renameSync(path.join(pkg.dir, 'index.css'), path.join(pkg.dir, 'css', 'all.css'));
  assert.equal(faceHint(pkg.dir, 'files/fake-sans-latin-400-normal.woff2')?.family, 'Fake Sans');
});
