import { Marked, Tokenizer, type MarkedToken, type Token, type Tokens } from 'marked';
import { isAllowedUrl, markdownOverLimit } from '@portfolio/schema';
import { escapeHtml } from './html-escape';
import { decodeReferences } from './html-references';
import { lexBlocks } from './markdown-lexer';

// Markdown from the content, as HTML that RichText injects with
// dangerouslySetInnerHTML. marked only tokenizes: every tag is written here,
// from one allowlist, so nothing marked would emit on its own gets through.
//
// - Block: p, a, em, strong, code, pre, ul, ol, li, blockquote, h3 to h6, br,
//   and hr. Inline (renderInlineMarkdown): a, em, strong, code, and br.
// - The one attribute is href on a, and only for a URL #4's link rule
//   accepts. A link it refuses renders its text alone.
// - Raw HTML, block and inline, renders as escaped text, so a tag shows as it
//   was typed rather than vanishing. Comments, CDATA sections, processing
//   instructions, and declarations are dropped: no browser ever showed them.
// - An image renders its alt text. Headings of depth 1 and 2 render as h3,
//   since the section renderers own a page's h1 and h2.
// - Anything else keeps its text and loses its markup: tables, strikethrough,
//   task-list checkboxes, a code block's language, a list's start number, and
//   link titles.
// - Source marked can't take renders as escaped text: a paragraph per run of
//   lines, or the phrase inline. marked recurses once per level of nesting, so
//   a deep enough quote or run of emphasis runs it out of stack, and that
//   mustn't take the page's render down with it.
// - So does source over the Markdown cap (#10). Validation refuses a field
//   over it, but a variant can hand RichText any text, and the measure is
//   linear where marked isn't.
// - marked may open at most MAX_NESTING quotes and lists at once. The cap
//   counts the levels lazy lines add the way marked does, and this holds
//   marked to a bound even where a line's nesting differs from the count.
// - When a lazy line makes marked lex a quote's content again, the inline
//   text of the first lexing isn't lexed as well (markdown-lexer.ts), so a
//   field's marks cost the same however deep its quotes.
//
// No Node API and no DOM: #7's preview frame and #9's browser render call it.

/** Our own instance, so nothing that configures the global `marked` reaches it. */
const markdown = new Marked({ async: false, breaks: false, gfm: true, pedantic: false });

/**
 * The most block quotes and lists marked may lex inside one another, re-lexes
 * included. The cap allows 12; past this a field renders as escaped text.
 */
const MAX_NESTING = 32;
let nesting = 0;
function nested<T>(lex: () => T): T {
  if (nesting >= MAX_NESTING) throw new RangeError('Markdown nests too deep to render');
  nesting++;
  try {
    return lex();
  } finally {
    nesting--;
  }
}
markdown.use({
  tokenizer: {
    blockquote(src) {
      return nested(() => Tokenizer.prototype.blockquote.call(this, src));
    },
    list(src) {
      return nested(() => Tokenizer.prototype.list.call(this, src));
    },
  },
});

export function renderMarkdown(source: string | undefined | null): string {
  if (!source) return '';
  if (markdownOverLimit(source)) return paragraphsOf(source);
  try {
    // A copy of the options per call: the lexer keeps its tokenizer on them.
    return blocks(lexBlocks(withoutNul(source), { ...markdown.defaults }), true);
  } catch {
    return paragraphsOf(source);
  }
}

export function renderInlineMarkdown(source: string | undefined | null): string {
  if (!source) return '';
  // Inline, nothing is code: the measure counts the marks inside a fence too.
  if (markdownOverLimit(source, 'inline')) return escapeHtml(withoutNul(source));
  try {
    return inlines(markdown.Lexer.lexInline(withoutNul(source), { ...markdown.defaults }), false);
  } catch {
    return escapeHtml(withoutNul(source));
  }
}

/** CommonMark replaces U+0000 before it parses. */
const withoutNul = (source: string) => source.replaceAll('\0', '\uFFFD');

/** The source as escaped text, a paragraph for each run of lines between blank ones. */
const paragraphsOf = (source: string) =>
  withoutNul(source)
    .split(/(?:\r\n?|\n)[ \t]*(?:\r\n?|\n)/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph !== '')
    .map((paragraph) => `<p>${escapeHtml(paragraph)}</p>\n`)
    .join('');

/**
 * Block tokens, as marked's own parser walks them: `top` is false inside a
 * tight list item, whose text runs join without a paragraph.
 */
