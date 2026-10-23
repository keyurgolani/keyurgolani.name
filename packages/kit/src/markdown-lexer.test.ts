import test from 'node:test';
import assert from 'node:assert/strict';
import { Lexer, Marked, type MarkedOptions } from 'marked';
import { markdownOverLimit } from '@portfolio/schema';
import { renderMarkdown } from './markdown';
import { lexBlocks } from './markdown-lexer';

// The renderer's block lexer (markdown-lexer.ts): marked's own tokens, with
// each paragraph's inline text lexed once however deep its quotes.

const marked = () => new Marked({ async: false, breaks: false, gfm: true, pedantic: false });
const options = (): MarkedOptions => ({ ...marked().defaults });

/** Text from the pieces marked reads as structure, the same every run. */
function generated(count: number): string[] {
  const pieces = [
    '> ',
    '>',
    '- ',
    '* ',
    '1. ',
    '2) ',
    '  ',
    '    ',
    '\t',
    '```',
    '~~~',
    '# ',
    'a',
    'b c',
    '*d*',
    '_e',
    '`f`',
    '[g]',
    '[g]: /h',
    '|',
    '-|-',
    '<div>',
    '\n',
    '\n',
    '\n\n',
    '==',
    '***',
  ];
  let seed = 7;
  const next = () => {
    seed = (seed * 1103515245 + 12345) % 2 ** 31;
    return seed / 2 ** 31;
  };
  const texts: string[] = [];
  for (let i = 0; i < count; i++) {
    let text = '';
    for (let j = 1 + Math.floor(next() * 48); j > 0; j--) {
      text += pieces[Math.floor(next() * pieces.length)];
    }
    texts.push(text);
  }
  return texts;
}

const SAMPLES = [
  '>>>> x *a *a *a\nlazy',
  `>>>> ${'- '.repeat(8)}x *a\nlazy\nlazy`,
  '> - a\nb\n'.repeat(12),
  '> > a\nb\n> > c',
  '> - a\nb\n\n> - c',
  '>>> > # h\na|b\n2) >>a\n      a|b\n'.repeat(2),
  '> a\n```\ncode\n```\nafter',
  '- a\n\n  b\n- c\n\n      code\n',
  'a|b\n-|-\nc|d\n\n[x]: https://a.test "t"\n\n[x] and [y][x]',
  'Title\n===\n\n<div>\n*a*\n</div>\n\n- [ ] task\n- [x] done',
  'a\r\n> b\r\nc\r\n',
  ...generated(600),
];

test("the renderer's block lexer returns marked's own tokens", () => {
  for (const text of SAMPLES) {
    assert.deepEqual(lexBlocks(text, options()), Lexer.lex(text, options()), JSON.stringify(text));
  }
});

test("a lazy line under quotes has the renderer lex a paragraph's inline text once, where marked lexes it once for every quote", () => {
  /** How many pieces of inline text `lex` lexes. */
  const lexed = (lex: (text: string, options: MarkedOptions) => unknown, text: string) => {
    let pieces = 0;
    const counting = marked();
    counting.use({
      tokenizer: {
        inlineText() {
          pieces++;
          return false;
        },
      },
    });
    lex(text, { ...counting.defaults });
    return pieces;
  };
  const paragraph = 'x *a* and `b` and *c*\nlazy';
  const once = lexed(Lexer.lex, paragraph);
  assert.ok(once > 0);
  for (const depth of [1, 2, 4, 8]) {
    const quoted = `${'>'.repeat(depth)} ${paragraph}`;
    assert.equal(lexed(lexBlocks, quoted), once, `${depth} quotes`);
    // Each lexing before the last has the paragraph without its lazy line, a piece shorter.
    assert.equal(
      lexed(Lexer.lex, quoted),
      once + (depth - 1) * (once - 1),
      `marked, ${depth} quotes`,
    );
  }
});

test('renderMarkdown lexes a paragraph under four quotes and a lazy line in about the time it lexes the paragraph alone', () => {
  // 256 marks that never close, which marked would lex four times over.
  const paragraph = `x ${'*a '.repeat(256)}${'word '.repeat(700)}\nlazy`;
  const quoted = `>>>> ${paragraph}`;
  assert.equal(markdownOverLimit(quoted), null);
  assert.ok(renderMarkdown(quoted).startsWith('<blockquote>'));
  const times: number[] = [];
  const bases: number[] = [];
  renderMarkdown(quoted);
  renderMarkdown(paragraph);
  for (let i = 0; i < 7; i++) {
    let start = performance.now();
    renderMarkdown(paragraph);
    bases.push(performance.now() - start);
    start = performance.now();
    renderMarkdown(quoted);
    times.push(performance.now() - start);
  }
  const median = (list: number[]) => list.sort((a, b) => a - b)[3]!;
  const [time, base] = [median(times), median(bases)];
  assert.ok(time < 2 * base, `${time.toFixed(1)} ms quoted against ${base.toFixed(1)} ms alone`);
});
