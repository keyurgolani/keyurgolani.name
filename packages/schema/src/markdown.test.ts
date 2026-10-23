import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { DIAGNOSTIC_SEVERITIES } from './diagnostics';
import {
  MARKDOWN_LIMITS,
  MARKDOWN_MAX_ANGLE_BRACKETS,
  MARKDOWN_MAX_INLINE_MARKS,
  MARKDOWN_MAX_LENGTH,
  MARKDOWN_MAX_LINK_PARENS,
  MARKDOWN_MAX_LIST_DEPTH,
  MARKDOWN_MAX_LIST_ITEM_LINES,
  MARKDOWN_MAX_QUOTE_DEPTH,
  MARKDOWN_MAX_URL_PUNCTUATION,
  inlineMarksFor,
  markdownOverLimit,
  measureMarkdown,
  type MarkdownShape,
} from './markdown';
import { DIAGNOSTIC_REMEDIATIONS, validatePublicationUnit } from './validate';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

const SITE = [
  'schemaVersion: 2',
  'appearance:',
  '  variant: editorial',
  '  designLanguage: platform-neutral',
  '  colorScheme: warm',
  '  typography: classic',
  '  displayMode: system',
  'visitorControls:',
  '  variant: locked',
  '  designLanguage: locked',
  '  colorScheme: selectable',
  '  typography: locked',
  '  displayMode: selectable',
  'motionPolicy: respect-os',
  'features:',
  '  feed: true',
  '',
].join('\n');

/** A pair whose work description is `markdown`, in JSON so any text goes in as it is. */
function validate(markdown: string) {
  const portfolio = JSON.stringify({
    schemaVersion: 3,
    locale: 'en',
    direction: 'ltr',
    identity: { name: 'Rowan Test' },
    works: [{ id: 'atlas', title: 'Atlas', medium: 'system', description: markdown }],
    sections: [{ kind: 'works', id: 'work', items: ['atlas'] }],
  });
  return validatePublicationUnit({
    portfolio: { text: portfolio, format: 'json', name: 'portfolio.json' },
    site: { text: SITE, format: 'yaml', name: 'site.yml' },
  });
}

/** A table `columns` wide with `rows` rows under its header: columns times rows plus one cells. */
const table = (columns: number, rows: number) =>
  `${'a|'.repeat(columns - 1)}a\n${'|-'.repeat(columns)}|\n${'a\n'.repeat(rows)}`;

/** For each limit, text at exactly the limit, and text one past it. */
const AT_AND_OVER: Record<keyof MarkdownShape, (n: number) => string> = {
  length: (n) => 'a'.repeat(n),
  quoteDepth: (n) => `${'> '.repeat(n)}quoted`,
  listDepth: (n) => `${'- '.repeat(n)}item`,
  listItemLines: (n) => `- first\n${'  more\n'.repeat(n - 1)}`,
  // Each lazy line under a quoted item nests what follows two levels deeper.
  nestingDepth: (n) => `${'> - a\nb\n'.repeat(Math.floor(n / 2))}${n % 2 ? '> x' : 'x'}`,
  tableCells: (n) =>
    [n >= 64 ? table(64, Math.floor(n / 64) - 1) : '', n % 64 ? table(n % 64, 0) : '']
      .filter(Boolean)
      .join('\n'),
  definitions: (n) =>
    Array.from({ length: n }, (_, i) => `[d${i}]: https://a.test/${i}`).join('\n'),
  // At the length limit, where a field holds the most.
  inlineMarks: (n) =>
    `${'*a '.repeat(n)}${' word'.repeat(MARKDOWN_MAX_LENGTH)}`.slice(0, MARKDOWN_MAX_LENGTH),
  linkParens: (n) => `[a](b${'('.repeat(n)}`,
  angleBrackets: (n) => 'a < b '.repeat(n),
  urlPunctuation: (n) => `www.example.test/${'?'.repeat(n - 2)}`,
};

