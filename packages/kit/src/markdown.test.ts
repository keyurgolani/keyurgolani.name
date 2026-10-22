import test from 'node:test';
import assert from 'node:assert/strict';
import { getDefaults, Marked, marked } from 'marked';
import { isAllowedUrl } from '@portfolio/schema';
import { escapeHtml } from './html-escape';
import { renderInlineMarkdown, renderMarkdown } from './markdown';
import {
  ALLOWED_URLS,
  allSpellings,
  ATTRIBUTES,
  CONTAINERS,
  corpus,
  ELEMENTS,
  EVENT_HANDLERS,
  linkProblems,
  REFUSED_SCHEMES,
  spellingsOf,
  TAG_FORMS,
  URL_CARRIERS,
  type Entry,
  type Family,
} from './test-support/markdown-corpus';
import { htmlProblems, type Allowlist } from './test-support/strict-html';

// #10 slice 1 item 8: markdown renders through one allowlist, written from
// marked's tokens (markdown.ts). The corpus (test-support/markdown-corpus.ts)
// is generated from the grammar of HTML, URLs, and Markdown, and every input
// goes through both renderers. The strict reader (test-support/strict-html.ts)
// accepts only what the renderer may write: allowlisted elements where a
// browser keeps them, href alone and only to a URL #4's link rule allows,
// wherever a browser would resolve it, and escaped text. The threat model's
// script-1 row cites these titles.

const RENDER: Readonly<Record<Allowlist, (source: string) => string>> = {
  block: renderMarkdown,
  inline: renderInlineMarkdown,
};
const MODES = ['block', 'inline'] as const;

const family = (name: Family) => corpus().filter((entry) => entry.family === name);

/** Each render of `entries` the reader or the link check finds fault with, or `also` does, one line each. */
function failures(
  entries: readonly Entry[],
  also: (html: string, entry: Entry) => string[] = () => [],
): string[] {
  const lines: string[] = [];
  for (const entry of entries) {
    for (const mode of MODES) {
      const html = RENDER[mode](entry.source);
      const problems = [
        ...htmlProblems(html, mode),
        ...linkProblems(html, entry, mode),
        ...also(html, entry),
      ];
      if (problems.length > 0) {
        lines.push(
          `${entry.label}: ${JSON.stringify(entry.source)} (${mode}) gives ${JSON.stringify(html)}: ${problems.join('; ')}`,
        );
      }
    }
  }
  return lines;
}

function assertClean(entries: readonly Entry[], also?: (html: string, entry: Entry) => string[]) {
  assert.ok(entries.length > 1000, `only ${entries.length} inputs`);
  const found = failures(entries, also);
  assert.equal(
    found.length,
    0,
    `${found.length} of ${entries.length * 2} renders:\n${found.slice(0, 10).join('\n')}`,
  );
}

/** The allowlists #10 sets, block and inline. */
const BLOCK = new Set('p a em strong code pre ul ol li blockquote h3 h4 h5 h6 br hr'.split(' '));
const INLINE = new Set('a em strong code br'.split(' '));

