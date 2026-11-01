import type { ChronologyEntry, Evidence, Work } from '@portfolio/schema';
import type { Period, VariantRenderInput } from '@portfolio/variant-contract';
import { chronologyOf, evidenceOf, worksOf } from '@portfolio/kit/sections';
import { monthName, moment, nowMoment, type Moment } from './dates';

// The book model (concept.json, genericDerivations 1 to 10): any portfolio
// as a short book. Front matter, chapters derived from the chronology's
// eras, back matter. Nothing here names a person, an employer, or a year.
// It reads the render input's published view through the kit's record
// helpers (worksOf, evidenceOf, chronologyOf), which already left out what
// visitors may not see, so no privacy or data rule is derived again here.
//
// 1. Eras: every chronology entry of kind role or study, read at its own
//    precision; overlapping periods merge, adjacent ones don't.
// 2. Cap: maxChapters merges the adjacent pair with the shortest span.
// 3. Titles: the era's organizations ('A', 'A and B', 'A, B and n more'),
//    or its principal role, or its years (chapterTitles).
//    The owner's own chapters (the `chapters` periodList) replace 1 to 3:
//    their boundaries and titles, records placing by date between them.
//    A list the book can't bind (malformed, out of order, starting after
//    now) is refused whole, and the derived chapters print.
// 4. Placement, first match wins, each record once: (a) links, (b) the
//    owner's place map, (c) the testimonial's organization, (d) the
//    record's own date, (e) present tense, (f) the back matter. A move the
//    book can't make (no such record, no such chapter, a link that holds
//    it) is kept where its own rules put it.
// 5. Kinds with no time map to fixed parts of the book.
// 6. Parts: plates, series, group pages packed two to a spread, the close.
// 7. Pages: roman for the front matter, arabic from chapter 1.
// 8. The index: skills and tools with page locators.
// 9. Inks: chapter n takes categorical ((n - 1) mod 5) + 1.
// 10. Fallbacks: calendar years, then one chapter.

type ViewSection = VariantRenderInput['portfolio']['sections'][number];

/** A work or a piece of evidence, as the book places it. */
export type BookRecord =
  | { readonly type: 'work'; readonly id: string; readonly work: Work }
  | { readonly type: 'evidence'; readonly id: string; readonly evidence: Evidence };

/** One section's records on a page, and whether this is the section's frame in its document. */
export interface Group {
  readonly section: ViewSection;
  readonly records: readonly BookRecord[];
  /** Estimated lines, for packing two groups to a spread. */
  readonly lines: number;
}

interface PartBase {
  /** The part's anchor, without the render's id prefix. Never a page number: pages shift. */
  readonly key: string;
  readonly title: string;
  /** The verso's folio; the recto's is page + 1. */
  page: number;
}

export interface OpenerPart extends PartBase {
  readonly type: 'opener';
}
export interface PlatePart extends PartBase {
  readonly type: 'plate';
  readonly work: Work;
  readonly section: ViewSection;
  /** Its plate number in the chapter, such as "3.1". */
  readonly plate: string;
  /** Plates alternate: the image on the recto, or on the verso. */
  readonly imageSide: 'recto' | 'verso';
}
export interface SeriesPart extends PartBase {
  readonly type: 'series';
  readonly work: Work;
  readonly section: ViewSection;
  /** A plate number for each image, in order. */
  readonly plates: readonly string[];
}
export interface GroupsPart extends PartBase {
  readonly type: 'groups';
  readonly verso: readonly Group[];
  readonly recto: readonly Group[];
}
export interface FlowPart extends PartBase {
  readonly type: 'flow';
  readonly group: Group;
}
export interface ClosePart extends PartBase {
  readonly type: 'close';
}
export type Part = OpenerPart | PlatePart | SeriesPart | GroupsPart | FlowPart | ClosePart;

export interface Chapter {
  /** 1-based. */
  readonly n: number;
  readonly slug: string;
  readonly title: string;
  readonly organizations: readonly string[];
  /** Each spine entry's role line: title, field, and the organization's sub-unit. */
  readonly roles: readonly string[];
  readonly locations: readonly string[];
  /** "Since April 2023", "August 2018 to March 2023", "2010 to 2016". */
  readonly span: string;
  /** "Since 2023", "2018 to 2023". */
  readonly years: string;
  readonly open: boolean;
  readonly start: Moment | undefined;
  readonly end: Moment | undefined;
  /** The spine entries, oldest first. */
  readonly entries: readonly ChronologyEntry[];
  /** Side threads placed here: projects, events, milestones. */
  readonly side: ChronologyEntry[];
  /** 1 to 5, the categorical ink, or 0 for the accent. */
  readonly ink: number;
  readonly current: boolean;
  /** The owner's teaser for their own chapter. */
  readonly teaser?: string;
  parts: Part[];
  firstPage: number;
  lastPage: number;
}

/** Where a record or a term is printed: a chapter's part, or the back matter. */
export interface Locator {
  /** Null for the back matter. */
  readonly chapter: Chapter | null;
  readonly page: number;
  readonly key: string;
}

export interface Term {
  readonly name: string;
  readonly locators: Locator[];
  /** The practice groups that list it, for a term with no page. */
  readonly groups: string[];
  /** A tool's version. */
  version?: string;
}

export interface KindEntry {
  readonly record: BookRecord;
  readonly at: Locator;
}

export interface BackPart {
  readonly key: 'about' | 'engagements' | 'also-by' | 'uncollected' | 'index';
  readonly page: number;
}

/** What the book did with the owner's overrides, for the tests and Studio's report. */
export interface Overrides {
  /** `owner` when their chapters bound the book; `refused` when the list couldn't. */
  readonly chapters: 'derived' | 'owner' | 'refused';
  readonly reason?: string;
  /** Record ids the place map moved. */
  readonly moved: readonly string[];
  /** Record ids it named that stayed where their rules put them. */
  readonly kept: readonly string[];
  /** Why the place map was refused whole, when it was. */
  readonly placeRefused?: string;
}