test('each limit holds at its value and refuses one past it, at the field pointer, with its code', () => {
  assert.equal(MARKDOWN_LIMITS.length, Object.keys(AT_AND_OVER).length);
  for (const { dimension, max, code } of MARKDOWN_LIMITS) {
    const at = AT_AND_OVER[dimension](max);
    const over = AT_AND_OVER[dimension](max + 1);
    assert.equal(measureMarkdown(at)[dimension], max, `${dimension} at the limit`);
    assert.equal(measureMarkdown(over)[dimension], max + 1, `${dimension} past the limit`);
    const ok = validate(at);
    assert.deepEqual(
      ok.diagnostics.map(({ code }) => code),
      [],
      `${dimension} at the limit validates`,
    );
    const refused = validate(over);
    assert.equal(refused.pair, null, dimension);
    assert.deepEqual(
      refused.diagnostics.map((d) => [d.code, d.severity, d.document, d.pointer]),
      [[code, 'blocks-preview', 'portfolio', '/works/0/description']],
      dimension,
    );
    const [finding] = refused.diagnostics;
    assert.ok(Number.isInteger(finding!.line) && Number.isInteger(finding!.column), dimension);
    assert.match(
      finding!.message,
      new RegExp(
        `the limit is ${max.toLocaleString('en-US')}\\.|at most ${max.toLocaleString('en-US')}\\.`,
      ),
    );
    assert.equal(finding!.remediation, DIAGNOSTIC_REMEDIATIONS[code]);
    assert.ok(
      finding!.remediation.includes(max.toLocaleString('en-US')),
      `${code} names ${dimension}'s limit`,
    );
  }
});

test('a shorter field holds fewer inline marks: four times the square root of its length, and 64 in any field', () => {
  const marks = (count: number, length: number) =>
    `${'*a '.repeat(count)}${' word'.repeat(length)}`.slice(0, length);
  for (const [length, max] of [
    [1, 64],
    [256, 64],
    [300, 69],
    [1024, 128],
    [2500, 200],
    [4096, 256],
    [MARKDOWN_MAX_LENGTH, MARKDOWN_MAX_INLINE_MARKS],
  ] as const) {
    assert.equal(inlineMarksFor(length), max, `${length} characters`);
    if (3 * (max + 1) > length) continue;
    assert.equal(measureMarkdown(marks(max, length)).inlineMarks, max);
    assert.equal(
      markdownOverLimit(marks(max, length)),
      null,
      `${max} marks in ${length} characters`,
    );
    const over = markdownOverLimit(marks(max + 1, length));
    assert.ok(over, `${max + 1} marks in ${length} characters`);
    assert.equal(over.limit.dimension, 'inlineMarks');
    assert.equal(over.value, max + 1);
    const [finding] = validate(marks(max + 1, length)).diagnostics;
    assert.ok(finding);
    assert.equal(finding.code, 'markdown.too-dense');
    assert.ok(
      finding.message.endsWith(
        `in ${length.toLocaleString('en-US')} characters; the limit is ${max.toLocaleString('en-US')}.`,
      ),
      finding.message,
    );
  }
  assert.equal(MARKDOWN_MAX_INLINE_MARKS, 362);
});

test('the Markdown codes block publish and preview, and their messages never quote the field', () => {
  for (const code of ['markdown.too-long', 'markdown.too-deep', 'markdown.too-dense'] as const) {
    assert.equal(DIAGNOSTIC_SEVERITIES[code], 'blocks-preview');
  }
  const canary = 'zqxcanary';
  for (const text of [
    `${canary} `.repeat(MARKDOWN_MAX_LENGTH),
    `${'> '.repeat(MARKDOWN_MAX_QUOTE_DEPTH + 1)}${canary}`,
    `*${canary} `.repeat(MARKDOWN_MAX_INLINE_MARKS + 1),
  ]) {
    const [finding] = validate(text).diagnostics;
    assert.ok(finding);
    assert.ok(!finding.message.includes(canary) && !finding.remediation.includes(canary));
  }
});

