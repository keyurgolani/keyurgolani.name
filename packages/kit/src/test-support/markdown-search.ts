// For tests: the adversarial search for the slowest Markdown field the cap
// (#10) lets through. Every family of block structure at its limits, around
// every set of inline openers at their limits, with every filler, each field
// cut back until it keeps to every limit, timed through both renderers.
// Openers come first, so every scan they start runs to the end.
//
// The structures, openers, and fillers come from the limits, so a limit
// raised or a dimension the measure stops counting changes what the search
// builds: a field it then finds costs what the limit was there to stop.
//
// Stage one times every structure with every filler at the length limit, all
// the openers at once, and none for the fillers that open marks themselves;
// stage two tries every opener set on the slowest pairs. Stage three builds
// shorter fields, which hold fewer marks but more of which fit a document,
// from the shortest that holds the fewest marks up. Inline, where block
// structure is plain text, stage one times the plain structure and the fence
// alone.

import {
  inlineMarksFor,
  markdownOverLimit,
  MARKDOWN_MAX_ANGLE_BRACKETS,
  MARKDOWN_MAX_DEFINITIONS,
  MARKDOWN_MAX_LENGTH,
  MARKDOWN_MAX_LINK_PARENS,
  MARKDOWN_MAX_LIST_DEPTH,
  MARKDOWN_MAX_LIST_ITEM_LINES,
  MARKDOWN_MAX_NESTING_DEPTH,
  MARKDOWN_MAX_QUOTE_DEPTH,
  MARKDOWN_MAX_TABLE_CELLS,
  MARKDOWN_MAX_URL_PUNCTUATION,
} from '@portfolio/schema';
import { renderInlineMarkdown, renderMarkdown } from '../markdown';

export interface SearchedField {
  readonly name: string;
  readonly text: string;
  /**
   * Milliseconds a render takes through each renderer, averaged over as many
   * renders as make the length limit's worth of text; 0 where it wasn't timed.
   */
  readonly block: number;
  readonly inline: number;
}

const L = MARKDOWN_MAX_LENGTH;
/** A count a field can hold, however high its limit: past the length no field gets more. */
const fit = (limit: number) => Math.min(limit, Math.floor(L / 2));

/** A table `columns` wide with `rows` rows under its header. */
export const table = (columns: number, rows: number) =>
  `${'a|'.repeat(columns - 1)}a\n${'|-'.repeat(columns)}|\n${'a\n'.repeat(rows)}`;

/** Tables of as many cells as the limit allows, `columns` wide. */
const cells = (columns: number) => {
  const rows = Math.floor(fit(MARKDOWN_MAX_TABLE_CELLS) / columns) - 1;
  return rows >= 0 ? table(columns, rows) : '';
};

const definitions = (n: number) =>
  Array.from({ length: n }, (_, i) => `[d${i}]: https://a.test/${i}`).join('\n');

/** Link sites and parentheses in one word, weighing about `target`. */
function linkSites(target: number): string {
  let sites = 1;
  while (((sites + 1) * sites) / 2 <= target) sites++;
  let out = '[a]('.repeat(sites);
  let weight = (sites * (sites - 1)) / 2;
  while (weight + sites <= target) {
    out += '(';
    weight += sites;
  }
  return `${out}x `;
}

/** Backtick runs of distinct lengths, so none closes another, within the mark limit. */
function backtickRuns(marks: number): string {
  let out = '';
  let used = 0;
  for (let i = 1; used + i <= marks; i++) {
    out += `${'`'.repeat(i)}a`;
    used += i;
  }
  return `${out} `;
}

/** Each set of openers, given the inline marks it may use. */
const OPENERS: Record<string, (marks: number) => string> = {
  none: () => '',
  emphasis: (marks) => '*a '.repeat(marks),
  'word marks': (marks) => `${'a!'.repeat(marks)} `,
  'backtick runs': backtickRuns,
  angles: () => `${'<?'.repeat(fit(MARKDOWN_MAX_ANGLE_BRACKETS))} `,
  links: () => linkSites(fit(MARKDOWN_MAX_LINK_PARENS)),
  url: () => `www.a${'?'.repeat(fit(MARKDOWN_MAX_URL_PUNCTUATION) - 2)} `,
  all: (marks) =>
    `${'*a '.repeat(marks)}${OPENERS.angles!(0)}${OPENERS.links!(0)}${OPENERS.url!(0)}`,
};

