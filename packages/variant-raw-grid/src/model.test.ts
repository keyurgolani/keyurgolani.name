import test from 'node:test';
import assert from 'node:assert/strict';
import { checkDestinationOverrides, navigationModel, pageOutline } from '@portfolio/kit/sections';
import { inputFor, pairOf, sampleInput } from './__tests__/harness.test';
import {
  caseRows,
  caseStickers,
  caseTicker,
  factText,
  firstSentence,
  homeModel,
  nameLines,
  nextWork,
  otherMedia,
  plainWords,
  pinnedWork,
  rowsOf,
  titleChars,
  longestToken,
  keepTail,
  thesisParts,
  tickerFacts,
} from './model';

// The derivations, pure, on the sample and on the shapes N4 names: one
// artifact, no proof, no thesis, no chronology, no media, a long name, a
// non-Latin name, and right to left. No person's words are in the model.

const base = { schemaVersion: 3, locale: 'en', direction: 'ltr' } as const;

test('the first sentence: never after an abbreviation or an initial, nor inside a link or code', () => {
  assert.deepEqual(firstSentence('I make failure legible. The rest follows.'), {
    lead: 'I make failure legible.',
    rest: 'The rest follows.',
  });
  assert.equal(
    firstSentence('Dr. Lee keeps the record. Then reads it.').lead,
    'Dr. Lee keeps the record.',
  );
  assert.equal(
    firstSentence('Write it, e.g. in a log. Then read it.').lead,
    'Write it, e.g. in a log.',
  );
  assert.equal(
    firstSentence('See [U.S. Digital Service](https://x.test/u.s). Then go.').lead,
    'See [U.S. Digital Service](https://x.test/u.s).',
  );
  assert.equal(firstSentence('Run `make. All` first. Then ship.').lead, 'Run `make. All` first.');
  assert.deepEqual(firstSentence('One sentence only'), { lead: 'One sentence only' });
});

test('the thesis: a short first sentence is the headline, a long one makes the whole a paragraph', () => {
  assert.deepEqual(thesisParts('I make failure legible. The rest.'), {
    lead: 'I make failure legible.',
    rest: 'The rest.',
  });
  const long =
    'Every system I have built in the last decade tries to show what happened. The rest.';
  assert.deepEqual(thesisParts(long), { rest: long });
  assert.equal(thesisParts(undefined), undefined);
  assert.equal(thesisParts('  '), undefined);
});

test('the name: at most three lines, the longest sets the fit, in characters (non-Latin too)', () => {
  assert.deepEqual(nameLines('Anamika Devi'), { lines: ['Anamika', 'Devi'], longest: 7 });
  assert.deepEqual(nameLines('Maria de los Ángeles Ortega'), {
    lines: ['Maria', 'de los Ángeles', 'Ortega'],
    longest: 14,
  });
  assert.deepEqual(nameLines('ليلى حداد'), { lines: ['ليلى', 'حداد'], longest: 4 });
  assert.deepEqual(nameLines('Prince'), { lines: ['Prince'], longest: 6 });
});

test('a fact reads figure, unit, and the first clause, in the record’s own words', () => {
  const metric = (statement: string, value: number, unit?: string) =>
    ({ id: 'm', type: 'metric', statement, metric: { value, ...(unit ? { unit } : {}) } }) as never;
  assert.equal(
    factText(metric('Years engineering, from research code to production.', 12, 'years'), 'en'),
    '12 years engineering',
  );
  assert.equal(factText(metric('Services owned', 38), 'en'), '38 services owned');
  assert.equal(factText(metric('Years in practice', 9, 'years'), 'en'), '9 years in practice');
  assert.equal(
    factText({ id: 'a', type: 'award', title: 'Best paper', receivedAt: '2016-05' } as never, 'en'),
    'Best paper, 2016',
  );
});

test('the sample: its ticker, its pinned work, its sheets', () => {
  const input = sampleInput();
  assert.deepEqual(
    tickerFacts(input).map(({ text }) => text),
    [
      '12 years engineering',
      '38 services owned',
      'SREcon Practitioner Award, 2025',
      '47 essays published',
      '3 books in progress',
    ],
  );
  assert.equal(pinnedWork(input)?.id, 'postmortem-template-kit');
  const model = homeModel(input);
  assert.deepEqual(
    model.sheets.map(({ id }) => id),
    ['work', 'writing', 'record', 'about'],
  );
  // The opening's sections render there, and the closing's in the foot.
  const placed = model.sheets.flatMap(({ rows }) => rows.flat().map(({ id }) => id));
  for (const id of ['top', 'thesis', 'contact', 'want-to-work-together'])
    assert.ok(!placed.includes(id), id);
  // The thesis still lists under About.
  assert.ok(model.sheets.find(({ id }) => id === 'about')!.toc.some(({ id }) => id === 'thesis'));
});

