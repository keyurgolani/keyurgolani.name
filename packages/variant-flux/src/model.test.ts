import test from 'node:test';
import assert from 'node:assert/strict';
import { checkGrouping, pageOutline } from '@portfolio/kit/sections';
import {
  controlsOf,
  currentFirst,
  folds,
  headlineText,
  openingOf,
  plateOf,
  proofLine,
  sheetGrouping,
  sheetsOf,
  terminatorFor,
  wordEms,
} from './model';
import { FIELD, placement, poseBox } from './field/spec';
import { inputFor, pairOf, renderInput, sampleInput } from './__tests__/harness.test';

// Flux's derivations, on the sample and on portfolios written here (N4): one
// artifact, no proof, no thesis, a long name, a name in Devanagari, a name
// in Japanese and a right-to-left page. Nothing here names a sample record
// outside the sample's own assertions.

const base = (extra: Record<string, unknown> = {}) => ({
  schemaVersion: 3,
  locale: 'en',
  direction: 'ltr',
  identity: { name: 'Rowan Vale', tagline: 'Letterpress and small tools.' },
  sections: [{ kind: 'hero', id: 'top', greeting: 'Hello, I am', tagline: 'I set type by hand.' }],
  ...extra,
});

const caseHref = (work: { slug: string }) => `/work/${work.slug}`;

test('the sample: the greeting line, then the thesis key phrase, as one string', () => {
  const opening = openingOf(sampleInput());
  assert.equal(opening.key.source, 'thesis');
  assert.equal(headlineText(opening), "Hello, I'm Anamika Devi. I make failure legible.");
  assert.ok(opening.positioning?.startsWith('I build calm software'));
  assert.equal(opening.cta?.label, 'Get in touch');
});

test('the stop the greeting line takes follows the language, and none after a sentence end', () => {
  assert.equal(terminatorFor('Rowan Vale', 'en'), '.');
  assert.equal(terminatorFor('अनामिका देवी', 'hi-IN'), '।');
  assert.equal(terminatorFor('山田花子', 'ja'), '。');
  assert.equal(terminatorFor('Dr. Who?', 'en'), '');
});

test('no thesis: the hero tagline is the key phrase, and the positioning line is the subtagline', () => {
  const input = inputFor(
    pairOf(
      base({
        sections: [
          {
            kind: 'hero',
            id: 'top',
            greeting: 'Hi',
            tagline: 'I set type.',
            subtagline: 'In a shed.',
          },
        ],
      }),
    ),
  );
  const opening = openingOf(input);
  assert.equal(opening.key.source, 'hero');
  assert.equal(opening.key.text, 'I set type.');
  assert.equal(opening.positioning, 'In a shed.');
  assert.equal(headlineText(opening), 'Hi Rowan Vale. I set type.');
});

test('a long name and a right-to-left page keep the h1 one string', () => {
  const long = 'Maximiliana Konstantinopoulou-Abernathy';
  const input = inputFor(
    pairOf(base({ direction: 'rtl', identity: { name: long, tagline: 'Tools.' } })),
  );
  assert.equal(headlineText(openingOf(input)), `Hello, I am ${long}. I set type by hand.`);
});

test('proof: at most three items, never lower-cased, none without proof', () => {
  const items = proofLine(sampleInput());
  assert.ok(items.length > 0 && items.length <= 3);
  for (const item of items) assert.match(item.words, /^\p{Lu}/u);
  assert.deepEqual(proofLine(inputFor(pairOf(base()))), []);
});

test('the plate: the signature work, or none; one artifact still makes a plate', () => {
  assert.equal(plateOf(sampleInput(), caseHref)?.work.title, 'Postmortem Template Kit');
  assert.equal(plateOf(inputFor(pairOf(base())), caseHref), undefined);
  const one = inputFor(
    pairOf(
      base({
        signature: 'press',
        works: [{ id: 'press', title: 'The Press', medium: 'object', summary: 'A press.' }],
        sections: [
          { kind: 'hero', id: 'top', tagline: 'I print.' },
          { kind: 'works', id: 'made', title: 'Made', items: ['press'] },
        ],
      }),
    ),
  );
  const plate = plateOf(one, caseHref);
  assert.equal(plate?.work.id, 'press');
  assert.equal(plate?.media, undefined);
});

test('controls: blobs defaults to 3, and an invalid value renders the default', () => {
  assert.equal(controlsOf({ controls: {} }).blobs, '3');
  assert.equal(controlsOf({ controls: { blobs: 'off' } }).blobs, 'off');
  assert.equal(controlsOf({ controls: { blobs: 'lots' } }).blobs, '3');
  assert.equal(controlsOf({ controls: {} }).wipe, true);
  assert.equal(controlsOf({ controls: { wipe: false } }).wipe, false);
  assert.equal(controlsOf({ controls: { wipe: 'no' } }).wipe, true);
});

