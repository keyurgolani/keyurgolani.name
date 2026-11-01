import test from 'node:test';
import assert from 'node:assert/strict';
import { fragmentId } from './client/reveal';
import { firstParagraph, pairHalves, readWidth, roomName } from './layout';

// How a gallery's blocks share its columns, and how a room is named in the
// switch: worked out in the model, so the stylesheet counts no siblings.

test('halves pair in reading order, and one with no half beside it reads across', () => {
  assert.deepEqual(pairHalves([false, false, false]), ['half', 'half', 'wide']);
  assert.deepEqual(pairHalves([false, true, false, false]), ['wide', 'wide', 'half', 'half']);
  assert.deepEqual(pairHalves([true, false, false, true, false]), [
    'wide',
    'half',
    'half',
    'wide',
    'wide',
  ]);
  assert.deepEqual(pairHalves([]), []);
});

test('a room is named by its title, or its first words that fit, cut at a word and never mid-word', () => {
  assert.equal(roomName('small-traces', 14), 'small-traces');
  assert.equal(roomName('Postmortem Template Kit', 14), 'Postmortem');
  assert.equal(roomName('The Quiet Cost of Legible Systems', 14), 'The Quiet Cost');
  // No small word left dangling at the end.
  assert.equal(roomName('Notes on the Craft of Maps', 13), 'Notes');
  // No punctuation left at the cut.
  assert.equal(roomName('Postmortem, Template, Kit', 14), 'Postmortem');
  // When not even the first word fits, the room is its numeral alone.
  assert.equal(roomName('Incomprehensibilities', 8), '');
  // A title in Japanese, with no spaces, cuts at its own word breaks, counted in characters.
  const japanese = '観測可能性の静かなコストについて';
  const cut = roomName(japanese, 8, 'ja');
  assert.ok(cut.length > 0 && cut.length <= 8 && japanese.startsWith(cut), cut);
  // A long hyphenated run cuts at a hyphen, and keeps none at its end.
  const run = roomName('state-of-the-art-observability-platform', 14);
  assert.ok(run.length > 0 && run.length <= 14 && !/[-\s]$/.test(run), run);
  assert.ok('state-of-the-art-observability-platform'.startsWith(run));
  // Graphemes, not code units: six characters fit six, however many code units they take.
  assert.equal(roomName('Café 🗺️', 6), 'Café 🗺️');
  // A symbol standing as its own word is kept whole, as a word is.
  assert.equal(roomName('Maps 🗺️ of the river', 7), 'Maps 🗺️');
  // What's attached to a word stays with it: no cut inside C++, A.I., or a quoted title.
  assert.equal(roomName('C++ for the Curious', 10), 'C++');
  assert.equal(roomName('A.I. Field Notes', 10), 'A.I. Field');
  assert.equal(roomName('A.I. and the Archive', 8), 'A.I.');
  assert.equal(roomName('“Cattle, Not Pets” Revisited', 20), '“Cattle, Not Pets”');
  assert.equal(roomName('Notes on “Legible Systems”', 18), 'Notes');
  // A wide East Asian character counts as two: eight columns hold four of them.
  assert.equal(readWidth('観測可能性'), 10);
  assert.ok(readWidth(roomName('観測可能性の静かなコストについて', 8, 'ja')) <= 8);
  for (const name of [roomName('A Brief History of the Phrase', 10)]) {
    assert.ok(!name.includes('…'));
    assert.ok('A Brief History of the Phrase'.startsWith(name));
  }
});

test("a fragment's id is decoded, and one that isn't valid percent-encoding names nothing", () => {
  assert.equal(fragmentId('#oa--awards'), 'oa--awards');
  assert.equal(fragmentId('#caf%C3%A9'), 'café');
  assert.equal(fragmentId('#100%'), null);
  assert.equal(fragmentId('#%E0%A4%A'), null);
  assert.equal(fragmentId('#'), null);
  assert.equal(fragmentId(''), null);
});

test("Practice's words split at their first paragraph, the wall label and its fold", () => {
  assert.deepEqual(firstParagraph('One.'), { first: 'One.', rest: undefined });
  assert.deepEqual(firstParagraph('One.\n\nTwo.\n\nThree.'), {
    first: 'One.',
    rest: 'Two.\n\nThree.',
  });
  assert.deepEqual(firstParagraph('  One,\nstill one.\n \nTwo.  '), {
    first: 'One,\nstill one.',
    rest: 'Two.',
  });
});
