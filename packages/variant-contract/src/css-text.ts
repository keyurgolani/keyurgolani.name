// CSS text as CSS Syntax 3 tokenizes it (K-5 round 3, R3-H1 and R3-H2): the
// one reading of comments, strings, url(), and escapes that the variant CSS
// audit, the variant stylesheet compiler, and the appearance source audit
// share, so what one reads as a comment the others do too.
//
// - A comment runs from `/*` to the next `*/`, outside a string and outside
//   an unquoted url(): a `/*` inside either is text.
// - A string runs to its unescaped closing quote. A line break before it
//   ends the string there, a bad string, and the end of the file before it
//   leaves it open. Each is a problem: a browser drops the declaration, and
//   an audit that read on would read something else.
// - An unquoted url() runs to its `)`, and a quote, a `(`, or a space before
//   anything but the `)` makes it a bad url, a problem too.
// - An escape outside a string or a url() decodes to the character it
//   names, so a check reads `--\75 i-radius-card` as `--ui-radius-card`.
//   Strings and url()s keep theirs: `content: '\201C'` is text a visitor
//   reads.
//
// Browser-safe and dependency-free: it's pure string work.

/** Something in CSS text a browser reads otherwise than its author meant: where, and what. */
export interface CssTextProblem {
  readonly offset: number;
  readonly message: string;
}

const WHITESPACE = /[ \t\n\r\f]/;
const NEWLINE = /[\n\r\f]/;
const IDENT = /[\w\u0080-\uffff-]/;

/** Whether `char` is a control character: what CSS Syntax 3 calls non-printable, tab and line breaks aside. */
function control(char: string): boolean {
  const code = char.charCodeAt(0);
  return (
    (code <= 0x08 || code === 0x0b || (code >= 0x0e && code <= 0x1f) || code === 0x7f) &&
    char.length === 1
  );
}

/** Just past the escape at `index`: `\` and one to six hex digits with one whitespace after, or `\` and one character. */
function escapeEnd(text: string, index: number): number {
  const hex = /^[0-9a-f]{1,6}/i.exec(text.slice(index + 1, index + 7));
  if (!hex) return Math.min(index + 2, text.length);
  const end = index + 1 + hex[0].length;
  if (text.startsWith('\r\n', end)) return end + 2;
  return WHITESPACE.test(text[end] ?? '') ? end + 1 : end;
}

/** Where the string opened at `start` ends, just past its quote, or where a line break or the end cut it off. */
function stringEnd(text: string, start: number, problems: CssTextProblem[] | null): number {
  const quote = text[start];
  for (let index = start + 1; index < text.length; index++) {
    const char = text[index]!;
    if (char === '\\') index++;
    else if (char === quote) return index + 1;
    else if (NEWLINE.test(char)) {
      problems?.push({
        offset: start,
        message: 'has a string that a line break ends before its closing quote',
      });
      return index;
    }
  }
  problems?.push({ offset: start, message: 'opens a string that never closes' });
  return text.length;
}

/**
 * Where an unquoted url() whose contents start at `from` ends, just past its `)`. A bad url
 * runs to the next `)` as a browser reads it, and is a problem.
 */
function urlEnd(
  text: string,
  start: number,
  from: number,
  problems: CssTextProblem[] | null,
): number {
  let bad = false;
  for (let index = from; index < text.length; index++) {
    const char = text[index]!;
    if (char === ')') {
      if (bad) problems?.push({ offset: start, message: "has a url() a browser can't read" });
      return index + 1;
    }
    if (char === '\\') {
      if (NEWLINE.test(text[index + 1] ?? '\n')) bad = true;
      index = escapeEnd(text, index) - 1;
    } else if (WHITESPACE.test(char)) {
      let next = index;
      while (next < text.length && WHITESPACE.test(text[next]!)) next++;
      if (text[next] !== ')') bad = true;
      index = next - 1;
    } else if (char === '"' || char === "'" || char === '(' || control(char)) {
      bad = true;
    }
  }
  problems?.push({ offset: start, message: 'opens a url() that never closes' });
  return text.length;
}

