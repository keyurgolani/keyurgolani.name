import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { contrastReport, schemeSets } from '@portfolio/appearance';
import {
  readingName,
  SHIPPING_TYPOGRAPHY,
  STRICTEST_READINGS,
} from '@portfolio/appearance/generators';
import { packPackages, recordDigest, renderReference } from '@portfolio/appearance/node';
import { generatedEntries, recordCurrent, referenceSets } from './catalog-generated';
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
    assert.ok(recordCurrent(entry.recorded, entry.text!), entry.id);
    assert.equal(entry.record!.result.contrastReport.passes, true, entry.id);
  }
  assert.deepEqual(
    Object.keys(referenceSets(entries)).sort(),
    entries.map(({ id }) => id),
  );
});

test("a record written at fewer of the strictest readings is current while every color matches and its report is what those readings make now; a moved color, a tampered report, or a reading this build doesn't have isn't (LANG-5c r2b)", () => {
  const { entries } = generatedEntries(REPO_ROOT, packPackages(REPO_ROOT));
  const written = readingName(STRICTEST_READINGS.slice(0, 2));
  assert.equal(entries.length, 4);
  type Sets = { light: object; dark: object; highContrast: { light: object; dark: object } };
  const sets = (tokens: Sets) => [
    tokens.light,
    tokens.dark,
    tokens.highContrast.light,
    tokens.highContrast.dark,
  ];
  for (const entry of entries) {
    const committed = entry.recorded!;
    const record = JSON.parse(committed);
    const fresh = JSON.parse(entry.text!);
    // The committed bytes are the 2-reading record: current through its readings alone.
    assert.notEqual(committed, entry.text, entry.id);
    assert.equal(record.result.reading, written, entry.id);
    assert.notEqual(fresh.result.reading, written, entry.id);
    assert.equal(recordCurrent(committed, entry.text!), true, entry.id);
    // No generated value moved: everything the record holds is what version 1 makes now.
    for (const key of [
      'generator',
      'input',
      'algorithm',
      'extracted',
      'anchors',
      'adjustments',
      'notes',
    ])
      assert.deepEqual(record.result[key], fresh.result[key], `${entry.id} ${key}`);
    const now = sets(fresh.result.tokens);
    sets(record.result.tokens).forEach((set, index) => {
      for (const [role, value] of Object.entries(set))
        assert.equal((now[index] as Record<string, string>)[role], value, `${entry.id} ${role}`);
    });
    type Committed = {
      result: {
        reading: string;
        tokens: { dark: Record<string, string> };
        contrastReport: { pairs: Record<string, unknown>[] };
      };
    };
    const edited = (edit: (record: Committed) => void) => {
      const copy = structuredClone(record);
      edit(copy);
      return JSON.stringify(copy, null, 2);
    };
    const moved = edited(({ result }) => {
      result.tokens.dark.accent = '#000001';
    });
    const tampered = edited(({ result }) => {
      result.contrastReport.pairs[1] = { ...result.contrastReport.pairs[1], ratio: 99 };
    });
    const unknown = edited(({ result }) => {
      result.reading = `${written}, and more`;
    });
    const fewer = edited(({ result }) => {
      result.reading = readingName(STRICTEST_READINGS.slice(0, 1));
    });
    const emptied = edited(({ result }) => {
      result.contrastReport.pairs = [];
    });
    // Readings are only ever added: one that skips a bare reading was never written.
    const skipping = edited(({ result }) => {
      result.reading = readingName([STRICTEST_READINGS[1]!, STRICTEST_READINGS[0]!]);
    });
    for (const [name, text] of Object.entries({
      moved,
      tampered,
      unknown,
      fewer,
      emptied,
      skipping,
    }))
      assert.equal(recordCurrent(text, entry.text!), false, `${entry.id} ${name}`);
    // What the generator makes now, written whole at some of the readings: current only at
    // the first ones, never at one that leaves the first out, however true its report.
    const at = (readings: readonly (typeof STRICTEST_READINGS)[number][]) => {
      const record = entry.record!;
      const pairs = readings.flatMap(
        ({ language }) =>
          contrastReport(
            schemeSets(record.result.tokens, record.result.tokens.highContrast),
            language,
            SHIPPING_TYPOGRAPHY,
          ).pairs,
      );
      return renderReference({
        ...record,
        result: {
          ...record.result,
          reading: readingName(readings),
          contrastReport: { passes: pairs.every(({ passes }) => passes), pairs },
        },
      });
    };
    assert.equal(recordCurrent(at(STRICTEST_READINGS.slice(0, 3)), entry.text!), true, entry.id);
    assert.equal(recordCurrent(at(STRICTEST_READINGS.slice(1, 2)), entry.text!), false, entry.id);
    assert.equal(recordCurrent(at(STRICTEST_READINGS.slice(2)), entry.text!), false, entry.id);
  }
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

test('a record written before K-2, without the three roles it added and their pairs, is current, so an acceptance of it stands; one that also moved another role still needs a version bump (K-2)', () => {
  const root = scratch();
  try {
    const additions = ['on-emphasis', 'focus-inverse', 'surface-lit'];
    const v1 = (file: string, edit?: (text: string) => string) => {
      const record = path.join(root, RECORDS, file);
      const parsed = JSON.parse(fs.readFileSync(record, 'utf8'));
      const { tokens } = parsed.result;
      for (const set of [
        tokens.light,
        tokens.dark,
        tokens.highContrast.light,
        tokens.highContrast.dark,
      ])
        for (const role of additions) delete set[role];
      parsed.result.contrastReport.pairs = parsed.result.contrastReport.pairs.filter(
        (pair: { foreground: string; ground: string }) =>
          !additions.includes(pair.foreground) && !additions.includes(pair.ground),
      );
      const text = `${JSON.stringify(parsed, null, 2)}\n`;
      fs.writeFileSync(record, edit ? edit(text) : text);
    };
    v1('brand-seed.json');
    v1('hct-tonal.json', (text) => text.replace('"canvas": "#fffbff"', '"canvas": "#fffbfe"'));
    const found = messages(root);
    assert.deepEqual(
      found.map(({ pack, writable }) => [pack, writable]),
      [['hct-tonal', false]],
    );
    assert.match(found[0]!.message, /changed at the same version\. Raise its version/);
    // A record with the three roles is compared whole: one that moves only one of them isn't current.
    const current = generatedEntries(REPO_ROOT, packPackages(REPO_ROOT)).entries[0]!;
    const moved = current.text!.replace(
      /"surface-lit": "#[0-9a-f]{6}"/,
      '"surface-lit": "#123456"',
    );
    assert.notEqual(moved, current.text);
    assert.equal(recordCurrent(moved, current.text!), false);
    // A pre-K-2 record's contrast report counts, less the pairs that read the three roles
    // (review M2): a tampered, stale, or emptied report isn't current.
    for (const entry of generatedEntries(REPO_ROOT, packPackages(REPO_ROOT)).entries) {
      const committed = entry.recorded!;
      assert.equal(recordCurrent(committed, entry.text!), true, entry.id);
      const record = JSON.parse(committed);
      const tampered = structuredClone(record);
      tampered.result.contrastReport.pairs[0] = {
        ...tampered.result.contrastReport.pairs[0],
        ratio: 1,
        passes: false,
      };
      const emptied = structuredClone(record);
      emptied.result.contrastReport.pairs = [];
      const failing = structuredClone(record);
      failing.result.contrastReport.passes = false;
      for (const [name, edited] of Object.entries({ tampered, emptied, failing })) {
        assert.equal(
          recordCurrent(JSON.stringify(edited, null, 2), entry.text!),
          false,
          `${entry.id} ${name}`,
        );
      }
    }
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
    // What the repository's acceptance.json holds already, which a new acceptance keeps.
    const before = JSON.parse(
      fs.readFileSync(path.join(root, RECORDS, 'acceptance.json'), 'utf8'),
    ) as Record<string, unknown>;
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
      ...before,
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

test('catalog show names the reference record and whether it waits or was accepted, and catalog review writes a page per scheme, images first', () => {
  const show = (id: string) => generatedLines(REPO_ROOT, packPackages(REPO_ROOT), id).join('\n');
  const accepted = JSON.parse(
    fs.readFileSync(path.join(REPO_ROOT, RECORDS, 'acceptance.json'), 'utf8'),
  ) as Record<string, { acceptedBy: string; acceptedAt: string }>;
  for (const [id, file] of [
    ['portfolio-artwork', 'example-media/gallery/looking-1.png'],
    ['profile-image', 'example-media/anamika/portrait.png'],
  ] as const) {
    const lines = show(id);
    assert.match(lines, new RegExp(`Generator: ${id}, version 1 \\(image-palette@1, anchor-v2\\)`));
    assert.ok(lines.includes(file), id);
    // The committed record read 2 readings; what it shows beside the digest says so (LANG-5c r2b).
    assert.ok(
      lines.includes(
        `Committed record: its report read ${readingName(STRICTEST_READINGS.slice(0, 2))}; the acceptance pins those bytes`,
      ),
      id,
    );
    // Whichever the committed acceptance.json says: accepted, by whom and when, or waiting.
    const by = accepted[id];
    assert.ok(
      lines.includes(
        by
          ? `Review: accepted by ${by.acceptedBy} on ${by.acceptedAt}`
          : "Review: waits for the owner's acceptance",
      ),
      `${id}\n${lines}`,
    );
  }
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
