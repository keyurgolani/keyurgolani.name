import type { ChronologyEntry, Evidence, Section, SectionKind, Work } from '@portfolio/schema';
import {
  anchorSection,
  DESTINATION_LABELS,
  footerOutline,
  isRoutedWork,
  navigationModel,
  pageOutline,
  present,
  sectionRenders,
  worksOf,
  type CaseStudyField,
  type DestinationId,
  type FooterOutline,
  type NavigationModel,
  type OutlineSection,
  type SectionOf,
} from '@portfolio/kit/sections';
import { routeHref, type VariantRenderInput } from '@portfolio/variant-contract';

// Raw Grid's content model: every derivation the composition makes from a
// portfolio, pure, with no person's words in it (brief §5.3, N4). The
// pages read the portfolio only through these, so what a render shows is
// what the rules give: the opening (the hero, the first thesis, the pinned
// work, the stickers), the proof ticker, five destination sheets in the
// fixed order, and the closing block.

/** The fixed order of the sheets: the five destinations (K-1). */
export const SHEET_ORDER: readonly DestinationId[] = [
  'work',
  'writing',
  'record',
  'about',
  'contact',
];

/** The most stickers the poster pins, and the most facts the ticker runs. */
export const MAX_STICKERS = 3;
export const MAX_TICKER = 8;

/** A thesis's first sentence leads as the cell's headline only when it's this short, in words. */
export const HEADLINE_WORDS = 8;

/** Ids the composition gives its own elements: two hyphens, which no content id has. */
export function chromeIds(prefix: string) {
  return {
    index: `${prefix}rg--index`,
    indexTitle: `${prefix}rg--index-title`,
    pin: `${prefix}rg--pin`,
    sheet: (id: DestinationId) => `${prefix}rg--${id}`,
    sheetTitle: (id: DestinationId) => `${prefix}rg--${id}-title`,
    tickerLabel: `${prefix}rg--ticker`,
  };
}

/** Whether the text is there to show. */
export const said = (text: string | undefined | null): text is string => present(text);

/** The words of a text, for counting. */
const wordsOf = (text: string) => text.trim().split(/\s+/).filter(Boolean);

/** Abbreviations a sentence never ends on. */
const ABBREVIATION = /(?:^|\s)(?:[A-Z]|Mr|Mrs|Ms|Dr|St|Jr|Sr|Prof|vs|etc|e\.g|i\.e|cf|No|Vol)\.$/;

/**
 * A text's first sentence and the rest (K-6 `firstSentence`, kept here until
 * the kit lifts it): the first `.`, `!` or `?` followed by space and a
 * capital or a digit, outside a Markdown link, code, or emphasis, and never
 * after an abbreviation or an initial.
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
    // A closing quote or emphasis mark stays with its sentence.
    let end = i + 1;
    while (end < source.length && /["'”’*_)]/.test(source[end]!)) end++;
    if (source[end] !== ' ' || !/[\p{Lu}\p{N}"“‘(]/u.test(source[end + 1] ?? '')) continue;
    const lead = source.slice(0, end);
    if (char === '.' && ABBREVIATION.test(lead.replace(/[*_]+$/, ''))) continue;
    return { lead, rest: source.slice(end + 1) };
  }
  return { lead: source };
}

/**
 * The thesis as the opening's cell sets it: a first sentence of at most
 * HEADLINE_WORDS words is its headline and the rest its body; otherwise the
 * whole thesis is one paragraph. None for an empty thesis.
 */
export function thesisParts(
  thesis: string | undefined,
): { readonly lead?: string; readonly rest?: string } | undefined {
  if (!said(thesis)) return undefined;
  const { lead, rest } = firstSentence(thesis);
  if (wordsOf(lead).length <= HEADLINE_WORDS) return rest ? { lead, rest } : { lead };
  return { rest: thesis.replace(/\s+/g, ' ').trim() };
}

/**
 * The name stacked for the poster: split on whitespace into at most three
 * lines (the middle words share the middle line), and the longest line's
 * length in characters, which sets the fit.
 */
