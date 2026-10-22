import test from 'node:test';
import assert from 'node:assert/strict';
import { fitId, isLanguageTag, isSectionId, mintId, slugifyTitle, workPath } from './ids';
import { SectionIdSchema } from './kinds/common';

test('isSectionId agrees with SectionIdSchema', () => {
  const samples = ['top', 'get-in-touch', 'a1-b2', 'a'.repeat(64), 'a'.repeat(65)];
  samples.push('main', 'Main', 'a--b', '-a', 'a-', '', 'a_b', 'é');
  for (const id of samples) {
    assert.equal(isSectionId(id), SectionIdSchema.safeParse(id).success, id);
  }
});

test('isLanguageTag accepts what Intl.getCanonicalLocales accepts', () => {
  for (const tag of ['en', 'en-US', 'en-us', 'sr-Latn-RS', 'und']) {
    assert.ok(isLanguageTag(tag), tag);
  }
  for (const tag of ['', 'en_US', 'en,fr', 'x-private']) {
    assert.ok(!isLanguageTag(tag), tag);
  }
});

test('slugifyTitle keeps lowercase letters and digits, folds accents, and joins the rest with hyphens', () => {
  assert.equal(
    slugifyTitle('  Tidewater Atlas: A Field Guide!  '),
    'tidewater-atlas-a-field-guide',
  );
  assert.equal(slugifyTitle('Écoute à Paris'), 'ecoute-a-paris');
  assert.equal(slugifyTitle('Ｆｕｌｌｗｉｄｔｈ 2024'), 'fullwidth-2024');
  assert.equal(slugifyTitle('日本語'), '');
  assert.equal(slugifyTitle('---'), '');
});

test('mintId slugifies the title, takes the next free number, and never mints main', () => {
  assert.equal(mintId('work', 'Tidewater Atlas', []), 'tidewater-atlas');
  assert.equal(mintId('work', 'Tidewater Atlas', ['tidewater-atlas']), 'tidewater-atlas-2');
  assert.equal(
    mintId('work', 'Tidewater Atlas', ['tidewater-atlas', 'tidewater-atlas-2']),
    'tidewater-atlas-3',
  );
  assert.equal(mintId('section', 'Main', []), 'main-2');
  // Without a title an id can use: the kind, and its next free number.
  assert.equal(mintId('evidence', undefined, []), 'evidence-1');
  assert.equal(mintId('work', '日本語', ['work-1']), 'work-2');
  assert.equal(mintId('media', '  ', []), 'media-1');
  // The same input mints the same id, and the taken ids aren't changed.
  const taken = new Set(['atlas']);
  assert.equal(mintId('work', 'Atlas', taken), mintId('work', 'Atlas', taken));
  assert.deepEqual([...taken], ['atlas']);
  // Every id it mints is one the schema takes.
  for (const title of ['Atlas', 'A'.repeat(100), 'x '.repeat(50), undefined, 'main']) {
    assert.ok(isSectionId(mintId('chronology', title, ['main-2'])), String(title));
  }
});

test('fitId cuts at a hyphen to keep 64 characters with the suffix', () => {
  const long = 'a-very-long-title-that-keeps-going-well-past-the-sixty-four-character-limit';
  assert.equal(fitId(long, ''), 'a-very-long-title-that-keeps-going-well-past-the-sixty-four');
  assert.equal(fitId(long, '-2'), 'a-very-long-title-that-keeps-going-well-past-the-sixty-four-2');
  assert.ok(fitId(long, '-12').length <= 64);
  // One word too long for the room is cut where the room ends.
  assert.equal(fitId('a'.repeat(70), '-2'), `${'a'.repeat(62)}-2`);
  assert.equal(workPath('tidewater-atlas'), '/work/tidewater-atlas');
});