test('the strict reader rejects any other element, any attribute but an allowed href, a refused or encoded href, a misplaced element, and unescaped text', () => {
  const rejects = (html: string, allowlist: Allowlist) => htmlProblems(html, allowlist).length > 0;
  // Everything the renderer writes, as it writes it, passes.
  const written = [
    '<h3>x</h3>\n<p>x <a href="https://x.test/?a=1&amp;b=&#39;">x <em>x</em></a><br><code>&lt;x&gt;</code></p>\n',
    '<ul>\n<li>x<ol>\n<li><p>x &amp; &#x26; &lt;</p>\n</li>\n</ol>\n</li>\n</ul>\n',
    '<blockquote>\n<pre><code>x\n</code></pre>\n<h6><strong>x</strong></h6>\n</blockquote>\n<hr>\n',
  ].join('');
  assert.deepEqual(htmlProblems(written, 'block'), []);
  assert.deepEqual(
    htmlProblems('x <a href="#x">x</a> <strong>x</strong><br><code>x</code>', 'inline'),
    [],
  );
  for (const name of ELEMENTS) {
    if (!BLOCK.has(name)) {
      assert.ok(rejects(`<p><${name}>x</${name}></p>\n`, 'block'), name);
      assert.ok(rejects(`<${name}>x</${name}>\n`, 'block'), name);
    }
    if (!INLINE.has(name)) assert.ok(rejects(`x<${name}>x</${name}>`, 'inline'), name);
  }
  for (const attribute of ATTRIBUTES) {
    assert.ok(rejects(`<p ${attribute}="x">x</p>\n`, 'block'), attribute);
    assert.ok(rejects(`<a href="#x" ${attribute}="x">x</a>`, 'inline'), attribute);
  }
  // Every spelling of a URL the link rule refuses, escaped as the renderer
  // escapes an href, and raw, as marked wrote it for the browser to decode.
  for (const { written: raw, reads } of allSpellings()) {
    if (isAllowedUrl(reads)) continue;
    assert.ok(rejects(`<a href="${escapeHtml(reads)}">x</a>`, 'inline'), JSON.stringify(reads));
    assert.ok(rejects(`<a href="${raw}">x</a>`, 'inline'), JSON.stringify(raw));
  }
  const misplaced: ReadonlyArray<readonly [string, Allowlist]> = [
    ['<p>x', 'block'],
    ['<p>x</p></p>\n', 'block'],
    ['<p><p>x</p></p>\n', 'block'],
    ['<p><h3>x</h3></p>\n', 'block'],
    ['<li>x</li>\n', 'block'],
    ['<ul>x</ul>\n', 'block'],
    ['<ol>\n<p>x</p>\n</ol>\n', 'block'],
    ['<blockquote>x</blockquote>\n', 'block'],
    ['<pre>x</pre>\n', 'block'],
    ['<pre><code>x</code><code>x</code></pre>\n', 'block'],
    ['<p><code><em>x</em></code></p>\n', 'block'],
    ['<p><a href="#x"><a href="#x">x</a></a></p>\n', 'block'],
    ['x\n', 'block'],
    ['<em>x</em>\n', 'block'],
    ['<p>x</p>', 'inline'],
    ['<ul>\n<li>x</li>\n</ul>\n', 'inline'],
    ['<hr>', 'inline'],
  ];
  // Forms the renderer never writes, and text it always escapes.
  const unwritten: readonly string[] = [
    '<p>x<br/></p>\n',
    '<p>x</p >\n',
    '<P>x</P>\n',
    "<p><a href='#x'>x</a></p>\n",
    '<p><a href=#x>x</a></p>\n',
    '<p><a  href="#x">x</a></p>\n',
    '<p><a href = "#x">x</a></p>\n',
    '<p><a href="#x" >x</a></p>\n',
    '<p><a href="&#35;x">x</a></p>\n',
    '<p><a href="#x\t">x</a></p>\n',
    '<p>x & x</p>\n',
    '<p>&amp</p>\n',
    '<p>"</p>\n',
    "<p>'</p>\n",
    '<p>></p>\n',
    '<p>\0</p>\n',
    '<p><!-- x --></p>\n',
    '<p><![CDATA[x]]></p>\n',
    '<p><?x?></p>\n',
    '<!DOCTYPE x>\n',
  ];
  for (const [html, allowlist] of misplaced) assert.ok(rejects(html, allowlist), html);
  for (const html of unwritten) assert.ok(rejects(html, 'block'), html);
});

test('every element, in every tag form, with every global, URL, and event-handler attribute, renders as escaped text the strict reader accepts, block and inline', () => {
  // Escaped, not dropped: the tag shows as it was typed.
  assertClean(family('elements'), (html) => (html.includes('&lt;') ? [] : ['the tag is gone']));
});

test('a link renders only where its destination points, never to a refused scheme or another host, however the URL is spelled and whichever construct carries it', () => {
  assertClean(family('urls'));
});

