// Swiss Signal's derivations (variants-10 brief §5.1): every word, count
// and placement the poster, the figures band, the selected index, the part
// openers and the ruled tables show, computed from the render input alone.
// Pure and browser-safe: no markup, no clock, no network, no randomness,
// and no person-specific literal (N4). Nothing here names a sample record;
// each rule reads kinds, fields and the owner's controls.
//
// Two helpers are local copies until A lifts them into the kit (K-6):
// posterLine() and repoForWork(), with the signatures the kit will take.
// The parts are the kit's navigation model (K-1), grouped for display.

import type { ChronologyEntry, Evidence, Link, Section, Work } from '@portfolio/schema';
import {
  anchorSection,
  chronologyOf,
  evidenceOf,
  githubSnapshot,
  isArchived,
  navigationModel,
  worksByIds,
  worksOf,
  type GroupingOptions,
  type PageOutline,
} from '@portfolio/kit/sections';
import type { VariantRenderInput } from '@portfolio/variant-contract';

/** What the derivations read: the visible content, the owner's controls, and the snapshots. */
export type ModelInput = Pick<VariantRenderInput, 'portfolio' | 'controls' | 'derived'>;

// ───────────── text ─────────────

/** Whether `text` has something to show. */
export function present(text: string | undefined | null): text is string {
  return typeof text === 'string' && text.trim() !== '';
}

/** Collapses runs of white space, as a poster line or a cell sets them. */
const squash = (text: string) => text.replace(/\s+/g, ' ').trim();

/** The owner's words as one list, joined as the locale lists them: "Go, Kafka, and Postgres". */
export function listed(items: readonly string[], locale: string): string {
  try {
    return new Intl.ListFormat(locale, { type: 'conjunction' }).format(items);
  } catch {
    return items.join(', ');
  }
}

/**
 * Inline Markdown as plain text, for a line set in one voice: link text
 * kept, emphasis and code marks dropped. The poster and the figures'
 * captions are set whole, never with one emphasised word (C3, smell 17).
 */
