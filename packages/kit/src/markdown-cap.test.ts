import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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
  validatePublicationUnit,
} from '@portfolio/schema';
import { renderInlineMarkdown, renderMarkdown } from './markdown';

// The Markdown cap (#10) from the renderer's side: a field at every limit at
// once renders fast through both functions, a 1 MiB document of them renders
// in bounded time, and every field a renderer reads as Markdown is capped.

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

const validate = (portfolio: object) =>
  validatePublicationUnit({
    portfolio: { text: JSON.stringify(portfolio), format: 'json', name: 'portfolio.json' },
    site: { text: SITE, format: 'yaml', name: 'site.yml' },
  });

/** Link sites and parentheses in one word, weighing exactly `target`. */
function linkSites(target: number): string {
  let sites = 1;
  while (((sites + 1) * sites) / 2 <= target) sites++;
  let out = '[a]('.repeat(sites);
  let weight = (sites * (sites - 1)) / 2;
  while (weight + sites <= target) {
    out += '(';
    weight += sites;
  }
  out += 'x ';
  while (weight < target) {
    out += '[a](b(x ';
    weight += 1;
  }
  return out;
}

/** Every inline limit's opener at once: marks, `<`, link parentheses, and a web address. */
const OPENERS =
  '*a '.repeat(MARKDOWN_MAX_INLINE_MARKS) +
  '<?'.repeat(MARKDOWN_MAX_ANGLE_BRACKETS) +
  ' ' +
  linkSites(MARKDOWN_MAX_LINK_PARENS) +
  `www.a${'?'.repeat(MARKDOWN_MAX_URL_PUNCTUATION - 2)} `;

const toLength = (head: string, fill: string) =>
  head +
  fill
    .repeat(Math.ceil(MARKDOWN_MAX_LENGTH / fill.length))
    .slice(0, MARKDOWN_MAX_LENGTH - head.length);

/**
 * The slowest fields an adversarial search found within the limits (about
 * 5,800 shapes: every structure, opener, and filler), and one at every limit
 * at once. Openers come first, so every scan they start runs to the end.
 */
const WORST: Record<string, string> = {
  'lists 8 deep, items at the line limit, pipes inside': toLength(
    `${'- '.repeat(MARKDOWN_MAX_LIST_DEPTH)}x\n`,
    `${'a\n'.repeat(MARKDOWN_MAX_LIST_ITEM_LINES - 1)}- ${'|'.repeat(40)}\n`,
  ),
  'quotes 4 deep around every inline opener, then a flat list': toLength(
    `${'>'.repeat(MARKDOWN_MAX_QUOTE_DEPTH)} x ${OPENERS}\n`,
    '- a\n',
  ),
  'every limit at once': toLength(
    `${'>'.repeat(MARKDOWN_MAX_QUOTE_DEPTH)} ${'- '.repeat(MARKDOWN_MAX_LIST_DEPTH)}x ${OPENERS}\n${'a\n'.repeat(MARKDOWN_MAX_LIST_ITEM_LINES - 3)}`,
    '|[',
  ),
};

/** A field nobody tuned to be slow, of the same length: paragraphs with marks and links, and a short list. */
const BENIGN = toLength(
  '',
  'Some *emphasis* and a [link](https://example.com) here.\n\n- a short item\n- another one\n\n',
);

/**
 * The medians of seven interleaved runs of `run` and of `baseline`, in
 * milliseconds, after one untimed run of each. Timing both in the same
 * rounds keeps a slow or busy machine from moving one and not the other.
 */
function medians(run: () => unknown, baseline: () => unknown): { time: number; base: number } {
  run();
  baseline();
  const times: number[] = [];
  const bases: number[] = [];
  for (let i = 0; i < 7; i++) {
    let start = performance.now();
    baseline();
    bases.push(performance.now() - start);
    start = performance.now();
    run();
    times.push(performance.now() - start);
  }
  const middle = (list: number[]) => list.sort((a, b) => a - b)[3]!;
  return { time: middle(times), base: middle(bases) };
}

// A worst-case field may cost this many times the benign one of the same
// length, and never more than the ceiling. About 9 times is the most seen on
// the development machine. A scan that grew faster than the text would blow
// through both.
const MAX_RATIO = 20;
const CEILING_MS = 1000;

