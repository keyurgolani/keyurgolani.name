import { looseDateOrder } from '@portfolio/schema';
import type { ChronologyEntry, Evidence, Section, ViewGitHubData, Work } from '@portfolio/schema';
import {
  anchorSection,
  chronologyOf,
  footerOutline,
  isArchived,
  isSignature,
  navigationModel,
  pageOutline,
  present,
  sectionRenders,
  worksOf,
  evidenceOf,
  githubSnapshot,
  type DestinationId,
  type FooterOutline,
  type GroupingOptions,
  type NavigationModel,
  type OutlineSection,
  type PageOutline,
  type SectionOf,
} from '@portfolio/kit/sections';
import type { VariantRenderInput } from '@portfolio/variant-contract';

// Mission Control's content model (brief §5.8): every derivation the wall
// makes from a portfolio, pure, with no person's words in it (N4). The
// page reads the portfolio only through these, so what a render shows is
// what the rules give: the boards (K-1's grouping hook, display only), the
// spans each panel takes on the 16-column wall and the order they pack in,
// the anchor panel's lines, the readouts, Latest, the status line's
// readings and every lamp's state word. A word is a lamp only when a field
// says it; nothing here invents a status.

/** Whether the text is there to show. */
export const said = (text: string | undefined | null): text is string => present(text);

/** A section's own title, when it has one. */
export const titleOfSection = (section: Section) =>
  'title' in section && typeof section.title === 'string' ? section.title : undefined;

/** The wall's boards, in their fixed order. */
export type BoardId = 'overview' | 'work' | 'writing' | 'record' | 'about' | 'contact';

/** The columns of the wall at full width. */
export const WALL_COLUMNS = 16;

/** The spans a panel takes, by its kind (brief §5.8, packing). */
export type Span = 6 | 8 | 10 | 16;

/** How far ahead the packer looks for a panel that fills a row's gap, so content order mostly holds. */
export const LOOKAHEAD = 2;

/** The Latest panel lists this many dated records unless the owner says otherwise. */
export const LATEST_DEFAULT = 3;
export const LATEST_MAX = 8;
export const FRESH_DEFAULT = 365;
/** A push is recent within this many days of the snapshot's fetch. */
export const PUSH_FRESH_DAYS = 30;

/** Ids the composition gives its own elements: two hyphens, which no content id has. */
export function chromeIds(prefix: string) {
  return {
    board: (id: BoardId) => `${prefix}mc--board-${id}`,
    boardTitle: (id: BoardId) => `${prefix}mc--board-${id}-title`,
    rail: `${prefix}mc--rail`,
    railTitle: `${prefix}mc--rail-title`,
    status: `${prefix}mc--status`,
    readouts: `${prefix}mc--readouts`,
    readoutsTitle: `${prefix}mc--readouts-title`,
    latest: `${prefix}mc--latest`,
    latestTitle: `${prefix}mc--latest-title`,
    index: `${prefix}mc--index`,
    indexTitle: `${prefix}mc--index-title`,
    name: `${prefix}mc--name`,
    caseTitle: `${prefix}mc--case-title`,
    caseFacts: `${prefix}mc--case-facts`,
    caseFactsTitle: `${prefix}mc--case-facts-title`,
    caseNext: `${prefix}mc--case-next`,
    caseNextTitle: `${prefix}mc--case-next-title`,
  };
}

/** Abbreviations a sentence never ends on. */
const ABBREVIATION = /(?:^|\s)(?:[A-Z]|Mr|Mrs|Ms|Dr|St|Jr|Sr|Prof|vs|etc|e\.g|i\.e|cf|No|Vol)\.$/;

/**
 * A text's first sentence and the rest (K-6 `firstSentence`, kept here
 * until the kit lifts it): the first `.`, `!` or `?` followed by a space and
 * a capital or a digit, outside a Markdown link or code, and never after an
 * abbreviation or an initial.
 */