export function plainInline(markdown: string): string {
  return squash(
    markdown
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/(\*\*|__)(.+?)\1/g, '$2')
      .replace(/(\*|_)(.+?)\1/g, '$2')
      .replace(/`([^`]+)`/g, '$1'),
  );
}

/**
 * Sentence ends: a Latin, Arabic or Devanagari stop before a space or the
 * end, or a CJK full stop, which takes no space after it.
 */
const SENTENCE_END = /^([\s\S]+?(?:[.!?؟۔।](?=\s|$)|[。！？]))\s*([\s\S]*)$/u;

/**
 * A text's first sentence, and what follows it (K-6 `firstSentence`). A
 * text with no sentence end is one sentence.
 */
export function firstSentence(text: string): { lead: string; rest?: string } {
  const flat = squash(text);
  const match = SENTENCE_END.exec(flat);
  if (!match) return { lead: flat };
  const rest = match[2]!.trim();
  return rest ? { lead: match[1]!, rest } : { lead: match[1]! };
}

/**
 * A trailing parenthetical, the device every Swiss head shares: "Listening
 * (a small experiment)" is the title "Listening" and the aside "a small
 * experiment". Only one at the very end counts, and never the whole text.
 * A sentence's closing stop after it is kept as `tail`, so the owner's
 * punctuation sets where they put it: "I mend things (slowly)."
 */
export function splitAside(text: string): { text: string; aside?: string; tail?: string } {
  const match = /^([\s\S]*?\S)\s*\(([^()]+)\)([.!?。！？؟]?)\s*$/u.exec(text.trim());
  if (!match) return { text: text.trim() };
  return { text: match[1]!, aside: match[2]!.trim(), ...(match[3] ? { tail: match[3] } : {}) };
}

/** How long a poster line is, which sets its scale (brief §5.1, posterLine). */
export type LengthClass = 'short' | 'medium' | 'long';

/**
 * Up to 32 characters is the poster at ×1.6 of display, up to 64 at ×1.1,
 * and anything longer at ×0.8 in sentence case. Characters are code points,
 * so a non-Latin line measures what it shows.
 */
export function lengthClass(text: string): LengthClass {
  const length = [...squash(text)].length;
  return length <= 32 ? 'short' : length <= 64 ? 'medium' : 'long';
}

/** The characters in a line's longest word. */
export function longestWord(text: string): number {
  return Math.max(
    0,
    ...squash(text)
      .split(' ')
      .map((word) => [...word].length),
  );
}

/**
 * How long a poster line's longest word is: a word of nine characters or
 * more sizes the uppercase poster to the width that word needs, where a step
 * alone would still break inside it on a narrow screen.
 */
export function wordClass(text: string): 'long' | undefined {
  return longestWord(text) >= 9 ? 'long' : undefined;
}

/** The custom property the poster's display type fits its longest word to: the phone rule's, and row 127's. */
export function wordFit(text: string): Record<'--layout-ss-word', number> {
  return { '--layout-ss-word': longestWord(text) };
}

/** The same for the poster line's aside, as it prints: its parentheses on its first and last words (row 127). */
export function asideFit(text: string): Record<'--layout-ss-aside-word', number> {
  return { '--layout-ss-aside-word': longestWord(`(${text})`) };
}

// ───────────── once per render ─────────────

/**
 * A derivation several components read, computed once per render input:
 * each render builds its own input object and never changes it, so it keys
 * the cache.
 */
function once<T>(read: (input: ModelInput) => T): (input: ModelInput) => T {
  const cache = new WeakMap<object, { value: T }>();
  return (input) => {
    const hit = cache.get(input);
    if (hit) return hit.value;
    const value = read(input);
    cache.set(input, { value });
    return value;
  };
}

// ───────────── controls ─────────────

const stringControl = (input: ModelInput, id: string): string | undefined => {
  const value = input.controls[id];
  return typeof value === 'string' && value !== '' ? value : undefined;
};

const booleanControl = (input: ModelInput, id: string, fallback: boolean): boolean => {
  const value = input.controls[id];
  return typeof value === 'boolean' ? value : fallback;
};

// ───────────── the poster ─────────────

/** Where the poster's line came from. */
export type PosterSource = 'thesis' | 'hero' | 'tagline' | 'name';

/** The fallback chain, in its order: the owner's choice starts it (control `posterLine`). */
export const POSTER_SOURCES: readonly PosterSource[] = ['thesis', 'hero', 'tagline', 'name'];

export interface PosterLine {
  /** The line, without its aside. */
  readonly text: string;
  readonly source: PosterSource;
  readonly length: LengthClass;
  /**
   * The parenthetical at the end of its last line, without its brackets:
   * the line's own trailing "(…)", else the identity's tagline, else none.
   */
  readonly aside?: { readonly text: string; readonly source: 'authored' | 'tagline' };
  /** The authored stop after an authored aside, set after its bracket. */
  readonly tail?: string;
  /**
   * Whether the h1 needs the owner's name before the line (SS-M5): always,
   * except when the line is the name.
   */
  readonly namePrefix: boolean;
}

/** The first hero section, the poster's own. */
export function heroOf(input: ModelInput): Extract<Section, { kind: 'hero' }> | undefined {
  return input.portfolio.sections.find(
    (section): section is Extract<Section, { kind: 'hero' }> => section.kind === 'hero',
  );
}

/** The first visible thesis section: the view keeps the thesis only when one shows. */
export function thesisSectionOf(input: ModelInput): Section | undefined {
  return input.portfolio.sections.find(
    (section) => section.kind === 'practice' && section.part === 'thesis',
  );
}

/** The owner's name as the poster sets it: the hero's own name where it gives one, else the identity's. */
export function ownerName(input: ModelInput): string {
  const name = heroOf(input)?.name;
  return squash(present(name) ? name : input.portfolio.identity.name);
}

function lineFrom(input: ModelInput, source: PosterSource): string | undefined {
  const { portfolio } = input;
  switch (source) {
    case 'thesis': {
      const thesis = portfolio.practice?.thesis;
      return thesisSectionOf(input) && present(thesis)
        ? firstSentence(plainInline(thesis)).lead
        : undefined;
    }
    case 'hero': {
      const tagline = heroOf(input)?.tagline;
      return present(tagline) ? firstSentence(plainInline(tagline)).lead : undefined;
    }
    case 'tagline':
      return present(portfolio.identity.tagline) ? squash(portfolio.identity.tagline) : undefined;
    case 'name':
      return ownerName(input);
  }
}

/**
 * The poster line (K-6 `posterLine(input)`, N5): the thesis's first
 * sentence, then the hero's tagline, then the identity's tagline, then the
 * name. The owner's `posterLine` control picks where the chain starts; the
 * name ends every chain, so there is always a line. The `aside` control
 * (tagline | off) turns the tagline aside off; an authored trailing "(…)"
 * is the owner's own words and always stays.
 */
function readPosterLine(input: ModelInput): PosterLine {
  const chosen = stringControl(input, 'posterLine') as PosterSource | undefined;
  const start = Math.max(0, POSTER_SOURCES.indexOf(chosen ?? 'thesis'));
  let source: PosterSource = 'name';
  let line = ownerName(input);
  for (const candidate of POSTER_SOURCES.slice(start)) {
    const found = lineFrom(input, candidate);
    if (present(found)) {
      source = candidate;
      line = found;
      break;
    }
  }
  const split = splitAside(line);
  const tagline = input.portfolio.identity.tagline;
  const aside = present(split.aside)
    ? { text: split.aside, source: 'authored' as const }
    : stringControl(input, 'aside') !== 'off' && source !== 'tagline' && present(tagline)
      ? { text: squash(tagline), source: 'tagline' as const }
      : undefined;
  return {
    text: split.text,
    source,
    length: lengthClass(split.text),
    ...(aside ? { aside } : {}),
    ...(split.tail ? { tail: split.tail } : {}),
    namePrefix: source !== 'name',
  };
}

/** The poster line, read once per render input. */
export const posterLine = once(readPosterLine);

/**
 * What the poster's left column sets under the rule: the hero's tagline as
 * the lede when the poster didn't take it, and its subtagline as the
 * positioning line.
 */
export function posterLede(input: ModelInput): {
  lede?: string;
  subtitle?: string;
  position?: string;
} {
  const hero = heroOf(input);
  const { source } = posterLine(input);
  return {
    ...(present(hero?.tagline) && source !== 'hero' ? { lede: hero.tagline } : {}),
    ...(present(hero?.subtitle) ? { subtitle: hero.subtitle } : {}),
    ...(present(hero?.subtagline) ? { position: hero.subtagline } : {}),
  };
}

// ───────────── dates ─────────────

/** The year a loose date names, `2022` from `2022-01` or `March 2022`, or none. */
export function yearOf(raw: string | undefined): string | undefined {
  return raw === undefined ? undefined : /(\d{4})/.exec(raw)?.[1];
}

const OPEN = /^(?:present|now|current)$/i;

/**
 * A period as a year range with an en dash (S13, T8): `2018–2023`, one year
 * when both ends share it, and `2023–now` while it runs. `open` marks the
 * composition's word "now", which a non-English page sets as English.
 */
export function rangeOf(
  period: { readonly start: string; readonly end?: string } | undefined,
): { text: string; open: boolean } | undefined {
  if (!period) return undefined;
  const start = yearOf(period.start);
  if (start === undefined) return undefined;
  const end =
    period.end === undefined || OPEN.test(period.end.trim()) ? undefined : yearOf(period.end);
  if (end === undefined) return { text: `${start}–now`, open: true };
  return { text: start === end ? start : `${start}–${end}`, open: false };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_NAMES = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];

/**
 * A loose date as a table cell sets it, day first in tabular figures:
 * `8 Feb 2026`, `Feb 2026`, `2026`, with its ISO form for `<time>`. The
 * month names are the composition's English words. None for "present".
 */
export function shortDate(raw: string | undefined): { text: string; iso: string } | undefined {
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  const iso = /^(\d{4})(?:-(\d{1,2})(?:-(\d{1,2}))?)?$/.exec(trimmed);
  const pad = (value: number) => String(value).padStart(2, '0');
  if (iso) {
    const [, year, month, day] = iso;
    if (month === undefined) return { text: year!, iso: year! };
    const m = Number(month);
    const name = MONTHS[m - 1];
    if (!name) return { text: year!, iso: year! };
    if (day === undefined) return { text: `${name} ${year}`, iso: `${year}-${pad(m)}` };
    return { text: `${Number(day)} ${name} ${year}`, iso: `${year}-${pad(m)}-${pad(Number(day))}` };
  }
  const named = /^([A-Za-z]+)\s+(\d{4})$/.exec(trimmed);
  if (named) {
    const index = MONTH_NAMES.indexOf(named[1]!.toLowerCase());
    if (index >= 0)
      return { text: `${MONTHS[index]} ${named[2]}`, iso: `${named[2]}-${pad(index + 1)}` };
  }
  const year = yearOf(trimmed);
  return year ? { text: year, iso: year } : undefined;
}

/**
 * The year the owner has been working since (control `since`, default on):
 * the earliest start among the chronology's role entries. None without one,
 * and none when the owner turns it off.
 */
export function sinceYear(input: ModelInput): string | undefined {
  if (!booleanControl(input, 'since', true)) return undefined;
  const years = input.portfolio.chronology
    .filter((entry) => entry.kind === 'role')
    .map((entry) => yearOf(entry.period.start))
    .filter((year): year is string => year !== undefined)
    .sort();
  return years[0];
}

// ───────────── numbers ─────────────

/** A number in the portfolio's locale, falling back to the root locale for a tag Intl rejects. */
export function formatNumber(value: number, locale: string): string {
  try {
    return new Intl.NumberFormat(locale).format(value);
  } catch {
    return new Intl.NumberFormat('en').format(value);
  }
}

/** Seconds as `m:ss`, a track's or an album's length. */
export function minutesSeconds(seconds: number): string {
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

// ───────────── the figures band ─────────────

export interface Figure {
  readonly id: string;
  /** The value with its unit folded in, a no-break space between: `12`, `38`, `40%`, `3.2 km`. */
  readonly value: string;
  /**
   * What never breaks: the number, with a tight unit set against it (`40%`, `120+`), the run a
   * figure is sized by; and a word unit after it, where the one break a figure allows is.
   */
  readonly run: string;
  readonly after?: string;
  /** The evidence statement, its caption. */
  readonly caption?: string;
  /** The description, a quieter second line. */
  readonly note?: string;
}

export interface FiguresBand {
  readonly section: Extract<Section, { kind: 'evidence' }>;
  readonly figures: readonly Figure[];
}

const isMetricSection = (section: Section, input: ModelInput) => {
  const items = evidenceOf(section, input);
  return (
    items.length > 0 &&
    items.every((entry) => entry.type === 'metric' && entry.metric?.value !== undefined)
  );
};

/** Units set tight against the number. */
const TIGHT_UNITS = /^(?:%|‰|°|′|″|x|×|\+|k|m|b|K|M|B)$/;

/**
 * Whether a caption opens with the unit as a whole word: "years" opens
 * "Years engineering", but "M" doesn't open "Monthly readers", nor "x"
 * "x86 builds". A word unit matches in any case; a one-letter or symbol
 * unit (M, k, x, %) only in its own case, where case is its meaning.
 */
export function opensWith(caption: string, unit: string, locale: string): boolean {
  if (unit === '') return false;
  const wordy = unit.length > 1 && /^\p{L}+$/u.test(unit);
  const head = caption.slice(0, unit.length);
  const same = wordy
    ? head.toLocaleLowerCase(locale) === unit.toLocaleLowerCase(locale)
    : head === unit;
  if (!same) return false;
  const next = caption.slice(unit.length, unit.length + 1);
  return next === '' || !/[\p{L}\p{N}]/u.test(next);
}

/**
 * One metric as a figure. The unit folds into the value unless the caption
 * already opens with it, so "12" sits over "Years engineering" rather than
 * "12 years" over it (S10).
 */
export function figureOf(entry: Evidence, locale: string): Figure | undefined {
  const value = entry.metric?.value;
  if (value === undefined) return undefined;
  const caption = present(entry.statement) ? plainInline(entry.statement) : undefined;
  const unit = entry.metric?.unit?.trim();
  const repeats = unit !== undefined && caption !== undefined && opensWith(caption, unit, locale);
  const number = formatNumber(value, locale);
  const shown =
    unit === undefined || unit === '' || repeats
      ? number
      : TIGHT_UNITS.test(unit)
        ? `${number}${unit}`
        : `${number} ${unit}`;
  const tight = unit !== undefined && unit !== '' && !repeats && TIGHT_UNITS.test(unit);
  const loose = unit !== undefined && unit !== '' && !repeats && !tight;
  return {
    id: entry.id,
    value: shown,
    run: tight ? `${number}${unit}` : number,
    ...(loose ? { after: unit } : {}),
    ...(caption ? { caption } : {}),
    ...(present(entry.description) ? { note: plainInline(entry.description) } : {}),
  };
}

/**
 * The figures band (control `figures`, a reference to an evidence section;
 * none means automatic): the named section when its every item is a metric
 * with a value, else the first such evidence section. A named section that
 * mixes metrics with other evidence isn't the band: it keeps every entry in
 * its part, and the band falls back to automatic. One figure per metric,
 * never padded (S1). None when there's no such section, and the part
 * openers follow the poster.
 */
function readFiguresBand(input: ModelInput): FiguresBand | undefined {
  const chosen = stringControl(input, 'figures');
  const sections = input.portfolio.sections;
  const named = chosen ? sections.find((section) => section.id === chosen) : undefined;
  const section =
    named && isMetricSection(named, input)
      ? named
      : sections.find((candidate) => isMetricSection(candidate, input));
  if (!section || section.kind !== 'evidence') return undefined;
  const figures = evidenceOf(section, input).flatMap((entry) => {
    const figure = figureOf(entry, input.portfolio.locale);
    return figure ? [figure] : [];
  });
  return figures.length ? { section, figures } : undefined;
}

/** The figures band, read once per render input. */
export const figuresBand = once(readFiguresBand);

// ───────────── parts ─────────────

/** The five parts, the kit's five destinations (K-1, N7). */
export type PartId = 'work' | 'writing' | 'record' | 'about' | 'contact';

export const PART_IDS: readonly PartId[] = ['work', 'writing', 'record', 'about', 'contact'];

/** Each part's word, the opener's display line. English: the page marks it in another language. */
export const PART_WORDS: Readonly<Record<PartId, string>> = {
  work: 'Work',
  writing: 'Writing',
  record: 'Record',
  about: 'About',
  contact: 'Contact',
};

/** The part orders the owner can pick (control `partOrder`). Contact always closes the page. */
export const PART_ORDERS: Readonly<Record<string, readonly PartId[]>> = {
  'work-first': ['work', 'writing', 'record', 'about', 'contact'],
  'writing-first': ['writing', 'work', 'record', 'about', 'contact'],
  'record-first': ['record', 'work', 'writing', 'about', 'contact'],
  'about-first': ['about', 'work', 'writing', 'record', 'contact'],
};

/**
 * Swiss's parts are the kit's five destinations, through navigationModel's
 * grouping hook (K-1): display only, so every section sits where the
 * canonical map puts it in every composition. The first hero is the poster
 * and the figures band's section is the band, so neither is in a part; the
 * sections the map leaves to the index (an untitled lede, custom and
 * extension sections) go to About, the part for the owner's own words. The
 * owner orders the parts (control `partOrder`); nothing moves a section.
 */
export function partGrouping(input: ModelInput): GroupingOptions<PartId> {
  const order = PART_ORDERS[stringControl(input, 'partOrder') ?? ''] ?? PART_ORDERS['work-first']!;
  const hero = heroOf(input)?.id;
  const band = figuresBand(input)?.section.id;
  return {
    groups: order.map((id) => ({ id, destination: id })),
    unplaced: 'about',
    groupOf: (section) => (section.id === hero || section.id === band ? null : undefined),
  };
}

export interface Part {
  readonly id: PartId;
  readonly word: string;
  /** Whether the word is the composition's (English) rather than the owner's title. */
  readonly own: boolean;
  /** Its sections, in reading order. */
  readonly sections: readonly Section[];
  /** Its position among the page's parts, from 1, for the narrow marker ("Part 2 of 5"). */
  readonly position: number;
}

/**
 * The page's parts, from the navigation model's groups for `outline` (the
 * page's pageOutline, or a function that makes it): each with its sections
 * in reading order, none empty. Read once per render input.
 * Contact's word is the contact section's own title, when it has one ("Get
 * in touch").
 */
const partsCache = new WeakMap<object, readonly Part[]>();

export function partsOf(
  input: ModelInput,
  outline: PageOutline | (() => PageOutline),
): readonly Part[] {
  const cached = partsCache.get(input);
  if (cached) return cached;
  const parts = readParts(input, typeof outline === 'function' ? outline() : outline);
  partsCache.set(input, parts);
  return parts;
}

function readParts(input: ModelInput, outline: PageOutline): readonly Part[] {
  const model = navigationModel(outline, { grouping: partGrouping(input) });
  const byId = new Map(input.portfolio.sections.map((section) => [section.id, section]));
  const filled = model.groups
    .map((group) => ({
      id: group.id,
      sections: group.sections.flatMap((entry) => {
        const section = byId.get(entry.id);
        return section ? [section] : [];
      }),
    }))
    .filter((part) => part.sections.length > 0);
  return filled.map((part, index) => {
    const contactTitle =
      part.id === 'contact'
        ? part.sections.find((section) => section.kind === 'contact')?.title
        : undefined;
    const word = present(contactTitle) ? splitAside(contactTitle).text : PART_WORDS[part.id];
    return { ...part, word, own: !present(contactTitle), position: index + 1 };
  });
}

// ───────────── heads and counts ─────────────

/**
 * How many things a section shows, for its head's parenthetical: works,
 * evidence and entries; an image series' photographs when the section is
 * one series; a practice part's groups; focus and fun-facts items; custom
 * items. Zero for the kinds that list nothing.
 */
export function itemCount(section: Section, input: ModelInput): number {
  switch (section.kind) {
    case 'works': {
      const works = worksOf(section, input);
      const only = works.length === 1 ? works[0] : undefined;
      if (only && only.medium === 'image-series') return only.media?.length ?? 0;
      return works.length;
    }
    case 'evidence':
      return evidenceOf(section, input).length;
    case 'chronology':
      return chronologyOf(section, input).length;
    case 'practice': {
      // A part's groups; a part of one group counts that group's entries.
      if (section.part === 'thesis') return 0;
      const groups = (input.portfolio.practice?.[section.part] ?? []) as readonly {
        readonly items?: readonly unknown[];
      }[];
      return groups.length === 1 ? (groups[0]!.items?.length ?? 0) : groups.length;
    }
    case 'github': {
      // The repositories its table lists, from the publish-frozen snapshot.
      const snapshot = githubSnapshot(section, input);
      if (snapshot?.state !== 'ready') return 0;
      const repos = (snapshot.value as { readonly pinnedRepos?: readonly unknown[] }).pinnedRepos;
      return repos?.length ?? 0;
    }
    case 'focus':
    case 'fun-facts':
      return section.items.length;
    case 'custom':
      return section.items?.length ?? 0;
    default:
      return 0;
  }
}

/**
 * A section head: its title without a trailing parenthetical, and the
 * parenthetical it carries, always real data (brief §5.1): the title's own
 * "(…)", else the count of the things it lists, else none. An untitled
 * section gets a visually hidden heading named for its kind.
 */
export function headOf(
  section: Section,
  input: ModelInput,
): { title: string; hidden: boolean; paren?: string; count?: number } {
  if (!present(section.title))
    return { title: KIND_WORDS[section.kind] ?? 'Section', hidden: true };
  const split = splitAside(section.title);
  if (present(split.aside)) return { title: split.text, hidden: false, paren: split.aside };
  const count = itemCount(section, input);
  return count >= 1
    ? {
        title: split.text,
        hidden: false,
        paren: formatNumber(count, input.portfolio.locale),
        count,
      }
    : { title: split.text, hidden: false };
}

/** Each core kind's name, for an untitled section's hidden heading. */
export const KIND_WORDS: Readonly<Record<string, string>> = {
  hero: 'Introduction',
  lede: 'Introduction',
  now: 'Now',
  works: 'Works',
  evidence: 'Evidence',
  chronology: 'Chronology',
  practice: 'Practice',
  contact: 'Contact',
  custom: 'Notes',
  quote: 'Quote',
  focus: 'Focus',
  'fun-facts': 'Facts',
  cta: 'Next step',
  github: 'GitHub',
};

/**
 * A part opener's contents: its titled sections, by title, but not the
 * contact section whose title is already the part's word ("Get in touch"),
 * nor a call to action, whose question heads its own call a screen below
 * (design review: "Want to work together?" once).
 */
export function partContents(part: Part): readonly { id: string; title: string }[] {
  return part.sections
    .filter((section) => present(section.title) && section.kind !== 'cta')
    .map((section) => ({ id: section.id, title: splitAside(section.title!).text }))
    .filter((entry) => !(entry.title === part.word && !part.own));
}

/** Whether a citation's venue is short enough to hold one line at any width. */
export function shortVenue(venue: string): boolean {
  return [...venue].length <= 24;
}

// ───────────── the selected index ─────────────

/**
 * The works the poster's index lists: the signature, then the featured
 * works, in the owner's order. Without a curation list, the first works
 * section's works that aren't archived. At most six (N3).
 */
export function selectedWorks(input: ModelInput): readonly Work[] {
  const { portfolio } = input;
  const ids = [portfolio.signature, ...portfolio.featured].filter(present);
  let works = worksByIds([...new Set(ids)], input);
  if (works.length === 0) {
    const first = portfolio.sections.find((section) => section.kind === 'works');
    works = first ? worksOf(first, input).filter((work) => !isArchived(work, input)) : [];
  }
  return works.slice(0, 6);
}

/** A GitHub repository a snapshot shows. */
export interface Repo {
  readonly name: string;
  readonly url: string;
  readonly stars: number;
  readonly forks?: number;
}

const urlKey = (url: string) => url.trim().toLowerCase().replace(/\/+$/, '');

/**
 * The GitHub snapshot repository whose URL matches the work's own URL or
 * one of its links (K-6 `repoForWork(input, work)`), from any github
 * section's ready snapshot, pinned repositories first. None without one.
 */
export function repoForWork(input: Pick<ModelInput, 'derived'>, work: Work): Repo | undefined {
  const urls = new Set(
    [work.url, ...(work.links ?? []).map((link) => link.url)].filter(present).map(urlKey),
  );
  if (urls.size === 0) return undefined;
  for (const derived of Object.values(input.derived)) {
    if (derived.state !== 'ready') continue;
    const { pinnedRepos, recentlyActive } = derived.value;
    for (const repo of [...pinnedRepos, ...recentlyActive]) {
      if (urls.has(urlKey(repo.url))) {
        return {
          name: repo.name,
          url: repo.url,
          stars: repo.stars,
          ...('forks' in repo ? { forks: repo.forks } : {}),
        };
      }
    }
  }
  return undefined;
}

const plural = (count: number, one: string, many: string, locale: string) =>
  `${formatNumber(count, locale)} ${count === 1 ? one : many}`;

/**
 * The proof the selected index sets beside a work: its first highlight
 * (the owner's words); else its repository's stars; else its reading time,
 * duration, track or photograph count; else its first two tools. `own`
 * marks the composition's words, which a non-English page sets as English.
 */
export function proofOf(input: ModelInput, work: Work): { text: string; own: boolean } | undefined {
  const locale = input.portfolio.locale;
  const highlight = work.highlights?.find(present);
  if (highlight) return { text: squash(highlight), own: false };
  const repo = repoForWork(input, work);
  if (repo) return { text: `${plural(repo.stars, 'star', 'stars', locale)} on GitHub`, own: true };
  if (work.readingTimeMinutes) {
    return { text: `${formatNumber(work.readingTimeMinutes, locale)} min read`, own: true };
  }
  if (work.durationMinutes) {
    return { text: `${formatNumber(Math.round(work.durationMinutes), locale)} min`, own: true };
  }
  if (work.tracks?.length) {
    return { text: plural(work.tracks.length, 'track', 'tracks', locale), own: true };
  }
  if (work.medium === 'image-series' && work.media?.length) {
    return { text: plural(work.media.length, 'photograph', 'photographs', locale), own: true };
  }
  const tools = (work.tools ?? []).filter(present).slice(0, 2);
  return tools.length ? { text: tools.join(', '), own: false } : undefined;
}

/** A work's medium in the composition's words, or none for an extension's medium. */
export function mediumWord(work: Work): string | undefined {
  switch (work.medium) {
    case 'writing':
      return present(work.publication) ? 'Essay' : 'Writing';
    case 'audio-video':
      return present(work.series) ? 'Episode' : 'Audio and video';
    case 'image-series':
      return 'Photographs';
    case 'interface':
      return 'Interface';
    case 'system':
      return 'System';
    case 'software':
      return 'Software';
    case 'photography':
      return 'Photography';
    case 'research':
      return 'Research';
    case 'music':
      return 'Music';
    case 'object':
      return 'Object';
    default:
      return undefined;
  }
}

/** When a work was made: its period's range, else the year it was published or released. */
export function workWhen(work: Work): { text: string; open: boolean } | undefined {
  const range = rangeOf(work.period);
  if (range) return range;
  const year = yearOf(work.publishedAt ?? work.releasedAt);
  return year ? { text: year, open: false } : undefined;
}

/** Whether a work has its own page: a case study, which needs a slug. */
export const hasCaseStudy = (work: Work) => work.caseStudy !== undefined && work.slug !== undefined;

// ───────────── tables ─────────────

/** An album's running time, only when every track has a length. */
export function albumTotal(work: Work): string | undefined {
  const tracks = work.tracks ?? [];
  if (tracks.length === 0 || tracks.some((track) => track.durationSeconds === undefined)) {
    return undefined;
  }
  return minutesSeconds(tracks.reduce((sum, track) => sum + (track.durationSeconds ?? 0), 0));
}

/**
 * The entry a chronology entry grew out of, for its indented row's
 * "(grew out of …)", when the view shows it.
 */
export function grewOutOf(entry: ChronologyEntry, input: ModelInput): ChronologyEntry | undefined {
  if (entry.branchesFrom === undefined) return undefined;
  return input.portfolio.chronology.find((other) => other.id === entry.branchesFrom);
}

// ───────────── contact ─────────────

/** Platforms whose names aren't a plain capital. */
const PLATFORM_WORDS: Readonly<Record<string, string>> = {
  github: 'GitHub',
  gitlab: 'GitLab',
  linkedin: 'LinkedIn',
  youtube: 'YouTube',
  email: 'Email',
  rss: 'RSS',
  orcid: 'ORCID',
};

/** A link's address as a reader sees it: no scheme, no trailing slash; a mailto's address. */
export function addressOf(url: string): string {
  const trimmed = url.trim();
  if (/^mailto:/i.test(trimmed)) return trimmed.replace(/^mailto:/i, '').split('?')[0]!;
  return trimmed.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/\/+$/, '');
}

const platformWord = (platform: string | undefined) => {
  if (!present(platform)) return undefined;
  const key = platform.trim().toLowerCase();
  return PLATFORM_WORDS[key] ?? key.charAt(0).toUpperCase() + key.slice(1);
};

/**
 * A contact row (SS-M4): the label column and the address the link shows.
 * The label is the link's own, unless it only repeats the address; then the
 * platform's name; else the row is the address alone.
 */
export function contactRow(link: Link): { label?: string; address: string } {
  const address = addressOf(link.url);
  const own = present(link.label) ? squash(link.label) : undefined;
  const repeats = own !== undefined && own.toLowerCase() === address.toLowerCase();
  const label = own && !repeats ? own : platformWord(link.platform);
  return label && label.toLowerCase() !== address.toLowerCase() ? { label, address } : { address };
}

/**
 * The links the contact finale lists: the contact record's, else the
 * portfolio's. The email is the finale's poster line, so a mailto to it
 * isn't listed again.
 */
export function contactLinks(input: ModelInput): readonly Link[] {
  const { contact, links, identity } = input.portfolio;
  const listed = contact?.links?.length ? contact.links : links;
  const email = present(identity.email) ? identity.email.trim().toLowerCase() : undefined;
  return listed.filter((link) => !(email && addressOf(link.url).toLowerCase() === email));
}

// ───────────── the case study (brief §5.1, component 19) ─────────────

/** A month and year in the composition's English, `January 2022`; a bare year stays a year. */
export function monthYear(raw: string | undefined): string | undefined {
  const date = shortDate(raw);
  if (!date) return undefined;
  const [year, month] = date.iso.split('-');
  if (month === undefined) return year;
  const name = MONTH_NAMES[Number(month) - 1];
  return name ? `${name[0]!.toUpperCase()}${name.slice(1)} ${year}` : year;
}

/** Fig. 1's caption: the owner's own for the cover where there is one; else the page names it "{title}, cover." */
export function coverCaption(work: Work): string | undefined {
  const caption = work.cover?.caption;
  return typeof caption === 'string' && present(caption) ? caption : undefined;
}

/**
 * The poster's parenthetical on a work's page, "(software, 2022–now)", in
 * its two halves, so the range sets as one unbroken run.
 */
export function caseAsideParts(work: Work): { medium?: string; when?: string } {
  const medium = mediumWord(work)?.toLowerCase();
  const when = workWhen(work)?.text;
  return { ...(medium ? { medium } : {}), ...(when ? { when } : {}) };
}

/** One row of the case's fact sheet: the composition's term and the work's own value. */
export interface Fact {
  readonly term: string;
  readonly value: string;
  /** Dates and figures, set in tabular figures. */
  readonly numeric?: boolean;
}

/** A sentence that ends: the owner's words, with a full stop when they have none. */
const sentence = (text: string) => (/[.!?…]$/.test(text) ? text : `${text}.`);

/**
 * The ruled fact sheet beside the poster: the role, the period ("Since
 * January 2022" while it runs), the medium, what it was made with, its
 * reach (the highlights, as sentences), and each award it cites. Only the
 * rows the work has.
 */
export function caseFacts(work: Work, cited: readonly Evidence[]): readonly Fact[] {
  const facts: Fact[] = [];
  if (present(work.role)) facts.push({ term: 'Role', value: squash(work.role) });
  if (present(work.organization))
    facts.push({ term: 'Organization', value: squash(work.organization) });
  const range = rangeOf(work.period);
  if (range) {
    const since = range.open ? monthYear(work.period?.start) : undefined;
    facts.push({ term: 'Period', value: since ? `Since ${since}` : range.text, numeric: true });
  }
  const medium = mediumWord(work);
  if (medium) facts.push({ term: 'Medium', value: medium });
  const tools = (work.tools ?? []).filter(present).map(squash);
  if (tools.length > 0) facts.push({ term: 'Made with', value: tools.join(', ') });
  const reach = (work.highlights ?? []).filter(present).map((text) => sentence(squash(text)));
  if (reach.length > 0) facts.push({ term: 'Reach', value: reach.join(' ') });
  for (const award of cited) {
    if (award.type !== 'award' || !present(award.title)) continue;
    const value = [squash(award.title), award.organization, yearOf(award.receivedAt)]
      .filter(present)
      .join(', ');
    facts.push({ term: 'Recognition', value });
  }
  return facts;
}

/** The decisions' table head, in the composition's words. */
export const DECISION_HEADS = ['Decision', 'Why', 'Instead of'] as const;

/** Where a work sits on home: its works section, its place among the live works, and the others. */
export interface CaseHome {
  readonly section: Extract<Section, { kind: 'works' }>;
  readonly title: string;
  /** From 1 among the section's works that aren't archived; 0 when the work is archived. */
  readonly position: number;
  readonly total: number;
  readonly others: readonly Work[];
}

/** The works section on home that holds the work, for the crumb and the way back. */
export function caseHome(work: Work, input: VariantRenderInput): CaseHome | undefined {
  const section = anchorSection(work, input);
  if (!section || section.kind !== 'works') return undefined;
  const live = worksOf(section, input).filter((each) => !isArchived(each, input));
  return {
    section,
    title: present(section.title) ? splitAside(section.title).text : (KIND_WORDS.works ?? 'Works'),
    position: live.findIndex((each) => each.id === work.id) + 1,
    total: live.length,
    others: live.filter((each) => each.id !== work.id),
  };
}

// ───────────── the home outline (design gate item 8) ─────────────

/** The type most of a section's evidence is. */
const majorityType = (entries: readonly Evidence[]) => {
  const counts = new Map<string, number>();
  for (const entry of entries) counts.set(entry.type, (counts.get(entry.type) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
};

/**
 * The sections a part shows closed, behind a native disclosure, so home
 * carries the thesis, a handful of works and one Record summary (gate item
 * 8, R12: display grouping only, no destination moves). Work keeps its
 * first works section, the signature's when it has one; Writing its first;
 * Record its words from collaborators; About everything but its skills,
 * stack and services (the contact part carries the ask); Contact everything. The rest fold, at the end of their part, each
 * with its frame, id and Index entry.
 */
export function foldedOf(part: Part, input: ModelInput): ReadonlySet<string> {
  const folded = new Set<string>();
  const sections = part.sections;
  if (part.id === 'work' || part.id === 'writing') {
    const signature = input.portfolio.signature;
    const works = sections.filter(
      (section): section is Extract<Section, { kind: 'works' }> => section.kind === 'works',
    );
    const kept =
      (signature ? works.find((section) => section.items.includes(signature)) : undefined) ??
      works[0] ??
      sections[0];
    for (const section of sections) if (section !== kept) folded.add(section.id);
  } else if (part.id === 'record') {
    for (const section of sections) {
      const testimonial =
        section.kind === 'evidence' && majorityType(evidenceOf(section, input)) === 'testimonial';
      if (!testimonial) folded.add(section.id);
    }
    // A Record of folds alone keeps its first section open, so the part says something.
    if (folded.size === sections.length && sections[0]) folded.delete(sections[0].id);
  } else if (part.id === 'about') {
    for (const section of sections) {
      if (
        section.kind === 'practice' &&
        (section.part === 'skills' || section.part === 'tools' || section.part === 'services')
      )
        folded.add(section.id);
    }
  }
  return folded;
}

/** The latest role a chronology lists, for its folded summary: "Principal Engineer, Solstice, 2023–now". */
export function latestRole(section: Section, input: ModelInput): string | undefined {
  if (section.kind !== 'chronology') return undefined;
  const role = chronologyOf(section, input).find((entry) => entry.kind === 'role');
  if (!role) return undefined;
  return [squash(role.title), role.organization, rangeOf(role.period)?.text]
    .filter(present)
    .join(', ');
}

// ───────────── a fold's summary row ─────────────

const EVIDENCE_NOUNS: Readonly<Record<string, readonly [string, string]>> = {
  metric: ['figure', 'figures'],
  testimonial: ['quote', 'quotes'],
  publication: ['paper', 'papers'],
  talk: ['talk', 'talks'],
  award: ['award', 'awards'],
  patent: ['patent', 'patents'],
  press: ['article', 'articles'],
  exhibition: ['exhibition', 'exhibitions'],
  client: ['client', 'clients'],
  recording: ['recording', 'recordings'],
  repository: ['repository', 'repositories'],
  'external-work': ['link', 'links'],
};

const WORK_NOUNS: Readonly<Record<string, readonly [string, string]>> = {
  software: ['project', 'projects'],
  writing: ['essay', 'essays'],
  'audio-video': ['episode', 'episodes'],
  'image-series': ['series', 'series'],
  photography: ['photograph', 'photographs'],
  research: ['study', 'studies'],
  music: ['record', 'records'],
};

/** What a practice entry is called: a string, or its name. */
const entryName = (entry: unknown): string | undefined => {
  if (typeof entry === 'string') return present(entry) ? squash(entry) : undefined;
  if (entry && typeof entry === 'object') {
    const { name, title, label } = entry as { name?: unknown; title?: unknown; label?: unknown };
    for (const value of [name, title, label])
      if (typeof value === 'string' && present(value)) return squash(value);
  }
  return undefined;
};

const majorityOf = (values: readonly (string | undefined)[]) => {
  const counts = new Map<string, number>();
  for (const value of values) if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
};

/**
 * A closed fold's summary row, so it reads as a list of things rather than
 * an accordion (lead A's ruling with design review item 10): what it holds,
 * counted in its own noun ("3 photographs", "6 tracks", "2 offers"), and its
 * first item's name, or for a chronology the latest role or the first entry
 * with its span. Every word comes from the section's own items.
 */
export function foldLine(
  section: Section,
  input: ModelInput,
): { readonly count?: string; readonly first?: string; readonly firstLang?: string } {
  const locale = input.portfolio.locale;
  const counted = (n: number, [one, many]: readonly [string, string]) =>
    n > 0 ? plural(n, one, many, locale) : undefined;
  switch (section.kind) {
    case 'works': {
      const works = worksOf(section, input);
      const only = works.length === 1 ? works[0] : undefined;
      if (only?.medium === 'image-series' && only.media?.length) {
        const caption = only.media.map((media) => media.caption).find(present);
        return {
          count: counted(only.media.length, ['photograph', 'photographs']),
          first: caption ? squash(caption) : splitAside(only.title).text,
          firstLang: only.lang,
        };
      }
      if (only?.tracks?.length) {
        return {
          count: counted(only.tracks.length, ['track', 'tracks']),
          first: splitAside(only.title).text,
          firstLang: only.lang,
        };
      }
      const medium = majorityOf(works.map((work) => work.medium));
      const noun = (medium && WORK_NOUNS[medium]) || (['work', 'works'] as const);
      return {
        count: counted(works.length, noun),
        first: works[0] ? splitAside(works[0].title).text : undefined,
        firstLang: works[0]?.lang,
      };
    }
    case 'evidence': {
      const entries = evidenceOf(section, input);
      const type = majorityOf(entries.map((entry) => entry.type));
      const noun = (type && EVIDENCE_NOUNS[type]) || (['record', 'records'] as const);
      const lead = entries[0];
      const name = lead
        ? [lead.title, lead.publication, lead.organization, lead.statement].find(present)
        : undefined;
      return {
        count: counted(entries.length, noun),
        first: name ? squash(name) : undefined,
        firstLang: lead?.lang,
      };
    }
    case 'chronology': {
      const entries = chronologyOf(section, input);
      const roles = entries.filter((entry) => entry.kind === 'role').length;
      const noun =
        roles === entries.length ? (['role', 'roles'] as const) : (['entry', 'entries'] as const);
      const latest = latestRole(section, input);
      const lead = entries[0];
      const first =
        latest ??
        (lead
          ? [squash(lead.title), lead.organization, rangeOf(lead.period)?.text]
              .filter(present)
              .join(', ')
          : undefined);
      const firstLang = latest ? entries.find((entry) => entry.kind === 'role')?.lang : lead?.lang;
      return { count: counted(entries.length, noun), first, firstLang };
    }
    case 'practice': {
      // No firstLang: the schema gives a skill, tool or service group, and
      // their items, no language of their own, so the row's is the page's.
      if (section.part === 'thesis') return {};
      const groups = (input.portfolio.practice?.[section.part] ?? []) as readonly {
        readonly name?: string;
        readonly items?: readonly unknown[];
      }[];
      const items = groups.flatMap((group) => group.items ?? []);
      if (section.part === 'services') {
        return {
          count: counted(items.length, ['offer', 'offers']),
          first: entryName(items[0]),
        };
      }
      const noun =
        section.part === 'tools' ? (['tool', 'tools'] as const) : (['skill', 'skills'] as const);
      return {
        count: counted(items.length, noun),
        first: entryName(groups[0]) ?? entryName(items[0]),
      };
    }
    case 'github': {
      const snapshot = githubSnapshot(section, input);
      if (snapshot?.state !== 'ready') return {};
      const repos =
        (snapshot.value as { readonly pinnedRepos?: readonly { readonly name?: string }[] })
          .pinnedRepos ?? [];
      return {
        count: counted(repos.length, ['repository', 'repositories']),
        first: entryName(repos[0]),
      };
    }
    case 'focus':
      return {
        count: counted(section.items.length, ['topic', 'topics']),
        first: entryName(section.items[0]),
      };
    case 'fun-facts':
      return { count: counted(section.items.length, ['fact', 'facts']) };
    case 'custom':
      return {
        count: counted(section.items?.length ?? 0, ['entry', 'entries']),
        first: entryName(section.items?.[0]),
      };
    default:
      return {};
  }
}
