import test from 'node:test';
import assert from 'node:assert/strict';
import { pageOutline } from '@portfolio/kit/sections';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import {
  dateText,
  datedRecords,
  firstClause,
  firstSentence,
  homeModel,
  pack,
  recordState,
  signalsOf,
  type Span,
} from './model';
import { fixtureInput, inputFor, pairOf, sampleInput } from './__tests__/harness.test';

// The derivations, pure, on the sample and on fixtures built for them: no
// snapshot, no evidence, one work. Nothing here names a person; every word
// a lamp or a reading carries comes from a field.

const spans = (list: readonly number[]) =>
  pack(list.map((span, item) => ({ item, span: span as Span })));

test('packing: first fit within two ahead, the last panel of a row stretching, every row summing to 16', () => {
  const placed = spans([10, 16, 6, 8, 8, 6]);
  assert.deepEqual(
    placed.map(({ item, span }) => [item, span]),
    [
      [0, 10],
      [2, 6],
      [1, 16],
      [3, 8],
      [4, 8],
      [5, 16],
    ],
  );
  let row = 0;
  for (const { span } of placed) {
    row += span;
    assert.ok(row <= 16);
    if (row === 16) row = 0;
  }
  assert.equal(row, 0);
  // Nothing within reach fits: the row's last panel stretches.
  assert.deepEqual(
    spans([6, 16, 16, 16]).map(({ span }) => span),
    [16, 16, 16, 16],
  );
});

test('firstSentence and firstClause keep a statement whole up to its first stop', () => {
  assert.deepEqual(firstSentence('Small. Then more.'), { lead: 'Small.', rest: 'Then more.' });
  assert.deepEqual(firstSentence('Dr. Rao builds. Then more.').lead, 'Dr. Rao builds.');
  assert.equal(
    firstClause('Years engineering, from research code to production.'),
    'Years engineering',
  );
  assert.equal(firstClause('Services owned'), 'Services owned');
});

test('dates show as precisely as they were written, in UTC', () => {
  assert.equal(dateText('2022-01', 'en'), 'Jan 2022');
  assert.equal(dateText('2026-04-15', 'en'), 'Apr 15, 2026');
  assert.equal(dateText('2019', 'en'), '2019');
  assert.equal(dateText('soon', 'en'), undefined);
});

test('state words come only from fields that exist', () => {
  const input = sampleInput();
  const work = (id: string) => input.portfolio.works.find((item) => item.id === id)!;
  assert.deepEqual(
    recordState(work('postmortem-template-kit'), input).map(({ text }) => text),
    ['Active since Jan 2022', 'SREcon Practitioner Award'],
  );
  assert.deepEqual(
    recordState(work('chaos-curriculum'), input).map(({ text }) => text),
    ['Archived'],
  );
  const patent = input.portfolio.evidence.find(({ type }) => type === 'patent')!;
  assert.match(recordState(patent, input)[0]!.text, /^(Granted|Filed)/);
  const metric = input.portfolio.evidence.find(({ type }) => type === 'metric')!;
  assert.deepEqual(recordState(metric, input), []);
});

test('the sample: boards, readings and Latest', () => {
  const input = sampleInput();
  const model = homeModel(input);
  assert.deepEqual(
    model.boards.map(({ id }) => id),
    ['overview', 'work', 'writing', 'record', 'about', 'contact'],
  );
  assert.deepEqual(
    model.boards[0]!.sections.map(({ id }) => id),
    ['top', 'thesis'],
  );
  assert.deepEqual(
    signalsOf(input).map(({ key, lamp, text }) => [key, lamp, text]),
    [
      ['now', 'positive', 'Apr 15, 2026'],
      ['push', 'positive', model.signals[1]!.text],
    ],
  );
  const latest = datedRecords(input);
  assert.ok(latest.length > 3);
  for (let i = 1; i < latest.length; i++) assert.ok(latest[i - 1]!.date >= latest[i]!.date);
  assert.equal(model.latestShown, 3);
  assert.equal(model.readouts?.readouts.length, 4);
});