test("every hostile shape from #58's follow-up is refused at validation, before any renderer sees it", () => {
  const shapes: Record<string, string> = {
    // Quadratic in marked's delimiter pattern: about 3 s in block mode.
    'x and 40,000 asterisks': `x ${'*'.repeat(40_000)}`,
    // About 22 s inline.
    '100 KiB of asterisks inline': '*'.repeat(100 * 1024),
    // Out of stack in marked at a few thousand levels.
    '4,000 levels of quotes': `${'>'.repeat(4000)} x`,
    '4,000 levels of emphasis': `${'*'.repeat(4000)}x${'*'.repeat(4000)}`,
    // 2,000 levels of lists exhausted a 4 GB heap; nested on one line they fit a field's bytes.
    '2,000 levels of lists': `${'- '.repeat(2000)}x`,
    '2,000 levels of indented lists': Array.from({ length: 2000 }, (_, i) => `${'  '.repeat(i)}- x`)
      .join('\n')
      .slice(0, 9000),
    'link destinations nested 1,000 deep': '[a]('.repeat(1000),
    'a web address with 4,000 question marks': `www.a${'?'.repeat(4000)}`,
    '2,000 unclosed processing instructions': '<?'.repeat(2000),
    'one list item 2,000 lines long': `- x\n${'a\n'.repeat(2000)}`,
    // The review's slow fields (#65), each within every limit before them.
    'a 1,024-column table of one-character rows': `${table(1024, 0)}${'a\n'.repeat(1500)}`,
    'a 768-column table under 256 definitions': `${Array.from({ length: 256 }, (_, i) => `[d${i}]: u`).join('\n')}\n\n${table(768, 8)}`,
    'a quoted item and a lazy line, repeated': '> - a\nb\n'.repeat(1024),
    'quotes around lazy lines, repeated': '> > a\nb\n'.repeat(1024),
    'a quoted ladder of lists and a lazy line, repeated': `> ${'- '.repeat(8)}a\nb\n`.repeat(372),
  };
  for (const [name, text] of Object.entries(shapes)) {
    const result = validate(text);
    assert.equal(result.pair, null, name);
    assert.ok(
      result.diagnostics.some(
        ({ code, pointer }) => code.startsWith('markdown.') && pointer === '/works/0/description',
      ),
      name,
    );
  }
});

/** Every string in every document the repository commits, with where it is. */
function committedStrings(): Array<{ where: string; text: string }> {
  const files = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n')
    .filter((file) => /(^|\/)portfolio[^/]*\.(ya?ml|json)$|(^|\/)example\.yml$/.test(file))
    // The pairs that show each Markdown code are over a limit on purpose.
    .filter((file) => !file.includes('__fixtures__/invalid/markdown.'));
  assert.ok(files.length > 50, 'the fixtures are found');
  const strings: Array<{ where: string; text: string }> = [];
  const walk = (value: unknown, where: string) => {
    if (typeof value === 'string') strings.push({ where, text: value });
    else if (Array.isArray(value)) value.forEach((item, i) => walk(item, `${where}/${i}`));
    else if (value && typeof value === 'object') {
      for (const [key, item] of Object.entries(value)) walk(item, `${where}/${key}`);
    }
  };
  for (const file of files) {
    const text = readFileSync(path.join(ROOT, file), 'utf8');
    let data: unknown;
    try {
      data = file.endsWith('.json') ? JSON.parse(text) : parseYaml(text);
    } catch {
      continue; // The parse.syntax fixtures.
    }
    walk(data, `${file}#`);
  }
  return strings;
}

test('every committed fixture, profession pair, and example keeps every string at least 4 times inside each limit', () => {
  const strings = committedStrings();
  for (const { dimension, max, maxFor } of MARKDOWN_LIMITS) {
    // The share of its limit, at its own length, each string takes.
    let largest = { share: 0, value: 0, limit: max, where: '' };
    for (const { where, text } of strings) {
      const value = measureMarkdown(text)[dimension];
      const limit = maxFor ? maxFor(text.length) : max;
      if (value / limit > largest.share) largest = { share: value / limit, value, limit, where };
    }
    assert.ok(
      largest.value * 4 <= largest.limit,
      `${dimension}: ${largest.value} at ${largest.where} is within 4 times of ${largest.limit}`,
    );
  }
});

/** The fewest milliseconds `run` takes in five tries. */
function fastest(run: () => unknown): number {
  let best = Infinity;
  for (let i = 0; i < 5; i++) {
    const start = performance.now();
    run();
    best = Math.min(best, performance.now() - start);
  }
  return best;
}