export function firstSentence(text: string): { readonly lead: string; readonly rest?: string } {
  const source = text.replace(/\s+/g, ' ').trim();
  let depth = 0;
  let code = false;
  for (let i = 0; i < source.length; i++) {
    const char = source[i]!;
    if (char === '`') code = !code;
    if (code) continue;
    if (char === '[' || char === '(') depth++;
    else if ((char === ']' || char === ')') && depth > 0) depth--;
    if (depth > 0 || !/[.!?]/.test(char)) continue;
    let end = i + 1;
    while (end < source.length && /["'”’*_)]/.test(source[end]!)) end++;
    if (source[end] !== ' ' || !/[\p{Lu}\p{N}"“‘(]/u.test(source[end + 1] ?? '')) continue;
    const lead = source.slice(0, end);
    if (char === '.' && ABBREVIATION.test(lead.replace(/[*_]+$/, ''))) continue;
    return { lead, rest: source.slice(end + 1) };
  }
  return { lead: source };
}

/** A statement's first clause, up to its first comma, colon, semicolon or sentence end. */
export function firstClause(text: string): string {
  const plain = text.replace(/\s+/g, ' ').trim();
  const match = /^(.+?)(?:[,;:]\s|[.!?](?:\s|$))/u.exec(plain);
  return (match ? match[1]! : plain).replace(/[.!?]$/, '');
}

/** The newest of the records by a date each gives, the first listed on a tie. */
function newest<T>(records: readonly T[], date: (record: T) => string): T | undefined {
  let best: T | undefined;
  for (const record of records) {
    if (best === undefined || date(record).localeCompare(date(best)) > 0) best = record;
  }
  return best;
}

/**
 * The current role (K-6 `currentRole`, kept here until the kit lifts it):
 * the role-kind chronology entry with no end and the latest start.
 */
export function currentRole(
  input: Pick<VariantRenderInput, 'portfolio'>,
): ChronologyEntry | undefined {
  return newest(
    input.portfolio.chronology.filter(
      (entry) => entry.kind === 'role' && entry.period.end === undefined,
    ),
    (entry) => String(entry.period.start ?? ''),
  );
}

// ---------- Dates ----------

/** A loose date's parts: YYYY, YYYY-MM or YYYY-MM-DD (and an ISO timestamp's date). */
export function dateParts(
  value: string | undefined,
): { readonly year: number; readonly month?: number; readonly day?: number } | undefined {
  if (!said(value)) return undefined;
  const match = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?/.exec(value.trim());
  if (!match) return undefined;
  return {
    year: Number(match[1]),
    ...(match[2] ? { month: Number(match[2]) } : {}),
    ...(match[3] ? { day: Number(match[3]) } : {}),
  };
}

/** A loose date in the page's locale, as precise as it was written, in UTC so no zone moves it. */
export function dateText(value: string | undefined, locale: string): string | undefined {
  const parts = dateParts(value);
  if (!parts) return undefined;
  const at = Date.UTC(parts.year, (parts.month ?? 1) - 1, parts.day ?? 1);
  const options: Intl.DateTimeFormatOptions = { timeZone: 'UTC', year: 'numeric' };
  if (parts.month !== undefined) options.month = 'short';
  if (parts.day !== undefined) options.day = 'numeric';
  try {
    return new Intl.DateTimeFormat(locale, options).format(at);
  } catch {
    return new Intl.DateTimeFormat('en', options).format(at);
  }
}

/** Days from one loose date to another, at day precision (a missing month or day is the first). */
export function daysBetween(from: string, to: string): number | undefined {
  const a = dateParts(from);
  const b = dateParts(to);
  if (!a || !b) return undefined;
  const ms = (p: NonNullable<ReturnType<typeof dateParts>>) =>
    Date.UTC(p.year, (p.month ?? 1) - 1, p.day ?? 1);
  return Math.round((ms(b) - ms(a)) / 86_400_000);
}

// ---------- Lamps: state words from fields ----------

/** A lamp's tone: a filled status lamp, or an outline one for a state that's over. */
export type LampTone = 'positive' | 'information' | 'neutral';

/** A lamp: a dot and a word, always. */
export interface Lamp {
  readonly tone: LampTone;
  readonly text: string;
  /** The machine-readable date, when the word carries one. */
  readonly date?: string;
}

/**
 * K-6 `recordState`, kept here until the kit lifts it: the state words a
 * record's own fields give, and nothing else. A record with none of them
 * has no lamp.
 */
export function recordState(
  record: Work | Evidence | ChronologyEntry,
  input: Pick<VariantRenderInput, 'portfolio'>,
): readonly Lamp[] {
  const { locale } = input.portfolio;
  const lamps: Lamp[] = [];
  if ('medium' in record) {
    const work = record;
    if (isArchived(work, input)) lamps.push({ tone: 'neutral', text: 'Archived' });
    else if (work.period?.start !== undefined && work.period.end === undefined) {
      const since = dateText(String(work.period.start), locale);
      if (since)
        lamps.push({
          tone: 'positive',
          text: `Active since ${since}`,
          date: String(work.period.start),
        });
    } else if (work.period?.end !== undefined) {
      const end = dateParts(String(work.period.end));
      if (end)
        lamps.push({ tone: 'neutral', text: `Shipped ${end.year}`, date: String(work.period.end) });
    }
    if (work.publishedAt !== undefined && !lamps.some(({ tone }) => tone === 'positive')) {
      const at = dateText(work.publishedAt, locale);
      if (at && lamps.length === 0)
        lamps.push({ tone: 'neutral', text: `Published ${at}`, date: work.publishedAt });
    } else if (work.releasedAt !== undefined && lamps.length === 0) {
      const at = dateText(work.releasedAt, locale);
      if (at) lamps.push({ tone: 'neutral', text: `Released ${at}`, date: work.releasedAt });
    }
    // A linked award: an information lamp with the award's own title.
    const evidence = new Map(input.portfolio.evidence.map((item) => [item.id, item]));
    for (const id of work.evidence ?? []) {
      const linked = evidence.get(id);
      if (linked?.type === 'award' && said(linked.title))
        lamps.push({ tone: 'information', text: linked.title });
    }
    return lamps;
  }
  if ('type' in record) {
    const evidence = record;
    if (evidence.type === 'patent') {
      if (evidence.status === 'granted') {
        const at = dateParts(evidence.grantedAt);
        lamps.push({
          tone: 'positive',
          text: at ? `Granted ${at.year}` : 'Granted',
          ...(evidence.grantedAt ? { date: evidence.grantedAt } : {}),
        });
      } else if (evidence.filedAt !== undefined) {
        const at = dateParts(evidence.filedAt);
        lamps.push({
          tone: 'neutral',
          text: at ? `Filed ${at.year}` : 'Filed',
          date: evidence.filedAt,
        });
      }
    }
    return lamps;
  }
  const entry = record;
  lamps.push(
    entry.period.end === undefined ||
      looseDateOrder(String(entry.period.end)) === Number.POSITIVE_INFINITY
      ? { tone: 'positive', text: 'Current' }
      : { tone: 'neutral', text: 'Ended' },
  );
  return lamps;
}

// ---------- Boards ----------

/**
 * The kinds the Overview takes after the anchor when the owner names no
 * tail: none, so the first view reaches the Work board's signature work
 * (F5); now and focus stay on About, their destination's board.
 */
const TAIL_KINDS: readonly string[] = [];

/** The owner's overviewTail control: up to two section ids. */
export function tailOf(input: VariantRenderInput): readonly string[] | undefined {
  const value = input.controls.overviewTail;
  return Array.isArray(value) && value.length > 0
    ? value.filter((id): id is string => typeof id === 'string').slice(0, 2)
    : undefined;
}

/**
 * The boards (K-1's grouping hook, display only): Overview stands for
 * About and takes the hero, the thesis and the owner's overviewTail (none
 * by default), each only where the map leaves it to the index or to About, so the hook never refuses one; every other
 * section takes its destination's board. A Writing board shows only when
 * the page has writing (lead A's ruling), and an empty board leaves.
 */
export function boardGrouping(tail: readonly string[] | undefined): GroupingOptions<BoardId> {
  const named = tail ? new Set(tail) : undefined;
  return {
    groups: [
      { id: 'overview', destination: 'about', label: { text: 'Overview' } },
      { id: 'work', destination: 'work' },
      { id: 'writing', destination: 'writing' },
      { id: 'record', destination: 'record' },
      { id: 'about', destination: 'about' },
      { id: 'contact', destination: 'contact' },
    ],
    groupOf: (section, { destination, sectionClass, firstOfKind, firstOfClass }) => {
      if (section.kind === 'hero' && firstOfKind) return 'overview';
      if (sectionClass === 'practice:thesis' && firstOfClass) return 'overview';
      const may = destination === null || destination === 'about';
      if (!may) return undefined;
      if (named ? named.has(section.id) : TAIL_KINDS.includes(section.kind) && firstOfKind)
        return 'overview';
      return undefined;
    },
    unplaced: 'about',
  };
}

/** The evidence types the full record holds: everything but the figures and the voices. */
const RECORD_TYPES: ReadonlySet<string> = new Set([
  'publication',
  'talk',
  'award',
  'patent',
  'press',
  'exhibition',
  'client',
  'recording',
  'repository',
  'external-work',
]);

/**
 * Whether a section is part of the full record, behind a closed native
 * disclosure at the end of its board (Design gate rule 8): publications,
 * talks, awards, patents, press and work elsewhere, education (a chronology
 * of studies), the GitHub snapshot, and the skills and the stack. The
 * summary stays open: the figures, the voices, the roles, every work, the
 * services and the owner's own words. By content shape, never by id or
 * title; display only, so no section changes destination.
 */
export function folds(section: Section, input: VariantRenderInput): boolean {
  switch (section.kind) {
    case 'evidence': {
      const records = evidenceOf(section, input);
      return records.length > 0 && records.every((record) => RECORD_TYPES.has(record.type));
    }
    case 'chronology': {
      const entries = chronologyOf(section, input);
      return entries.length > 0 && entries.every((entry) => entry.kind === 'study');
    }
    case 'github':
      return true;
    case 'practice':
      // Skills, tools and services are the practice's full record; the thesis is the anchor's.
      return section.part === 'skills' || section.part === 'tools' || section.part === 'services';
    default:
      return false;
  }
}

/** A board's sections with its folded ones after the rest, each group in reading order. */
export function foldsLast<T extends { readonly id: string }>(
  items: readonly T[],
  folded: (item: T) => boolean,
): T[] {
  return [...items.filter((item) => !folded(item)), ...items.filter(folded)];
}

/** One board as the wall draws it. */
export interface Board {
  readonly id: BoardId;
  readonly destination: DestinationId;
  readonly label: string;
  readonly lang?: string;
  /** Where the rail and the board's own index land: its section titled as it is, else its first. */
  readonly href: string;
  /** Its sections that render, in reading order. */
  readonly sections: readonly Section[];
  /** Its sections' outline entries, in the same order. */
  readonly entries: readonly OutlineSection[];
}

// ---------- Spans and packing ----------

/**
 * A section's span on the 16-column wall, by its kind, its part and its items (brief §5.8).
 * A kind whose body is the kit's measure-capped stack asks for 8, so two pair up rather than
 * one parking a column in a 16-wide frame (G2). A chronology of more than 3 entries still asks
 * for 16, since at 8 it would stand far taller than its neighbour; the stylesheet flows a wide
 * panel's stack in columns instead.
 */
export function spanOf(entry: OutlineSection, firstWorks: boolean): Span {
  switch (entry.kind) {
    case 'github':
      return 8;
    case 'chronology':
      return entry.count > 3 ? 16 : 8;
    case 'practice':
      return entry.part === 'thesis' ? 10 : 8;
    case 'lede':
    case 'contact':
      return 10;
    case 'works': {
      if (firstWorks) return 16;
      const media = entry.media?.map(({ medium }) => medium) ?? [];
      if (media.includes('image-series') || media.includes('photography')) return 10;
      if (media.every((medium) => medium === 'writing')) return 8;
      if (media.includes('audio-video') || media.includes('music')) return 8;
      return entry.count > 2 ? 10 : 6;
    }
    case 'evidence': {
      const types = entry.types?.map(({ type }) => type) ?? [];
      const only = types.length === 1 ? types[0] : undefined;
      if (only === 'testimonial' || only === 'press') return 16;
      if (only === 'external-work') return 8;
      if (only === 'publication' || only === 'talk') return 10;
      if (only === 'metric') return 8;
      return entry.count > 3 ? 10 : 6;
    }
    default:
      return 6;
  }
}

/** A placed panel: its item and the span it takes once its row is full. */
export interface Placed<T> {
  readonly item: T;
  readonly span: number;
  /** The span its kind asked for, before its row's gap stretched it. */
  readonly asked: Span;
}

/**
 * First-fit packing on the wall: each row takes panels in content order,
 * and when the next one doesn't fit the row's gap, the first of the next
 * LOOKAHEAD that does fills it; a row's last panel stretches over what's
 * left, so no row has a hole. The result is the DOM order, so tab order
 * and visual order agree.
 */
export function pack<T>(
  items: readonly { readonly item: T; readonly span: Span }[],
  columns = WALL_COLUMNS,
): Placed<T>[] {
  const rest = [...items];
  const out: Placed<T>[] = [];
  while (rest.length > 0) {
    const row: Placed<T>[] = [];
    let free = columns;
    while (rest.length > 0 && free > 0) {
      const at = rest
        .slice(0, LOOKAHEAD + 1)
        .findIndex(({ span }) => Math.min(span, columns) <= free);
      // The row's first panel always fits: every span is clamped to the columns.
      if (at < 0) break;
      const [next] = rest.splice(at, 1);
      const span = Math.min(next!.span, columns);
      row.push({ item: next!.item, span, asked: next!.span });
      free -= span;
    }
    if (free > 0) {
      const last = row.pop()!;
      row.push({ ...last, span: last.span + free });
    }
    out.push(...row);
  }
  return out;
}

// ---------- Counts ----------

/** Each kind's name in the composition's words, for an untitled panel's bar (never the schema's id). */
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

/** An untitled panel's bar label: its kind's word, else a plain one. */
export const kindWord = (kind: string) => KIND_WORDS[kind] ?? 'Section';

/** The count a panel's title bar carries, in the composition's own words. */
export interface Count {
  readonly n: number;
  readonly one: string;
  readonly many: string;
}

const EVIDENCE_WORDS: Readonly<Record<string, readonly [string, string]>> = {
  metric: ['metric', 'metrics'],
  publication: ['publication', 'publications'],
  talk: ['talk', 'talks'],
  award: ['award', 'awards'],
  patent: ['patent', 'patents'],
  testimonial: ['quote', 'quotes'],
  press: ['article', 'articles'],
};

/** A section's count for its title bar, or none for a kind that holds one thing. */
export function countOf(entry: OutlineSection): Count | undefined {
  if (entry.count <= 0) return undefined;
  const words = ((): readonly [string, string] | undefined => {
    switch (entry.kind) {
      case 'works':
        return entry.media?.every(({ medium }) => medium === 'writing')
          ? ['piece', 'pieces']
          : ['work', 'works'];
      case 'evidence': {
        const types = entry.types ?? [];
        return types.length === 1
          ? (EVIDENCE_WORDS[types[0]!.type] ?? ['record', 'records'])
          : ['record', 'records'];
      }
      case 'chronology':
        return ['entry', 'entries'];
      case 'focus':
      case 'fun-facts':
        return ['item', 'items'];
      case 'practice':
        return entry.part === 'thesis' ? undefined : ['group', 'groups'];
      default:
        return undefined;
    }
  })();
  return words ? { n: entry.count, one: words[0], many: words[1] } : undefined;
}

export const countWords = (count: Count) => (count.n === 1 ? count.one : count.many);

// ---------- Readouts and Latest ----------

/** One readout: a metric's figure, its unit, and the first clause of its statement. */
export interface Readout {
  readonly id: string;
  readonly value?: number;
  readonly unit?: string;
  readonly label?: string;
  readonly href?: string;
  readonly lang?: string;
}

/** The first all-metric evidence section's metrics, as the Overview's readouts (a back-reference). */
export function readoutsOf(
  input: VariantRenderInput,
  outline: PageOutline,
): { readonly section: OutlineSection; readonly readouts: readonly Readout[] } | undefined {
  const entry = outline.sections.find(
    (item) =>
      item.kind === 'evidence' && item.types?.length === 1 && item.types[0]!.type === 'metric',
  );
  if (!entry) return undefined;
  const section = input.portfolio.sections.find(({ id }) => id === entry.id);
  if (!section) return undefined;
  const readouts = evidenceOf(section, input)
    .filter((record) => record.metric?.value !== undefined)
    .map((record): Readout => {
      const label = said(record.statement)
        ? firstClause(record.statement)
        : said(record.title)
          ? record.title
          : undefined;
      return {
        id: record.id,
        ...(record.metric?.value !== undefined ? { value: record.metric.value } : {}),
        ...(said(record.metric?.unit) ? { unit: record.metric!.unit } : {}),
        ...(label ? { label } : {}),
        ...(entry.href ? { href: `#${input.ids.prefix}${record.id}` } : {}),
        ...(record.lang ? { lang: record.lang } : {}),
      };
    });
  return readouts.length > 0 ? { section: entry, readouts } : undefined;
}

/** A dated record Latest may list. */
export interface Dated {
  readonly id: string;
  /** The section the record sits in, so a route to it names its board. */
  readonly section: string;
  readonly date: string;
  readonly kind: string;
  readonly title: string;
  readonly href?: string;
  readonly lang?: string;
}

const WORK_KIND: Readonly<Record<string, string>> = {
  writing: 'Essay',
  'audio-video': 'Episode',
  music: 'Release',
  photography: 'Photographs',
  'image-series': 'Series',
  research: 'Research',
};
const EVIDENCE_KIND: Readonly<Record<string, string>> = {
  publication: 'Publication',
  talk: 'Talk',
  award: 'Award',
  patent: 'Patent',
  press: 'Press',
};

/**
 * K-6 `datedRecords`, kept here until the kit lifts it: every dated record
 * a section on the page lists, by the date its own fields give, newest
 * first, each record once.
 */
export function datedRecords(input: VariantRenderInput): readonly Dated[] {
  const seen = new Set<string>();
  const out: Dated[] = [];
  const add = (
    record: { readonly id: string; readonly lang?: string },
    date: unknown,
    kind: string,
    title: string | undefined,
  ) => {
    if (seen.has(record.id) || typeof date !== 'string' || !dateParts(date) || !said(title)) return;
    const section = anchorSection(record, input);
    if (!section) return;
    seen.add(record.id);
    out.push({
      id: record.id,
      section: section.id,
      date,
      kind,
      title,
      href: `#${input.ids.prefix}${record.id}`,
      ...(record.lang ? { lang: record.lang } : {}),
    });
  };
  for (const section of input.portfolio.sections) {
    if (!sectionRenders(section, input)) continue;
    if (section.kind === 'works') {
      for (const work of worksOf(section, input)) {
        const date = work.publishedAt ?? work.releasedAt;
        const kind =
          work.series !== undefined && work.number !== undefined
            ? `Episode ${work.number}`
            : (WORK_KIND[work.medium] ?? 'Work');
        add(work, date, kind, work.title);
      }
    } else if (section.kind === 'evidence') {
      for (const record of evidenceOf(section, input)) {
        const date =
          record.publishedAt ?? record.presentedAt ?? record.grantedAt ?? record.receivedAt;
        const kind = EVIDENCE_KIND[record.type];
        if (kind) add(record, date, kind, record.title ?? record.statement);
      }
    }
  }
  return out.sort((a, b) => b.date.localeCompare(a.date));
}

/** The latestCount control, clamped, with its default. */
export function latestCount(input: VariantRenderInput): number {
  const value = input.controls.latestCount;
  return typeof value === 'number' && Number.isInteger(value)
    ? Math.max(0, Math.min(LATEST_MAX, value))
    : LATEST_DEFAULT;
}

// ---------- The status line ----------

/** One reading on the status line. */
export interface Signal {
  readonly key: 'now' | 'push';
  readonly lamp: 'positive' | 'neutral';
  readonly label: string;
  readonly date: string;
  readonly text: string;
}

/** The nowFreshForDays control, clamped, with its default. */
export function freshDays(input: VariantRenderInput): number {
  const value = input.controls.nowFreshForDays;
  return typeof value === 'number' && Number.isInteger(value)
    ? Math.max(30, Math.min(730, value))
    : FRESH_DEFAULT;
}

/** The newest push in any GitHub section's snapshot, with its fetch time. */
function newestPush(
  input: VariantRenderInput,
): { pushedAt: string; fetchedAt: string } | undefined {
  let best: { pushedAt: string; fetchedAt: string } | undefined;
  for (const section of input.portfolio.sections) {
    if (section.kind !== 'github' || !sectionRenders(section, input)) continue;
    const derived = githubSnapshot(section, input);
    if (derived?.state !== 'ready') continue;
    const data = derived.value as ViewGitHubData;
    for (const repo of data.recentlyActive ?? []) {
      if (!best || repo.pushedAt.localeCompare(best.pushedAt) > 0)
        best = { pushedAt: repo.pushedAt, fetchedAt: data.fetchedAt };
    }
  }
  return best;
}

/**
 * The status line's readings, real ones only, each left out when its field
 * is missing: the now section's as-of date (a filled lamp within
 * nowFreshForDays of the request day, else an outline one, never a
 * warning) and the newest push in the GitHub snapshot (filled within 30
 * days of the snapshot's fetch).
 */
export function signalsOf(input: VariantRenderInput): readonly Signal[] {
  const { locale } = input.portfolio;
  const signals: Signal[] = [];
  const now = input.portfolio.sections.find(
    (section): section is SectionOf<'now'> =>
      section.kind === 'now' && sectionRenders(section, input),
  );
  const asOf = now?.asOf !== undefined ? String(now.asOf) : undefined;
  const asOfText = dateText(asOf, locale);
  if (asOf && asOfText) {
    const age = daysBetween(asOf, input.env.now);
    signals.push({
      key: 'now',
      lamp: age !== undefined && age <= freshDays(input) ? 'positive' : 'neutral',
      label: 'Now, updated',
      date: asOf,
      text: asOfText,
    });
  }
  const push = newestPush(input);
  const pushText = push ? dateText(push.pushedAt, locale) : undefined;
  if (push && pushText) {
    const age = daysBetween(push.pushedAt, push.fetchedAt);
    signals.push({
      key: 'push',
      lamp: age !== undefined && age <= PUSH_FRESH_DAYS ? 'positive' : 'neutral',
      label: 'Last push',
      date: push.pushedAt.slice(0, 10),
      text: pushText,
    });
  }
  return signals;
}

// ---------- The showcase ----------

/** The first works section's cells: the signature, the featured one, the archived strip, the rest. */
export interface Showcase {
  readonly signature?: Work;
  readonly featured?: Work;
  readonly archived?: Work;
  readonly rest: readonly Work[];
}

/** Splits a works section into the showcase's cells (brief §5.8). */
export function showcaseOf(works: readonly Work[], input: VariantRenderInput): Showcase {
  const left = [...works];
  const take = (pick: (work: Work) => boolean) => {
    const at = left.findIndex(pick);
    return at < 0 ? undefined : left.splice(at, 1)[0];
  };
  const signature = take((work) => isSignature(work, input)) ?? take(() => true);
  const featured =
    take((work) => input.portfolio.featured.includes(work.id) && !isArchived(work, input)) ??
    take((work) => !isArchived(work, input));
  const archived = take((work) => isArchived(work, input));
  return {
    ...(signature ? { signature } : {}),
    ...(featured ? { featured } : {}),
    ...(archived ? { archived } : {}),
    rest: left,
  };
}

// ---------- Correlate: the records a record names (K-6 `relationsOf`) ----------

/** The kinds whose records the wall marks for correlate: the ones its own renderers draw. */
export const TRACED_KINDS: readonly string[] = ['works', 'evidence', 'chronology', 'github'];

/** The key a repository in a GitHub snapshot takes: two hyphens, which no content id has. */
export const repoKey = (name: string) => `mc--repo-${name}`;

/**
 * The repositories a GitHub section shows, as its flags say: up to six
 * pinned and the recently pushed to its limit, the excluded left out.
 */
export function shownRepos(section: SectionOf<'github'>, data: ViewGitHubData) {
  const excluded = new Set(section.excludeRepos ?? []);
  const pinned =
    section.showPinnedRepos !== false
      ? (data.pinnedRepos ?? []).filter((repo) => !excluded.has(repo.name)).slice(0, 6)
      : [];
  const recent =
    section.showRecentlyActive !== false
      ? (data.recentlyActive ?? [])
          .filter((repo) => !excluded.has(repo.name))
          .slice(0, section.recentlyActiveLimit ?? 10)
      : [];
  return { pinned, recent };
}

/** What a named record is called in a Linked list, and where it is on the page. */
export interface RelatedLabel {
  readonly text: string;
  /** The composition's word for what it is, such as Repository. */
  readonly kind?: string;
  readonly lang?: string;
  /** Its place on the page, when it has one there. */
  readonly href?: string;
}

/** One hop of relations between the records on the page, both ways. */
export interface Relations {
  /** Each record that names another, with the records it names, in the order first met. */
  readonly names: ReadonlyMap<string, readonly string[]>;
  readonly labels: ReadonlyMap<string, RelatedLabel>;
}

const NO_RELATIONS: Relations = { names: new Map(), labels: new Map() };

/** A link's address as the relation compares it: no trailing slash. */
const sameUrl = (url: string) => url.trim().replace(/\/+$/, '');

/** The correlate control: on unless the owner turned it off. */
export const correlateOn = (input: Pick<VariantRenderInput, 'controls'>) =>
  input.controls.correlate !== false;

/**
 * The relations correlate traces (brief §5.8), one hop, only through
 * fields that name another record, and only between records a section the
 * wall marks shows: a work's evidence; a chronology entry's works, the
 * entry it branches from and the one it merges into; a testimonial whose
 * source's organization is a chronology entry's; and a repository in the
 * GitHub snapshot whose address is one of a work's links. Every relation
 * runs both ways: the award a work names names the work. Nothing is
 * inferred from titles or text.
 */
export function relationsOf(
  input: VariantRenderInput,
  traced: readonly string[] = TRACED_KINDS,
): Relations {
  if (!correlateOn(input)) return NO_RELATIONS;
  const { prefix } = input.ids;
  const works = new Map<string, Work>();
  const evidence = new Map<string, Evidence>();
  const entries = new Map<string, ChronologyEntry>();
  const repos = new Map<string, { name: string; url: string }>();
  for (const section of input.portfolio.sections) {
    if (!traced.includes(section.kind) || !sectionRenders(section, input)) continue;
    if (section.kind === 'works')
      for (const work of worksOf(section, input)) works.set(work.id, work);
    else if (section.kind === 'evidence')
      for (const record of evidenceOf(section, input)) evidence.set(record.id, record);
    else if (section.kind === 'chronology')
      for (const entry of chronologyOf(section, input)) entries.set(entry.id, entry);
    else if (section.kind === 'github') {
      const derived = githubSnapshot(section, input);
      if (derived?.state !== 'ready') continue;
      const data = derived.value as ViewGitHubData;
      const { pinned, recent } = shownRepos(section, data);
      for (const repo of [...pinned, ...recent])
        repos.set(repoKey(repo.name), { name: repo.name, url: repo.url });
    }
  }
  const placed = (id: string) => works.has(id) || evidence.has(id) || entries.has(id);
  const names = new Map<string, string[]>();
  const link = (a: string, b: string) => {
    if (a === b) return;
    for (const [from, to] of [
      [a, b],
      [b, a],
    ] as const) {
      const list = names.get(from) ?? [];
      if (!list.includes(to)) list.push(to);
      names.set(from, list);
    }
  };
  for (const work of works.values()) {
    for (const id of work.evidence ?? []) if (evidence.has(id)) link(work.id, id);
    const urls = new Set(
      [...(work.links ?? []).map(({ url }) => url), ...(said(work.url) ? [work.url] : [])].map(
        sameUrl,
      ),
    );
    for (const [key, repo] of repos) if (urls.has(sameUrl(repo.url))) link(work.id, key);
  }
  for (const entry of entries.values()) {
    for (const id of entry.works ?? []) if (works.has(id)) link(entry.id, id);
    for (const id of [entry.branchesFrom, entry.mergesInto])
      if (id !== undefined && entries.has(id)) link(entry.id, id);
    if (said(entry.organization))
      for (const record of evidence.values())
        if (record.type === 'testimonial' && record.source?.organization === entry.organization)
          link(entry.id, record.id);
  }
  const labels = new Map<string, RelatedLabel>();
  const at = (record: { readonly id: string }) =>
    anchorSection(record, input) ? { href: `#${prefix}${record.id}` } : {};
  for (const id of names.keys()) {
    const work = works.get(id);
    const record = evidence.get(id);
    const entry = entries.get(id);
    const repo = repos.get(id);
    const label: RelatedLabel | undefined = work
      ? { text: work.title, ...(work.lang ? { lang: work.lang } : {}), ...at(work) }
      : record
        ? {
            text:
              record.type === 'testimonial' && record.source
                ? [record.source.name, record.source.organization].filter(said).join(', ')
                : said(record.title)
                  ? record.title
                  : firstClause(record.statement ?? ''),
            ...(record.lang ? { lang: record.lang } : {}),
            ...at(record),
          }
        : entry
          ? {
              text: [entry.title, entry.organization].filter(said).join(', '),
              ...(entry.lang ? { lang: entry.lang } : {}),
              ...at(entry),
            }
          : repo
            ? { text: repo.name, kind: 'Repository', href: `#${prefix}${id}` }
            : undefined;
    if (label && said(label.text)) labels.set(id, label);
  }
  // A record whose names have no words to show is left out, so every Linked list is whole.
  const shown = new Map<string, readonly string[]>();
  for (const [id, list] of names) {
    const kept = list.filter((other) => labels.has(other) && (placed(other) || repos.has(other)));
    if (kept.length > 0 && labels.has(id)) shown.set(id, kept);
  }
  return { names: shown, labels };
}

// ---------- The page plan ----------

/** Where the hero's tagline sits when the thesis is the lede: About's lede panel, else the anchor. */
export interface Tagline {
  readonly text: string;
  /** The About board's lede section it opens, as that panel's standfirst; none: the anchor's hero part. */
  readonly section?: string;
}

export interface HomeModel {
  readonly outline: PageOutline;
  readonly navigation: NavigationModel<BoardId>;
  readonly boards: readonly Board[];
  readonly footer: FooterOutline;
  readonly hero?: SectionOf<'hero'>;
  readonly thesis?: SectionOf<'practice'>;
  /** The thesis's first sentence, else the hero's tagline's, else the identity's tagline (N5). */
  readonly lede?: string;
  /** Whether a part of the anchor (the thesis's or the hero's) draws the lede; else the anchor does. */
  readonly ledeInPart: boolean;
  /**
   * The rest of the text the lede is the first sentence of (the thesis, else the hero's
   * tagline): the anchor's standfirst, right under it, the one statement continued (MC-M1, N3).
   */
  readonly ledeRest?: string;
  /**
   * The hero's tagline when the thesis is the lede, so it isn't on the anchor already (N3): it
   * opens About's lede panel, else it sits in the anchor above the subtagline.
   */
  readonly tagline?: Tagline;
  /** The role line: the current role and its organisation, else the identity's tagline. */
  readonly role?: { readonly title: string; readonly organization?: string };
  readonly readouts?: ReturnType<typeof readoutsOf>;
  readonly latest: readonly Dated[];
  readonly latestShown: number;
  readonly signals: readonly Signal[];
  /** The first works section on the page, which opens as the showcase. */
  readonly firstWorks?: string;
  /** The host's words, marked English in a portfolio in another language. */
  readonly uiLang: 'en' | undefined;
  /** What correlate traces: the records each record names, one hop. */
  readonly relations: Relations;
}

/** Builds the page plan from the render input. */
export function homeModel(input: VariantRenderInput, outline = pageOutline(input)): HomeModel {
  const { portfolio } = input;
  const grouping = boardGrouping(tailOf(input));
  const navigation = navigationModel<BoardId>(outline, { grouping });
  const footer = footerOutline(input);
  const byId = new Map(portfolio.sections.map((section) => [section.id, section]));
  const boards: Board[] = navigation.groups.flatMap((group): Board[] => {
    const folded = (id: string) =>
      folds(byId.get(id)!, input) && said(titleOfSection(byId.get(id)!));
    const entries = foldsLast(
      group.sections.filter((entry) => byId.has(entry.id)),
      (entry) => folded(entry.id),
    );
    const sections = entries
      .map((entry) => byId.get(entry.id)!)
      .filter((section) => sectionRenders(section, input));
    if (sections.length === 0) return [];
    return [
      {
        id: group.id,
        destination: group.destination,
        label: group.label,
        ...(group.lang ? { lang: group.lang } : {}),
        href: group.href,
        sections,
        entries: entries.filter((entry) => sections.some(({ id }) => id === entry.id)),
      },
    ];
  });
  const overview = boards.find(({ id }) => id === 'overview');
  const hero = overview?.sections.find(
    (section): section is SectionOf<'hero'> => section.kind === 'hero',
  );
  const thesisText = portfolio.practice?.thesis;
  const thesis = said(thesisText)
    ? overview?.sections.find(
        (section): section is SectionOf<'practice'> =>
          section.kind === 'practice' && section.part === 'thesis',
      )
    : undefined;
  const lede =
    thesis && said(thesisText)
      ? firstSentence(thesisText).lead
      : said(hero?.tagline)
        ? firstSentence(hero!.tagline!).lead
        : said(portfolio.identity.tagline)
          ? portfolio.identity.tagline
          : undefined;
  const heroTagline = said(hero?.tagline) ? hero!.tagline! : undefined;
  const ledeSource = thesis && said(thesisText) ? thesisText : heroTagline;
  const rest = ledeSource ? firstSentence(ledeSource).rest : undefined;
  const ledeRest = said(rest) ? rest : undefined;
  const aboutLede = boards
    .find(({ id }) => id === 'about')
    ?.sections.find((section) => section.kind === 'lede');
  const tagline: Tagline | undefined =
    thesis && heroTagline
      ? { text: heroTagline, ...(aboutLede ? { section: aboutLede.id } : {}) }
      : undefined;
  const current = currentRole(input);
  const role = current
    ? {
        title: current.title,
        ...(said(current.organization) ? { organization: current.organization } : {}),
      }
    : said(portfolio.identity.tagline) && lede !== portfolio.identity.tagline
      ? { title: portfolio.identity.tagline }
      : undefined;
  const latest = datedRecords(input);
  const firstWorks = outline.sections.find(({ kind }) => kind === 'works')?.id;
  return {
    outline,
    navigation,
    boards,
    footer,
    ...(hero ? { hero } : {}),
    ...(thesis ? { thesis } : {}),
    ...(lede ? { lede } : {}),
    ledeInPart: thesis !== undefined || hero !== undefined,
    ...(ledeRest ? { ledeRest } : {}),
    ...(tagline ? { tagline } : {}),
    ...(role ? { role } : {}),
    readouts: readoutsOf(input, outline),
    latest,
    latestShown: Math.min(latestCount(input), latest.length),
    signals: signalsOf(input),
    ...(firstWorks ? { firstWorks } : {}),
    uiLang: /^en(?:-|$)/i.test(portfolio.locale) ? undefined : 'en',
    relations: relationsOf(input),
  };
}