export interface Book {
  readonly derivedFrom: 'chronology' | 'years' | 'single' | 'owner';
  readonly options: BookOptions;
  readonly overrides: Overrides;
  readonly chapters: readonly Chapter[];
  readonly current: Chapter | undefined;
  readonly front: {
    readonly hero?: ViewSection & { kind: 'hero' };
    readonly thesisSection?: ViewSection;
    /** The book's title and subtitle (derivation 5). */
    readonly title: string;
    readonly subtitle?: string;
    readonly quote?: ViewSection & { kind: 'quote' };
    readonly preface?: ViewSection & { kind: 'lede' };
    /** The proof's records, in the owner's order. */
    readonly proof: readonly BookRecord[];
    /**
     * The sections that print nowhere but the proof (every record they show is a proof
     * record): the imprint band frames them, so each section has its frame on some page.
     */
    readonly proofSections: readonly Group[];
    readonly signature?: Work;
  };
  readonly close: {
    readonly now?: ViewSection & { kind: 'now' };
    readonly focus?: ViewSection & { kind: 'focus' };
    readonly github?: ViewSection & { kind: 'github' };
  };
  readonly back: {
    readonly about?: ViewSection & { kind: 'fun-facts' };
    readonly services?: ViewSection;
    readonly alsoBy: readonly { section: ViewSection; evidence: Evidence }[];
    readonly uncollected: readonly Group[];
    /** Sections with nowhere else to go: later ledes, custom and extension sections. */
    readonly extras: readonly ViewSection[];
    readonly skills?: ViewSection;
    readonly tools?: ViewSection;
    readonly terms: readonly Term[];
    readonly kinds: readonly { kind: string; entries: readonly KindEntry[] }[];
    readonly parts: readonly BackPart[];
  };
  readonly colophon: {
    readonly contact?: ViewSection & { kind: 'contact' };
    readonly cta?: ViewSection & { kind: 'cta' };
  };
  /** Where each placed record prints. */
  readonly printed: ReadonlyMap<string, Locator>;
  /** Where each section's frame is: home, a chapter, the back matter, or the colophon on every page. */
  readonly sectionAt: ReadonlyMap<string, SectionPlace>;
  /** Which chapter each record went to, and by which rule. */
  readonly placed: ReadonlyMap<string, { chapter: Chapter; rule: string }>;
  readonly backStart: number;
  readonly totalPages: number;
}

/** The page a section's frame is on. */
export type SectionPlace = 'home' | 'back' | 'colophon' | Chapter;

export interface BookOptions {
  readonly maxChapters: number;
  readonly chapterTitles: 'organization' | 'role' | 'years';
  readonly chapterAccents: boolean;
  /** Where the fore-edge sits on a wide screen; phones always take the top bar. */
  readonly spine: 'left' | 'top' | 'off';
  /** Folios and page locators; off, the contents and index point by chapter. */
  readonly folios: boolean;
  /** The owner's own chapters, checked; empty for the derived book. */
  readonly periods: readonly Period[];
  /** Why the owner's chapters were refused, when they were. */
  readonly periodsRefused?: string;
  /** The owner's moves, record id to chapter slug. */
  readonly place: Readonly<Record<string, string>>;
  /** Why the owner's moves were refused, when they were. */
  readonly placeRefused?: string;
}

export const DEFAULT_OPTIONS: BookOptions = {
  maxChapters: 6,
  chapterTitles: 'organization',
  chapterAccents: true,
  spine: 'left',
  folios: true,
  periods: [],
  place: {},
};

/** The most chapters an owner may list, as the manifest's periodList declares. */
export const MAX_PERIODS = 7;
/** The most moves a place map holds, as the contract's recordPlacement does. */
const MAX_MOVES = 256;
const PERIOD_FROM = /^\d{4}(?:-(?:0[1-9]|1[0-2]))?$/;
/** A chapter slug: lowercase words joined by hyphens, at most 64 characters, as a path takes it. */
const SLUG = /^(?=.{1,64}$)[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** What owner text never holds: controls, line separators, direction overrides, markup. */
const UNPLAIN = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069<>]/;
const PERIOD_KEYS = new Set(['slug', 'title', 'from', 'teaser']);

const plain = (value: unknown, max: number): value is string =>
  typeof value === 'string' &&
  value.length > 0 &&
  value === value.trim() &&
  [...value].length <= max &&
  !UNPLAIN.test(value);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The month a period's `from` starts: a bare year is its January. */
const fromIdx = (from: string) =>
  Number(from.slice(0, 4)) * 12 + (Number(from.slice(5, 7)) || 1) - 1;

/**
 * The owner's chapters as the book can bind them, or why it can't. The host
 * already holds a stored list to the contract and renders its default when it
 * fails; the book checks again, since a list it can't bind must never print a
 * broken book: any one bad period refuses the whole list.
 */
export function periodsOf(value: unknown): { periods: Period[]; refused?: string } {
  if (value === undefined || value === null) return { periods: [] };
  if (!Array.isArray(value)) return { periods: [], refused: 'not a list of chapters' };
  if (value.length > MAX_PERIODS) {
    return { periods: [], refused: `more than ${MAX_PERIODS} chapters` };
  }
  const periods: Period[] = [];
  const slugs = new Set<string>(['back-matter']);
  let previous = -Infinity;
  for (const [i, item] of value.entries()) {
    const at = `chapter ${i + 1}`;
    if (!isRecord(item) || Object.keys(item).some((key) => !PERIOD_KEYS.has(key))) {
      return { periods: [], refused: `${at} isn't { slug, title, from, teaser? }` };
    }
    const { slug, title, from, teaser } = item;
    if (typeof slug !== 'string' || !SLUG.test(slug) || slugs.has(slug)) {
      return { periods: [], refused: `${at}'s slug is missing, malformed, taken or reserved` };
    }
    if (!plain(title, 60)) return { periods: [], refused: `${at}'s title isn't one plain line` };
    if (typeof from !== 'string' || !PERIOD_FROM.test(from)) {
      return { periods: [], refused: `${at}'s start isn't YYYY or YYYY-MM` };
    }
    if (fromIdx(from) <= previous) {
      return { periods: [], refused: `${at} doesn't start after the one before it` };
    }
    if (teaser !== undefined && !plain(teaser, 300)) {
      return { periods: [], refused: `${at}'s teaser isn't plain text of 300 characters or fewer` };
    }
    slugs.add(slug);
    previous = fromIdx(from);
    periods.push({ slug, title, from, ...(teaser !== undefined ? { teaser } : {}) });
  }
  return { periods };
}