test('the measure is linear: four times the text takes at most about four times the time', () => {
  // Shapes that are quadratic or worse in marked, and plain prose, at 256 KiB and 1 MiB.
  const shapes = [
    (n: number) => `x ${'*'.repeat(n)}`,
    (n: number) => '[a]('.repeat(n / 4),
    (n: number) => `${'- '.repeat(n / 2)}x`,
    (n: number) => `${'>'.repeat(n)} x`,
    (n: number) => `- x\n${'a\n'.repeat(n / 2)}`,
    (n: number) =>
      'The quick brown fox, *jumps* over [the](https://a.test) lazy dog. '.repeat(n / 64),
    // The block structure: tables, definitions, lazy lines, fences, and code.
    (n: number) => `${table(n / 8, 0)}${'a\n'.repeat(n / 4)}`,
    (n: number) => '[a]: b\n'.repeat(n / 7),
    (n: number) => '> - a\nb\n'.repeat(n / 8),
    (n: number) => '> x\n```\n'.repeat(n / 8),
    (n: number) => `\`\`\`\n${'> - *a\n'.repeat(n / 8)}`,
    (n: number) => `\n${'    > - *a <b>\n'.repeat(n / 16)}`,
    (n: number) => '-\t- \t> x\n'.repeat(n / 10),
  ];
  for (const shape of shapes) {
    const small = shape(1 << 18);
    const large = shape(1 << 20);
    measureMarkdown(small);
    const ratio = fastest(() => measureMarkdown(large)) / fastest(() => measureMarkdown(small));
    // Linear is 4 times; quadratic would be 16. The slack is for a busy machine.
    assert.ok(
      ratio < 8,
      `${small.slice(0, 12)}: four times the text took ${ratio.toFixed(2)} times as long`,
    );
  }
});