test('pairing: equal compact neighbours share a row, a Now beside a focus list, nothing else', () => {
  const input = sampleInput();
  const record = homeModel(input).sheets.find(({ id }) => id === 'record')!;
  const pairs = record.rows.filter((row) => row.length === 2).map((row) => row.map(({ id }) => id));
  assert.deepEqual(pairs, [['press', 'elsewhere']]);
  const about = homeModel(input).sheets.find(({ id }) => id === 'about')!;
  assert.ok(
    about.rows.some((row) => row.map(({ id }) => id).join() === 'now,currently-focused-on'),
  );
  assert.deepEqual(rowsOf([], input), []);
});

test('one artifact, no proof, no thesis, no chronology, no media: the opening closes up and nothing breaks', () => {
  const input = inputFor(
    pairOf({
      ...base,
      identity: { name: 'Kai Bell' },
      works: [{ id: 'w', title: 'The one thing', medium: 'object' }],
      sections: [
        { kind: 'hero', id: 'top', tagline: 'Makes one thing.' },
        { kind: 'works', id: 'work', title: 'Work', items: ['w'] },
      ],
    }),
  );
  const model = homeModel(input);
  assert.equal(model.thesis, undefined);
  assert.deepEqual(model.stickers, []);
  assert.deepEqual(model.ticker, []);
  assert.equal(model.pinned?.id, 'w');
  assert.deepEqual(
    model.sheets.map(({ id }) => id),
    ['work'],
  );
});

test('a section no destination takes closes About, so nothing drops', () => {
  const input = inputFor(
    pairOf({
      ...base,
      identity: { name: 'Kai Bell' },
      sections: [
        { kind: 'lede', id: 'intro', body: 'An untitled lede.' },
        { kind: 'custom', id: 'odd', title: 'Odd things', body: 'Some.' },
      ],
    }),
  );
  const model = homeModel(input);
  assert.deepEqual(
    model.sheets.map(({ id, rows }) => [id, rows.flat().map(({ id: s }) => s)]),
    [['about', ['intro', 'odd']]],
  );
});

test('the composition declares no destination overrides: the canonical map holds (N7)', () => {
  const input = sampleInput();
  const outline = pageOutline(input);
  assert.deepEqual(checkDestinationOverrides({}, [outline]), []);
  // Every section sits on the sheet the kit's canonical map places it on...
  const { placed } = navigationModel(outline);
  const model = homeModel(input);
  for (const sheet of model.sheets)
    for (const section of sheet.rows.flat())
      assert.equal(placed.get(section.id) ?? 'about', sheet.id, section.id);
  // ...the N7 defaults among them.
  const sheetOf = (id: string) =>
    model.sheets.find((sheet) => sheet.rows.flat().some((section) => section.id === id))?.id;
  assert.deepEqual(
    ['publications', 'incident-history', 'on-github', 'skills', 'essays'].map(sheetOf),
    ['record', 'work', 'record', 'about', 'writing'],
  );
});

test('a stale tickerItems control, none of it on the page, falls back to the default facts', () => {
  const doc = {
    ...base,
    identity: { name: 'Kai Bell' },
    evidence: [
      { id: 'm1', type: 'metric', statement: 'Things made', metric: { value: 3 } },
      { id: 'm2', type: 'metric', statement: 'Things kept', metric: { value: 4 } },
    ],
    sections: [{ kind: 'evidence', id: 'facts', title: 'Facts', items: ['m1', 'm2'] }],
  };
  const ids = (controls?: Record<string, unknown>) =>
    tickerFacts(inputFor(pairOf(doc, controls))).map(({ id }) => id);
  assert.deepEqual(ids(), ['m1', 'm2']);
  assert.deepEqual(ids({ tickerItems: ['m2', 'm1'] }), ['m2', 'm1']);
  assert.deepEqual(ids({ tickerItems: ['gone', 'also-gone'] }), ['m1', 'm2']);
});

