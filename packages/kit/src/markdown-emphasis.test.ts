import test from 'node:test';
import assert from 'node:assert/strict';
import { Lexer, Marked, type Tokenizer } from 'marked';
import { emStrong } from './markdown-emphasis';

// markdown-emphasis.ts against marked's own emStrong: the same tokens for
// every text, so the renderer's output doesn't change by a byte.

const OPTIONS = { async: false, breaks: false, gfm: true, pedantic: false } as const;
const theirs = new Marked(OPTIONS);
const ours = new Marked(OPTIONS);
let handedBack = 0;
ours.use({
  tokenizer: {
    emStrong(src, maskedSrc, prevChar) {
      const token = emStrong.call(this, src, maskedSrc, prevChar);
      if (token === false) handedBack++;
      return token;
    },
  },
});

/** A seeded generator (mulberry32), so every run checks the same texts. */
function seeded(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Pieces the texts are made of: delimiter runs, the classes of character
 * either side of one (space, punctuation, symbol, letter, CJK, an astral
 * symbol, a lone surrogate), escapes, including of an astral symbol, which
 * masking shortens, and the links, code, and tags masking hides.
 */
const PIECES = [
  ...['*', '**', '***', '****', '_', '__', '___', '*_', '_*', '*a*', '_a_', '**a**', '__a__'],
  ...[' ', '  ', '\n', '\n\n', '\t', '　', 'a', 'word', 'x_y', 'a*b', '日本', '語'],
  ...['.', ',', '!', '?', '(', ')', '"', "'", '~', '~~', '-', '+', '=', '|', '$', '¡', '«', '»'],
  ...['😀', '\ud800', '\udc00', 'é', '\\', '\\*', '\\_', '\\😀', '&amp;'],
  ...['`', '``', '`a*`', '[a](b)', '[a*](b*)', '[', ']', '<a>', '<b*>', '#', '>', '- '],
];
const DELIMITERS = 13;

function texts(): string[] {
  const random = seeded(10);
  const pick = (count: number) => PIECES[Math.floor(random() * count)]!;
  const out: string[] = [];
  for (let i = 0; i < 4000; i++) {
    let text = '';
    for (let j = 1 + Math.floor(random() * 30); j > 0; j--) text += pick(PIECES.length);
    out.push(text);
  }
  // Longer texts dense with delimiters, whose searches walk many runs.
  for (let i = 0; i < 150; i++) {
    let text = '';
    for (let j = 50 + Math.floor(random() * 300); j > 0; j--) {
      text += pick(random() < 0.5 ? DELIMITERS : PIECES.length);
    }
    out.push(text);
  }
  return out;
}

/** The cases each rule of the search turns on, written out. */
const CASES = [
  // The expression's first alternative, which skips a lone delimiter between pairs of the other.
  ['*__a*b__', '_**a_b**', '*a __b*c__ d*', '*__*__', '_**_**_', '*x__y*z__*', '**__a*b__**'],
  // Openers and closers of each length, and marked's rule of three.
  ['*a**b*', '***a**b*', '**a*b**', '*a***', '***a*', '*a* *b**', '****a**', '_a__b_'],
  // The character either side: space, punctuation, letters, CJK, and surrogates.
  ['😀*a*😀', '*a😀*', '*😀*', '\ud800*a*', '*a\udc00*', '日本*語*の', '*日本*語', '_日本_語'],
  // Masking: escapes, an escaped astral symbol that shortens the masked text, links, and code.
  ['\\😀*a*', '\\😀\\😀 *a* b*', '\\😀*😀*a*', '*[a*](b)*', '*`a*`*', '*<b*>*', '\\**a*'],
  // Two escaped astral symbols after an opener start its search two code
  // units early, inside the surrogate pair before it.
  ['😀*a\\😀*\\😀', '😀*a\\😀 \\😀', '😀**a\\😀\\😀**', '😀_a\\😀\\😀_'],
  // Intraword underscores and openers that never close.
  ['a_b_c', '_a_b', 'x _a_b_ y', '*a *a *a *a', '_a _a _a', `x ${'*a '.repeat(64)}`],
].flat();

test("the emphasis tokenizer gives marked's own tokens for every text, inline and in blocks, without handing a text back", () => {
  const all = [...CASES, ...texts()];
  let ems = 0;
  for (const text of all) {
    const inline = ours.Lexer.lexInline(text, { ...ours.defaults });
    assert.deepEqual(inline, theirs.Lexer.lexInline(text, { ...theirs.defaults }), text);
    assert.deepEqual(
      ours.Lexer.lex(text, { ...ours.defaults }),
      theirs.Lexer.lex(text, { ...theirs.defaults }),
      text,
    );
    if (inline.some(({ type }) => type === 'em' || type === 'strong')) ems++;
  }
  assert.ok(ems > 1000, `${ems} of ${all.length} texts have emphasis`);
  assert.equal(handedBack, 0, 'marked 15 is the shape the search reads');
});

test("a closer expression of another shape leaves the text to marked's own tokenizer", () => {
  const { inline, other } = Lexer.rules as unknown as Tokenizer['rules'] & {
    inline: { gfm: Tokenizer['rules']['inline'] };
  };
  const rules = { other, block: {}, inline: { ...inline.gfm, emStrongRDelimAst: /\*+/gu } };
  const tokenizer = { rules, lexer: new Lexer({ ...OPTIONS }) } as unknown as Tokenizer;
  assert.equal(emStrong.call(tokenizer, '*a*', '*a*', ''), false);
});