test('the measure counts what marked reads, and leaves escaped and inert marks out', () => {
  const cases: Array<[string, Partial<MarkdownShape>]> = [
    ['> > > x', { quoteDepth: 3 }],
    ['>>> x', { quoteDepth: 3 }],
    ['- - - x', { listDepth: 3 }],
    ['- - -', { listDepth: 0 }],
    ['- a\n  - b\n    - c\n- d', { listDepth: 3 }],
    ['- a\n\nparagraph\n\n  - b', { listDepth: 1 }],
    ['1. a\n   1. b', { listDepth: 2 }],
    ['- x\n\n  more\n  more', { listItemLines: 2 }],
    ['- x\nlazy\nlazy', { listItemLines: 3 }],
    ['*a* **b** _c_ ~~d~~ !e `f`', { inlineMarks: 15 }],
    ['\\*a\\* a * b _ c ~ d', { inlineMarks: 0 }],
    ['* item\n* item', { inlineMarks: 0 }],
    ['[a](https://a.test/b) and [c](d)', { linkParens: 0 }],
    ['[a](b(c', { linkParens: 1 }],
    ['[a]([a]([a](', { linkParens: 3 }],
    ['[a]( ((', { linkParens: 2 }],
    ['[a](b (c)', { linkParens: 1 }],
    ['<b> a < b <!-- c -->', { angleBrackets: 3 }],
    ['see www.a.test/b?c=d&e=f.', { urlPunctuation: 5 }],
    ['www.a. b???', { urlPunctuation: 2 }],
    ['- a\r\n  - b', { listDepth: 2 }],
    // Nesting: a lazy line under a quoted list or quote nests what follows.
    ['> a\nlazy', { nestingDepth: 1 }],
    ['> - a\n> b', { nestingDepth: 2 }],
    ['> - a\nb\n> - c', { nestingDepth: 4 }],
    ['> > a\nb\n> > c', { nestingDepth: 3 }],
    ['> - a\nb\n\n> - c', { nestingDepth: 2 }],
    // Tables: rows run to a blank line, each the header's width.
    ['a|b\n-|-\nc|d\ne', { tableCells: 6 }],
    ['a|b|c\n|-|-|-|\n\nd', { tableCells: 3 }],
    ['a\n:-\nb', { tableCells: 2 }],
    ['[a]: https://a.test\n[b]: https://b.test "B"', { definitions: 2 }],
    // Code is inert in block mode: its marks, quotes, and lists count for nothing.
    [
      '```\n> > > > >\n- - - - - x\n*a <b>\n```',
      { quoteDepth: 0, listDepth: 0, inlineMarks: 0, angleBrackets: 0 },
    ],
    ['~~~~\n```\n*a\n~~~~\n*b*', { inlineMarks: 2 }],
    ['    >>>>> x\n    *a <b>', { quoteDepth: 0, inlineMarks: 0, angleBrackets: 0 }],
    ['- a\n\n        *b*', { inlineMarks: 0 }],
    // Not code: a paragraph's next line, a fence a lazy line can't open,
    // and wherever marked may have read the lines another way.
    ['a\n    *b*', { inlineMarks: 2 }],
    ['> a\n```*b*', { inlineMarks: 5 }],
    ['<div>\n\n```\n*b*\n```', { inlineMarks: 8 }],
    ['[x]: https://a.test\n\n```\n*b*\n```', { inlineMarks: 8 }],
    ['a\n2) ```\n   *b*\n   ```', { inlineMarks: 8 }],
    [' - ```\n   *b*\n==', { inlineMarks: 5 }],
    ['> - a\nb\n\n```\n*b*\n```', { inlineMarks: 8 }],
  ];
  for (const [text, expected] of cases) {
    const shape = measureMarkdown(text);
    for (const [key, value] of Object.entries(expected)) {
      assert.equal(shape[key as keyof MarkdownShape], value, `${JSON.stringify(text)} ${key}`);
    }
  }
  // Inline, a fence is only backticks: what's inside it counts.
  assert.equal(measureMarkdown('```\n*a <b>\n```', 'inline').inlineMarks, 7);
  assert.equal(measureMarkdown('```\n*a <b>\n```', 'inline').angleBrackets, 1);
  assert.equal(MARKDOWN_MAX_LINK_PARENS + MARKDOWN_MAX_ANGLE_BRACKETS > 0, true);
  assert.ok(MARKDOWN_MAX_LIST_DEPTH > 0 && MARKDOWN_MAX_LIST_ITEM_LINES > 0);
  assert.ok(MARKDOWN_MAX_URL_PUNCTUATION > 0);
});

test('code in a fence or an indented block validates whatever it holds, as marked leaves it inert', () => {
  const samples: Record<string, string> = {
    'a fenced diff with conflict markers': [
      'The merge left this:',
      '',
      '```diff',
      '<<<<<<< HEAD',
      'const retries = 3;',
      '=======',
      'const retries = 5;',
      '>>>>>>> feature',
      '```',
    ].join('\n'),
    'a fenced YAML sample nested 10 deep': [
      '~~~yaml',
      ...Array.from({ length: 10 }, (_, i) => `${'  '.repeat(i)}- level${i}:`),
      '~~~',
    ].join('\n'),
    'a fence with more marks and < than a field allows': `\`\`\`html\n${'<p>*a* _b_ ~c~ !d `e`</p>\n'.repeat(60)}\`\`\``,
    'the same as indented code': `Before:\n\n${'    <p>*a* _b_ ~c~ !d `e`</p> >>>>>>> x\n'.repeat(60)}`,
    'a shell transcript in a quote': `> Run it:\n>\n> \`\`\`\n${'> >>> print(1)\n'.repeat(12)}> \`\`\``,
  };
  for (const [name, text] of Object.entries(samples)) {
    assert.ok(text.length <= MARKDOWN_MAX_LENGTH, name);
    assert.deepEqual(
      validate(text).diagnostics.map(({ code }) => code),
      [],
      `${name} validates`,
    );
  }
  // Read inline, as renderInlineMarkdown reads a field, the same fence is text.
  const fence = samples['a fence with more marks and < than a field allows']!;
  assert.equal(markdownOverLimit(fence), null);
  assert.equal(markdownOverLimit(fence, 'inline')?.limit.dimension, 'inlineMarks');
});
