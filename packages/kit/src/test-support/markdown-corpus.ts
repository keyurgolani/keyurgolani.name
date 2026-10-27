// For tests: the inputs the markdown renderer is checked against, generated
// from the grammar of HTML, URLs, and Markdown rather than listed one by one,
// so they cover whole classes: every element and event the DOM library
// names, every form a tag can take, every way to spell a scheme, and every
// Markdown construct that carries a URL or markup. Every body is the inert
// word x, so no input is a payload. The strict reader (strict-html.ts)
// decides whether an output is safe.
//
// 1. Elements: each element in each tag form, with each attribute in turn;
//    each attribute in each form, on each element in turn; and each element
//    with a seventh of the attributes.
// 2. URLs: each refused scheme and each allowed URL, spelled with other
//    case, character references, inserted controls, leading spaces, and
//    percent-encoding, plus references to another host and http URLs with
//    other authorities, in each construct that carries a URL, and some of
//    those inside each container.
// 3. Carriers: element and markup fragments inside each container.
// 4. Markup: comments, CDATA, processing instructions, declarations, and
//    malformed character references.
//
// Products too large to run whole are sampled at fixed strides, so every run
// checks the same inputs.

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { unescapeHtml } from '../html-escape';

/** TypeScript's DOM library, whose tag name maps name every element and whose event maps name every event. */
const DOM = readFileSync(
  path.join(path.dirname(createRequire(import.meta.url).resolve('typescript')), 'lib.dom.d.ts'),
  'utf8',
);