test('an allowed URL spelled in other case or with character references still renders as a link to it, inline, in angle brackets, through a definition, and as an autolink', () => {
  let checked = 0;
  for (const url of ALLOWED_URLS) {
    for (const { kind, written, reads } of spellingsOf(url)) {
      const same = reads.toLowerCase() === url.toLowerCase() && /^[\x21-\x7e]+$/.test(reads);
      if (!same || !['plain', 'case', 'reference'].includes(kind)) continue;
      const link = `<a href="${escapeHtml(reads)}">x</a>`;
      for (const source of [`[x](${written})`, `[x](<${written}>)`]) {
        assert.equal(renderMarkdown(source), `<p>${link}</p>\n`, source);
        assert.equal(renderInlineMarkdown(source), link, source);
      }
      for (const source of [`[x][r]\n\n[r]: ${written}`, `[x][r]\n\n[r]: <${written}> "x"`]) {
        assert.equal(renderMarkdown(source), `<p>${link}</p>\n`, source);
      }
      // An autolink's scheme is spelled out, never a reference.
      if (kind !== 'reference' && /^[a-z]+:/i.test(url)) {
        const autolink = `<a href="${escapeHtml(reads)}">${escapeHtml(written)}</a>`;
        assert.equal(renderMarkdown(`<${written}>`), `<p>${autolink}</p>\n`, written);
        assert.equal(renderInlineMarkdown(`<${written}>`), autolink, written);
      }
      checked++;
    }
  }
  assert.ok(checked > 300, `only ${checked} spellings`);
});

test('element and markup fragments inside lists, quotes, headings, emphasis, tables, titles, link and image text, and code render only allowlisted markup', () => {
  assertClean(family('carriers'));
});

test('comments, CDATA, processing instructions, declarations, and malformed character references render as nothing or as escaped text', () => {
  assertClean(family('markup'));
});

test('the corpus holds every element and attribute in every tag form, every URL in every kind of spelling, and every carrier and container', () => {
  // The names come from the DOM library, so a library that moved them would show here.
  assert.ok(ELEMENTS.length > 200, `${ELEMENTS.length} elements`);
  assert.ok(EVENT_HANDLERS.length > 150, `${EVENT_HANDLERS.length} event handlers`);
  const raw = ['script', 'style', 'textarea', 'title', 'xmp', 'plaintext', 'noscript', 'noembed'];
  const foreign = ['svg', 'math', 'foreignObject', 'annotation-xml', 'mglyph'];
  const forms = ['form', 'input', 'button', 'select', 'selectedcontent', 'option'];
  const embedding = ['iframe', 'object', 'embed', 'img', 'video', 'audio', 'picture', 'template'];
  for (const name of [...raw, ...foreign, ...forms, ...embedding, 'base', 'meta', 'link']) {
    assert.ok(ELEMENTS.includes(name), name);
  }
  for (const name of ['onerror', 'onload', 'onclick', 'onfocus', 'onanimationstart', 'ontoggle']) {
    assert.ok(EVENT_HANDLERS.includes(name), name);
  }
  for (const name of ['style', 'src', 'srcset', 'href', 'xlink:href', 'formaction', 'srcdoc']) {
    assert.ok(ATTRIBUTES.includes(name), name);
  }
  assert.ok(ATTRIBUTES.includes('background'));
  const entries = corpus();
  // Each element and each attribute in every form.
  const formsOf = new Map<string, Set<number>>();
  for (const { family: name, label } of entries) {
    const match = name === 'elements' ? /^<(.+)> (\S+), form (\d+)$/.exec(label) : null;
    if (!match) continue;
    for (const key of [`<${match[1]}>`, match[2]!]) {
      if (!formsOf.has(key)) formsOf.set(key, new Set());
      formsOf.get(key)!.add(Number(match[3]));
    }
  }
  for (const key of [...ELEMENTS.map((name) => `<${name}>`), ...ATTRIBUTES]) {
    assert.equal(formsOf.get(key)?.size, TAG_FORMS.length, key);
  }
  // Each URL in each kind of spelling, and every spelling in both inline links.
  for (const scheme of ['javascript', 'vbscript', 'data', 'file', 'blob']) {
    assert.ok(REFUSED_SCHEMES.includes(scheme), scheme);
  }
  for (const url of [...REFUSED_SCHEMES.map((scheme) => `${scheme}:x`), ...ALLOWED_URLS]) {
    assert.deepEqual(
      [...new Set(spellingsOf(url).map(({ kind }) => kind))].sort(),
      ['case', 'inserted', 'leading', 'percent', 'plain', 'reference'],
      url,
    );
  }
  const labels = entries.map(({ label }) => label);
  for (const carrier of ['inline link', 'inline link in angle brackets']) {
    const pattern = new RegExp(`^${carrier}, \\w+$`);
    assert.equal(labels.filter((label) => pattern.test(label)).length, allSpellings().length);
  }
  for (const { name } of URL_CARRIERS) {
    assert.ok(
      labels.some((label) => label.startsWith(`${name}, `)),
      name,
    );
  }
  for (const { name } of CONTAINERS) {
    assert.ok(
      labels.some((label) => label.endsWith(`, in ${name}`)),
      name,
    );
  }
});