/**
 * The owner's moves, each a record id to a chapter slug, or why the book can't take them. As
 * for the chapters, any one malformed move refuses the whole map, and so does more than the
 * contract's 256. A well-formed move the book can't make (no such record or chapter) is the
 * book's to keep in place, one at a time.
 */
export function placeOf(value: unknown): { moves: Record<string, string>; refused?: string } {
  if (value === undefined || value === null) return { moves: {} };
  if (!isRecord(value)) return { moves: {}, refused: 'not a map of record ids to chapter slugs' };
  const entries = Object.entries(value);
  if (entries.length > MAX_MOVES) return { moves: {}, refused: `more than ${MAX_MOVES} moves` };
  const moves: Record<string, string> = {};
  for (const [id, slug] of entries) {
    if (typeof slug !== 'string' || !SLUG.test(slug)) {
      return { moves: {}, refused: `the move of ${id} doesn't name a chapter slug` };
    }
    moves[id] = slug;
  }
  return { moves };
}

/** The control values the manifest declares, each held to its range, else its default. */
export function optionsOf(controls: Readonly<Record<string, unknown>>): BookOptions {
  const max = controls.maxChapters;
  const titles = controls.chapterTitles;
  const accents = controls.chapterAccents;
  const spine = controls.spine;
  const folios = controls.folios;
  const { periods, refused } = periodsOf(controls.chapters);
  const place = placeOf(controls.place);
  return {
    maxChapters:
      typeof max === 'number' && Number.isInteger(max) && max >= 2 && max <= 7
        ? max
        : DEFAULT_OPTIONS.maxChapters,
    chapterTitles:
      titles === 'organization' || titles === 'role' || titles === 'years'
        ? titles
        : DEFAULT_OPTIONS.chapterTitles,
    chapterAccents: typeof accents === 'boolean' ? accents : DEFAULT_OPTIONS.chapterAccents,
    spine: spine === 'left' || spine === 'top' || spine === 'off' ? spine : DEFAULT_OPTIONS.spine,
    folios: typeof folios === 'boolean' ? folios : DEFAULT_OPTIONS.folios,
    periods,
    ...(refused ? { periodsRefused: refused } : {}),
    place: place.moves,
    ...(place.refused ? { placeRefused: place.refused } : {}),
  };
}

/** The fixed anchors, each with two hyphens, which no content id has. */
export const ANCHORS = {
  contents: 'ch--contents',
  preface: 'ch--preface',
  opening: 'ch--opening',
  close: 'ch--close',
  turn: 'ch--turn',
  colophon: 'ch--colophon',
  title: 'ch--title',
  index: 'ch--index',
  about: 'ch--about',
  engagements: 'ch--engagements',
  alsoBy: 'ch--also-by',
  uncollected: 'ch--uncollected',
  back: 'ch--back-matter',
  case: 'ch--case',
  story: 'ch--story',
  decisions: 'ch--decisions',
  after: 'ch--after',
} as const;

/** Lines a page holds before a new spread starts (derivation 6). */
const PAGE_LINES = 30;
/** Characters a line, for the estimate. */
const LINE_CHARS = 58;

/** The text before an organization's first comma: "IIT Bombay, Formal Methods Lab" is IIT Bombay. */
export const normalOrganization = (organization: string | undefined): string | undefined => {
  const head = organization?.split(',')[0]?.trim();
  return head ? head : undefined;
};

/** A slug in the route grammar: lowercase words joined by hyphens, at most 64 characters. */
export function slugify(text: string): string {
  const words = text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/[\s-]+/)
    .filter(Boolean);
  let slug = '';
  for (const word of words) {
    const next = slug ? `${slug}-${word}` : word;
    if (next.length > 60) break;
    slug = next;
  }
  return slug;
}

