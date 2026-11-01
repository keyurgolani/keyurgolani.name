import test from 'node:test';
import { appendFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { chronologyOf, evidenceOf, isRoutedWork, worksOf } from '@portfolio/kit/sections';
import type { VariantRenderInput } from '@portfolio/variant-contract';
import { FIXTURE_NAMES, fixtureInput, renderInput, sampleInput } from './harness.test';

// Every authored string Mission Control places is on its pages (the P2 code
// review's must-fix 1, modelled on Flux P1's content test). For the sample
// and the 16 contract fixtures it collects the identity's words, each
// section's own fields, and the fields of the records each section places
// (its works, evidence and chronology entries, its practice part, the
// contact), and asks that each one appear in the text of the home page or
// of one of the work pages it routes, Markdown reduced to its words. The
// full record may sit behind a closed panel: its text is on the page. What
// MC leaves out on purpose is declared in OMITTED, each rule with its
// reason, so a dropped field fails here unless someone rules it out in
// writing.

/** Fields that carry no visible words: ids, URLs, dates, enums, numbers, references and media. */
const NOT_WORDS = new Set([
  'id',
  'url',
  'href',
  'slug',
  'asset',
  'kind',
  'type',
  'medium',
  'part',
  'visibility',
  'lang',
  'locale',
  'direction',
  'dir',
  'schemaVersion',
  'src',
  'start',
  'end',
  'date',
  'publishedAt',
  'releasedAt',
  'presentedAt',
  'receivedAt',
  'grantedAt',
  'filedAt',
  'takenAt',
  'asOf',
  'extensions',
  'thread',
  'branchesFrom',
  'mergesInto',
  'avatar',
  'logo',
  'focalPoint',
  'fit',
  'crop',
  'organizationUrl',
  'pdfUrl',
  'slidesUrl',
  'videoUrl',
  'audioUrl',
  'sourceUrl',
  'username',
  'value',
  'unit',
  'key',
  'featured',
  'archived',
  'status',
  'format',
  'platform',
  'durationMinutes',
  'durationSeconds',
  'duration',
  'readingTimeMinutes',
  'stars',
  'year',
  'evidence',
  'works',
  'related',
  'relations',
  'show',
  'timeZone',
  'iconName',
  'icon',
  'filter',
  'limit',
  'ids',
  'sort',
  'layout',
  'featuredRepos',
  'excludeRepos',
  'showPinnedRepos',
  'showRecentRepos',
  'showContributions',
  'showLanguages',
  'grouping',
  'tail',
]);

/**
 * What MC leaves out on purpose: a path pattern each, matched against the
 * field's place in the collection (`section:<id>(<kind>)`, then
 * `/work:<id>`, `/ev:<id>`, `/chr:<id>`, `/practice.<part>`, `/contact`).
 */
interface Rule {
  readonly path: RegExp;
  readonly why: string;
  /** When the rule holds only for some values: the string, and the record or placement it's on. */
  readonly when?: (text: string, input: VariantRenderInput, path: string) => boolean;
}

/** The evidence record a path names. */
const recordAt = (input: VariantRenderInput, path: string) => {
  const id = /\/ev:([^.[]+)/.exec(path)?.[1];
  return input.portfolio.evidence.find((record) => record.id === id);
};

/** The placement a path names, on a work or a custom item. */
const placementAt = (input: VariantRenderInput, path: string) => {
  const work = /\/work:([^.[]+)\.media\[(\d+)\]/.exec(path);
  if (work)
    return input.portfolio.works.find((each) => each.id === work[1])?.media?.[Number(work[2])];
  const item = /^section:([^(]+)\(custom\)\.items\[(\d+)\]\.media\[(\d+)\]/.exec(path);
  if (!item) return undefined;
  const section = input.portfolio.sections.find((each) => each.id === item[1]);
  return (section as { items?: { media?: { asset: string }[] }[] } | undefined)?.items?.[
    Number(item[2])
  ]?.media?.[Number(item[3])];
};

const OMITTED: readonly Rule[] = [
  {
    path: /^section:[^(]+\(hero\)\.name$/,
    when: (text, input) => text.trim() === input.portfolio.identity.name.trim(),
    why: "the anchor's h1 is the identity's name, which a hero's name equal to it only repeats",
  },
  {
    path: /^section:[^(]+\(hero\)\.greeting$/,
    why: "the greeting is a frame word the anchor doesn't set (N5)",
  },
  {
    path: /\.(?:meta|seo)\./,
    why: "a page's meta and seo words are the document's head, not its text",
  },
  {
    path: /\/ev:[^.]+\.authors\[\d+\]$/,
    when: (_text, input, path) => Boolean(recordAt(input, path)?.citation?.trim()),
    why: "a whole citation stands for a record's authors, venue and date, so a reader never gets them twice (the kit's citesWhole, A4)",
  },
  {
    path: /\/ev:[^.]+\.links\[0\]\.label$/,
    when: (text, input, path) => {
      const record = recordAt(input, path);
      return (
        record !== undefined &&
        record.url === undefined &&
        !record.buttonText?.trim() &&
        text.trim() === record.title?.trim()
      );
    },
    why: 'a record with no address of its own links its title to its first link, so a label equal to the title would only repeat it',
  },
  {
    path: /\/ev:[^.]+\.locationLabel$/,
    when: (text) => /^\s*(?:online|virtual)\s*$/i.test(text),
    why: 'a place of "online" says where nothing is (the kit\'s shownPlace)',
  },
  {
    path: /\.media\[\d+\]\.(?:caption|location|tags\[\d+\]|alt)$/,
    when: (_text, input, path) => {
      const placement = placementAt(input, path);
      return placement !== undefined && input.media[placement.asset]?.kind !== 'image';
    },
    why: "a document, audio or video placement has no figure on the page to caption (the kit's placedMedia shows none either); its link carries it",
  },
];

interface Authored {
  readonly path: string;
  readonly text: string;
}

function strings(value: unknown, at: string, out: Authored[]): void {
  if (typeof value === 'string') {
    if (value.trim()) out.push({ path: at, text: value });
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => strings(item, `${at}[${index}]`, out));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (NOT_WORDS.has(key)) continue;
      strings(item, `${at}.${key}`, out);
    }
  }
}

/** Every authored string MC places, with where it came from. */
export function authored(input: VariantRenderInput): Authored[] {
  const out: Authored[] = [];
  const { portfolio } = input;
  strings(
    {
      name: portfolio.identity.name,
      tagline: portfolio.identity.tagline,
      email: portfolio.identity.email,
    },
    'identity',
    out,
  );
  for (const section of portfolio.sections) {
    const at = `section:${section.id}(${section.kind})`;
    const own: Record<string, unknown> = { ...section };
    delete own.items;
    strings(own, at, out);
    if (section.kind === 'custom' || section.kind === 'focus' || section.kind === 'fun-facts')
      strings((section as { items?: unknown }).items, `${at}.items`, out);
    if (section.kind === 'works')
      for (const work of worksOf(section, input)) strings(work, `${at}/work:${work.id}`, out);
    if (section.kind === 'evidence')
      for (const entry of evidenceOf(section, input)) strings(entry, `${at}/ev:${entry.id}`, out);
    if (section.kind === 'chronology')
      for (const entry of chronologyOf(section, input))
        strings(entry, `${at}/chr:${entry.id}`, out);
    if (section.kind === 'practice')
      strings(
        (portfolio.practice as Record<string, unknown> | undefined)?.[section.part],
        `${at}/practice.${section.part}`,
        out,
      );
    if (section.kind === 'contact') strings(portfolio.contact, `${at}/contact`, out);
  }
  return out;
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  '#39': "'",
  '#x27': "'",
  nbsp: ' ',
};

const decode = (html: string) =>
  html.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, name: string) => {
    if (ENTITIES[name] !== undefined) return ENTITIES[name]!;
    if (name.startsWith('#x')) return String.fromCodePoint(parseInt(name.slice(2), 16));
    if (name.startsWith('#')) return String.fromCodePoint(Number(name.slice(1)));
    return whole;
  });

/** A render's text and its words in attributes a reader gets (alt, aria-label, title). */
function textOf(html: string): { text: string; attrs: string } {
  const attrs = [...html.matchAll(/\s(?:alt|aria-label|title)="([^"]*)"/g)]
    .map(([, value]) => decode(value!))
    .join(' ');
  const text = decode(html.replace(/<[^>]+>/g, ' '));
  return { text, attrs };
}

/** Markdown reduced to its words. */
const plainInline = (markdown: string) =>
  markdown
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(\*|_)(.+?)\1/g, '$2')
    .replace(/`([^`]+)`/g, '$1');

/**
 * Text as the match compares it: lower case, with no whitespace or
 * punctuation, so a line the page breaks or a list it joins with commas
 * still matches its source.
 */
const norm = (text: string) =>
  plainInline(text)
    .toLocaleLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, '');

/** The home page and every work page it routes, as one text. */
function pagesOf(input: VariantRenderInput): { text: string; attrs: string } {
  const pages = [
    renderInput(input),
    ...input.portfolio.works
      .filter(isRoutedWork)
      .map((work) => renderInput({ ...input, route: { route: 'work', slug: work.slug } })),
  ].map(textOf);
  return {
    text: pages.map((page) => page.text).join(' '),
    attrs: pages.map((page) => page.attrs).join(' '),
  };
}

/** The authored strings `input`'s pages don't show, less what OMITTED rules out. */
export function missing(input: VariantRenderInput): string[] {
  const { text, attrs } = pagesOf(input);
  const page = norm(text);
  const labels = norm(attrs);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const { path, text: raw } of authored(input)) {
    if (
      seen.has(path) ||
      OMITTED.some((rule) => rule.path.test(path) && (rule.when?.(raw, input, path) ?? true))
    )
      continue;
    seen.add(path);
    const words = norm(raw);
    if (!words) continue;
    // Long text: its head and its tail, so a cut shows.
    const parts = words.length > 80 ? [words.slice(0, 50), words.slice(-30)] : [words];
    if (parts.every((part) => page.includes(part) || labels.includes(part))) continue;
    out.push(`${path}: ${JSON.stringify(raw.slice(0, 100))}`);
  }
  return out;
}

const INPUTS: readonly (readonly [string, () => VariantRenderInput])[] = [
  ['sample', () => sampleInput()],
  ...FIXTURE_NAMES.map((name) => [name, () => fixtureInput(name)] as const),
];

for (const [name, input] of INPUTS) {
  test(`${name}: every authored string MC places is on its pages, or ruled out in OMITTED`, () => {
    const list = missing(input());
    if (process.env.MC_MISSING_DUMP)
      appendFileSync(process.env.MC_MISSING_DUMP, list.map((line) => `${name} ${line}\n`).join(''));
    assert.deepEqual(list, []);
  });
}