test('every input renders the same markup a second time, in reverse order, and with the global marked set up otherwise', () => {
  const entries = corpus();
  const render = ({ source }: Entry) =>
    `${renderMarkdown(source)}\0${renderInlineMarkdown(source)}`;
  const first = entries.map(render);
  const again = [...entries].reverse().map(render).reverse();
  assert.deepEqual(
    entries.filter((_, i) => first[i] !== again[i]).map(({ source }) => source),
    [],
  );
  // The renderer has its own Marked: options another module sets on the global one don't reach it.
  marked.setOptions({ gfm: false, breaks: true, pedantic: true });
  try {
    const changed = entries.filter((entry, i) => i % 7 === 0 && render(entry) !== first[i]);
    assert.deepEqual(
      changed.map(({ source }) => source),
      [],
    );
  } finally {
    marked.setOptions(getDefaults());
  }
});

/** Inputs to check by eye: [source, as blocks, inline]. */
const DOCUMENTED: ReadonlyArray<readonly [string, string, string]> = [
  // Raw HTML shows as it was typed.
  [
    '<script>x</script>',
    '<p>&lt;script&gt;x&lt;/script&gt;</p>\n',
    '&lt;script&gt;x&lt;/script&gt;',
  ],
  [
    'x <b onclick="x">x</b>',
    '<p>x &lt;b onclick=&quot;x&quot;&gt;x&lt;/b&gt;</p>\n',
    'x &lt;b onclick=&quot;x&quot;&gt;x&lt;/b&gt;',
  ],
  // Comments, CDATA, processing instructions, and declarations are dropped.
  ['x <!-- x --> x', '<p>x  x</p>\n', 'x  x'],
  ['<!-- x -->\n\n<![CDATA[x]]>\n\n<?x x?>\n\n<!DOCTYPE x>', '', '\n\n\n\n\n\n'],
  // An image is its alt text.
  ['![x *y*](https://x.test/x.png)', '<p>x y</p>\n', 'x y'],
  // Headings start at h3: the section renderers own h1 and h2.
  ['# x\n\n## x\n\n#### x', '<h3>x</h3>\n<h3>x</h3>\n<h4>x</h4>\n', '# x\n\n## x\n\n#### x'],
  ['x\n=', '<h3>x</h3>\n', 'x\n='],
  // A link the rule refuses is its text, however it's spelled.
  ['[x](javascript:x)', '<p>x</p>\n', 'x'],
  ['[x](java&#115;cript:x)', '<p>x</p>\n', 'x'],
  ['[x](//x.test)', '<p>x</p>\n', 'x'],
  ['<javascript:x>', '<p>javascript:x</p>\n', 'javascript:x'],
  // One it allows keeps its href alone, references decoded, then percent-encoded.
  [
    '[x](https://x.test/é "x")',
    '<p><a href="https://x.test/%C3%A9">x</a></p>\n',
    '<a href="https://x.test/%C3%A9">x</a>',
  ],
  [
    '[x](&#104;ttps://x.test)',
    '<p><a href="https://x.test">x</a></p>\n',
    '<a href="https://x.test">x</a>',
  ],
  // Without its semicolon, a legacy name such as amp or lt decodes as it does
  // in a browser's attribute value, except before `=`.
  [
    '[x](https://x.test/?a&amp=b)',
    '<p><a href="https://x.test/?a&amp;amp=b">x</a></p>\n',
    '<a href="https://x.test/?a&amp;amp=b">x</a>',
  ],
  [
    '[x](https://x.test/?a&lt)',
    '<p><a href="https://x.test/?a%3C">x</a></p>\n',
    '<a href="https://x.test/?a%3C">x</a>',
  ],
  [
    '[x](https://x.test/?a&amp;b=c)',
    '<p><a href="https://x.test/?a&amp;b=c">x</a></p>\n',
    '<a href="https://x.test/?a&amp;b=c">x</a>',
  ],
  // A destination with a space, which only angle brackets allow, is refused.
  // Without them, a raw space means no link at all, and %20 is the way to write one.
  ['[x](<https://x.test/a b>)', '<p>x</p>\n', 'x'],
  [
    '[x](https://x.test/a b)',
    '<p>[x](<a href="https://x.test/a">https://x.test/a</a> b)</p>\n',
    '[x](<a href="https://x.test/a">https://x.test/a</a> b)',
  ],
  [
    '[x](https://x.test/a%20b)',
    '<p><a href="https://x.test/a%20b">x</a></p>\n',
    '<a href="https://x.test/a%20b">x</a>',
  ],
  // A table is a paragraph per row and a line per cell.
  [
    '| x | y |\n| - | - |\n| z | w |',
    '<p>x<br>y</p>\n<p>z<br>w</p>\n',
    '| x | y |\n| - | - |\n| z | w |',
  ],
  // An ordered list starts at 1. Task boxes, strikethrough, and a fence's language go.
  ['3. x\n4. y', '<ol>\n<li>x</li>\n<li>y</li>\n</ol>\n', '3. x\n4. y'],
  ['- [x] y\n- ~~z~~', '<ul>\n<li>y</li>\n<li>z</li>\n</ul>\n', '- [x] y\n- z'],
  ['```js\nx\n```', '<pre><code>x\n</code></pre>\n', '<code>js x </code>'],
  // GFM's bare URLs and emails link.
  [
    'www.x.test and x@x.test',
    '<p><a href="http://www.x.test">www.x.test</a> and <a href="mailto:x@x.test">x@x.test</a></p>\n',
    '<a href="http://www.x.test">www.x.test</a> and <a href="mailto:x@x.test">x@x.test</a>',
  ],
];