/** A small portfolio: one work, no evidence, no snapshot, no presence. */
function oneWork(): VariantRenderInput {
  return inputFor(
    pairOf({
      schemaVersion: 3,
      locale: 'en',
      direction: 'ltr',
      identity: { name: 'Sam Q' },
      works: [{ id: 'kiln', title: 'Kiln', medium: 'object', period: { start: '2024-03' } }],
      sections: [
        { kind: 'hero', id: 'top', tagline: 'Pots that pour well. And more.' },
        { kind: 'works', id: 'made', title: 'Made', items: ['kiln'] },
      ],
    }),
  );
}

test('one work and nothing else: no readings, no readouts, no Latest, the hero tagline as the lede', () => {
  const input = oneWork();
  const model = homeModel(input);
  assert.deepEqual(model.signals, []);
  assert.equal(model.readouts, undefined);
  assert.equal(model.latestShown, 0);
  assert.equal(model.lede, 'Pots that pour well.');
  assert.deepEqual(
    model.boards.map(({ id }) => id),
    ['overview', 'work'],
  );
  assert.deepEqual(
    recordState(input.portfolio.works[0]!, input).map(({ text }) => text),
    ['Active since Mar 2024'],
  );
});

test('every contract fixture plans without throwing, and the RTL one keeps its boards', () => {
  for (const name of ['sparse', 'identity-only', 'rtl', 'long-text']) {
    const input = fixtureInput(name);
    const model = homeModel(input, pageOutline(input));
    assert.ok(model.boards.length >= 1, name);
  }
});

test('the controls: latestCount 0 hides Latest, nowFreshForDays turns an old now to an outline lamp, overviewTail picks the tail', () => {
  const base = sampleInput();
  const none = homeModel({ ...base, controls: { ...base.controls, latestCount: 0 } });
  assert.equal(none.latestShown, 0);
  const eight = homeModel({ ...base, controls: { ...base.controls, latestCount: 8 } });
  assert.equal(eight.latestShown, Math.min(8, eight.latest.length));
  const stale = signalsOf({ ...base, env: { ...base.env, now: '2028-01-01T00:00:00.000Z' } });
  assert.equal(stale.find(({ key }) => key === 'now')?.lamp, 'neutral');
  const tail = homeModel({ ...base, controls: { ...base.controls, overviewTail: ['about'] } });
  assert.deepEqual(
    tail.boards[0]!.sections.map(({ id }) => id),
    ['top', 'thesis', 'about'],
  );
  // A tail naming a section another destination owns is ignored, never moved (K-1).
  const refused = homeModel({ ...base, controls: { ...base.controls, overviewTail: ['essays'] } });
  assert.deepEqual(
    refused.boards[0]!.sections.map(({ id }) => id),
    ['top', 'thesis'],
  );
  assert.ok(
    refused.boards.find(({ id }) => id === 'writing')!.sections.some(({ id }) => id === 'essays'),
  );
});

test('no evidence at all: no readouts, and Latest only from dated works', () => {
  const input = inputFor(
    pairOf({
      schemaVersion: 3,
      locale: 'en',
      direction: 'ltr',
      identity: { name: 'Ana Ruiz', tagline: 'Writer' },
      works: [
        { id: 'one', title: 'One', medium: 'writing', publishedAt: '2025-02-01' },
        { id: 'two', title: 'Two', medium: 'writing', publishedAt: '2025-06-01' },
      ],
      sections: [{ kind: 'works', id: 'essays', title: 'Essays', items: ['one', 'two'] }],
    }),
  );
  const model = homeModel(input);
  assert.equal(model.readouts, undefined);
  assert.deepEqual(
    model.latest.map(({ id, kind }) => [id, kind]),
    [
      ['two', 'Essay'],
      ['one', 'Essay'],
    ],
  );
  assert.deepEqual(
    model.boards.map(({ id }) => id),
    ['writing'],
  );
  // With no hero and no thesis, the identity's tagline is the lede, and no role line repeats it.
  assert.equal(model.lede, 'Writer');
  assert.equal(model.role, undefined);
});