const growingBackticks = (n: number) => {
  let out = '';
  for (let i = 1; out.length < n; i++) out += `${'`'.repeat(i)}a`;
  return out;
};

/** `unit` repeated to at least `n` characters. */
const repeated = (unit: string) => (n: number) => unit.repeat(Math.ceil(n / unit.length));

const FILLERS: Record<string, (n: number) => string> = {
  words: repeated('word '),
  brackets: repeated('['),
  images: repeated('!['),
  'link pairs': repeated('[a](b) '),
  reflinks: repeated('[d0] [a][d1] '),
  'backtick runs': growingBackticks,
  'code spans': repeated('`a` '),
  escapes: repeated('\\.'),
  'escaped pipes': repeated('\\|'),
  urls: repeated('www.a.b? '),
  'hard breaks': repeated('a  \n'),
  emails: repeated('a@a.a '),
  'flat list': repeated('- a\n'),
  'table rows': repeated('c|d\n'),
  headings: repeated('# a\n'),
  'lazy lines': repeated('a\n'),
  'short paragraphs': repeated('a\n\n'),
  pipes: repeated('|'),
  exclaims: repeated('!'),
  emphasis: repeated('*a '),
  tildes: repeated('a~b '),
  'long class word': repeated('a.#$%&+/=?{|}-'),
  'open parens': repeated('('),
  'gt runs': repeated('>'),
  'mixed punctuation': repeated('.,;:?)'),
  cjk: repeated('日本語の文章'),
  definitions: repeated('[a]: b\n'),
  'quoted lazy items': repeated('> - a\nb\n'),
};

/** The fillers that open marks or structure themselves, which all the openers would leave no room for. */
const OPENING_FILLERS = [
  'backtick runs',
  'code spans',
  'exclaims',
  'emphasis',
  'tildes',
  'gt runs',
  'definitions',
  'quoted lazy items',
];

interface Structure {
  /** Before the openers, which come after an `x `. */
  readonly head: string;
  /** Between the openers and the filler. */
  readonly mid: string;
  /** After the filler. */
  readonly tail: string;
}

const Q = MARKDOWN_MAX_QUOTE_DEPTH;
const D = MARKDOWN_MAX_LIST_DEPTH;
const LINES = MARKDOWN_MAX_LIST_ITEM_LINES;

const PLAIN = 'quotes 0, lists 0, item lines 0';
const FENCE = 'a fence';

/** The corners of stream D's grid of quotes, lists, and item lines, and the families the review added. */
function structures(): Record<string, Structure> {
  const out: Record<string, Structure> = {};
  for (const [q, d, lines] of [
    [0, 0, 0],
    [Q, 0, 0],
    [0, D, LINES],
    [Q, D, 0],
    [Q, D, LINES],
  ].map(([q, d, lines]) => [Math.min(q!, 64), Math.min(d!, 64), Math.min(lines!, 1024)])) {
    out[`quotes ${q}, lists ${d}, item lines ${lines}`] = {
      head: `${q ? `${'>'.repeat(q!)} ` : ''}${'- '.repeat(d!)}`,
      mid: lines! > 1 ? `\n${'a\n'.repeat(lines! - 2)}` : '\n',
      tail: '',
    };
  }
  const nest = Math.min(MARKDOWN_MAX_NESTING_DEPTH, 64);
  out['nesting through lazy lines'] = {
    head: `${'> - a\nb\n'.repeat(Math.max(Math.floor(nest / 2) - 1, 0))}> - `,
    mid: '\n',
    tail: '',
  };
  out['the quote cascade: quotes and a lazy line'] = {
    head: `${'>'.repeat(Math.min(Q, 64))} ${'- '.repeat(Math.min(D, nest - Math.min(Q, 64)) / 2)}`,
    mid: '\nlazy\n',
    tail: '',
  };
  out['a table at the cell limit'] = { head: `${cells(64)}\n`, mid: '\n', tail: '' };
  out['a wide table at the cell limit'] = { head: `${cells(1024)}\n`, mid: '\n', tail: '' };
  out['definitions over a table'] = {
    head: `${definitions(Math.min(MARKDOWN_MAX_DEFINITIONS, 256))}\n\n${cells(64)}\n`,
    mid: '\n',
    tail: '',
  };
  out['definitions over the text'] = {
    head: `${definitions(Math.min(MARKDOWN_MAX_DEFINITIONS, 256))}\n\n`,
    mid: '\n',
    tail: '',
  };
  out[FENCE] = { head: '```\n', mid: '\n', tail: '\n```' };
  return out;
}

