import test from 'node:test';
import assert from 'node:assert/strict';
import { changeIn, countsIn, numberOf } from './figures';

// The figures a case study's words hold: read from the owner's prose, never invented.

test('numbers read from digits and English words', () => {
  assert.equal(numberOf('thirty-eight'), 38);
  assert.equal(numberOf('fourteen'), 14);
  assert.equal(numberOf('3,481'), 3481);
  assert.equal(numberOf('ninety'), 90);
  assert.equal(numberOf('roughly'), undefined);
});

test("a context's counts come from its own sentence, and a sentence with none has none", () => {
  assert.deepEqual(
    countsIn(
      'A real-time payments platform of thirty-eight services, three platform teams, and a meeting.',
    ),
    [
      { count: 38, of: 'services' },
      { count: 3, of: 'platform teams' },
    ],
  );
  assert.deepEqual(countsIn('A small team and a long week.'), []);
  assert.deepEqual(countsIn(undefined), []);
});

test('a count stops at its noun, and a span of time or a decimal is no count of things', () => {
  assert.deepEqual(countsIn('A team of thirty-eight engineers was formed.'), [
    { count: 38, of: 'engineers' },
  ]);
  assert.deepEqual(countsIn('It took two years.'), []);
  assert.deepEqual(countsIn('Requests waited 1.5 seconds, then 3 minutes.'), []);
  assert.deepEqual(countsIn('Over 12 weeks, 40 services moved.'), [{ count: 40, of: 'services' }]);
  assert.deepEqual(countsIn('In 2021 forty services moved.'), [{ count: 40, of: 'services' }]);
  assert.deepEqual(countsIn('In 2021, engineers moved forty services.'), [
    { count: 40, of: 'services' },
  ]);
});

test('each side of a change keeps its own unit, and units that do not convert draw nothing', () => {
  assert.deepEqual(changeIn('Detection fell from 14 minutes to 3 seconds.'), {
    measure: 'Detection',
    from: 14,
    to: 3,
    unit: 'minutes',
    toUnit: 'seconds',
    toAsFrom: 0.05,
  });
  assert.equal(changeIn('Cost fell from 40 dollars to 3 engineers.'), undefined);
  assert.deepEqual(changeIn('Latency fell from 2 seconds to 300 ms.'), {
    measure: 'Latency',
    from: 2,
    to: 300,
    unit: 'seconds',
    toUnit: 'ms',
    toAsFrom: 0.3,
  });
});

test('a change reads its measure, both numbers, and its unit, and a vague one reads as none', () => {
  assert.deepEqual(
    changeIn(
      'Mean time to detect fell from fourteen minutes to three after the reviews rebuilt it. More.',
    ),
    { measure: 'Mean time to detect', from: 14, to: 3, unit: 'minutes' },
  );
  assert.equal(
    changeIn(
      'Review attendance went from roughly half the invited engineers to nearly all of them.',
    ),
    undefined,
  );
  assert.deepEqual(changeIn('Builds went from 40 to 12 minutes.'), {
    measure: 'Builds',
    from: 40,
    to: 12,
    unit: 'minutes',
  });
});