test('a worst-case field at the limits renders through renderMarkdown and renderInlineMarkdown within 20 times a benign field of its length, and under 1 s', (t) => {
  for (const [name, field] of Object.entries(WORST)) {
    const shape = measureMarkdown(field);
    for (const { dimension, max } of MARKDOWN_LIMITS) {
      assert.ok(
        shape[dimension] <= max,
        `${name}: ${dimension} ${shape[dimension]} is within ${max}`,
      );
    }
    assert.equal(shape.length, MARKDOWN_MAX_LENGTH, name);
    const block = medians(
      () => renderMarkdown(field),
      () => renderMarkdown(BENIGN),
    );
    const inline = medians(
      () => renderInlineMarkdown(field),
      () => renderInlineMarkdown(BENIGN),
    );
    t.diagnostic(
      `${name}: block ${block.time.toFixed(1)} ms (benign ${block.base.toFixed(1)}), inline ${inline.time.toFixed(1)} ms (benign ${inline.base.toFixed(1)})`,
    );
    for (const [kind, { time, base }] of [
      ['block', block],
      ['inline', inline],
    ] as const) {
      // Below a millisecond the ratio is mostly timer noise, so the benign
      // time counts as at least 1 ms.
      const bound = Math.min(MAX_RATIO * Math.max(base, 1), CEILING_MS);
      assert.ok(
        time < bound,
        `${name}: ${kind} ${time.toFixed(1)} ms against ${bound.toFixed(1)} ms (benign ${base.toFixed(1)} ms)`,
      );
    }
  }
  const all = WORST['every limit at once']!;
  const shape = measureMarkdown(all);
  for (const { dimension, max } of MARKDOWN_LIMITS) {
    if (dimension === 'length') continue;
    assert.ok(
      shape[dimension] >= max * 0.9,
      `every limit at once: ${dimension} ${shape[dimension]} is near ${max}`,
    );
  }
});

test('a 1 MiB document of worst-case fields at the limits validates and renders in bounded time', (t) => {
  const field = WORST['every limit at once']!;
  const works: object[] = [];
  const portfolio = {
    schemaVersion: 3,
    locale: 'en',
    direction: 'ltr',
    identity: { name: 'Rowan Test' },
    works,
    sections: [{ kind: 'works', id: 'work', items: [] as string[] }],
  };
  const size = () => Buffer.byteLength(JSON.stringify(portfolio), 'utf8');
  for (let i = 0; ; i++) {
    const work = { id: `w${i}`, title: 'W', medium: 'system', description: field };
    works.push(work);
    portfolio.sections[0]!.items.push(work.id);
    if (size() > 1 << 20) {
      works.pop();
      portfolio.sections[0]!.items.pop();
      break;
    }
  }
  assert.ok(works.length >= 100, `${works.length} fields fill the document`);
  const start = performance.now();
  const result = validate(portfolio);
  const validated = performance.now();
  assert.deepEqual(
    result.diagnostics.filter(({ severity }) => severity !== 'warning').map(({ code }) => code),
    [],
  );
  assert.ok(result.pair);
  const parsed = result.pair.portfolio.works ?? [];
  assert.equal(parsed.length, works.length);
  for (const work of parsed) {
    renderMarkdown(work.description);
    renderInlineMarkdown(work.description);
  }
  const rendered = performance.now();
  t.diagnostic(
    `${works.length} fields: validated in ${(validated - start).toFixed(0)} ms, rendered in ${(rendered - validated).toFixed(0)} ms`,
  );
  assert.ok(validated - start < 5000, 'validation is bounded');
  assert.ok(rendered - validated < 20_000, 'rendering is bounded');
});

const KIT = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(KIT, '../../..');

/** A document with every field a renderer reads as Markdown, each set to `ok`. */
function everyMarkdownField() {
  return {
    schemaVersion: 3,
    locale: 'en',
    direction: 'ltr',
    identity: { name: 'Rowan Test' },
    practice: { thesis: 'ok', services: [{ items: [{ name: 'Service', description: 'ok' }] }] },
    works: [
      {
        id: 'atlas',
        slug: 'atlas',
        title: 'Atlas',
        medium: 'system',
        summary: 'ok',
        description: 'ok',
        excerpt: 'ok',
        showNotes: 'ok',
        caseStudy: {
          challenge: 'ok',
          context: 'ok',
          role: 'ok',
          constraints: 'ok',
          decisions: [{ decision: 'ok', rationale: 'ok', alternatives: 'ok' }],
          evidence: 'ok',
          outcomes: 'ok',
          reflection: 'ok',
        },
      },
    ],
    evidence: [
      {
        id: 'proof',
        type: 'publication',
        title: 'Proof',
        statement: 'ok',
        abstract: 'ok',
        excerpt: 'ok',
        description: 'ok',
      },
    ],
    chronology: [
      { id: 'role', kind: 'role', title: 'Role', period: { start: '2020' }, description: 'ok' },
    ],
    sections: [
      { kind: 'works', id: 'work', items: ['atlas'] },
      { kind: 'evidence', id: 'proof-section', items: ['proof'] },
      { kind: 'chronology', id: 'history', items: ['role'] },
      { kind: 'practice', id: 'thesis', part: 'thesis' },
      { kind: 'practice', id: 'services', part: 'services' },
      {
        kind: 'custom',
        id: 'custom',
        title: 'Custom',
        body: 'ok',
        items: [{ title: 'Item', summary: 'ok' }],
      },
      { kind: 'lede', id: 'lede', body: 'ok' },
      { kind: 'now', id: 'now', body: 'ok' },
    ],
  };
}

