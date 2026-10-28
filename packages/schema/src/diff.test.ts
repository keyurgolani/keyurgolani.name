import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_EDITS, unifiedDiff } from './diff';

const names = { before: 'old.yml (old)', after: 'portfolio.yml (new)' };
const text = (...lines: string[]) => `${lines.join('\n')}\n`;

test('equal texts have an empty diff', () => {
  assert.equal(unifiedDiff('a\nb\n', 'a\nb\n', names), '');
});

test('a diff has three lines of context around each change, in hunks', () => {
  const before = text('1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12');
  const after = text('1', 'two', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13');
  assert.equal(
    unifiedDiff(before, after, names),
    text(
      '--- old.yml (old)',
      '+++ portfolio.yml (new)',
      '@@ -1,5 +1,5 @@',
      ' 1',
      '-2',
      '+two',
      ' 3',
      ' 4',
      ' 5',
      '@@ -10,3 +10,4 @@',
      ' 10',
      ' 11',
      ' 12',
      '+13',
    ),
  );
});

test('a diff from or to nothing counts its lines from zero', () => {
  assert.equal(
    unifiedDiff('', 'a\n', names),
    text('--- old.yml (old)', '+++ portfolio.yml (new)', '@@ -0,0 +1,1 @@', '+a'),
  );
});

test(`past ${MAX_EDITS} changed lines there's no diff, and the caller shows the text whole`, () => {
  const many = (prefix: string) =>
    text(...Array.from({ length: MAX_EDITS }, (_, index) => `${prefix}${index}`));
  assert.equal(unifiedDiff(many('a'), many('b'), names), null);
  // Under the limit, a long diff is still written.
  const half = (prefix: string) =>
    text(...Array.from({ length: MAX_EDITS / 4 }, (_, index) => `${prefix}${index}`));
  assert.match(unifiedDiff(half('a'), half('b'), names) ?? '', /^--- old\.yml/);
});