export function nameLines(name: string): {
  readonly lines: readonly string[];
  readonly longest: number;
} {
  const words = wordsOf(name);
  const lines =
    words.length <= 3 ? words : [words[0]!, words.slice(1, -1).join(' '), words.at(-1)!];
  return { lines, longest: Math.max(1, ...lines.map((line) => [...line].length)) };
}

/**
 * A work's title as the case poster fits it, in characters: its longest
 * word, so no word breaks, or a third of the whole, so a long title sets in
 * about three lines, as the name does.
 */
export function titleChars(title: string): number {
  const words = wordsOf(title);
  // A script that wraps between any two characters (Han, kana, Hangul, Thai) has no long word to
  // keep whole: its runs count as a third of the title at most, so it fits at a display size.
  const free =
    /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Thai}]/u;
  const third = Math.ceil([...title.trim()].length / 3);
  const longest = Math.max(
    1,
    ...words.map((word) =>
      free.test(word) ? Math.min([...word].length, third) : [...word].length,
    ),
  );
  return Math.max(longest, third);
}

/**
 * A title's longest piece the browser keeps whole, in characters: the run between spaces (not a
 * no-break space) and after each hyphen, dash or slash, with its punctuation, so a card title
 * fitted by it never breaks inside "POSTMORTEM-" or strands the comma of "RECORDINGS,". A run in
 * a script that wraps between any two characters counts as a third of the title at most.
 */
export function longestToken(title: string): number {
  const free =
    /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Thai}]/u;
  const third = Math.ceil([...title.trim()].length / 3);
  const tokens = title
    .trim()
    .split(/[^\S\u00a0]+/)
    .flatMap((word) => word.split(/(?<=[-\u2010-\u2014/])/))
    .filter(Boolean);
  return Math.max(
    1,
    ...tokens.map((token) =>
      free.test(token) ? Math.min([...token].length, third) : [...token].length,
    ),
  );
}

/** A title whose last word is a number or a letter or two ("Vol. 1") keeps it with the word before. */
export const keepTail = (title: string) => title.replace(/\s+(\S{1,2})$/u, '\u00a0$1');

/** A loose date as text that sorts, newest last: the first date-like field a record has. */
const dateOf = (record: Evidence | ChronologyEntry): string => {
  if ('type' in record) {
    return String(
      record.receivedAt ??
        record.publishedAt ??
        record.presentedAt ??
        record.grantedAt ??
        record.filedAt ??
        record.asOf ??
        '',
    );
  }
  return String(record.period.start ?? '');
};

/** The newest of the records, by their own dates, the first listed on a tie. */
function newest<T extends Evidence | ChronologyEntry>(records: readonly T[]): T | undefined {
  let best: T | undefined;
  for (const record of records) {
    if (best === undefined || dateOf(record).localeCompare(dateOf(best)) > 0) best = record;
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
  );
}

/** Whether the record has its anchor on this page: a section the composition renders lists it. */
export function onPage(record: { readonly id: string }, input: VariantRenderInput): boolean {
  return anchorSection(record, input) !== undefined;
}

/** A link to a record where the page shows it. */
export const recordHref = (record: { readonly id: string }, input: VariantRenderInput) =>
  `#${input.ids.prefix}${record.id}`;

/** One sticker: a fact a record states, linking to it. */
export interface Sticker {
  readonly id: string;
  /** The first takes the emphasis ground, the rest the plain one. */
  readonly tone: 'emphasis' | 'plain';
  /** Its words: the record's own, with at most one word of the composition's, which `own` marks. */
  readonly line: string;
  readonly sub?: string;
  /** Which of the lines is the composition's own word, in English. */
  readonly own?: 'line';
  readonly lang?: string;
}