/**
 * The field for a structure, openers, and filler, at most `length` long, or
 * null: the openers take every inline mark a field of that length holds and
 * the filler the rest of the length, the openers cut back while the field
 * has too many marks and the filler while it's over any other limit.
 */
function field(
  structure: Structure,
  openers: (marks: number) => string,
  filler: (n: number) => string,
  length = L,
): string | null {
  let marks = fit(inlineMarksFor(length));
  let size = length;
  for (let tries = 0; tries < 30; tries++) {
    const head = `${structure.head}x ${openers(marks)}${structure.mid}`;
    const room = Math.min(size, length - head.length - structure.tail.length);
    if (room < 0) {
      if (marks === 0) return null;
      marks = Math.floor(marks * 0.9);
      continue;
    }
    const text = head + filler(room).slice(0, room) + structure.tail;
    const over = markdownOverLimit(text);
    if (!over) return text;
    if (over.limit.dimension === 'inlineMarks' && marks > 0) {
      marks = Math.max(0, marks - (over.value - inlineMarksFor(text.length)));
    } else {
      size = Math.floor(room * 0.8);
    }
  }
  return null;
}

/** Milliseconds a render of `text` takes, over as many renders as make the length limit's worth. */
function time(render: (source: string) => string, text: string): number {
  const renders = Math.max(1, Math.round(L / Math.max(text.length, 1)));
  const start = performance.now();
  for (let i = 0; i < renders; i++) render(text);
  return (performance.now() - start) / renders;
}

function timed(name: string, text: string, inline: boolean): SearchedField {
  return {
    name,
    text,
    block: time(renderMarkdown, text),
    inline: inline ? time(renderInlineMarkdown, text) : 0,
  };
}

/**
 * The lengths stage three builds fields at, doubling from the shortest that
 * holds every mark the shortest field may, at three characters an opener.
 */
function shorterLengths(): number[] {
  const lengths: number[] = [];
  for (let length = 3 * inlineMarksFor(0); length < L; length *= 2) lengths.push(length);
  return lengths;
}

/** Every field the search built, slowest first, and the structures that fit no field at all. */
export function searchMarkdown(): { fields: SearchedField[]; unfit: string[] } {
  const all = structures();
  const fields: SearchedField[] = [];
  const fitted = new Set<string>();
  const seen = new Set<string>();
  const add = (
    structureName: string,
    openersName: string,
    fillerName: string,
    inline = structureName === PLAIN || structureName === FENCE,
    length = L,
  ) => {
    const text = field(all[structureName]!, OPENERS[openersName]!, FILLERS[fillerName]!, length);
    if (text === null || seen.has(text)) return;
    seen.add(text);
    fitted.add(structureName);
    const at = length === L ? '' : `; at most ${length} characters`;
    fields.push(
      timed(`${structureName}; openers: ${openersName}; filler: ${fillerName}${at}`, text, inline),
    );
  };
  // Warm both renderers up, so the first fields aren't timed cold.
  const warm = `x ${OPENERS.all!(inlineMarksFor(L))}\n${FILLERS.words!(L / 2)}`;
  for (let i = 0; i < 3; i++) timed('warm-up', warm, true);
  for (const structureName of Object.keys(all)) {
    for (const fillerName of Object.keys(FILLERS)) {
      add(structureName, 'all', fillerName);
      if (OPENING_FILLERS.includes(fillerName)) add(structureName, 'none', fillerName);
    }
  }
  const worst = (field: SearchedField) => Math.max(field.block, field.inline);
  const pairs = [...fields]
    .sort((a, b) => worst(b) - worst(a))
    .slice(0, 6)
    .map(({ name }) => name.split('; '));
  for (const [structureName, , fillerPart] of pairs) {
    const fillerName = fillerPart!.slice('filler: '.length);
    for (const openersName of Object.keys(OPENERS)) {
      add(structureName!, openersName, fillerName, true);
    }
  }
  // Stage three: the shorter fields, each structure with as many emphasis
  // openers as a field of the length holds, and text after them.
  for (const length of shorterLengths()) {
    for (const structureName of Object.keys(all))
      add(structureName, 'emphasis', 'words', true, length);
  }
  fields.sort((a, b) => worst(b) - worst(a));
  return { fields, unfit: Object.keys(all).filter((name) => !fitted.has(name)) };
}