/** Whether `url(` at `index` opens an unquoted url, and where its contents start. */
function unquotedUrl(text: string, index: number): number | null {
  if (!/^url\(/i.test(text.slice(index, index + 4)) || IDENT.test(text[index - 1] ?? ' '))
    return null;
  let from = index + 4;
  while (from < text.length && WHITESPACE.test(text[from]!)) from++;
  return text[from] === '"' || text[from] === "'" ? null : from;
}

/**
 * `text` with each comment blanked, every character but a line break a space, so offsets,
 * lines, and columns stay where they were; each problem a browser would read past; and where
 * each backslash outside a string sits, an unquoted url()'s among them (K-5 round 5), which
 * the source audit refuses.
 */
export function scanCss(text: string): {
  readonly text: string;
  readonly problems: CssTextProblem[];
  readonly escapes: number[];
} {
  const problems: CssTextProblem[] = [];
  const escapes: number[] = [];
  let out = '';
  let index = 0;
  while (index < text.length) {
    const char = text[index]!;
    let end = index + 1;
    if (char === '/' && text[index + 1] === '*') {
      const close = text.indexOf('*/', index + 2);
      if (close === -1)
        problems.push({ offset: index, message: 'opens a comment that never closes' });
      end = close === -1 ? text.length : close + 2;
      out += text.slice(index, end).replace(/[^\n]/g, ' ');
      index = end;
      continue;
    }
    if (char === '"' || char === "'") end = stringEnd(text, index, problems);
    else if (char === '\\') {
      escapes.push(index);
      end = Math.min(index + 2, text.length);
    } else {
      const from = unquotedUrl(text, index);
      if (from !== null) {
        end = urlEnd(text, index, from, problems);
        for (
          let at = text.indexOf('\\', from);
          at !== -1 && at < end;
          at = text.indexOf('\\', at + 2)
        )
          escapes.push(at);
      }
    }
    out += text.slice(index, end);
    index = end;
  }
  return { text: out, problems, escapes };
}

/** `text` with each comment blanked, as scanCss() reads it. */
export function stripCssComments(text: string): string {
  return scanCss(text).text;
}

/**
 * `text` with each escape outside a string or a url() decoded: `\` and one to six hex digits
 * (and one whitespace after them) to that code point, and `\` and any other character to the
 * character. An escape that would decode to a quote, a backslash, or a control character
 * stays as written, so decoding never opens a string or another escape.
 */
export function decodeCssEscapes(text: string): string {
  let out = '';
  let index = 0;
  while (index < text.length) {
    const char = text[index]!;
    if (char === '"' || char === "'") {
      const end = stringEnd(text, index, null);
      out += text.slice(index, end);
      index = end;
      continue;
    }
    const from = unquotedUrl(text, index);
    if (from !== null) {
      const end = urlEnd(text, index, from, null);
      out += text.slice(index, end);
      index = end;
      continue;
    }
    if (char !== '\\' || index + 1 >= text.length || NEWLINE.test(text[index + 1]!)) {
      out += char;
      index++;
      continue;
    }
    const hex = /^[0-9a-f]{1,6}/i.exec(text.slice(index + 1, index + 7));
    const point = hex ? Number.parseInt(hex[0], 16) : -1;
    const decoded = !hex
      ? text[index + 1]!
      : point === 0 || (point >= 0xd800 && point <= 0xdfff) || point > 0x10ffff
        ? '\uFFFD'
        : String.fromCodePoint(point);
    const end = escapeEnd(text, index);
    const unsafe =
      decoded === '"' ||
      decoded === "'" ||
      decoded === '\\' ||
      control(decoded) ||
      /^[\t\n\r\f]$/.test(decoded);
    out += unsafe ? text.slice(index, end) : decoded;
    index = end;
  }
  return out;
}
