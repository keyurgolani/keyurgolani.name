import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MARKDOWN_MAX_LENGTH, markdownOverLimit, validatePublicationUnit } from '@portfolio/schema';
import { renderInlineMarkdown, renderMarkdown } from './markdown';
import { searchMarkdown, table } from './test-support/markdown-search';

// The Markdown cap (#10) from the renderer's side: the slowest field an
// adversarial search finds within the limits renders fast through both
// functions, so does a field over them that skipped validation, marked never
// nests past the renderer's ceiling, a 1 MiB document of the field slowest
// for its size renders within a bound of a benign one, and every field a
// renderer reads as Markdown is capped.

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

/** A field nobody tuned to be slow, of the length limit: paragraphs with marks and links, and a short list. */
const BENIGN = (() => {
  const fill =
    'Some *emphasis* and a [link](https://example.com) here.\n\n- a short item\n- another one\n\n';
  return fill.repeat(Math.ceil(MARKDOWN_MAX_LENGTH / fill.length)).slice(0, MARKDOWN_MAX_LENGTH);
})();

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

// A field may cost this many times the benign field of the same length, the
// benign time counted as at least the floor, and never more than the ceiling.
// The search's slowest field costs about 9 times the benign one on the
// development machine, and CI has run such ratios up to about twice what the
// development machine does. Without the inline-mark limit the slowest field
// the search finds costs over 150 times the benign one.
const MAX_RATIO = 40;
const FLOOR_MS = 4;
const CEILING_MS = 1000;
const bound = (base: number) => Math.min(MAX_RATIO * Math.max(base, FLOOR_MS), CEILING_MS);

const RENDER = { block: renderMarkdown, inline: renderInlineMarkdown } as const;

let search: ReturnType<typeof searchMarkdown> | undefined;
const searched = () => (search ??= searchMarkdown());

test('the slowest field the adversarial search finds within the limits renders through both renderers within 40 times a benign field of its length, and under 1 s', (t) => {
  assert.equal(markdownOverLimit(BENIGN), null, 'the benign field keeps to every limit');
  assert.equal(markdownOverLimit(BENIGN, 'inline'), null, 'and inline');
  const { fields, unfit } = searched();
  assert.deepEqual(unfit, [], 'every structure fits a field within the limits');
  assert.ok(fields.length > 250, `${fields.length} fields searched`);
  t.diagnostic(`${fields.length} fields searched`);
  for (const { name, text } of fields.slice(0, 2)) {
    assert.equal(markdownOverLimit(text), null, `${name} keeps to every limit`);
    const benign = BENIGN.slice(0, text.length);
    for (const mode of ['block', 'inline'] as const) {
      const render = RENDER[mode];
      const { time, base } = medians(
        () => render(text),
        () => render(benign),
      );
      t.diagnostic(
        `${mode} ${time.toFixed(1)} ms (benign ${base.toFixed(1)}, bound ${bound(base).toFixed(0)}): ${name}`,
      );
      assert.ok(
        time < bound(base),
        `${name}: ${mode} ${time.toFixed(1)} ms against ${bound(base).toFixed(1)} ms (benign ${base.toFixed(1)} ms)`,
      );
    }
  }
});