function blocks(tokens: readonly Token[], top: boolean): string {
  let html = '';
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i] as MarkedToken;
    switch (token.type) {
      case 'space':
      case 'def':
        break;
      case 'paragraph':
        html += `<p>${inlines(token.tokens, false)}</p>\n`;
        break;
      case 'heading': {
        const level = Math.min(Math.max(token.depth, 3), 6);
        html += `<h${level}>${inlines(token.tokens, false)}</h${level}>\n`;
        break;
      }
      case 'code':
        html += `<pre><code>${escapeHtml(`${token.text.replace(/\n$/, '')}\n`)}</code></pre>\n`;
        break;
      case 'blockquote':
        html += `<blockquote>\n${blocks(token.tokens, true)}</blockquote>\n`;
        break;
      case 'list': {
        const tag = token.ordered ? 'ol' : 'ul';
        const items = token.items.map((item) => `<li>${blocks(item.tokens, item.loose)}</li>\n`);
        html += `<${tag}>\n${items.join('')}</${tag}>\n`;
        break;
      }
      case 'hr':
        html += '<hr>\n';
        break;
      case 'html': {
        const text = withoutComments(token.text).trim();
        if (text) html += `<p>${escapeHtml(text)}</p>\n`;
        break;
      }
      case 'table':
        // Each row a paragraph, each cell a line of it.
        for (const row of [token.header, ...token.rows]) {
          const cells = row
            .map((cell) => inlines(cell.tokens, false))
            .filter((cell) => cell.trim());
          if (cells.length > 0) html += `<p>${cells.join('<br>')}</p>\n`;
        }
        break;
      case 'text': {
        let body = textOf(token, false);
        while (tokens[i + 1]?.type === 'text')
          body += `\n${textOf(tokens[++i] as Tokens.Text, false)}`;
        html += top ? `<p>${body}</p>\n` : body;
        break;
      }
      default: {
        const text = plainText([tokens[i]!]);
        if (text.trim()) html += `<p>${text}</p>\n`;
      }
    }
  }
  return html;
}

/** Inline tokens. Inside a link's text a nested link renders its text alone. */
function inlines(tokens: readonly Token[], inLink: boolean): string {
  let html = '';
  for (const any of tokens) {
    const token = any as MarkedToken;
    switch (token.type) {
      case 'text':
        html += textOf(token, inLink);
        break;
      case 'escape':
        html += escapeText(token.text);
        break;
      case 'strong':
        html += `<strong>${inlines(token.tokens, inLink)}</strong>`;
        break;
      case 'em':
        html += `<em>${inlines(token.tokens, inLink)}</em>`;
        break;
      case 'codespan':
        html += `<code>${escapeHtml(token.text)}</code>`;
        break;
      case 'br':
        html += '<br>';
        break;
      case 'del':
        html += inlines(token.tokens, inLink);
        break;
      case 'link': {
        const text = inlines(token.tokens, true);
        const href = inLink ? null : linkHref(token.href);
        html += href === null ? text : `<a href="${escapeHtml(href)}">${text}</a>`;
        break;
      }
      case 'image':
        html += token.tokens ? plainText(token.tokens) : escapeText(token.text);
        break;
      case 'html':
        html += escapeHtml(withoutComments(token.text));
        break;
      default:
        html += plainText([any]);
    }
  }
  return html;
}

function textOf(token: Tokens.Text, inLink: boolean): string {
  return token.tokens ? inlines(token.tokens, inLink) : escapeText(token.text);
}

/** Tokens' text alone, escaped: an image's alt text, or a token the allowlist has no place for. */
function plainText(tokens: readonly Token[]): string {
  let text = '';
  for (const token of tokens) {
    if (token.type === 'html') text += escapeHtml(withoutComments(token.text as string));
    else if (token.type === 'codespan' || token.type === 'code') {
      text += escapeHtml(token.text as string);
    } else if ('tokens' in token && Array.isArray(token.tokens)) text += plainText(token.tokens);
    else if ('text' in token && typeof token.text === 'string') text += escapeText(token.text);
  }
  return text;
}

/**
 * A link's URL as the page carries it, or null when #4's link rule refuses
 * it. marked hands over the destination with its backslash escapes removed
 * and its character references left in, which the old renderer wrote out for
 * the browser to decode, so they're decoded here and the rule judges the URL a
 * browser would follow. It's then percent-encoded as marked did, judged again,
 * and escaped as it's written, so the page carries exactly what was judged.
 */
function linkHref(destination: string): string | null {
  const url = decodeReferences(destination);
  if (!isAllowedUrl(url)) return null;
  let encoded: string;
  try {
    encoded = encodeURI(url).replace(/%25/g, '%');
  } catch {
    // A lone surrogate.
    return null;
  }
  return isAllowedUrl(encoded) ? encoded : null;
}

/** Comments, CDATA sections, processing instructions, and declarations, each to its end or the text's. */
const COMMENT_LIKE =
  /<!--(?:-?>|[\s\S]*?(?:-->|$))|<!\[CDATA\[[\s\S]*?(?:\]\]>|$)|<\?[\s\S]*?(?:\?>|$)|<![A-Za-z][\s\S]*?(?:>|$)/g;
const withoutComments = (html: string) => html.replace(COMMENT_LIKE, '');

/**
 * Text, escaped as escapeHtml does, except that a character reference the
 * author wrote stays one, as marked left it: a numeric one, or a name of up
 * to 20 letters and digits. That's what sanitize-html's post-pass
 * (markdown-sanitize.ts) keeps as a reference, so the two agree. Only a few
 * names past 20 are references, such as CounterClockwiseContourIntegral, and
 * those render as their text.
 */
const escapeText = (text: string) =>
  text.replace(/[<>"']|&(?!#\d{1,7};|#[xX][0-9a-fA-F]{1,6};|[A-Za-z0-9]{1,20};)/g, escapeHtml);