test('sheets: the five destinations in their fixed order, inks in turn, tabs stepping 0 to 1', () => {
  const input = sampleInput();
  const sheets = sheetsOf(input, pageOutline(input));
  const ids = sheets.map((sheet) => sheet.id);
  assert.deepEqual(
    ids.filter((id) => id !== 'more'),
    ['work', 'writing', 'record', 'about', 'contact'],
  );
  assert.deepEqual(
    sheets.slice(0, 3).map((sheet) => sheet.ink),
    ['a', 'b', 'c'],
  );
  // The opening's hero and thesis sit on no sheet.
  for (const sheet of sheets)
    for (const section of sheet.sections) assert.notEqual(section.id, 'top');
});

test("a tab word's width in em: a little over the planned and default faces', an em per CJK character", () => {
  // Inter sets "Get in touch" at 5.56 em and Trebuchet MS at 5.4; "Work" at 2.45 and 2.4.
  assert.equal(wordEms('Get in touch'), 5.98);
  assert.ok(wordEms('Work') > 2.45 && wordEms('Work') < 2.7);
  // Narrow letters count for less than the old flat 0.62 em a character, wide ones for more.
  assert.ok(wordEms('little') < 6 * 0.62);
  assert.ok(wordEms('MMMM') > 4 * 0.62);
  assert.equal(wordEms('お問い合わせ'), 6.36);
  assert.equal(wordEms(''), 0);
});

test('every sheet with a word carries its width in em, for its tab to size it', () => {
  const input = sampleInput();
  const html = renderInput(input);
  const worded = sheetsOf(input, pageOutline(input)).filter((sheet) => sheet.word);
  assert.ok(worded.length >= 5);
  for (const sheet of worded)
    assert.match(
      html,
      new RegExp(`data-sheet="${sheet.id}"[^>]*--layout-fx-ems:${wordEms(sheet.word!)}[;"]`),
      sheet.id,
    );
});

test('Experience keeps its current roles open and folds the earlier ones; short or role-less runs stay whole', () => {
  const role = (start: string, end?: string) => ({
    kind: 'role' as const,
    period: end ? { start, end } : { start },
  });
  const now = role('2023');
  const was = [role('2019', '2023'), role('2015', '2019')];
  assert.deepEqual(currentFirst([now, ...was]), { shown: [now], earlier: was });
  // No current role: the latest stays open.
  assert.deepEqual(currentFirst(was.concat(role('2010', '2015'))).shown, [was[0]]);
  // Two entries, or no role among them: nothing folds.
  assert.deepEqual(currentFirst([now, was[0]!]).earlier, []);
  const school = { kind: 'study' as const, period: { start: '2010', end: '2014' } };
  assert.deepEqual(currentFirst([school, school, school]).earlier, []);
});

test('folds: the record keeps its summary open and folds the rest (the home outline)', () => {
  const input = sampleInput();
  const byId = new Map(input.portfolio.sections.map((section) => [section.id, section]));
  assert.equal(folds(byId.get('at-a-glance')!, input), false);
  assert.equal(folds(byId.get('words-from-collaborators')!, input), false);
  assert.equal(folds(byId.get('experience')!, input), false);
  for (const id of ['education', 'publications', 'talks', 'patents', 'on-github', 'skills'])
    assert.equal(folds(byId.get(id)!, input), true, id);
});

test('the field: every pose has room for its blur, and no small circle vanishes in the goo', () => {
  for (const mode of ['w', 'm', 't', 'p'] as const) {
    for (const ink of ['a', 'b'] as const) {
      const pose = FIELD[mode][ink];
      const box = poseBox(pose);
      assert.ok(box.maxX > box.minX && box.maxY > box.minY);
      assert.ok(placement(pose).width > 0);
      for (const [, , r] of [...pose.frame, ...pose.lobe])
        assert.ok(r >= 2.2, `${mode}.${ink} r ${r}`);
    }
  }
});

test('the sheet grouping declares no mistake, on the sample and on one artifact (K-1)', () => {
  const one = inputFor(
    pairOf(
      base({
        works: [{ id: 'w', title: 'One thing', medium: 'software' }],
        sections: [
          { kind: 'hero', id: 'top', tagline: 'I make one thing.' },
          { kind: 'works', id: 'work', title: 'Work', items: ['w'] },
        ],
      }),
    ),
  );
  assert.deepEqual(
    sheetsOf(one, pageOutline(one)).map((sheet) => sheet.id),
    ['work'],
  );
  for (const each of [sampleInput(), one])
    assert.deepEqual(checkGrouping({ grouping: sheetGrouping(each) }, [pageOutline(each)]), []);
});
