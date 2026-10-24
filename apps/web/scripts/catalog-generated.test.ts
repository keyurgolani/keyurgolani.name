import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { packPackages, recordDigest } from '@portfolio/appearance/node';
import { generatedEntries, referenceSets } from './catalog-generated';
import { acceptanceStatus, acceptScheme, generatedLines, writeReview } from './catalog-review';
import { REPO_ROOT } from './registry-options';

// #20 PR 3: the generated schemes' reference records, held current at their
// generator's version, and what the owner reads and writes to accept one.

/** A scratch root with the schemes package and the reference images, for a check to break. */
function scratch(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kgn-generated-'));
  fs.cpSync(
    path.join(REPO_ROOT, 'packages/appearance-schemes'),
    path.join(root, 'packages/appearance-schemes'),
    { recursive: true, filter: (source) => !source.includes('node_modules') },
  );
  for (const file of [
    'example-media/anamika/portrait.png',
    'example-media/gallery/looking-1.png',
  ]) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.copyFileSync(path.join(REPO_ROOT, file), path.join(root, file));
  }
  return root;
}

const RECORDS = 'packages/appearance-schemes/generated';
const messages = (root: string) =>
  generatedEntries(root, packPackages(root)).problems.map(({ pack, message, writable }) => ({
    pack,
    message,
    writable,
  }));

test('every generated scheme has a current reference record, and each one passes its own report', () => {
  const { entries, problems } = generatedEntries(REPO_ROOT, packPackages(REPO_ROOT));
  assert.deepEqual(problems, []);
  assert.deepEqual(
    entries.map(({ id }) => id),
    ['brand-seed', 'hct-tonal', 'portfolio-artwork', 'profile-image'],
  );
  for (const entry of entries) {
    assert.equal(entry.recorded, entry.text, entry.id);
    assert.equal(entry.record!.result.contrastReport.passes, true, entry.id);
  }
  assert.deepEqual(
    Object.keys(referenceSets(entries)).sort(),
    entries.map(({ id }) => id),
  );
});

test('a missing or other-version record is stale and writable, and a changed one at the same version needs a version bump', () => {
  const root = scratch();
  try {
    fs.rmSync(path.join(root, RECORDS, 'brand-seed.json'));
    const record = path.join(root, RECORDS, 'hct-tonal.json');
    const text = fs.readFileSync(record, 'utf8');
    fs.writeFileSync(record, text.replace('"canvas": "#fffbff"', '"canvas": "#fffbfe"'));
    const other = path.join(root, RECORDS, 'profile-image.json');
    const parsed = JSON.parse(fs.readFileSync(other, 'utf8'));
    parsed.result.generator.version = 0;
    fs.writeFileSync(other, JSON.stringify(parsed));
    const found = messages(root);
    assert.deepEqual(
      found.map(({ pack, writable }) => [pack, writable]),
      [
        ['brand-seed', true],
        ['hct-tonal', false],
        ['profile-image', true],
      ],
    );
    assert.match(found[0]!.message, /is missing/);
    assert.match(found[1]!.message, /changed at the same version\. Raise its version/);
    assert.match(found[2]!.message, /another profile-image version and is stale/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a record from another reference input, a seed or an image, is stale and writable, never a generator change', () => {
  const root = scratch();
  try {
    // brand-seed's record says it came from another seed.
    const seeded = path.join(root, RECORDS, 'brand-seed.json');
    const parsed = JSON.parse(fs.readFileSync(seeded, 'utf8'));
    parsed.source.seedColor = '#5b5bd7';
    parsed.result.input.seedColor = '#5b5bd7';
    parsed.result.tokens.light.accent = '#5b5bd7';
    fs.writeFileSync(seeded, JSON.stringify(parsed));
    // The portrait's pixels changed, so its hash and its palette did.
    fs.copyFileSync(
      path.join(REPO_ROOT, 'example-media/gallery/looking-1.png'),
      path.join(root, 'example-media/anamika/portrait.png'),
    );
    const found = messages(root);
    assert.deepEqual(
      found.map(({ pack, writable }) => [pack, writable]),
      [
        ['brand-seed', true],
        ['profile-image', true],
      ],
    );
    for (const { message } of found)
      assert.match(message, /from another reference input and is stale/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('an acceptance names only an image-derived scheme, and the owner accepts the current record alone', () => {
  const root = scratch();
  try {
    const packages = packPackages(root);
    assert.deepEqual(acceptScheme(root, packages, 'brand-seed', 'keyurgolani').ok, false);
    assert.equal(acceptScheme(root, packages, 'nebula', 'keyurgolani').ok, false);
    assert.equal(acceptScheme(root, packages, 'profile-image', 'Not A Login').ok, false);
    const accepted = acceptScheme(
      root,
      packages,
      'profile-image',
      'keyurgolani',
      new Date('2026-10-24T12:00:00Z'),
    );
    assert.ok(accepted.ok);
    const written = JSON.parse(
      fs.readFileSync(path.join(root, RECORDS, 'acceptance.json'), 'utf8'),
    );
    assert.deepEqual(written, {
      'profile-image': {
        record: recordDigest(
          fs.readFileSync(path.join(root, RECORDS, 'profile-image.json'), 'utf8'),
        ),
        acceptedBy: 'keyurgolani',
        acceptedAt: '2026-10-24',
      },
    });
    const entry = generatedEntries(root, packages).entries.find(
      ({ id }) => id === 'profile-image',
    )!;
    assert.match(
      acceptanceStatus(root, entry, 'packages/appearance-schemes'),
      /^accepted by keyurgolani/,
    );
    assert.deepEqual(messages(root), []);
    // An acceptance of a seed scheme is a finding.
    fs.writeFileSync(
      path.join(root, RECORDS, 'acceptance.json'),
      JSON.stringify({ ...written, 'brand-seed': written['profile-image'] }),
    );
    assert.match(
      messages(root)[0]!.message,
      /accepts brand-seed, which isn't an image-derived scheme/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('catalog show names the reference record and whether it waits, and catalog review writes a page per scheme, images first', () => {
  const lines = generatedLines(REPO_ROOT, packPackages(REPO_ROOT), 'portfolio-artwork').join('\n');
  assert.match(lines, /Generator: portfolio-artwork, version 1 \(image-palette@1, anchor-v2\)/);
  assert.match(lines, /example-media\/gallery\/looking-1\.png/);
  assert.match(lines, /Review: waits for the owner's acceptance/);
  assert.deepEqual(generatedLines(REPO_ROOT, packPackages(REPO_ROOT), 'warm-parchment'), []);
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'kgn-review-pages-'));
  try {
    const written = writeReview(REPO_ROOT, packPackages(REPO_ROOT), out).map((file) =>
      path.basename(file),
    );
    assert.deepEqual(written, [
      'portfolio-artwork.html',
      'profile-image.html',
      'brand-seed.html',
      'hct-tonal.html',
      'index.html',
    ]);
    const page = fs.readFileSync(path.join(out, 'profile-image.html'), 'utf8');
    assert.match(page, /<img src="profile-image\.png"/);
    assert.ok(fs.existsSync(path.join(out, 'profile-image.png')));
    assert.match(page, /data-categorical-6/);
    assert.match(page, /high-contrast-dark/);
    assert.doesNotMatch(page, /https?:\/\//, 'the page loads nothing from anywhere');
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});