/** Names as a book lists them: "A", "A and B", "A, B and C". */
export function listed(names: readonly string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

interface Era {
  entries: { entry: ChronologyEntry; start: Moment; end: Moment }[];
  start: Moment;
  end: Moment;
}

function dateOfWork(work: Work, now: string): Moment | undefined {
  for (const raw of [work.period?.start, work.publishedAt, work.releasedAt]) {
    const at = moment(raw, 'start', now);
    if (at) return at;
  }
  const taken = (work.media ?? [])
    .map((placement) => moment(placement.takenAt, 'start', now))
    .filter((at): at is Moment => at !== undefined)
    .sort((a, b) => a.idx - b.idx);
  return taken[0];
}

function dateOfEvidence(evidence: Evidence, now: string): Moment | undefined {
  for (const raw of [
    evidence.publishedAt,
    evidence.presentedAt,
    evidence.receivedAt,
    evidence.filedAt,
    evidence.grantedAt,
  ]) {
    const at = moment(raw, 'start', now);
    if (at) return at;
  }
  return undefined;
}

const recordDate = (record: BookRecord, now: string) =>
  record.type === 'work' ? dateOfWork(record.work, now) : dateOfEvidence(record.evidence, now);

/** The lines a group is estimated to take on a page. */
function estimate(section: ViewSection, records: readonly BookRecord[]): number {
  let lines = 3 + (section.subtitle ? 2 : 0);
  for (const record of records) {
    const text =
      record.type === 'work'
        ? (record.work.summary ?? record.work.excerpt ?? record.work.description ?? '')
        : (record.evidence.statement ??
          record.evidence.excerpt ??
          record.evidence.description ??
          record.evidence.abstract ??
          '');
    lines += 2.2 + Math.ceil(text.length / LINE_CHARS);
  }
  return lines;
}

type MediaView = VariantRenderInput['media'] | undefined;

/** Whether a placement names an image the view holds (all of them, when no media is given). */
const isImage = (asset: string, media: MediaView) =>
  media === undefined || (Object.hasOwn(media, asset) && media[asset]!.kind === 'image');

/**
 * A work prints as a series with two or more images, and as a plate with a
 * cover or one image. With none, it's text on a group page: no empty frames.
 */
function plateKind(work: Work, media: MediaView): 'plate' | 'series' | null {
  const images = (work.media ?? []).filter((placement) => isImage(placement.asset, media));
  if (images.length >= 2) return 'series';
  if ((work.cover && isImage(work.cover.asset, media)) || images.length === 1) return 'plate';
  return null;
}

type SpineItem = Era['entries'][number];

/** The spine's entries with their periods, oldest first. */
function spineItems(chronology: readonly ChronologyEntry[], now: string): SpineItem[] {
  return chronology
    .filter((entry) => entry.kind === 'role' || entry.kind === 'study')
    .flatMap((entry) => {
      const start = moment(entry.period.start, 'start', now);
      if (!start) return [];
      const end = entry.period.end ? moment(entry.period.end, 'end', now) : nowMoment(now);
      return [{ entry, start, end: end && end.idx >= start.idx ? end : start }];
    })
    .sort((a, b) => a.start.idx - b.start.idx);
}

/** The eras of the spine, merged where they overlap, oldest first. */
function spineEras(chronology: readonly ChronologyEntry[], now: string): Era[] {
  const eras: Era[] = [];
  for (const item of spineItems(chronology, now)) {
    const last = eras.at(-1);
    if (last && item.start.idx <= last.end.idx) {
      last.entries.push(item);
      if (item.end.idx > last.end.idx) last.end = item.end;
    } else {
      eras.push({ entries: [item], start: item.start, end: item.end });
    }
  }
  return eras;
}

/** Merge the adjacent pair with the shortest combined span until `max` remain. */
function capped(eras: Era[], max: number): Era[] {
  const out = [...eras];
  while (out.length > max) {
    let best = 0;
    let span = Infinity;
    for (let i = 0; i < out.length - 1; i += 1) {
      const combined = out[i + 1]!.end.idx - out[i]!.start.idx;
      if (combined < span) {
        span = combined;
        best = i;
      }
    }
    const a = out[best]!;
    const b = out[best + 1]!;
    out.splice(best, 2, {
      entries: [...a.entries, ...b.entries],
      start: a.start,
      end: b.end.idx > a.end.idx ? b.end : a.end,
    });
  }
  return out;
}

/** The month before a moment, at its precision: the end of the chapter before it. */
function before(at: Moment): Moment {
  if (at.precision === 'year') return { idx: at.idx - 1, year: at.year - 1, precision: 'year' };
  const month = at.month === 1 ? 12 : at.month! - 1;
  return { idx: at.idx - 1, year: month === 12 ? at.year - 1 : at.year, month, precision: 'month' };
}

/**
 * The owner's chapters as eras: each from its start to the month before the next, the last to
 * now. A spine entry joins the chapter its own move names, else the one it starts in, else the
 * first.
 */
function ownerEras(
  periods: readonly Period[],
  chronology: readonly ChronologyEntry[],
  place: Readonly<Record<string, string>>,
  now: string,
): Era[] {
  const NOW = nowMoment(now);
  const starts = periods.map((period) => moment(period.from, 'start', now)!);
  const eras: Era[] = starts.map((start, i) => ({
    entries: [],
    start,
    end: i + 1 < starts.length ? before(starts[i + 1]!) : NOW,
  }));
  for (const item of spineItems(chronology, now)) {
    const moved = periods.findIndex((period) => period.slug === place[item.entry.id]);
    let at = 0;
    starts.forEach((start, i) => {
      if (start.idx <= item.start.idx) at = i;
    });
    eras[moved >= 0 ? moved : at]!.entries.push(item);
  }
  return eras;
}

export function buildBook(
  input: Pick<VariantRenderInput, 'portfolio' | 'env' | 'controls'> &
    Partial<Pick<VariantRenderInput, 'media'>>,
  options: BookOptions = optionsOf(input.controls),
): Book {
  const { portfolio } = input;
  const now = input.env.now;
  const NOW = nowMoment(now);
  const sections = portfolio.sections;
  const proofIds = new Set(portfolio.proof);
  const recordById = new Map<string, BookRecord>([
    ...portfolio.works.map(
      (work) => [work.id, { type: 'work', id: work.id, work }] as [string, BookRecord],
    ),
    ...portfolio.evidence.map(
      (evidence) =>
        [evidence.id, { type: 'evidence', id: evidence.id, evidence }] as [string, BookRecord],
    ),
  ]);

  // The owner's chapters, when the book can bind them: none may start after now.
  let refused = options.periodsRefused;
  let periods = options.periods;
  if (periods.some((period) => fromIdx(period.from) > NOW.idx)) {
    refused = 'a chapter starts after now';
    periods = [];
  }

  // 1 and 2. Eras, from the owner's chapters, else the spine; else calendar years; else one chapter.
  let derivedFrom: Book['derivedFrom'] = periods.length > 0 ? 'owner' : 'chronology';
  let eras =
    periods.length > 0
      ? ownerEras(periods, portfolio.chronology, options.place, now)
      : spineEras(portfolio.chronology, now);
  if (eras.length === 0) {
    derivedFrom = 'years';
    const years = new Set<number>();
    for (const record of recordById.values()) {
      if (record.type === 'evidence' && record.evidence.type === 'external-work') continue;
      const at = recordDate(record, now);
      if (at) years.add(at.year);
    }
    for (const entry of portfolio.chronology) {
      const at = moment(entry.period.start, 'start', now);
      if (at) years.add(at.year);
    }
    eras = [...years]
      .sort((a, b) => a - b)
      .map((year) => ({
        entries: [],
        start: { idx: year * 12, year, precision: 'year' as const },
        end: { idx: year * 12 + 11, year, precision: 'year' as const },
      }));
  }
  if (derivedFrom !== 'owner') eras = capped(eras, options.maxChapters);

  // 3. Titles, spans, slugs and inks.
  const taken = new Set<string>(['back-matter']);
  const chapters: Chapter[] = eras.map((era, i) => {
    const entries = era.entries.map(({ entry }) => entry);
    const organizations: string[] = [];
    for (const entry of entries) {
      const name = normalOrganization(entry.organization);
      if (name && !organizations.includes(name)) organizations.push(name);
    }
    const principal = [...era.entries].sort(
      (a, b) => b.end.idx - b.start.idx - (a.end.idx - a.start.idx),
    )[0]?.entry;
    const owner = derivedFrom === 'owner' ? periods[i] : undefined;
    const open = owner
      ? i === eras.length - 1
      : era.end.idx >= NOW.idx && era.entries.some(({ entry }) => !entry.period.end);
    const years = open
      ? `Since ${era.start.year}`
      : era.start.year === era.end.year
        ? String(era.start.year)
        : `${era.start.year} to ${era.end.year}`;
    const named =
      organizations.length === 0
        ? undefined
        : organizations.length <= 2
          ? organizations.join(' and ')
          : `${organizations[0]}, ${organizations[1]} and ${organizations.length - 2} more`;
    const title = owner
      ? owner.title
      : options.chapterTitles === 'years'
        ? years
        : options.chapterTitles === 'role'
          ? (principal?.title ?? named ?? years)
          : (named ?? principal?.title ?? years);
    let slug = owner?.slug ?? (slugify(title) || `chapter-${i + 1}`);
    for (let n = 2; taken.has(slug); n += 1) slug = `${slugify(title) || `chapter-${i + 1}`}-${n}`;
    taken.add(slug);
    const roles = entries.map((entry) => {
      const head = normalOrganization(entry.organization);
      const sub =
        entry.organization && head !== entry.organization.trim()
          ? entry.organization.split(',').slice(1).join(',').trim()
          : undefined;
      return [entry.title, entry.field, sub].filter(Boolean).join(', ');
    });
    const locations = [...new Set(entries.flatMap((entry) => entry.location ?? []))];
    const span = open
      ? `Since ${era.start.precision === 'year' ? era.start.year : longMonth(era.start)}`
      : era.start.precision !== 'year' && era.end.precision !== 'year'
        ? `${longMonth(era.start)} to ${longMonth(era.end)}`
        : years;
    return {
      n: i + 1,
      slug,
      title,
      organizations,
      roles,
      locations,
      span,
      years,
      open,
      start: era.start,
      end: era.end,
      entries,
      side: [],
      ink: options.chapterAccents ? (i % 5) + 1 : 0,
      current: i === eras.length - 1,
      ...(owner?.teaser ? { teaser: owner.teaser } : {}),
      parts: [],
      firstPage: 0,
      lastPage: 0,
    };
  });
  if (chapters.length === 0) {
    derivedFrom = 'single';
    const first = sections.find(
      (section) =>
        (section.kind === 'works' || section.kind === 'evidence') && section.title !== undefined,
    );
    const title = first?.title ?? portfolio.identity.name;
    chapters.push({
      n: 1,
      slug: slugify(title) || 'chapter-1',
      title,
      organizations: [],
      roles: [],
      locations: [],
      span: '',
      years: '',
      open: true,
      start: undefined,
      end: undefined,
      entries: [],
      side: [],
      ink: options.chapterAccents ? 1 : 0,
      current: true,
      parts: [],
      firstPage: 0,
      lastPage: 0,
    });
  }
  const current = chapters.at(-1);

  // 4. Placement, first match wins, every record once.
  const placed = new Map<string, { chapter: Chapter; rule: string }>();
  const place = (id: string, chapter: Chapter | undefined, rule: string) => {
    if (chapter && !placed.has(id)) placed.set(id, { chapter, rule });
  };
  const chapterOfEntry = (id: string | undefined) =>
    id === undefined ? undefined : chapters.find((c) => c.entries.some((e) => e.id === id));
  const chapterByDate = (at: Moment | undefined): Chapter | undefined => {
    if (!at) return undefined;
    if (derivedFrom === 'single') return chapters[0];
    let found: Chapter | undefined;
    for (const chapter of chapters)
      if (chapter.start && chapter.start.idx <= at.idx) found = chapter;
    return found ?? chapters[0];
  };
  const moves = options.place;
  const movedTo = (id: string) =>
    Object.hasOwn(moves, id) ? chapters.find((c) => c.slug === moves[id]) : undefined;
  // (a) Links: a side thread joins its parent's chapter, and an entry's works join its chapter.
  // (b) A side thread with no parent goes where the owner moved it.
  for (const entry of portfolio.chronology) {
    const own = chapterOfEntry(entry.id);
    const parent = chapterOfEntry(entry.branchesFrom);
    const moved = parent ? undefined : movedTo(entry.id);
    const chapter =
      own ?? parent ?? moved ?? chapterByDate(moment(entry.period.start, 'start', now));
    if (!own && chapter) {
      chapter.side.push(entry);
      placed.set(entry.id, {
        chapter,
        rule: parent ? 'branchesFrom' : moved ? 'override' : 'dated',
      });
    }
    for (const work of entry.works ?? []) if (recordById.has(work)) place(work, chapter, 'linked');
  }
  // (b) The owner's moves: a work or an evidence record into a chapter the book has. External
  // work keeps its fixed page, Also by.
  for (const id of Object.keys(moves)) {
    const record = recordById.get(id);
    if (!record || (record.type === 'evidence' && record.evidence.type === 'external-work'))
      continue;
    place(id, movedTo(id), 'override');
  }
  // (c) Organization: a testimonial whose source names an era's organization.
  for (const record of recordById.values()) {
    if (record.type !== 'evidence' || record.evidence.type !== 'testimonial') continue;
    const source = normalOrganization(record.evidence.source?.organization);
    if (!source) continue;
    const chapter = chapters.find((c) =>
      c.organizations.some((o) => o === source || o.startsWith(source) || source.startsWith(o)),
    );
    place(record.id, chapter, 'organization');
  }
  // (d) Date, and (e) present tense.
  for (const record of recordById.values()) {
    if (record.type === 'evidence' && record.evidence.type === 'external-work') continue;
    const at = recordDate(record, now);
    if (at) place(record.id, chapterByDate(at), 'dated');
    else if (
      record.type === 'evidence' &&
      ((record.evidence.type === 'metric' && !proofIds.has(record.id)) ||
        record.evidence.type === 'testimonial')
    ) {
      place(record.id, current, 'present');
    } else if (derivedFrom === 'single') place(record.id, current, 'single');
  }

  // 5. The sections in authored order: fixed parts, and each chapter's groups.
  type Front = { -readonly [K in keyof Book['front']]: Book['front'][K] };
  type Close = { -readonly [K in keyof Book['close']]: Book['close'][K] };
  type Colophon = { -readonly [K in keyof Book['colophon']]: Book['colophon'][K] };
  const front: Partial<Front> = {};
  const close: Close = {};
  const colophon: Colophon = {};
  const alsoBy: { section: ViewSection; evidence: Evidence }[] = [];
  const uncollected = new Map<string, { section: ViewSection; records: BookRecord[] }>();
  const extras: ViewSection[] = [];
  let about: Book['back']['about'];
  let services: ViewSection | undefined;
  let skills: ViewSection | undefined;
  let tools: ViewSection | undefined;
  const groups = new Map<Chapter, Map<string, { section: ViewSection; records: BookRecord[] }>>();
  const shown = new Set<string>();
  const addTo = (
    into: Map<string, { section: ViewSection; records: BookRecord[] }>,
    section: ViewSection,
    record: BookRecord,
  ) => {
    const group = into.get(section.id) ?? { section, records: [] };
    group.records.push(record);
    into.set(section.id, group);
  };
  for (const section of sections) {
    switch (section.kind) {
      case 'hero':
        if (!front.hero) front.hero = section;
        else extras.push(section);
        break;
      case 'quote':
        if (!front.quote) front.quote = section;
        else extras.push(section);
        break;
      case 'lede':
        if (!front.preface) front.preface = section;
        else extras.push(section);
        break;
      case 'now':
        if (!close.now) close.now = section;
        else extras.push(section);
        break;
      case 'focus':
        if (!close.focus) close.focus = section;
        else extras.push(section);
        break;
      case 'github':
        if (!close.github) close.github = section;
        else extras.push(section);
        break;
      case 'contact':
        if (!colophon.contact) colophon.contact = section;
        else extras.push(section);
        break;
      case 'cta':
        if (!colophon.cta) colophon.cta = section;
        else extras.push(section);
        break;
      case 'fun-facts':
        if (!about) about = section;
        else extras.push(section);
        break;
      case 'practice':
        if (section.part === 'thesis' && !front.thesisSection) front.thesisSection = section;
        else if (section.part === 'services' && !services) services = section;
        else if (section.part === 'skills' && !skills) skills = section;
        else if (section.part === 'tools' && !tools) tools = section;
        else extras.push(section);
        break;
      case 'chronology':
        // Spine entries open their chapters, and side threads print in its Alongside line.
        for (const entry of chronologyOf(section, input)) shown.add(entry.id);
        break;
      case 'works':
      case 'evidence': {
        const records: BookRecord[] = [
          ...worksOf(section, input).map((work) => recordById.get(work.id)!),
          ...evidenceOf(section, input).map((evidence) => recordById.get(evidence.id)!),
        ];
        for (const record of records) {
          if (shown.has(record.id)) continue;
          if (record.type === 'evidence' && record.evidence.type === 'external-work') {
            shown.add(record.id);
            alsoBy.push({ section, evidence: record.evidence });
            continue;
          }
          // A proof record prints on the title page; a proof metric nowhere else.
          if (proofIds.has(record.id)) {
            if (
              !placed.has(record.id) ||
              (record.type === 'evidence' && record.evidence.type === 'metric')
            ) {
              continue;
            }
          }
          shown.add(record.id);
          const at = placed.get(record.id);
          if (!at) {
            addTo(uncollected, section, record);
            continue;
          }
          const into = groups.get(at.chapter) ?? new Map();
          groups.set(at.chapter, into);
          addTo(into, section, record);
        }
        break;
      }
      default:
        // Custom sections and an extension's kinds: the back matter.
        extras.push(section);
    }
  }

  // The title (derivation 5): the thesis's first sentence when it's 8 to 60
  // characters; else the name, with the whole thesis as the subtitle.
  const thesis = (portfolio.practice?.thesis ?? '').replace(/\s+/g, ' ').trim();
  const hero = front.hero;
  const lead = thesis || hero?.tagline?.trim() || portfolio.identity.tagline?.trim() || '';
  const sentence = /^(.{8,60}?[.!?])\s+(.+)$/.exec(lead);
  if (sentence) {
    front.title = sentence[1]!;
    front.subtitle = sentence[2]!;
  } else if (lead && lead.length <= 60) {
    front.title = lead;
    front.subtitle = thesis ? hero?.tagline : undefined;
  } else {
    front.title = portfolio.identity.name;
    front.subtitle = lead || undefined;
  }
  front.proof = portfolio.proof.flatMap((id) => recordById.get(id) ?? []);
  const grouped = new Set<string>([
    ...[...groups.values()].flatMap((into) => [...into.keys()]),
    ...uncollected.keys(),
    ...alsoBy.map(({ section }) => section.id),
  ]);
  front.proofSections = sections.flatMap((section): Group[] => {
    if ((section.kind !== 'works' && section.kind !== 'evidence') || grouped.has(section.id))
      return [];
    const records = [
      ...worksOf(section, input).map((work) => recordById.get(work.id)!),
      ...evidenceOf(section, input).map((evidence) => recordById.get(evidence.id)!),
    ].filter((record) => proofIds.has(record.id));
    return records.length > 0 ? [{ section, records, lines: 0 }] : [];
  });
  front.signature = portfolio.signature
    ? portfolio.works.find((work) => work.id === portfolio.signature)
    : undefined;

  // 6. Each chapter's parts, in authored section order.
  for (const chapter of chapters) {
    const parts: Part[] = [{ type: 'opener', key: ANCHORS.opening, title: 'Opening', page: 0 }];
    let pending: Group[] = [];
    let plateNo = 0;
    let plates = 0;
    const flush = () => {
      if (pending.length === 0) return;
      const spreads: { verso: Group[]; recto: Group[]; v: number; r: number }[] = [];
      let spread: (typeof spreads)[number] | undefined;
      for (const group of pending) {
        if (!spread) {
          spread = { verso: [], recto: [], v: 0, r: 0 };
          spreads.push(spread);
        }
        const fill = Math.min(spread.v, spread.r);
        if (spread.v > 0 && spread.r > 0 && fill + group.lines > PAGE_LINES) {
          spread = { verso: [], recto: [], v: 0, r: 0 };
          spreads.push(spread);
        }
        if (spread.v <= spread.r) {
          spread.verso.push(group);
          spread.v += group.lines;
        } else {
          spread.recto.push(group);
          spread.r += group.lines;
        }
      }
      for (const { verso, recto } of spreads) {
        const all = [...verso, ...recto];
        const key = `${all.map((group) => group.section.id).join('--')}--pages`;
        const title = all
          .map((group) => group.section.title)
          .filter(Boolean)
          .join(', ');
        parts.push(
          recto.length > 0
            ? { type: 'groups', key, title, verso, recto, page: 0 }
            : { type: 'flow', key, title, group: verso[0]!, page: 0 },
        );
      }
      pending = [];
    };
    for (const { section, records } of groups.get(chapter)?.values() ?? []) {
      const rest: BookRecord[] = [];
      for (const record of records) {
        const kind = record.type === 'work' ? plateKind(record.work, input.media) : null;
        if (record.type !== 'work' || kind === null) {
          rest.push(record);
          continue;
        }
        flush();
        if (kind === 'plate') {
          plateNo += 1;
          parts.push({
            type: 'plate',
            key: record.id,
            title: record.work.title,
            work: record.work,
            section,
            plate: `${chapter.n}.${plateNo}`,
            imageSide: plates % 2 === 0 ? 'recto' : 'verso',
            page: 0,
          });
        } else {
          const numbers = (record.work.media ?? [])
            .filter((placement) => isImage(placement.asset, input.media))
            .map(() => {
              plateNo += 1;
              return `${chapter.n}.${plateNo}`;
            });
          parts.push({
            type: 'series',
            key: record.id,
            title: section.title && records.length === 1 ? section.title : record.work.title,
            work: record.work,
            section,
            plates: numbers,
            page: 0,
          });
        }
        plates += 1;
      }
      if (rest.length > 0) pending.push({ section, records: rest, lines: estimate(section, rest) });
    }
    flush();
    if (chapter.current && (close.now || close.focus || close.github)) {
      parts.push({ type: 'close', key: ANCHORS.close, title: 'Still being written', page: 0 });
    }
    chapter.parts = parts;
  }

  // 7. Pages: two a spread, arabic from chapter 1.
  let page = 1;
  const printed = new Map<string, Locator>();
  for (const chapter of chapters) {
    chapter.firstPage = page;
    for (const part of chapter.parts) {
      part.page = page;
      // A locator is the folio printed under the page a thing is set on: the recto's is page + 1.
      const at = (folio: number): Locator => ({ chapter, page: folio, key: part.key });
      if (part.type === 'plate' || part.type === 'series')
        printed.set(part.work.id, at(headPage(part)));
      if (part.type === 'flow')
        for (const record of part.group.records) printed.set(record.id, at(page));
      if (part.type === 'groups') {
        for (const group of part.verso)
          for (const record of group.records) printed.set(record.id, at(page));
        for (const group of part.recto)
          for (const record of group.records) printed.set(record.id, at(page + 1));
      }
      page += 2;
    }
    chapter.lastPage = page - 1;
  }
  const backStart = page;
  // The index is there when the practice lists skills or tools, or the book names any: a spine
  // entry's skills, a printed work's tools.
  const workTools = (id: string) => {
    const record = recordById.get(id);
    return record?.type === 'work' ? (record.work.tools ?? []) : [];
  };
  const named =
    chapters.some((c) => c.entries.some((e) => (e.skills ?? []).length > 0)) ||
    [...printed.keys()].some((id) => workTools(id).length > 0);
  const indexed = Boolean(skills || tools || named);
  const backKeys: BackPart['key'][] = ['about'];
  if (services) backKeys.push('engagements');
  if (alsoBy.length > 0) backKeys.push('also-by');
  if (uncollected.size > 0 || extras.length > 0) backKeys.push('uncollected');
  if (indexed) backKeys.push('index');
  // The opening spread holds About the author, the next pages the rest, then the index's spread.
  const backParts: BackPart[] = backKeys.map((key) => ({
    key,
    // Each the folio it's set on: About the author on the opening recto, the engagements on
    // the next verso, Also by and Uncollected on its recto, the index from the verso after.
    page:
      key === 'about'
        ? backStart + 1
        : key === 'index'
          ? backStart + (backKeys.length > 2 ? 4 : 2)
          : key === 'engagements'
            ? backStart + 2
            : backStart + 3,
  }));
  const backPages = backKeys.includes('index')
    ? backKeys.length > 2
      ? 6
      : 4
    : backKeys.length > 1
      ? 4
      : 2;
  for (const group of uncollected.values()) {
    for (const record of group.records) {
      printed.set(record.id, { chapter: null, page: backStart + 3, key: ANCHORS.uncollected });
    }
  }

  // 8. The index: each skill and tool the practice lists, and each one the book names, with a
  // page wherever a spine entry's skills or a work's tools name it; a listed one with none
  // points to its group.
  const terms = new Map<string, Term>();
  const term = (name: string) => {
    const key = name.trim();
    let found = terms.get(key);
    if (!found) {
      found = { name: key, locators: [], groups: [] };
      terms.set(key, found);
    }
    return found;
  };
  const locate = (t: Term, at: Locator) => {
    if (!t.locators.some((l) => l.page === at.page)) t.locators.push(at);
  };
  if (skills) {
    for (const group of portfolio.practice?.skills ?? []) {
      for (const item of group.items) {
        const t = term(item);
        if (group.name && !t.groups.includes(group.name)) t.groups.push(group.name);
      }
    }
  }
  if (tools) {
    for (const group of portfolio.practice?.tools ?? []) {
      for (const item of group.items) {
        const t = term(item.name);
        if (group.name && !t.groups.includes(group.name)) t.groups.push(group.name);
        if (item.version) t.version = item.version;
      }
    }
  }
  if (indexed) {
    for (const chapter of chapters) {
      for (const entry of chapter.entries) {
        for (const skill of entry.skills ?? []) {
          if (skill.trim()) {
            locate(term(skill), { chapter, page: chapter.firstPage, key: ANCHORS.opening });
          }
        }
      }
    }
    for (const [id, at] of printed) {
      for (const tool of workTools(id)) if (tool.trim() && at.chapter) locate(term(tool), at);
    }
  }
  const sortedTerms = [...terms.values()].sort((a, b) =>
    a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }),
  );
  for (const t of sortedTerms) t.locators.sort((a, b) => a.page - b.page);

  // Works by kind, for the index's first part.
  const kindOf = (record: BookRecord): string | null => {
    if (record.type === 'work') {
      const medium = record.work.medium;
      if (medium === 'writing' || medium === 'research') return 'Writing';
      if (medium === 'audio-video' || medium === 'music') return 'Sound and episodes';
      if (medium === 'image-series' || medium === 'photography') return 'Photographs';
      return 'Works';
    }
    const type = record.evidence.type;
    if (type === 'publication') return 'Writing';
    if (type === 'talk') return 'Talks';
    if (type === 'award' || type === 'patent' || type === 'press') return 'Record';
    return null;
  };
  const byKind = new Map<string, KindEntry[]>();
  for (const [id, at] of printed) {
    const record = recordById.get(id);
    if (!record) continue;
    const kind = kindOf(record);
    if (!kind) continue;
    byKind.set(kind, [...(byKind.get(kind) ?? []), { record, at }]);
  }
  const kinds = ['Works', 'Writing', 'Talks', 'Sound and episodes', 'Photographs', 'Record']
    .filter((kind) => byKind.has(kind))
    .map((kind) => ({
      kind,
      entries: byKind.get(kind)!.sort((a, b) => a.at.page - b.at.page),
    }));

  // Where each section's frame lands, for a link the owner wrote to it (#<section id>).
  const sectionAt = new Map<string, SectionPlace>();
  const at = (id: string | undefined, place: SectionPlace) => {
    if (id !== undefined && !sectionAt.has(id)) sectionAt.set(id, place);
  };
  for (const section of [front.hero, front.thesisSection, front.quote, front.preface])
    at(section?.id, 'home');
  for (const section of [colophon.contact, colophon.cta]) at(section?.id, 'colophon');
  if (current)
    for (const section of [close.now, close.focus, close.github]) at(section?.id, current);
  for (const chapter of chapters) {
    for (const entry of [...chapter.entries, ...chapter.side]) {
      const listing = sections.find(
        (s) => s.kind === 'chronology' && chronologyOf(s, input).some((e) => e.id === entry.id),
      );
      at(listing?.id, chapter);
    }
    for (const part of chapter.parts) {
      if (part.type === 'plate' || part.type === 'series') at(part.section.id, chapter);
      if (part.type === 'groups')
        for (const g of [...part.verso, ...part.recto]) at(g.section.id, chapter);
      if (part.type === 'flow') at(part.group.section.id, chapter);
    }
  }
  for (const section of [
    about,
    services,
    skills,
    tools,
    ...alsoBy.map((a) => a.section),
    ...extras,
  ])
    at(section?.id, 'back');
  for (const group of uncollected.values()) at(group.section.id, 'back');
  for (const section of sections) at(section.id, 'home');

  const movedIds = Object.keys(moves).filter(
    (id) =>
      placed.get(id)?.rule === 'override' ||
      (derivedFrom === 'owner' &&
        chapters.some((c) => c.slug === moves[id] && c.entries.some((e) => e.id === id))),
  );
  const overrides: Overrides = {
    chapters: derivedFrom === 'owner' ? 'owner' : refused ? 'refused' : 'derived',
    ...(refused ? { reason: refused } : {}),
    moved: movedIds,
    kept: Object.keys(moves).filter((id) => !movedIds.includes(id)),
    ...(options.placeRefused ? { placeRefused: options.placeRefused } : {}),
  };

  const finishedFront = front as Front;
  return {
    derivedFrom,
    options,
    overrides,
    chapters,
    current,
    front: finishedFront,
    close,
    back: {
      ...(about ? { about } : {}),
      ...(services ? { services } : {}),
      alsoBy,
      uncollected: [...uncollected.values()].map(({ section, records }) => ({
        section,
        records,
        lines: estimate(section, records),
      })),
      extras,
      ...(skills ? { skills } : {}),
      ...(tools ? { tools } : {}),
      terms: sortedTerms,
      kinds,
      parts: backParts,
    },
    colophon,
    printed,
    sectionAt,
    placed,
    backStart,
    totalPages: backStart + backPages - 1,
  };
}