/** A sticker's words: the record's own, plus at most one kit word ("Published in"). */
export function stickerText(
  record: Evidence | ChronologyEntry,
): Pick<Sticker, 'line' | 'sub' | 'own'> | undefined {
  if ('type' in record) {
    switch (record.type) {
      case 'award':
        return said(record.title)
          ? {
              line: record.title,
              ...(said(record.receivedAt) ? { sub: String(record.receivedAt).slice(0, 4) } : {}),
            }
          : undefined;
      case 'publication':
        // "Published in" names a venue; with none, the title stands alone.
        if (said(record.venue)) return { line: 'Published in', sub: record.venue, own: 'line' };
        return said(record.title) ? { line: record.title } : undefined;
      case 'press':
        return said(record.publication)
          ? { line: 'Written up in', sub: record.publication, own: 'line' }
          : undefined;
      case 'patent':
        return said(record.title)
          ? { line: record.title, ...(said(record.number) ? { sub: record.number } : {}) }
          : undefined;
      default: {
        const line = said(record.title) ? record.title : undefined;
        return line ? { line } : undefined;
      }
    }
  }
  return { line: record.title, ...(said(record.organization) ? { sub: record.organization } : {}) };
}

/** A control's list of ids, as the manifest declares it. */
const idList = (value: unknown): readonly string[] =>
  Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];

/**
 * The poster's stickers, at most three, each a fact a record on this page
 * states, linking to it:
 * - the `stickers` control's ids (evidence or chronology), in its order;
 * - otherwise, or when none of them is a record this page shows (a stale
 *   control), the newest award in proof (else the newest award), the newest
 *   publication, and the current role.
 * None found: none, and the poster closes up.
 */
export function stickersOf(input: VariantRenderInput): readonly Sticker[] {
  const { portfolio } = input;
  const evidence = new Map(portfolio.evidence.map((record) => [record.id, record]));
  const chronology = new Map(portfolio.chronology.map((entry) => [entry.id, entry]));
  const shown = <T extends { readonly id: string }>(records: readonly T[]) =>
    records.filter((record) => onPage(record, input));
  const chosen = shown(
    idList(input.controls.stickers).flatMap((id) => {
      const record = evidence.get(id) ?? chronology.get(id);
      return record ? [record] : [];
    }),
  );
  let records: (Evidence | ChronologyEntry)[];
  if (chosen.length > 0) {
    records = chosen;
  } else {
    const awards = shown(portfolio.evidence.filter((record) => record.type === 'award'));
    const proofAwards = awards.filter((record) => portfolio.proof.includes(record.id));
    const role = currentRole(input);
    records = [
      newest(proofAwards.length > 0 ? proofAwards : awards),
      newest(shown(portfolio.evidence.filter((record) => record.type === 'publication'))),
      role && onPage(role, input) ? role : undefined,
    ].filter((record): record is Evidence | ChronologyEntry => record !== undefined);
  }
  const stickers: Sticker[] = [];
  for (const record of shown(records)) {
    if (stickers.length === MAX_STICKERS || stickers.some(({ id }) => id === record.id)) continue;
    const text = stickerText(record);
    if (!text) continue;
    stickers.push({
      id: record.id,
      tone: stickers.length === 0 ? 'emphasis' : 'plain',
      ...text,
      ...(record.lang !== undefined ? { lang: record.lang } : {}),
    });
  }
  return stickers;
}

