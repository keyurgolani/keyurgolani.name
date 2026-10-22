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

/** For each limit, text at exactly the limit, and text one past it. */
const AT_AND_OVER: Record<keyof MarkdownShape, (n: number) => string> = {
  length: (n) => 'a'.repeat(n),
  quoteDepth: (n) => `${'> '.repeat(n)}quoted`,
  listDepth: (n) => `${'- '.repeat(n)}item`,
  listItemLines: (n) => `- first\n${'  more\n'.repeat(n - 1)}`,
  inlineMarks: (n) => '*a '.repeat(n),
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
  for (const { dimension, max } of MARKDOWN_LIMITS) {
    let largest = { value: 0, where: '' };
    for (const { where, text } of strings) {
      const value = measureMarkdown(text)[dimension];
      if (value > largest.value) largest = { value, where };
    }
    assert.ok(
      largest.value * 4 <= max,
      `${dimension}: ${largest.value} at ${largest.where} is within 4 times of ${max}`,
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
  // Shapes that are quadratic or worse in marked, and plain prose, at 512 KiB and 2 MiB.
  const shapes = [
    (n: number) => `x ${'*'.repeat(n)}`,
    (n: number) => '[a]('.repeat(n / 4),
    (n: number) => `${'- '.repeat(n / 2)}x`,
    (n: number) => `${'>'.repeat(n)} x`,
    (n: number) => `- x\n${'a\n'.repeat(n / 2)}`,
    (n: number) =>
      'The quick brown fox, *jumps* over [the](https://a.test) lazy dog. '.repeat(n / 64),
  ];
  for (const shape of shapes) {
    const small = shape(1 << 19);
    const large = shape(1 << 21);
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
  ];
  for (const [text, expected] of cases) {
    const shape = measureMarkdown(text);
    for (const [key, value] of Object.entries(expected)) {
      assert.equal(shape[key as keyof MarkdownShape], value, `${JSON.stringify(text)} ${key}`);
    }
  }
  assert.equal(MARKDOWN_MAX_LINK_PARENS + MARKDOWN_MAX_ANGLE_BRACKETS > 0, true);
  assert.ok(MARKDOWN_MAX_LIST_DEPTH > 0 && MARKDOWN_MAX_LIST_ITEM_LINES > 0);
  assert.ok(MARKDOWN_MAX_URL_PUNCTUATION > 0);
});