function longMonth(at: Moment): string {
  return at.month === undefined ? String(at.year) : `${monthName(at.month)} ${at.year}`;
}

/**
 * The folio a part's heading prints under: a plate's title is on its text page, the recto
 * when its image is on the verso; everything else starts on the verso.
 */
export function headPage(part: Part): number {
  return part.type === 'plate' && part.imageSide === 'verso' ? part.page + 1 : part.page;
}

/** The chapter a slug names, if any. */
export const chapterBySlug = (book: Book, slug: string | undefined) =>
  slug === undefined ? undefined : book.chapters.find((chapter) => chapter.slug === slug);

/** Front matter folios, i to iv. */
export const roman = (n: number): string =>
  ['', 'i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x'][n] ?? String(n);

/** Small counts as words: "three chapters". */
export const spelled = (n: number): string =>
  ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'][n] ??
  String(n);

/** Whether a chronology entry is on the spine. */
export const isSpine = (entry: ChronologyEntry) => entry.kind === 'role' || entry.kind === 'study';

export type { ViewSection };

/** The chronology entry by id, for an Alongside line's parent. */
export function entryById(
  input: Pick<VariantRenderInput, 'portfolio'>,
  id: string | undefined,
): ChronologyEntry | undefined {
  return id === undefined ? undefined : input.portfolio.chronology.find((e) => e.id === id);
}