/** The quoted keys of the DOM library's interfaces whose names `pattern` matches. */
function domKeys(pattern: RegExp): string[] {
  const keys: string[] = [];
  const interfaces = DOM.matchAll(/^interface (\w+)(?: extends [^{]+)? \{\n([\s\S]*?)^\}/gm);
  for (const [, name = '', body = ''] of interfaces) {
    if (!pattern.test(name)) continue;
    for (const [, key = ''] of body.matchAll(/^ {4}"([^"]+)": /gm)) keys.push(key);
  }
  return keys;
}

const unique = (names: readonly string[]) => [...new Set(names)].sort();

// ─── Vocabulary ──────────────────────────────────────────────────────────

/**
 * Every element name: the HTML, obsolete HTML, SVG, and MathML elements the
 * DOM library declares, which take in the raw-text, foreign, form, and
 * embedding elements; names the HTML parser handles that the library lacks;
 * a custom element; and an unknown one.
 */
export const ELEMENTS = unique([
  ...domKeys(/^(?:HTMLElement|HTMLElementDeprecated|SVGElement|MathMLElement)TagNameMap$/),
  ...['selectedcontent', 'mglyph', 'malignmark', 'altGlyph', 'animateColor', 'glyphRef'],
  ...['x-x', 'x'],
]);

/** `on` and each event the DOM library declares, its handler properties, and handlers older browsers ran. */
export const EVENT_HANDLERS = unique([
  ...domKeys(/EventMap$/).map((event) => `on${event}`),
  ...Array.from(DOM.matchAll(/^ {4}(on[a-z]+): \(\(this: /gm), ([, name = '']) => name),
  ...['activate', 'beforeactivate', 'beforecopy', 'beforecut', 'beforepaste', 'begin', 'bounce']
    .concat(['end', 'finish', 'focusin', 'focusout', 'mousewheel', 'repeat', 'search', 'start'])
    .map((event) => `on${event}`),
]);

/** Attributes that load, link, or submit to a URL, or hold a document. */
export const URL_ATTRIBUTES = unique([
  ...['action', 'archive', 'background', 'by', 'cite', 'classid', 'codebase', 'content', 'data'],
  ...['dynsrc', 'formaction', 'from', 'href', 'icon', 'imagesrcset', 'longdesc', 'lowsrc'],
  ...['manifest', 'ping', 'poster', 'profile', 'src', 'srcdoc', 'srcset', 'to', 'usemap'],
  ...['values', 'xlink:href'],
]);

/** The global attributes, the URL attributes, and every event handler. */
export const ATTRIBUTES = unique([
  ...['accesskey', 'autocapitalize', 'autocorrect', 'autofocus', 'class', 'contenteditable'],
  ...['dir', 'draggable', 'enterkeyhint', 'hidden', 'id', 'inert', 'inputmode', 'is', 'itemid'],
  ...['itemprop', 'itemref', 'itemscope', 'itemtype', 'lang', 'nonce', 'popover', 'slot'],
  ...['spellcheck', 'style', 'tabindex', 'title', 'translate', 'writingsuggestions'],
  ...['xml:lang', 'xml:space', 'xmlns', 'xmlns:xlink'],
  ...URL_ATTRIBUTES,
  ...EVENT_HANDLERS,
]);

/** `text` with its letters in alternating case, the first upper at `phase` 0. */
const alternating = (text: string, phase = 0) =>
  [...text].map((char, i) => (i % 2 === phase ? char.toUpperCase() : char.toLowerCase())).join('');

/** Each form the HTML tokenizer accepts for a tag, as element `e` with attribute `a`. */
export const TAG_FORMS: ReadonlyArray<(e: string, a: string) => string> = [
  (e) => `<${e}>x</${e}>`,
  (e) => `<${e}>`,
  (e) => `</${e}>`,
  (e) => `<${e}/>`,
  (e, a) => `<${e} ${a} />`,
  (e, a) => `<${e} ${a}>x</${e}>`,
  (e, a) => `<${e} ${a}=x>x</${e}>`,
  (e, a) => `<${e} ${a}='x'>x</${e}>`,
  (e, a) => `<${e} ${a}="x">x</${e}>`,
  (e, a) => `<${e} ${a} = "x" >x</${e} >`,
  (e, a) => `<${e}/${a}=x>x</${e}>`,
  (e, a) => `<${e}/${a}/${a}='x'/>`,
  (e, a) => `<${e} ${a}="x"${a}='x'${a}=x>`,
  (e, a) => `<${e}\t${a}=x\f${a}=x\r${a}=x>`,
  (e, a) => `<${e.toUpperCase()} ${a.toUpperCase()}=X>X</${e.toUpperCase()}>`,
  (e, a) => `<${alternating(e)} ${alternating(a, 1)}=x>x</${alternating(e, 1)}>`,
  // Unclosed: the tag, its quote, and the element.
  (e, a) => `<${e} ${a}=x`,
  (e, a) => `<${e} ${a}="x>x</${e}>`,
  (e, a) => `<${e} ${a}=x>x`,
  (e, a) => `<${e}><${e} ${a}=x><${e}>x</${e}></${e}>`,
  // Split across lines, and across paragraphs.
  (e, a) => `<${e}\n${a}=x\n>\nx\n</${e}\n>`,
  (e, a) => `<${e} ${a}=x>\n\nx\n\n</${e}>`,
  (e, a) => `</${e} ${a}=x>`,
  (e, a) => `<${e} ${a}=\`x\`>x</${e}>`,
  (e, a) => `x<${e} ${a}=x>x</${e}>x`,
];

// ─── URLs ────────────────────────────────────────────────────────────────

/** Schemes #4's link rule refuses: script, data, files and blobs, browser internals, others, and near misses of the ones it allows. */
export const REFUSED_SCHEMES = [
  ...['javascript', 'vbscript', 'livescript', 'data', 'file', 'blob', 'filesystem', 'about'],
  ...['view-source', 'jar', 'ms-its', 'mhtml', 'intent', 'chrome', 'ftp', 'ws', 'sms', 'feed'],
  ...['x', 'x+x', 'x-x', 'x.x', 'x1', 'httpx', 'xhttps', 'mailtox', 'tel2'],
];

/** URLs it allows: one per scheme, and the relative references a link may carry, one with the characters an href escapes. */
export const ALLOWED_URLS = [
  ...['https://x.test', 'http://x.test', 'mailto:x', 'tel:x'],
  ...['#x', '/#x', '/x', 'x', './x', '../x', '?x', "#x&x'x"],
];

export interface Spelling {
  readonly kind:
    'plain' | 'case' | 'reference' | 'inserted' | 'leading' | 'percent' | 'network' | 'authority';
  /** The destination as the Markdown writes it. */
  readonly written: string;
  /**
   * What a browser reads from it as an attribute value: its character
   * references decoded, and NUL as U+FFFD, which CommonMark replaces it with.
   */
  readonly reads: string;
}

/** The named references for the punctuation in a URL. Letters and digits have none. */
const NAMES: Readonly<Record<string, string>> = {
  ':': 'colon',
  '/': 'sol',
  '.': 'period',
  '@': 'commat',
  '+': 'plus',
  '#': 'num',
  '?': 'quest',
};

/** A numeric reference's character, as a browser decodes it. */
function codePoint(value: number): string {
  // A browser maps 0x80 to 0x9F through windows-1252. No reference here reaches them.
  if (value >= 0x80 && value <= 0x9f) throw new Error(`no windows-1252 mapping for ${value}`);
  if (value === 0 || value > 0x10ffff || (value >= 0xd800 && value <= 0xdfff)) return '\ufffd';
  return String.fromCodePoint(value);
}

/** What a browser reads from a numeric reference without its semicolon: the digits that follow are part of it. */
function unterminated(digits: string, rest: string, radix: 10 | 16): string {
  const run = (radix === 10 ? /^\d*/ : /^[\da-f]*/i).exec(rest)?.[0] ?? '';
  return codePoint(parseInt(digits + run, radix)) + rest.slice(run.length);
}

/** Each character reference for `char`, with what a browser reads from it and the `rest` after it. */
function referencesFor(char: string, rest: string): Array<readonly [string, string]> {
  const code = char.codePointAt(0) ?? 0;
  const decimal = String(code);
  const hex = code.toString(16);
  const same = char + rest;
  const forms: Array<readonly [string, string]> = [
    [`&#${decimal};`, same],
    [`&#0000000${decimal};`, same],
    [`&#x${hex};`, same],
    [`&#X${hex.toUpperCase()};`, same],
    [`&#x0000000${hex};`, same],
    [`&#${decimal}`, unterminated(decimal, rest, 10)],
    [`&#x${hex}`, unterminated(hex, rest, 16)],
  ];
  const name = NAMES[char];
  // Without its semicolon a browser decodes only a few legacy names, and none of these.
  if (name) forms.push([`&${name};`, same], [`&${name}`, `&${name}${rest}`]);
  return forms;
}

/**
 * What can sit unseen in a URL: each C0 control, the space, DEL, and
 * invisible or space-like Unicode, raw; and tab, line feed, carriage return,
 * NUL, and the no-break space as references.
 */
const INSERTED: ReadonlyArray<readonly [string, string]> = [
  ...Array.from({ length: 0x21 }, (_, code) => String.fromCharCode(code)),
  ...['\x7f', '\u00a0', '\u200b', '\u200c', '\u2028', '\u3000', '\ufeff'],
]
  .map((char) => [char, char === '\0' ? '\ufffd' : char] as const)
  .concat([
    ['&Tab;', '\t'],
    ['&NewLine;', '\n'],
    ['&#9;', '\t'],
    ['&#x0A;', '\n'],
    ['&#13;', '\r'],
    ['&#0;', '\ufffd'],
    ['&nbsp;', '\u00a0'],
  ]);

const LEADING: ReadonlyArray<readonly [string, string]> = [
  ['  ', '  '],
  ['   ', '   '],
  ['\t\t', '\t\t'],
  [' \n ', ' \n '],
  ['&#32;&#32;', '  '],
];

/** `char`'s UTF-8 bytes, percent-encoded. */
const percent = (char: string) =>
  Array.from(
    new TextEncoder().encode(char),
    (byte) => `%${byte.toString(16).toUpperCase().padStart(2, '0')}`,
  ).join('');

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/**
 * `url` spelled each way, once each. What changes is its scheme and colon,
 * or all of a relative URL; the rest is written as it is.
 */
export function spellingsOf(url: string): Spelling[] {
  const head = SCHEME.exec(url)?.[0] ?? url;
  const tail = url.slice(head.length);
  const chars = [...head];
  const spellings = new Map<string, Spelling>();
  const add = (kind: Spelling['kind'], written: string, reads = written) => {
    if (!spellings.has(written)) spellings.set(written, { kind, written, reads });
  };
  add('plain', url);
  // Other case, and letters that case-fold to ASCII ones: the long s, the dotless i, and the Kelvin sign.
  const lookalikes = head.replace(/s/g, '\u017f').replace(/i/g, '\u0131').replace(/k/g, '\u212a');
  for (const spelled of [
    head.toUpperCase(),
    head.charAt(0).toUpperCase() + head.slice(1),
    alternating(head),
    alternating(head, 1),
    lookalikes,
  ]) {
    add('case', spelled + tail);
  }
  // Each character as each kind of reference, and percent-encoded.
  chars.forEach((char, i) => {
    const before = chars.slice(0, i).join('');
    const rest = chars.slice(i + 1).join('') + tail;
    for (const [reference, reads] of referencesFor(char, rest)) {
      add('reference', before + reference + rest, before + reads);
    }
    add('percent', before + percent(char) + rest);
  });
  // Every character at once.
  add('reference', chars.map((char) => `&#${char.codePointAt(0)};`).join('') + tail, url);
  add(
    'reference',
    chars.map((char) => `&#x${char.codePointAt(0)?.toString(16)};`).join('') + tail,
    url,
  );
  add('percent', chars.map(percent).join('') + tail);
  add('percent', chars.map((char) => percent(char).toLowerCase()).join('') + tail);
  add('percent', `%25${percent(chars[0] ?? '').slice(1)}${url.slice(1)}`);
  // Something unseen at each position, and spaces before it all.
  for (let i = 0; i <= chars.length; i++) {
    const before = chars.slice(0, i).join('');
    const after = chars.slice(i).join('') + tail;
    for (const [written, reads] of INSERTED) {
      add('inserted', before + written + after, before + reads + after);
    }
  }
  for (const [written, reads] of LEADING) add('leading', written + url, reads + url);
  return [...spellings.values()];
}

/**
 * References to another host: two slashes, each written any way a browser
 * reads as one, with nothing, a tab, or a line feed between them, and no
 * scheme, an http one, or a space before. A raw backslash is left out:
 * Markdown reads one as an escape in some constructs and as itself in others.
 */
export function networkSpellings(): Spelling[] {
  const slashes = [
    ['/', '/'],
    ['&#47;', '/'],
    ['&sol;', '/'],
    ['&#x2F;', '/'],
    ['&#92;', '\\'],
    ['&bsol;', '\\'],
    ['&#x5c;', '\\'],
    ['%2F', '%2F'],
    ['%5C', '%5C'],
  ] as const;
  const between = [
    ['', ''],
    ['\t', '\t'],
    ['&NewLine;', '\n'],
  ] as const;
  const before = [
    ['', ''],
    ['https:', 'https:'],
    ['HTTP:', 'HTTP:'],
    [' ', ' '],
  ] as const;
  const spellings: Spelling[] = [];
  for (const [prefix, prefixReads] of before) {
    for (const [first, firstReads] of slashes) {
      for (const [gap, gapReads] of between) {
        for (const [second, secondReads] of slashes) {
          spellings.push({
            kind: 'network',
            written: `${prefix}${first}${gap}${second}x.test`,
            reads: `${prefixReads}${firstReads}${gapReads}${secondReads}x.test`,
          });
        }
      }
    }
  }
  return spellings;
}

/**
 * http and https URLs with other authorities: a port, user info, and a
 * trailing dot, which stay links; and an IPv6 host and a backslash after the
 * host (which a browser reads as a slash), which percent-encoding breaks.
 */
export function authoritySpellings(): Spelling[] {
  const authorities = [
    ['x.test:1', 'x.test:1'],
    ['x@x.test', 'x@x.test'],
    ['x.test.', 'x.test.'],
    ['[::1]', '[::1]'],
    ['[::1]:1/x', '[::1]:1/x'],
    ['x.test&#92;x', 'x.test\\x'],
    ['x.test&bsol;', 'x.test\\'],
  ] as const;
  return ['https://', 'HTTP://'].flatMap((scheme) =>
    authorities.map(([written, reads]) => ({
      kind: 'authority' as const,
      written: scheme + written,
      reads: scheme + reads,
    })),
  );
}

/** Every spelling of every URL. */
export function allSpellings(): Spelling[] {
  return [...REFUSED_SCHEMES.map((scheme) => `${scheme}:x`), ...ALLOWED_URLS]
    .flatMap(spellingsOf)
    .concat(networkSpellings(), authoritySpellings());
}

/** Where a construct's output may link: only where its URL points, nowhere, or anywhere the reader allows. */
export type Links = 'destination' | 'nowhere' | 'anywhere';

/** Where output may link, rendered as blocks and inline. Inline, a definition or a code block is text, and its URL can be an autolink. */
export interface LinksByMode {
  readonly block: Links;
  readonly inline: Links;
}

const everywhere = (links: Links): LinksByMode => ({ block: links, inline: links });

export interface UrlCarrier {
  readonly name: string;
  /** The Markdown carrying `url`; `index` turns the attributes and titles some carriers go through. */
  readonly carry: (url: string, index: number) => string;
  readonly links: LinksByMode;
  /** Whether it carries the URL on one line, so a container can hold it. */
  readonly oneLine?: boolean;
}

/** Titles that try to close the attribute a title would be written in, with each event handler in turn. */
function title(index: number): string {
  const quotes = ['"', "'", '&quot;', '&#39;', '\\"', "\\'"];
  const delimiters = [
    ['"', '"'],
    ["'", "'"],
    ['(', ')'],
  ] as const;
  const quote = quotes[index % quotes.length]!;
  const [open, close] = delimiters[Math.floor(index / quotes.length) % delimiters.length]!;
  const handler = EVENT_HANDLERS[index % EVENT_HANDLERS.length]!;
  return `${open}x${quote} ${handler}=${quote}x${close}`;
}

/** Each Markdown construct that carries a URL: links, definitions, autolinks, bare URLs, images, titles, and raw HTML. */
export const URL_CARRIERS: readonly UrlCarrier[] = [
  {
    name: 'inline link',
    carry: (url) => `[x](${url})`,
    links: everywhere('destination'),
    oneLine: true,
  },
  {
    name: 'inline link in angle brackets',
    carry: (url) => `[x](<${url}>)`,
    links: everywhere('destination'),
    oneLine: true,
  },
  {
    name: 'inline link with a title that tries to close it',
    carry: (url, i) => `[x](${url} ${title(i)})`,
    links: everywhere('destination'),
  },
  {
    name: 'reference link',
    carry: (url) => `[x][r]\n\n[r]: ${url}`,
    links: everywhere('destination'),
  },
  {
    name: 'collapsed reference to an angle-bracket definition with a title',
    carry: (url, i) => `[x][]\n\n[x]: <${url}> ${title(i)}`,
    links: everywhere('destination'),
  },
  {
    name: 'shortcut reference with its title on the next line',
    carry: (url) => `[X]\n\n[x]: ${url}\n  (x)`,
    links: everywhere('destination'),
  },
  {
    name: 'autolink',
    carry: (url) => `<${url}>`,
    links: everywhere('destination'),
    oneLine: true,
  },
  {
    name: 'GFM bare URL',
    carry: (url) => `x ${url} x`,
    links: everywhere('anywhere'),
    oneLine: true,
  },
  { name: 'image', carry: (url) => `![x](${url})`, links: everywhere('nowhere') },
  {
    name: 'reference image',
    carry: (url) => `![x][r]\n\n[r]: <${url}>`,
    links: { block: 'nowhere', inline: 'destination' },
  },
  {
    name: 'linked image',
    carry: (url) => `[![x](${url})](${url})`,
    links: everywhere('destination'),
  },
  {
    name: 'raw HTML attribute',
    carry: (url, i) => {
      const element = ELEMENTS[(i * 7) % ELEMENTS.length]!;
      const attribute = URL_ATTRIBUTES[i % URL_ATTRIBUTES.length]!;
      const quote = ['"', "'", ''][i % 3]!;
      return `<${element} ${attribute}=${quote}${url}${quote}>x</${element}>`;
    },
    links: everywhere('nowhere'),
  },
  {
    name: 'HTML block',
    carry: (url) => `<div>\n<a href="${url}">x</a>\n</div>`,
    links: everywhere('nowhere'),
  },
];

/**
 * Text GFM would link on its own: a bare URL or an email. A construct that
 * fails to parse leaves its URL as text, which GFM may then link, so where
 * such text appears only the strict reader judges the links.
 */
export const BARE_LINK = /(?:https?|ftp):\/\/|www\.|@/i;

// ─── Containers ──────────────────────────────────────────────────────────

/** What becomes of a link inside a container: it stays, it's dropped (code and image text), or the container adds one of its own. */
export type ContainerLinks = 'keeps' | 'drops' | 'adds';

export interface Container {
  readonly name: string;
  readonly wrap: (inner: string) => string;
  /** Rendered as blocks and inline. */
  readonly links: { readonly block: ContainerLinks; readonly inline: ContainerLinks };
}

const keeps = { block: 'keeps', inline: 'keeps' } as const;
const drops = { block: 'drops', inline: 'drops' } as const;
const adds = { block: 'adds', inline: 'adds' } as const;
/** A code or HTML block's content is text. Inline there are no blocks, so it's parsed. */
const textBlock = { block: 'drops', inline: 'keeps' } as const;

/** Each place Markdown can put a fragment: lists, quotes, headings, emphasis, tables, link and image text, and code. */
export const CONTAINERS: readonly Container[] = [
  { name: 'paragraph', wrap: (s) => `x ${s} x`, links: keeps },
  { name: 'bullet list', wrap: (s) => `- ${s}`, links: keeps },
  { name: 'ordered list', wrap: (s) => `2. x\n3. ${s}`, links: keeps },
  { name: 'task list', wrap: (s) => `- [ ] ${s}\n- [x] x`, links: keeps },
  { name: 'nested list', wrap: (s) => `- x\n  1) ${s}`, links: keeps },
  { name: 'loose list', wrap: (s) => `* x\n\n* ${s}`, links: keeps },
  { name: 'blockquote', wrap: (s) => `> ${s}`, links: keeps },
  { name: 'nested blockquote', wrap: (s) => `> x\n>\n> > ${s}`, links: keeps },
  { name: 'heading', wrap: (s) => `# ${s}`, links: keeps },
  { name: 'level 6 heading', wrap: (s) => `###### ${s} ###`, links: keeps },
  { name: 'setext heading', wrap: (s) => `${s}\n---`, links: keeps },
  { name: 'emphasis', wrap: (s) => `*${s}*`, links: keeps },
  { name: 'strong emphasis', wrap: (s) => `__${s}__`, links: keeps },
  { name: 'strikethrough', wrap: (s) => `~~${s}~~`, links: keeps },
  { name: 'table', wrap: (s) => `| ${s} | x |\n| --- | :-: |\n| x | ${s} |`, links: keeps },
  { name: 'hard line breaks', wrap: (s) => `x  \n${s}\\\nx`, links: keeps },
  { name: 'HTML block around Markdown', wrap: (s) => `<div>\n\n${s}\n\n</div>`, links: keeps },
  { name: 'HTML block', wrap: (s) => `<div>${s}</div>`, links: textBlock },
  { name: 'link text', wrap: (s) => `[x ${s} x](x)`, links: adds },
  { name: 'link title', wrap: (s) => `[x](x "x ${s} x")`, links: adds },
  { name: 'definition title', wrap: (s) => `[x]\n\n[x]: x 'x ${s} x'`, links: adds },
  { name: 'image text', wrap: (s) => `![x ${s} x](x)`, links: drops },
  { name: 'code span', wrap: (s) => `\`${s}\``, links: drops },
  { name: 'code span in double backticks', wrap: (s) => `\`\` ${s} \`\``, links: drops },
  { name: 'fenced code', wrap: (s) => `\`\`\`x\n${s}\n\`\`\``, links: textBlock },
  { name: 'tilde fence', wrap: (s) => `~~~\n${s}\n~~~`, links: textBlock },
  { name: 'indented code', wrap: (s) => `    ${s}`, links: textBlock },
];

// ─── Markup that isn't an element ────────────────────────────────────────

/** Comments, CDATA, processing instructions, declarations, and bogus comments: each whole, empty, cut off, or closed early. */
function markupForms(): string[] {
  const bodies = ['', 'x', '-', '--', ' -- ', '-x-', '>', '<x>', '\nx\n', 'x\n\nx'];
  const forms: string[] = [];
  for (const body of bodies) {
    for (const end of ['-->', '--!>', '--->', '->', '>', '']) forms.push(`<!--${body}${end}`);
    for (const end of [']]>', ']]', '']) {
      forms.push(`<![CDATA[${body}${end}`, `<![cdata[${body}${end}`);
    }
    for (const end of ['?>', '>', '']) forms.push(`<?${body}${end}`, `<?x ${body}${end}`);
    for (const name of ['DOCTYPE', 'doctype', 'ELEMENT', 'ATTLIST', 'x', '']) {
      forms.push(`<!${name} ${body}>`, `<!${name}${body}`);
    }
    forms.push(`</${body}>`, `</ ${body}>`, `<//${body}>`, `< ${body}>`, `<=${body}>`);
  }
  return forms;
}

/** Character references a browser reads wrong or not at all, built from their parts. */
function malformedReferences(): string[] {
  const kinds = ['', '#', '#x', '#X'];
  const bodies = [
    ...['', '0', '65', '0000000065', '-1', '1a', 'zz', 'D800', '110000', '7FFFFFFF'],
    ...['99999999999', 'amp', 'AMP', 'lt', 'notit', 'Tab', 'colon', 'x'.repeat(40), ' 65'],
  ];
  const ends = [';', '', ' ', '=', 'x', ';;'];
  return kinds.flatMap((kind) =>
    bodies.flatMap((body) => ends.map((end) => `&${kind}${body}${end}`)),
  );
}

/** Where a malformed reference goes: text, destinations, link text, titles, image text, code, raw attributes, and headings. */
const REFERENCE_CONTEXTS: ReadonlyArray<(reference: string) => string> = [
  (r) => `x ${r} x`,
  (r) => `[x](${r}x)`,
  (r) => `[x](<https://x.test/${r}>)`,
  (r) => `[${r}](https://x.test)`,
  (r) => `[x](https://x.test "${r}")`,
  (r) => `![${r}](x)`,
  (r) => `\`${r}\``,
  (r) => `<x x="${r}">`,
  (r) => `<https://x.test/${r}>`,
  (r) => `# ${r}`,
  (r) => `[x][y]\n\n[y]: ${r}x`,
];

// ─── The corpus ──────────────────────────────────────────────────────────

export type Family = 'elements' | 'urls' | 'carriers' | 'markup';

export interface Entry {
  readonly family: Family;
  /** What generated it, for a failure message. */
  readonly label: string;
  readonly source: string;
  /** A URL's spelling, and where the construct carrying it may link. */
  readonly url?: { readonly spelling: Spelling; readonly links: LinksByMode };
}

/** Each element in each form, each attribute in each form, and each element with a seventh of the attributes. */
function elementEntries(): Entry[] {
  const entries: Entry[] = [];
  const forms = TAG_FORMS.length;
  const add = (e: string, a: string, f: number) =>
    entries.push({
      family: 'elements',
      label: `<${e}> ${a}, form ${f}`,
      source: TAG_FORMS[f]!(e, a),
    });
  ELEMENTS.forEach((e, i) => {
    for (let f = 0; f < forms; f++) add(e, ATTRIBUTES[(i * forms + f) % ATTRIBUTES.length]!, f);
  });
  ATTRIBUTES.forEach((a, j) => {
    for (let f = 0; f < forms; f++) add(ELEMENTS[(j * forms + f) % ELEMENTS.length]!, a, f);
  });
  // Each element meets every seventh attribute, from an offset that moves with it.
  ELEMENTS.forEach((e, i) => {
    ATTRIBUTES.forEach((a, j) => {
      if ((i + 3 * j) % 7 === 0) add(e, a, (i + j) % forms);
    });
  });
  return entries;
}

/**
 * Every spelling in the two inline links; each other carrier with every
 * ninth spelling, from an offset of its own; and a sample of the one-line
 * ones in each container that keeps or drops links.
 */
function urlEntries(): Entry[] {
  const spellings = allSpellings();
  const entries: Entry[] = [];
  const oneLine: Entry[] = [];
  URL_CARRIERS.forEach((carrier, c) => {
    spellings.forEach((spelling, k) => {
      if (c > 1 && k % 9 !== c % 9) return;
      const entry: Entry = {
        family: 'urls',
        label: `${carrier.name}, ${spelling.kind}`,
        source: carrier.carry(spelling.written, k),
        url: { spelling, links: carrier.links },
      };
      entries.push(entry);
      if (carrier.oneLine && !/[\n\r]/.test(entry.source)) oneLine.push(entry);
    });
  });
  const inside = (links: ContainerLinks, carried: Links): Links =>
    links === 'drops' ? 'nowhere' : carried;
  CONTAINERS.forEach((container, c) => {
    if (container.links.block === 'adds') return;
    oneLine.forEach((entry, k) => {
      if (k % 211 !== c) return;
      const carried = entry.url!.links;
      entries.push({
        family: 'urls',
        label: `${entry.label}, in ${container.name}`,
        source: container.wrap(entry.source),
        url: {
          spelling: entry.url!.spelling,
          links: {
            block: inside(container.links.block, carried.block),
            inline: inside(container.links.inline, carried.inline),
          },
        },
      });
    });
  });
  return entries;
}

/** Comment-like markup alone, among text, inside an element, and twice; and each malformed reference in each context. */
function markupEntries(): Entry[] {
  const entries: Entry[] = [];
  markupForms().forEach((form, k) => {
    const e = ELEMENTS[k % ELEMENTS.length]!;
    for (const source of [form, `x ${form} x`, `<${e}>${form}</${e}>`, `${form}\n\n${form}`]) {
      entries.push({ family: 'markup', label: 'comment-like markup', source });
    }
  });
  for (const reference of malformedReferences()) {
    REFERENCE_CONTEXTS.forEach((context, c) => {
      entries.push({
        family: 'markup',
        label: `malformed reference, context ${c}`,
        source: context(reference),
      });
    });
  }
  return entries;
}

/** Element and markup fragments in each container, each container taking a 29th of them from an offset of its own. */
function carrierEntries(fragments: readonly Entry[]): Entry[] {
  const entries: Entry[] = [];
  CONTAINERS.forEach((container, c) => {
    fragments.forEach((fragment, k) => {
      if (k % 29 !== c) return;
      entries.push({
        family: 'carriers',
        label: `${fragment.label}, in ${container.name}`,
        source: container.wrap(fragment.source),
      });
    });
  });
  return entries;
}

let built: readonly Entry[] | undefined;

/** The whole corpus, built once. */
export function corpus(): readonly Entry[] {
  if (!built) {
    const elements = elementEntries();
    const markup = markupEntries();
    built = [...elements, ...urlEntries(), ...carrierEntries([...elements, ...markup]), ...markup];
  }
  return built;
}

// ─── Where links may go ──────────────────────────────────────────────────

const PAGE = 'https://site.test/work/page';

/**
 * Where a link to `url` goes from PAGE. CommonMark writes a backslash that
 * isn't an escape as %5C, so it's never read as a slash; then the URL parser
 * drops leading and trailing C0 controls and spaces, and every tab and line
 * break. Null when no browser would resolve it.
 */
export function target(url: string): string | null {
  const cleaned = url
    .replaceAll('\\', '%5C')
    .replace(/^[\0-\x20]+|[\0-\x20]+$/g, '')
    .replace(/[\t\n\r]/g, '');
  try {
    return new URL(cleaned, PAGE).href;
  } catch {
    return null;
  }
}

/**
 * Where a spelling's destination may point: as a browser reads it, without
 * the whitespace around it, and, where a line break in it splits it, at
 * either part, since a definition's destination ends at a line break or
 * starts after one.
 */
function destinations({ written, reads }: Spelling): ReadonlySet<string | null> {
  const candidates = [reads, reads.trim()];
  if (/[\n\r]/.test(written)) {
    candidates.push(...reads.split(/\r\n?|\n/).map((part) => part.trim()));
  }
  return new Set(candidates.map(target));
}

/** Each link in `html` that goes somewhere the entry's construct may not link, rendered in `mode`. */
export function linkProblems(html: string, entry: Entry, mode: keyof LinksByMode): string[] {
  if (!entry.url) return [];
  const links = BARE_LINK.test(entry.source) ? 'anywhere' : entry.url.links[mode];
  if (links === 'anywhere') return [];
  const hrefs = Array.from(html.matchAll(/<a href="([^"]*)">/g), ([, href = '']) =>
    unescapeHtml(href),
  );
  if (links === 'nowhere') {
    return hrefs.map((href) => `a link to ${href} from a construct that never links`);
  }
  const allowed = destinations(entry.url.spelling);
  return hrefs
    .filter((href) => !allowed.has(target(href)))
    .map((href) => `a link to ${target(href)}, where its destination doesn't point`);
}