test('the case rows: short texts two to a row, everything else the width', () => {
  assert.deepEqual(
    caseRows(
      ['challenge', 'context', 'role', 'decisions', 'evidence', 'outcomes', 'reflection'],
      true,
    ),
    [['challenge', 'context'], ['role'], ['decisions'], ['evidence'], ['outcomes'], ['reflection']],
  );
  // Evidence citing nothing is a text like the others.
  assert.deepEqual(caseRows(['evidence', 'outcomes'], false), [['evidence', 'outcomes']]);
  assert.deepEqual(caseRows(['reflection'], false), [['reflection']]);
  assert.deepEqual(caseRows(['decisions', 'reflection'], false), [['decisions'], ['reflection']]);
});

test('the case: its stickers from what it cites, its ticker from its highlights, the next work round the order', () => {
  const doc = {
    ...base,
    identity: { name: 'Kai Bell' },
    evidence: [
      { id: 'prize', type: 'award', title: 'A prize', receivedAt: '2024' },
      { id: 'kind', type: 'testimonial', statement: 'Kind words.', source: { name: 'Ana' } },
      { id: 'write', type: 'press', title: 'A piece', publication: 'A paper' },
    ],
    works: [
      {
        id: 'one',
        slug: 'one',
        title: 'One',
        medium: 'system',
        evidence: ['kind', 'prize', 'write', 'gone'],
        highlights: ['Fast', 'Small'],
        caseStudy: { challenge: 'Hard.' },
      },
      { id: 'essay', title: 'Essay', medium: 'writing' },
      { id: 'two', title: 'Two', medium: 'object', highlights: ['Only one'] },
    ],
    sections: [{ kind: 'works', id: 'work', title: 'Work', items: ['two', 'one', 'essay'] }],
  };
  const input = inputFor(pairOf(doc));
  const [one, essay, two] = input.portfolio.works;
  assert.deepEqual(
    caseStickers(one!, input).map(({ id, tone, line, sub }) => ({ id, tone, line, sub })),
    [
      { id: 'prize', tone: 'emphasis', line: 'A prize', sub: '2024' },
      { id: 'write', tone: 'plain', line: 'Written up in', sub: 'A paper' },
    ],
  );
  assert.deepEqual(
    caseTicker(one!, input).map(({ text }) => text),
    ['Fast', 'Small'],
  );
  assert.deepEqual(caseTicker(two!, input), []);
  assert.deepEqual(caseTicker(one!, inputFor(pairOf(doc, { ticker: false }))), []);
  // Round the order, writing left out: after One comes Two, at the start.
  assert.equal(nextWork(one!, input)?.id, 'two');
  assert.equal(nextWork(two!, input)?.id, 'one');
  assert.equal(nextWork(essay!, input)?.id, 'two');
});

test('the case title fits by its longest word, or a third of a long title', () => {
  assert.equal(titleChars('Postmortem Template Kit'), 10);
  assert.equal(titleChars('Atlas'), 5);
  // A card's title by the piece a browser keeps whole: after a hyphen, with its punctuation.
  assert.equal(longestToken('postmortem-template-kit'), 11);
  assert.equal(longestToken('Workshop — Postmortems as Editing'), 11);
  assert.equal(longestToken(keepTail('Field Recordings, vol. 1')), 11);
  assert.equal(keepTail('Field Recordings, vol. 1'), 'Field Recordings, vol.\u00a01');
  assert.equal(keepTail('Reliability review'), 'Reliability review');
  assert.equal(titleChars('How to Write a Postmortem That Doesn’t Make Things Worse'), 19);
  // A Japanese title of 31 characters fits as about three lines, not as one 31-character word.
  assert.equal(titleChars('障害報告書のためのテンプレート集と質問のための小さな道具箱です'), 11);
});

test('an audio-first work with no cover keeps its first media; one whose first became the cover drops it', () => {
  const audio = { asset: 'track' };
  const image = { asset: 'still' };
  // No cover, and the first media is audio, so no cover was taken from it: both stay.
  assert.deepEqual(otherMedia({ media: [audio, image] }, false), [audio, image]);
  // No cover, and the first media is an image that became the cover: it goes from the rest.
  assert.deepEqual(otherMedia({ media: [image, audio] }, true), [audio]);
  // A cover of its own: every media stays.
  assert.deepEqual(otherMedia({ cover: image, media: [audio] }, true), [audio]);
});

test('a summary as plain words keeps a link’s text, never the link', () => {
  assert.equal(plainWords('A *small* [tracing](https://x.test) `lib`.'), 'A small tracing lib.');
});