/** A statement's first clause: up to its first comma, stop, semicolon, colon, or dash. */
const firstClause = (text: string) =>
  text
    .split(/[,.;:—–]/)[0]!
    .replace(/[*_`]/g, '')
    .trim();

/** A clause's first letter lowered, when it's a capital that starts a plain word. */
const lowerFirst = (text: string) =>
  /^\p{Lu}\p{Ll}/u.test(text) ? text[0]!.toLowerCase() + text.slice(1) : text;

/** The format a figure takes in the ticker: grouped digits in the content's locale. */
const figure = (value: number, locale: string) => {
  try {
    return new Intl.NumberFormat(locale).format(value);
  } catch {
    return new Intl.NumberFormat('en').format(value);
  }
};

/**
 * One fact as a short line, its record's own words: a metric is its figure,
 * its unit (unless the statement starts with it), and the first clause of
 * its statement ("12 years engineering"); an award is its title and year;
 * anything else its title. None when the record says too little.
 */
export function factText(record: Evidence, locale: string): string | undefined {
  if (record.type === 'metric' && record.metric?.value !== undefined) {
    const clause = said(record.statement) ? firstClause(record.statement) : '';
    const unit = record.metric.unit;
    const leads = said(unit) && clause.toLowerCase().startsWith(unit.toLowerCase());
    const head = `${figure(record.metric.value, locale)}${said(unit) && !leads ? ` ${unit}` : ''}`;
    return clause ? `${head} ${lowerFirst(clause)}` : head;
  }
  if (record.type === 'award' && said(record.title)) {
    return said(record.receivedAt)
      ? `${record.title}, ${String(record.receivedAt).slice(0, 4)}`
      : record.title;
  }
  return said(record.title) ? record.title : undefined;
}

/** One ticker fact. */
export interface TickerFact {
  readonly id: string;
  readonly text: string;
  readonly lang?: string;
}

/**
 * The ticker's facts: the `tickerItems` control's evidence when set;
 * otherwise, or when none of it is a fact this page shows (a stale
 * control), the proof list, then every metric a rendered evidence section
 * lists, without repeats, up to MAX_TICKER. Each is a record the page shows
 * as DOM text elsewhere, so the track can be hidden from assistive
 * technology. Fewer than two, or the `ticker` control off: none.
 */
export function tickerFacts(input: VariantRenderInput): readonly TickerFact[] {
  if (input.controls.ticker === false) return [];
  const { portfolio } = input;
  const evidence = new Map(portfolio.evidence.map((record) => [record.id, record]));
  const factsOf = (ids: readonly string[]) => {
    const facts: TickerFact[] = [];
    for (const id of ids) {
      if (facts.length === MAX_TICKER) break;
      const record = evidence.get(id);
      if (!record || !onPage(record, input) || facts.some((fact) => fact.id === id)) continue;
      const text = factText(record, record.lang ?? portfolio.locale);
      if (text)
        facts.push({ id, text, ...(record.lang !== undefined ? { lang: record.lang } : {}) });
    }
    return facts;
  };
  const chosen = factsOf(idList(input.controls.tickerItems));
  const facts =
    chosen.length > 0
      ? chosen
      : factsOf([
          ...portfolio.proof,
          ...portfolio.sections
            .filter((section) => section.kind === 'evidence' && sectionRenders(section, input))
            .flatMap((section) => (section as SectionOf<'evidence'>).items)
            .filter((id) => evidence.get(id)?.type === 'metric'),
        ]);
  return facts.length >= 2 ? facts : [];
}

/**
 * The pinned work: the signature, else the first featured work, else the
 * first work of the first works section, so long as a section shows it.
 */
export function pinnedWork(input: VariantRenderInput): Work | undefined {
  const { portfolio } = input;
  const byId = new Map(portfolio.works.map((work) => [work.id, work]));
  const candidates = [
    portfolio.signature,
    portfolio.featured[0],
    ...portfolio.sections
      .filter((section) => section.kind === 'works' && sectionRenders(section, input))
      .flatMap((section) => worksOf(section, input).map(({ id }) => id))
      .slice(0, 1),
  ];
  for (const id of candidates) {
    const work = id ? byId.get(id) : undefined;
    if (work && onPage(work, input)) return work;
  }
  return undefined;
}

/** Where a work's title links: its own page when it has one, else where the page shows it. */
export function workHref(work: Work, input: VariantRenderInput): string | undefined {
  if (isRoutedWork(work)) return routeHref(input, { route: 'work', slug: work.slug });
  return undefined;
}

/** The mediums a works section shows as photographs. */
const PHOTOGRAPHS = new Set(['photography', 'image-series']);

/**
 * What a section lists, as its band head counts it, or none for a section
 * that is one thing (a lede, a now, a quote, the GitHub snapshot, a
 * contact): works count their works, except photographs, which count
 * each frame (RG-M4); practice counts the items its groups hold.
 */
export function countOf(
  section: Section,
  input: VariantRenderInput,
): { readonly n: number; readonly unit: 'entries' | 'photographs' } | undefined {
  switch (section.kind) {
    case 'works': {
      const works = worksOf(section, input);
      if (works.length > 0 && works.every((work) => PHOTOGRAPHS.has(work.medium))) {
        const frames = works.reduce((n, work) => n + Math.max(1, work.media?.length ?? 0), 0);
        return { n: frames, unit: 'photographs' };
      }
      return { n: works.length, unit: 'entries' };
    }
    case 'evidence':
    case 'chronology':
    case 'focus':
    case 'fun-facts':
      return { n: listOf(section, input), unit: 'entries' };
    case 'practice': {
      const part = input.portfolio.practice?.[section.part];
      if (!Array.isArray(part)) return undefined;
      const n = part.reduce(
        (sum: number, group: { items?: readonly unknown[] }) => sum + (group.items?.length ?? 0),
        0,
      );
      return { n, unit: 'entries' };
    }
    case 'custom':
      return section.items?.length ? { n: section.items.length, unit: 'entries' } : undefined;
    default:
      return undefined;
  }
}

function listOf(section: Section, input: VariantRenderInput): number {
  switch (section.kind) {
    case 'evidence':
      return section.items.filter((id) =>
        input.portfolio.evidence.some((record) => record.id === id),
      ).length;
    case 'chronology': {
      const ids = section.items ?? input.portfolio.chronology.map(({ id }) => id);
      return ids.filter((id) => input.portfolio.chronology.some((entry) => entry.id === id)).length;
    }
    case 'focus':
    case 'fun-facts':
      return section.items.length;
    default:
      return 0;
  }
}

/** The kinds that are one thing, which never pair. */
const COMPACT_EVIDENCE = new Set(['award', 'patent', 'publication', 'press', 'external-work']);

/** Whether an evidence section lists one or two compact records. */
function compactEvidence(section: Section, input: VariantRenderInput): number | undefined {
  if (section.kind !== 'evidence') return undefined;
  const records = section.items.flatMap((id) =>
    input.portfolio.evidence.filter((record) => record.id === id),
  );
  if (records.length === 0 || records.length > 2) return undefined;
  return records.every((record) => COMPACT_EVIDENCE.has(record.type)) ? records.length : undefined;
}

/**
 * The sheet's rows: two neighbours share a 6/6 row only when both list the
 * same number (one or two) of compact evidence records, or a Now sits
 * before a focus list. Greedy, in content order, so reading order holds.
 */
export function rowsOf(
  sections: readonly Section[],
  input: VariantRenderInput,
): readonly (readonly Section[])[] {
  const rows: Section[][] = [];
  for (let i = 0; i < sections.length; i++) {
    const a = sections[i]!;
    const b = sections[i + 1];
    const evidence = compactEvidence(a, input);
    const pairs =
      b !== undefined &&
      ((a.kind === 'now' && b.kind === 'focus') ||
        (evidence !== undefined && compactEvidence(b, input) === evidence));
    if (pairs) {
      rows.push([a, b]);
      i++;
    } else rows.push([a]);
  }
  return rows;
}

/** One sheet: a destination's word and its sections, in content order. */
export interface Sheet {
  readonly id: DestinationId;
  readonly label: string;
  readonly lang?: string;
  /** What the sheet's table of contents lists: every section the destination places, the opening's included. */
  readonly toc: readonly OutlineSection[];
  /** The sections the sheet renders itself, in rows. */
  readonly rows: readonly (readonly Section[])[];
}

/** The page plan. */
export interface HomeModel {
  readonly navigation: NavigationModel;
  readonly footer: FooterOutline;
  readonly hero?: SectionOf<'hero'>;
  readonly thesis?: SectionOf<'practice'>;
  readonly pinned?: Work;
  readonly stickers: readonly Sticker[];
  readonly ticker: readonly TickerFact[];
  readonly sheets: readonly Sheet[];
  readonly contact?: SectionOf<'contact'>;
  readonly cta?: SectionOf<'cta'>;
  /** How many sections the page lists, for the header's resting "where" cell. */
  readonly sectionCount: number;
  /** The host's words, marked English in a portfolio in another language. */
  readonly uiLang: 'en' | undefined;
}

/** Whether the practice part has words to show. */
const thesisText = (input: VariantRenderInput) => input.portfolio.practice?.thesis;

/** Builds the page plan from the render input. */
export function homeModel(input: VariantRenderInput): HomeModel {
  const { portfolio } = input;
  const outline = pageOutline(input);
  const navigation = navigationModel(outline);
  const footer = footerOutline(input);
  const rendered = portfolio.sections.filter((section) => sectionRenders(section, input));
  const hero = rendered.find((section): section is SectionOf<'hero'> => section.kind === 'hero');
  const thesis = said(thesisText(input))
    ? rendered.find(
        (section): section is SectionOf<'practice'> =>
          section.kind === 'practice' && section.part === 'thesis',
      )
    : undefined;
  const contact = rendered.find(
    (section): section is SectionOf<'contact'> => section.kind === 'contact',
  );
  const cta = footer.cta
    ? rendered.find(
        (section): section is SectionOf<'cta'> =>
          section.kind === 'cta' && section.id === footer.cta!.id,
      )
    : undefined;
  // The opening and the closing render their own sections; the sheets the rest.
  const elsewhere = new Set([hero?.id, thesis?.id, contact?.id, cta?.id].filter(said));
  const byId = new Map(rendered.map((section) => [section.id, section]));
  const placed = new Map<DestinationId, Section[]>();
  const unplaced: Section[] = [];
  for (const section of rendered) {
    if (elsewhere.has(section.id)) continue;
    const to = navigation.placed.get(section.id) ?? null;
    if (to === null) unplaced.push(section);
    else placed.set(to, [...(placed.get(to) ?? []), section]);
  }
  // A section no destination takes closes About, so nothing drops.
  if (unplaced.length > 0) placed.set('about', [...(placed.get('about') ?? []), ...unplaced]);
  const destinations = new Map(
    navigation.primary.map((destination) => [destination.id, destination]),
  );
  const uiLang = /^en(?:-|$)/i.test(portfolio.locale) ? undefined : ('en' as const);
  const sheets: Sheet[] = SHEET_ORDER.flatMap((id): Sheet[] => {
    const sections = placed.get(id) ?? [];
    if (sections.length === 0) return [];
    const destination = destinations.get(id);
    const toc = [
      ...(destination?.sections ?? []),
      ...unplaced
        .filter(() => id === 'about')
        .flatMap((section) => outline.sections.filter((entry) => entry.id === section.id)),
    ].filter(
      (entry, index, all) =>
        byId.has(entry.id) && all.findIndex(({ id: other }) => other === entry.id) === index,
    );
    return [
      {
        id,
        label: destination?.label ?? DESTINATION_LABELS[id],
        ...(destination?.lang !== undefined
          ? { lang: destination.lang }
          : uiLang
            ? { lang: uiLang }
            : {}),
        toc,
        rows: rowsOf(sections, input),
      },
    ];
  });
  return {
    navigation,
    footer,
    ...(hero ? { hero } : {}),
    ...(thesis ? { thesis } : {}),
    ...(pinnedWork(input) ? { pinned: pinnedWork(input)! } : {}),
    stickers: stickersOf(input),
    ticker: tickerFacts(input),
    sheets,
    ...(contact ? { contact } : {}),
    ...(cta ? { cta } : {}),
    sectionCount: navigation.index.length,
    uiLang,
  };
}

/** The sections of one kind, for a renderer that needs its section's kind narrowed. */
export const isKind = <K extends SectionKind>(section: Section, kind: K): section is SectionOf<K> =>
  section.kind === kind;

// The case page (phase 2): a work's own page, /work/<slug>, as a poster of
// its own. Pure, like the rest: what the page shows is what these give.

/** The words of a work's medium in the fact sheet, the composition's own. */
const MEDIUM_WORDS: Readonly<Record<string, string>> = {
  interface: 'Interface',
  system: 'System',
  software: 'Software',
  photography: 'Photography',
  'image-series': 'Photographs',
  writing: 'Writing',
  research: 'Research',
  music: 'Music',
  'audio-video': 'Audio and video',
  object: 'Object',
};

/** A core medium's words; none for an extension's. */
export const mediumWords = (work: Pick<Work, 'medium'>): string | undefined =>
  Object.hasOwn(MEDIUM_WORDS, work.medium) ? MEDIUM_WORDS[work.medium] : undefined;

/** The evidence a work cites, in its order, that the view holds, each once. */
export function citedOf(work: Work, input: VariantRenderInput): readonly Evidence[] {
  const byId = new Map(input.portfolio.evidence.map((record) => [record.id, record]));
  const seen = new Set<string>();
  return (work.evidence ?? []).flatMap((id) => {
    const record = byId.get(id);
    if (!record || seen.has(id)) return [];
    seen.add(id);
    return [record];
  });
}

/** The kinds of record a case poster may pin: each states one fact in a few words. */
const CASE_STICKERS = new Set(['award', 'press', 'publication', 'patent']);

/**
 * The case poster's stickers: up to three of the records the work cites,
 * in its order, each a fact in its own words linking to its cell on the
 * page, the first in ink. None, and the poster closes up.
 */
export function caseStickers(work: Work, input: VariantRenderInput): readonly Sticker[] {
  const stickers: Sticker[] = [];
  for (const record of citedOf(work, input)) {
    if (stickers.length === MAX_STICKERS || !CASE_STICKERS.has(record.type)) continue;
    const text = stickerText(record);
    if (!text) continue;
    stickers.push({
      id: record.id,
      tone: stickers.length === 0 ? 'emphasis' : 'plain',
      ...text,
      ...(record.lang !== undefined ? { lang: record.lang } : {}),
    });
  }
  return stickers;
}

/**
 * The case page's ticker: the work's own highlights, which its fact sheet
 * lists as text, so the track can stay hidden from assistive technology.
 * Fewer than two, or the `ticker` control off: none.
 */
export function caseTicker(work: Work, input: VariantRenderInput): readonly TickerFact[] {
  if (input.controls.ticker === false) return [];
  const facts = (work.highlights ?? [])
    .filter(said)
    .slice(0, MAX_TICKER)
    .map((text, index) => ({
      id: `${work.id}-${index}`,
      text,
      ...(work.lang !== undefined ? { lang: work.lang } : {}),
    }));
  return facts.length >= 2 ? facts : [];
}

/** The parts that are one text each, which may share a row with a neighbour. */
const TEXT_PARTS = new Set<CaseStudyField>([
  'challenge',
  'context',
  'role',
  'constraints',
  'outcomes',
]);

/**
 * The case's rows, in the parts' order: two neighbouring text parts share a
 * row, half each; the decisions, the reflection, a text with no text beside
 * it, and the evidence when it cites records run the field's width, so no
 * pair holds blank beside a taller neighbour. The evidence with no record
 * cited is a text like any other.
 */
export function caseRows(
  parts: readonly CaseStudyField[],
  citesRecords: boolean,
): readonly (readonly CaseStudyField[])[] {
  const pairs = (part: CaseStudyField) =>
    TEXT_PARTS.has(part) || (part === 'evidence' && !citesRecords);
  const rows: CaseStudyField[][] = [];
  for (let i = 0; i < parts.length; i++) {
    const a = parts[i]!;
    const b = parts[i + 1];
    if (b !== undefined && pairs(a) && pairs(b)) {
      rows.push([a, b]);
      i++;
    } else rows.push([a]);
  }
  return rows;
}

/** A work's media past its cover: all of them, less the first only when it became the cover. */
export function otherMedia<P>(
  work: { readonly cover?: unknown; readonly media?: readonly P[] },
  firstIsCover: boolean,
): readonly P[] {
  const media = work.media ?? [];
  return firstIsCover && work.cover === undefined ? media.slice(1) : media;
}

/** Markdown as its plain words: a link's text, no emphasis marks, no code ticks. */
export const plainWords = (markdown: string) =>
  markdown
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * The next work: the one after this in the order the page's works sections
 * show them, writing left out, round to the first; none when this is the
 * only one.
 */
export function nextWork(work: Work, input: VariantRenderInput): Work | undefined {
  const order: Work[] = [];
  for (const section of input.portfolio.sections) {
    if (section.kind !== 'works' || !sectionRenders(section, input)) continue;
    for (const each of worksOf(section, input)) {
      if (each.medium !== 'writing' && !order.some(({ id }) => id === each.id)) order.push(each);
    }
  }
  const at = order.findIndex(({ id }) => id === work.id);
  return [...order.slice(at + 1), ...order.slice(0, Math.max(at, 0))].find(
    ({ id }) => id !== work.id,
  );
}