test('a field over the cap renders as escaped text, at once, when it skipped validation', () => {
  // The review's slow fields (#65): up to seconds through marked, and the
  // last past what marked can lex at all.
  const definitions = Array.from({ length: 256 }, (_, i) => `[d${i}]: u`).join('\n');
  const fields: Record<string, string> = {
    'a 1,024-column table of one-character rows': `${table(1024, 0)}${'a\n'.repeat(1500)}`,
    'a 768-column table under 256 definitions': `${definitions}\n\n${table(768, 8)}`,
    'a quoted item and a lazy line, repeated': '> - a\nb\n'.repeat(1024),
    'x and 40,000 asterisks': `x ${'*'.repeat(40_000)}`,
    'a quoted ladder of lists and a lazy line, repeated': `> ${'- '.repeat(8)}a\nb\n`.repeat(372),
  };
  for (const [name, text] of Object.entries(fields)) {
    assert.ok(markdownOverLimit(text), `${name} is over the cap`);
    for (const mode of ['block', 'inline'] as const) {
      const render = RENDER[mode];
      const html = render(text);
      for (const tag of ['<blockquote>', '<li>', '<em>', '<strong>']) {
        assert.ok(!html.includes(tag), `${name}: ${mode} renders as text`);
      }
      const { time, base } = medians(
        () => render(text),
        () => render(BENIGN),
      );
      assert.ok(
        time < bound(base),
        `${name}: ${mode} ${time.toFixed(1)} ms against ${bound(base).toFixed(1)} ms`,
      );
    }
  }
});

test("marked never nests past the renderer's ceiling, even where it nests a field deeper than the cap counts", () => {
  // marked reads `2) >>a` as the paragraph's next line rather than a list,
  // which the measure can't tell from a list, and nests each repeat deeper:
  // the measure counts 10 levels here and marked opens 121. Past the
  // renderer's ceiling the field renders as escaped text.
  const repeat = '>>> > # h\na|b\n2) >>a\n      a|b\n';
  const text = repeat.repeat(40);
  assert.equal(markdownOverLimit(text), null);
  assert.ok(!renderMarkdown(text).includes('<blockquote>'), 'it renders as text');
  assert.ok(
    renderMarkdown(repeat.repeat(2)).includes('<blockquote>'),
    'two repeats render as quotes',
  );
});

/** A portfolio of works whose descriptions are `field`, as many as fit in 1 MiB. */
function documentOf(field: string) {
  const works: Array<{ id: string; title: string; medium: string; description: string }> = [];
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
      return portfolio;
    }
  }
}

test('a 1 MiB document of the field the search finds slowest for its size validates, and renders within 40 times a benign document', (t) => {
  // For its size: a document holds more of a shorter field, and the marks a
  // field may hold shrink with its length so that none costs more for its
  // size than the limits let the longest cost.
  const perByte = ({ text, block, inline }: { text: string; block: number; inline: number }) =>
    (block + inline) / Buffer.byteLength(text, 'utf8');
  const [slowest] = [...searched().fields].sort((a, b) => perByte(b) - perByte(a));
  /** Milliseconds to validate the document, and to render every field both ways. */
  const timeOf = (portfolio: ReturnType<typeof documentOf>) => {
    const start = performance.now();
    const result = validate(portfolio);
    const validated = performance.now() - start;
    assert.deepEqual(
      result.diagnostics.filter(({ severity }) => severity !== 'warning').map(({ code }) => code),
      [],
    );
    assert.ok(result.pair);
    const parsed = result.pair.portfolio.works ?? [];
    assert.equal(parsed.length, portfolio.works.length);
    const rendering = performance.now();
    for (const work of parsed) {
      renderMarkdown(work.description);
      renderInlineMarkdown(work.description);
    }
    return { validated, rendered: performance.now() - rendering };
  };
  const worst = documentOf(slowest!.text);
  assert.ok(worst.works.length >= 32, `${worst.works.length} fields fill the document`);
  const { validated, rendered } = timeOf(worst);
  const benign = timeOf(documentOf(BENIGN));
  t.diagnostic(
    `${worst.works.length} fields of ${slowest!.name}: validated in ${validated.toFixed(0)} ms, rendered in ${rendered.toFixed(0)} ms (benign ${benign.rendered.toFixed(0)} ms)`,
  );
  assert.ok(validated < 5000, 'validation is bounded');
  const limit = MAX_RATIO * Math.max(benign.rendered, FLOOR_MS);
  assert.ok(
    rendered < limit,
    `rendering is bounded: ${rendered.toFixed(0)} ms against ${limit.toFixed(0)} ms`,
  );
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