test('representative inputs render exactly as documented: raw HTML as text, comments dropped, images as alt text, headings from h3, refused links as text, and tables as paragraphs', () => {
  for (const [source, block, inline] of DOCUMENTED) {
    assert.equal(renderMarkdown(source), block, source);
    assert.equal(renderInlineMarkdown(source), inline, source);
  }
});

test('source nested deeper than marked can take renders as escaped text instead of throwing, a paragraph per run of lines, and the strict reader accepts it', () => {
  // marked recurses once per level of nesting. Where it runs out of stack
  // depends on the runtime and how warm it is: around 2,000 to 3,000 levels of
  // quote, or 4,000 to 7,000 emphasis markers. Near there, either way out is
  // safe; well past it, the fallback is exact.
  const quote = (depth: number) => `${'> '.repeat(depth)}x`;
  const emphasis = (count: number) => `${'*'.repeat(count)}x${'*'.repeat(count)}`;
  for (const source of [quote(2000), emphasis(5000)]) {
    for (const mode of MODES) {
      assert.deepEqual(htmlProblems(RENDER[mode](source), mode), [], `${source.length} chars`);
    }
  }
  const before = renderMarkdown('# x\n\n> *x*');
  const deepQuote = `${'>'.repeat(20000)} x`;
  const deepEmphasis = emphasis(10000);
  assert.throws(() => new Marked().lexer(deepQuote), RangeError);
  assert.throws(() => new Marked().lexer(deepEmphasis), RangeError);
  const quoted = `${'&gt;'.repeat(20000)} x`;
  const mixed = `x <b>x</b>\n\n${deepEmphasis}\n \n"&amp;"`;
  const cases: ReadonlyArray<readonly [string, string, string, string]> = [
    ['a 20,000-deep quote', deepQuote, `<p>${quoted}</p>\n`, quoted],
    ['10,000 emphasis markers a side', deepEmphasis, `<p>${deepEmphasis}</p>\n`, deepEmphasis],
    [
      'paragraphs around them',
      mixed,
      `<p>x &lt;b&gt;x&lt;/b&gt;</p>\n<p>${deepEmphasis}</p>\n<p>&quot;&amp;amp;&quot;</p>\n`,
      `x &lt;b&gt;x&lt;/b&gt;\n\n${deepEmphasis}\n \n&quot;&amp;amp;&quot;`,
    ],
  ];
  for (const [name, source, block, inline] of cases) {
    assert.ok(renderMarkdown(source) === block, `${name}, as blocks`);
    assert.ok(renderInlineMarkdown(source) === inline, `${name}, inline`);
    assert.deepEqual(htmlProblems(block, 'block'), [], name);
    assert.deepEqual(htmlProblems(inline, 'inline'), [], name);
  }
  // The next render goes on as before.
  assert.equal(renderMarkdown('# x\n\n> *x*'), before);
});