const study = '/works/0/caseStudy';
/**
 * Every `RichText source={...}` in the shared renderers and the reference
 * variant, by file and expression, with the document fields it reads. A new
 * one fails the test below until it's listed here, and a listed field that
 * isn't the schema's MarkdownSchema fails it too.
 */
const RICH_TEXT_FIELDS: Record<string, readonly string[]> = {
  'custom.tsx section.body': ['/sections/5/body'],
  'custom.tsx item.summary': ['/sections/5/items/0/summary'],
  'practice.tsx item.description': ['/practice/services/0/items/0/description'],
  'practice.tsx practice.thesis': ['/practice/thesis'],
  'case-study.tsx study[key]!': [
    'challenge',
    'context',
    'role',
    'constraints',
    'outcomes',
    'reflection',
  ].map((key) => `${study}/${key}`),
  'case-study.tsx decision.decision': [`${study}/decisions/0/decision`],
  'case-study.tsx decision.rationale': [`${study}/decisions/0/rationale`],
  'case-study.tsx decision.alternatives': [`${study}/decisions/0/alternatives`],
  'case-study.tsx study.evidence': [`${study}/evidence`],
  'works.tsx work.summary': ['/works/0/summary'],
  'works.tsx work.excerpt': ['/works/0/excerpt'],
  'works.tsx work.description': ['/works/0/description'],
  'works.tsx work.showNotes': ['/works/0/showNotes'],
  'narrative.tsx section.body': ['/sections/6/body', '/sections/7/body'],
  'chronology.tsx entry.description': ['/chronology/0/description'],
  'evidence.tsx entry.statement': ['/evidence/0/statement'],
  'evidence.tsx entry.abstract': ['/evidence/0/abstract'],
  'evidence.tsx entry.excerpt': ['/evidence/0/excerpt'],
  'evidence.tsx entry.description': ['/evidence/0/description'],
  'index.tsx entry.statement': ['/evidence/0/statement'],
};

function setAt(document: object, pointer: string, value: string) {
  const keys = pointer.split('/').slice(1);
  let at = document as Record<string, unknown>;
  for (const key of keys.slice(0, -1)) at = at[key] as Record<string, unknown>;
  assert.equal(typeof at[keys.at(-1)!], 'string', pointer);
  at[keys.at(-1)!] = value;
}

test('every field a renderer reads as Markdown takes the Markdown cap, so a long-text field can not accept Markdown without it', () => {
  const sources = [
    ...readdirSync(path.join(KIT, 'sections/renderers'))
      .filter((file) => file.endsWith('.tsx'))
      .map((file) => path.join(KIT, 'sections/renderers', file)),
    path.join(ROOT, 'tests/external-variant/src/index.tsx'),
  ];
  const found = new Set<string>();
  for (const file of sources) {
    for (const [, expression] of readFileSync(file, 'utf8').matchAll(
      /<RichText\s+source=\{([^}]+)\}/g,
    )) {
      found.add(`${path.basename(file)} ${expression!.trim()}`);
    }
  }
  assert.ok(found.size >= 20, 'the renderers are read');
  for (const use of found) {
    assert.ok(
      Object.hasOwn(RICH_TEXT_FIELDS, use),
      `${use} renders Markdown: list the fields it reads`,
    );
  }
  const base = everyMarkdownField();
  assert.deepEqual(
    validate(base).diagnostics.filter(({ severity }) => severity !== 'warning'),
    [],
  );
  const over = 'a'.repeat(MARKDOWN_MAX_LENGTH + 1);
  for (const [use, pointers] of Object.entries(RICH_TEXT_FIELDS)) {
    for (const pointer of pointers) {
      const document = everyMarkdownField();
      setAt(document, pointer, over);
      assert.deepEqual(
        validate(document).diagnostics.map(({ code, pointer }) => [code, pointer]),
        [['markdown.too-long', pointer]],
        `${use}: ${pointer} is MarkdownSchema`,
      );
    }
  }
});
