import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeCssEscapes, scanCss, stripCssComments } from './css-text';

// The one reading of CSS text the audits and the compiler share (K-5 round 3).

test('comments blank to spaces, lines kept, but never inside a string or an unquoted url()', () => {
  assert.equal(stripCssComments('a /* b */ c'), 'a         c');
  assert.equal(stripCssComments('a /* b\nc */ d'), 'a     \n     d');
  for (const text of [
    "content: '/*'; x: 1; content: '*/';",
    'content: "*/"; x: 1;',
    `content: "it's /* no"; x: 1;`,
    `content: 'say "/*"'; x: 1;`,
    "content: 'it\\'s /*'; x: 1;",
    'background: url(./a/*b.png); x: 1;',
  ]) {
    assert.equal(stripCssComments(text), text, text);
    assert.deepEqual(scanCss(text).problems, [], text);
  }
  // A quote inside a comment opens nothing; an escaped slash opens no comment.
  assert.equal(stripCssComments("/* it's */ x"), '           x');
  assert.equal(stripCssComments('\\/* x'), '\\/* x');
});

test('an unterminated string, comment, or url(), and a bad string or url(), are problems', () => {
  const problems = (text: string) => scanCss(text).problems.map(({ message }) => message);
  assert.deepEqual(problems("content: 'open\nx: 1;"), [
    'has a string that a line break ends before its closing quote',
  ]);
  assert.deepEqual(problems("content: 'never"), ['opens a string that never closes']);
  assert.deepEqual(problems('x: 1; /* never'), ['opens a comment that never closes']);
  assert.deepEqual(problems('background: url(./a'), ['opens a url() that never closes']);
  for (const text of ['url(./a b.png)', "url(./a'b.png)", 'url(./a(b.png)'])
    assert.deepEqual(problems(text), ["has a url() a browser can't read"], text);
  // A string's escaped line break continues it.
  assert.deepEqual(problems("content: 'a\\\nb';"), []);
  // A quoted url() is a string, and a url-like name is not url().
  assert.deepEqual(problems("url( './a b.png' )"), []);
  assert.deepEqual(problems('myurl(a b)'), []);
});

test('escapes decode outside strings and url()s, and never to a quote, a backslash, or a control', () => {
  assert.equal(decodeCssEscapes('--\\75 i-radius-card'), '--ui-radius-card');
  assert.equal(decodeCssEscapes('--c\\olor-accent'), '--color-accent');
  assert.equal(decodeCssEscapes('#\\66 00'), '#f00');
  assert.equal(decodeCssEscapes('\\72 gb(255 0 0)'), 'rgb(255 0 0)');
  assert.equal(decodeCssEscapes('\\000072\\67 b'), 'rgb');
  assert.equal(decodeCssEscapes('a\\\r\nb'), 'a\\\r\nb');
  // Strings and url()s keep theirs.
  assert.equal(decodeCssEscapes("content: '\\201C'"), "content: '\\201C'");
  assert.equal(decodeCssEscapes('url(\\61 .png) \\62'), 'url(\\61 .png) b');
  // Zero, a surrogate, and past U+10FFFF are the replacement character.
  assert.equal(decodeCssEscapes('\\0 \\d800 \\110000'), '\uFFFD\uFFFD\uFFFD');
  // These stay escaped, so decoding opens no string and no escape.
  for (const text of ['\\27 x', '\\22 x', '\\5c x', "\\'", '\\9 x'])
    assert.equal(decodeCssEscapes(text), text, text);
});
